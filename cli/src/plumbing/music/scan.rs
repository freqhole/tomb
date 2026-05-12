//! scan and directory management commands

use clap::Parser;
use grimoire::jobs::{
    add_directory_tags, create_job, create_job_session, list_scanned_directories,
    record_scanned_directory, remove_scanned_directory, CreateJobRequest, CreateJobSessionRequest,
    JobType, ScanDirectoryParams,
};

use crate::plumbing::utils::CommandOutput;

/// scan and directory management commands
#[derive(Debug, Parser)]
pub enum ScanAction {
    /// scan a directory for audio files
    Scan {
        /// directory path to scan
        path: String,

        /// comma-separated list of tags to apply to all albums in this directory
        #[arg(long, value_delimiter = ',')]
        tags: Option<Vec<String>>,
    },

    /// rescan all tracked directories
    Rescan,

    /// list tracked directories
    Directories,

    /// remove a directory from tracking
    RemoveDirectory {
        /// directory path to remove
        path: String,
    },

    /// validate that all blob files still exist on disk
    ValidateFiles,
}

pub async fn handle_command(action: ScanAction) -> CommandOutput<serde_json::Value> {
    match action {
        ScanAction::Scan { path, tags } => {
            eprintln!("scanning directory: {}", path);

            // set up directory tag rules if tags were specified
            if let Some(tag_names) = &tags {
                if !tag_names.is_empty() {
                    eprintln!("setting up directory tag rules for: {:?}", tag_names);
                    let tag_response =
                        add_directory_tags(&path, tag_names.clone(), Some("cli-scan".to_string()))
                            .await;
                    if tag_response.success {
                        eprintln!(
                            "directory tag rules configured: {} tags for {}",
                            tag_names.len(),
                            path
                        );
                    } else {
                        eprintln!(
                            "warning: failed to set up directory tags: {}",
                            tag_response.message
                        );
                    }
                }
            }

            // create a job session for this scan
            let session_request = CreateJobSessionRequest {
                job_type: JobType::ProcessFile,
                batch_size: None,
                created_by: Some("cli-scan".to_string()),
            };

            let session_response = create_job_session(session_request).await;
            if !session_response.success {
                return CommandOutput::failure(
                    format!("Failed to create job session: {}", session_response.message),
                    session_response.errors,
                    (),
                );
            }

            let session = session_response.data.unwrap();
            let session_id = &session.id;
            eprintln!("created job session: {}", session_id);

            // record the scanned directory for future rescans (before queueing job
            // so that other scans can skip this subdir)
            let _ = record_scanned_directory(&path, 0, None).await;

            // create a ScanDirectory job instead of scanning synchronously
            let scan_params = ScanDirectoryParams {
                directory_path: path.clone(),
                recursive: true,
                max_depth: None,
                file_extensions: None,
                skip_tracked_subdirs: true,
            };

            let job_request = CreateJobRequest {
                job_type: JobType::ScanDirectory,
                session_id: Some(session_id.to_string()),
                parameters: serde_json::to_value(&scan_params).unwrap_or_default(),
                max_retries: Some(0),
                scheduled_at: None,
                created_by: Some("cli-scan".to_string()),
                priority: None,
            };

            let response = create_job(job_request).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let job = response.data.unwrap();

            let message = format!("scan job created: {}", job.id);
            eprintln!("use 'freqhole jobs status {}' to check progress", job.id);

            let data = serde_json::json!({
                "path": path,
                "job_id": job.id,
                "session_id": session_id,
                "status": job.status,
                "tags_configured": tags.as_ref().map(|t| t.len()).unwrap_or(0),
            });

            CommandOutput::success(message, data)
        }

        ScanAction::Rescan => {
            eprintln!("creating rescan job for all tracked directories...");

            // create a rescan job
            let job_request = CreateJobRequest {
                job_type: JobType::RescanDirectories,
                session_id: None,
                parameters: serde_json::json!({}),
                max_retries: Some(0), // no retries for rescan
                scheduled_at: None,   // immediate
                created_by: Some("cli".to_string()),
                priority: None,
            };

            let response = create_job(job_request).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let job = response.data.unwrap();

            let message = format!("rescan job created: {}", job.id);
            let data = serde_json::json!({
                "job_id": job.id,
                "status": job.status,
            });

            CommandOutput::success(message, data)
        }

        ScanAction::Directories => {
            let response = list_scanned_directories().await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let directories = response.data.unwrap_or_default();

            if directories.is_empty() {
                return CommandOutput::success("no directories tracked", serde_json::json!([]));
            }

            // format for display
            let data = serde_json::json!(directories
                .iter()
                .map(|d| {
                    serde_json::json!({
                        "path": d.path,
                        "file_count": d.file_count,
                        "last_scanned_at": format_timestamp(d.last_scanned_at),
                        "created_at": format_timestamp(d.created_at),
                    })
                })
                .collect::<Vec<_>>());

            let message = format!("found {} tracked directories", directories.len());
            CommandOutput::success(message, data)
        }

        ScanAction::RemoveDirectory { path } => {
            let response = remove_scanned_directory(&path).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let message = format!("removed directory from tracking: {}", path);
            CommandOutput::success(message, ())
        }

        ScanAction::ValidateFiles => {
            eprintln!("creating validation job to check for missing files...");

            // validation is part of the rescan job, so we can just trigger a rescan
            // but with a different message to indicate it's for validation
            let job_request = CreateJobRequest {
                job_type: JobType::RescanDirectories,
                session_id: None,
                parameters: serde_json::json!({}),
                max_retries: Some(0),
                scheduled_at: None,
                created_by: Some("cli".to_string()),
                priority: None,
            };

            let response = create_job(job_request).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let job = response.data.unwrap();

            let message = format!("validation job created: {}", job.id);
            eprintln!("job will scan directories and check for missing files");
            eprintln!("use 'freqhole jobs status {}' to check progress", job.id);

            let data = serde_json::json!({
                "job_id": job.id,
                "status": job.status,
            });

            CommandOutput::success(message, data)
        }
    }
}

/// format unix timestamp for display
fn format_timestamp(timestamp: i64) -> String {
    use time::OffsetDateTime;
    match OffsetDateTime::from_unix_timestamp(timestamp) {
        Ok(dt) => {
            let format =
                time::format_description::parse("[year]-[month]-[day] [hour]:[minute]:[second]")
                    .unwrap();
            dt.format(&format).unwrap_or_else(|_| timestamp.to_string())
        }
        Err(_) => timestamp.to_string(),
    }
}
