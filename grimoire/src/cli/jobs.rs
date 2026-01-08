//! Job queue management CLI commands

use crate::error::GrimoireResult;
use crate::jobs::{
    create_job, create_job_session, get_queue_stats, list_jobs, CreateJobRequest,
    CreateJobSessionRequest, JobType, ScanDirectoryParams,
};
use clap::Subcommand;
use serde_json::json;

#[derive(Subcommand)]
pub enum JobAction {
    /// List jobs in the queue
    List {
        /// Filter by session ID
        #[arg(long)]
        session_id: Option<String>,
        /// Maximum number of jobs to list
        #[arg(long, default_value = "20")]
        limit: usize,
    },
    /// Show job processing statistics
    Stats,
    /// Scan a directory for music files and create jobs
    Scan {
        /// Path to scan
        path: String,
        /// Scan directories recursively
        #[arg(long)]
        recursive: Option<bool>,
        /// Maximum recursion depth (only with --recursive)
        #[arg(long)]
        max_depth: Option<usize>,
    },
    /// Process a single file directly
    ProcessFile {
        /// Path to the file to process
        path: String,
    },
    /// Run the job processor
    RunProcessor {
        /// Maximum number of jobs to process (0 = unlimited)
        #[arg(long, default_value = "0")]
        max_jobs: usize,
        /// Process jobs once and exit (don't loop)
        #[arg(long)]
        once: bool,
    },
}

/// Handle job commands
pub async fn handle_command(action: JobAction) -> GrimoireResult<()> {
    match action {
        JobAction::List { session_id, limit } => {
            println!("listing jobs...");

            let jobs = list_jobs(session_id.as_deref(), None, Some(limit as u32), None)
                .await
                .map_err(|e| crate::error::GrimoireError::ProcessingFailed {
                    message: format!("Failed to list jobs: {}", e),
                })?;

            if jobs.is_empty() {
                println!("No jobs found.");
            } else {
                println!("Found {} jobs:\n", jobs.len());
                println!(
                    "{:<16} {:<20} {:<12} {:<15} {:<20}",
                    "ID", "Type", "Status", "Retry Count", "Created"
                );
                println!("{}", "-".repeat(85));

                for job in jobs {
                    let job_type = job.job_type().unwrap_or_else(|_| JobType::ProcessFile);
                    let status = job
                        .status()
                        .unwrap_or_else(|_| crate::jobs::JobStatus::Pending);

                    // Format timestamp
                    let created_time = super::utils::format_timestamp(job.scheduled_at);

                    println!(
                        "{:<16} {:<20} {:<12} {:<15} {:<20}",
                        &job.id[..8], // Show first 8 chars of ID
                        format!("{:?}", job_type),
                        format!("{:?}", status),
                        format!("{}/{}", job.retry_count, job.max_retries),
                        created_time
                    );
                }
            }
        }

        JobAction::Stats => {
            println!("queue statistics:");

            let stats = get_queue_stats().await.map_err(|e| {
                crate::error::GrimoireError::ProcessingFailed {
                    message: format!("Failed to get stats: {}", e),
                }
            })?;

            println!("  Pending Jobs:   {}", stats.pending_jobs);
            println!("  Running Jobs:   {}", stats.running_jobs);
            println!("  Completed Jobs: {}", stats.completed_jobs);
            println!("  Failed Jobs:    {}", stats.failed_jobs);
            println!("  Active Sessions: {}", stats.active_sessions);
            println!();

            let total_jobs =
                stats.pending_jobs + stats.running_jobs + stats.completed_jobs + stats.failed_jobs;
            if total_jobs > 0 {
                let success_rate = (stats.completed_jobs as f64 / total_jobs as f64) * 100.0;
                println!("  Success Rate: {:.1}%", success_rate);
            }
        }

        JobAction::Scan {
            path,
            recursive,
            max_depth,
        } => {
            println!("creating directory scan job for: {}", path);

            // First create a job session for the scan
            let session_request = CreateJobSessionRequest {
                job_type: JobType::ScanDirectory,
                batch_size: Some(100),
                created_by: Some("cli".to_string()),
            };

            let session = create_job_session(session_request).await.map_err(|e| {
                crate::error::GrimoireError::ProcessingFailed {
                    message: format!("Failed to create job session: {}", e),
                }
            })?;

            println!("created job session: {}", session.id);

            // Create the scan job
            let scan_params = ScanDirectoryParams {
                directory_path: path.clone(),
                recursive: recursive.unwrap_or(true),
                max_depth: max_depth.map(|d| d as u32),
                file_extensions: None, // Use default audio extensions
            };

            let job_request = CreateJobRequest {
                job_type: JobType::ScanDirectory,
                session_id: Some(session.id.clone()),
                parameters: json!(scan_params),
                max_retries: Some(3),
                scheduled_at: None, // Immediate
                created_by: Some("cli".to_string()),
            };

            let job = create_job(job_request).await.map_err(|e| {
                crate::error::GrimoireError::ProcessingFailed {
                    message: format!("Failed to create scan job: {}", e),
                }
            })?;

            println!("created scan job: {}", job.id);
            println!("   Session: {}", session.id);
            println!("   Path: {}", path);
            println!("   Recursive: {}", recursive.unwrap_or(true));
            if let Some(depth) = max_depth {
                println!("   Max Depth: {}", depth);
            }

            println!(
                "\nuse 'grimoire jobs list --session-id {}' to check progress",
                session.id
            );
        }

        JobAction::ProcessFile { path } => {
            println!("creating file processing job for: {}", path);

            let job_request = CreateJobRequest {
                job_type: JobType::ProcessFile,
                session_id: None,
                parameters: json!({
                    "file_path": path,
                    "extract_metadata": true,
                    "generate_thumbnail": true,
                    "generate_waveform": false
                }),
                max_retries: Some(3),
                scheduled_at: None,
                created_by: Some("cli".to_string()),
            };

            let job = create_job(job_request).await.map_err(|e| {
                crate::error::GrimoireError::ProcessingFailed {
                    message: format!("Failed to create process file job: {}", e),
                }
            })?;

            println!("created process file job: {}", job.id);
            println!("   File: {}", path);

            println!("\nuse 'grimoire jobs list' to check progress");
        }

        JobAction::RunProcessor { max_jobs, once } => {
            println!("starting job processor...");
            if once {
                println!("   mode: process all pending jobs and exit");
            } else {
                println!("   mode: continuous processing");
            }
            if max_jobs > 0 {
                println!("   max jobs: {}", max_jobs);
            }
            println!();

            let result = if once {
                crate::jobs::run_job_processor_once(max_jobs as u32).await
            } else {
                crate::jobs::run_job_processor().await
            };

            match result {
                Ok(_) => {
                    if once {
                        println!("finished processing all pending jobs");
                    }
                }
                Err(e) => {
                    println!("job processor error: {}", e);
                    return Err(crate::error::GrimoireError::ProcessingFailed {
                        message: format!("Job processor failed: {}", e),
                    });
                }
            }
        }
    }

    Ok(())
}
