//! scan and directory management commands

use clap::Parser;
use grimoire::jobs::{
    create_job, list_scanned_directories, record_scanned_directory, remove_scanned_directory,
    CreateJobRequest, JobType,
};
use grimoire::music::scanner::scan_directory;

use crate::plumbing::utils::CommandOutput;

/// scan and directory management commands
#[derive(Debug, Parser)]
pub enum ScanAction {
    /// scan a directory for audio files
    Scan {
        /// directory path to scan
        path: String,

        /// create a session for batch processing
        #[arg(long)]
        session_id: Option<String>,
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
        ScanAction::Scan { path, session_id } => {
            // generate session id if not provided
            let session_id = session_id.unwrap_or_else(|| {
                use time::OffsetDateTime;
                let timestamp = OffsetDateTime::now_utc().unix_timestamp();
                format!("scan-{}", timestamp)
            });

            eprintln!("scanning directory: {}", path);
            eprintln!("session id: {}", session_id);

            let response = scan_directory(&path, &session_id, true, None, None).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let file_count = response.data.unwrap_or(0);

            // record the scanned directory for future rescans
            let _ = record_scanned_directory(&path, file_count as i64, None).await;

            let message = format!("scan complete: found {} audio files", file_count);
            let data = serde_json::json!({
                "path": path,
                "session_id": session_id,
                "files_found": file_count,
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
