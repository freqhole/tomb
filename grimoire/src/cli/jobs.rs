//! Job queue management CLI commands

use crate::cli::output::{CommandOutput, OutputFormat};
use crate::error::{GrimoireError, GrimoireResult};
use crate::jobs::{
    create_job, create_job_session, get_queue_stats, list_jobs, CreateJobRequest,
    CreateJobSessionRequest, JobStatus, JobType, ScanDirectoryParams,
};
use clap::Subcommand;
use serde::Serialize;
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

#[derive(Debug, Clone, Serialize)]
pub struct JobListItem {
    pub id: String,
    pub job_type: String,
    pub status: String,
    pub retry_count: i32,
    pub max_retries: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct JobStats {
    pub pending_jobs: u64,
    pub running_jobs: u64,
    pub completed_jobs: u64,
    pub failed_jobs: u64,
    pub active_sessions: u64,
    pub total_jobs: u64,
    pub success_rate: Option<f64>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScanJobCreated {
    pub job_id: String,
    pub session_id: String,
    pub path: String,
    pub recursive: bool,
    pub max_depth: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessJobCreated {
    pub job_id: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProcessorResult {
    pub mode: String,
    pub max_jobs: usize,
    pub completed: bool,
}

/// Handle job commands
pub async fn handle_command(action: JobAction, format: OutputFormat) -> GrimoireResult<()> {
    match action {
        JobAction::List { session_id, limit } => {
            let jobs = list_jobs(session_id.as_deref(), None, Some(limit as u32), None)
                .await
                .map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("Failed to list jobs: {}", e),
                })?;

            let job_items: Vec<JobListItem> = jobs
                .iter()
                .map(|job| {
                    let job_type = job.job_type().unwrap_or(JobType::ProcessFile);
                    let status = job.status().unwrap_or(JobStatus::Pending);
                    let created_time = super::utils::format_timestamp(job.scheduled_at);

                    JobListItem {
                        id: job.id.clone(),
                        job_type: format!("{:?}", job_type),
                        status: format!("{:?}", status),
                        retry_count: job.retry_count,
                        max_retries: job.max_retries,
                        created_at: created_time,
                    }
                })
                .collect();

            let message = format!("Found {} jobs", job_items.len());
            let output = CommandOutput::success(message, job_items);
            print!("{}", output.format(format));
        }

        JobAction::Stats => {
            let stats = get_queue_stats()
                .await
                .map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("Failed to get stats: {}", e),
                })?;

            let total_jobs =
                stats.pending_jobs + stats.running_jobs + stats.completed_jobs + stats.failed_jobs;
            let success_rate = if total_jobs > 0 {
                Some((stats.completed_jobs as f64 / total_jobs as f64) * 100.0)
            } else {
                None
            };

            let job_stats = JobStats {
                pending_jobs: stats.pending_jobs,
                running_jobs: stats.running_jobs,
                completed_jobs: stats.completed_jobs,
                failed_jobs: stats.failed_jobs,
                active_sessions: stats.active_sessions,
                total_jobs,
                success_rate,
            };

            let output = CommandOutput::success("Queue statistics", job_stats);
            print!("{}", output.format(format));
        }

        JobAction::Scan {
            path,
            recursive,
            max_depth,
        } => {
            // First create a job session for the scan
            let session_request = CreateJobSessionRequest {
                job_type: JobType::ScanDirectory,
                batch_size: Some(100),
                created_by: Some("cli".to_string()),
            };

            let session = create_job_session(session_request).await.map_err(|e| {
                GrimoireError::ProcessingFailed {
                    message: format!("Failed to create job session: {}", e),
                }
            })?;

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

            let job =
                create_job(job_request)
                    .await
                    .map_err(|e| GrimoireError::ProcessingFailed {
                        message: format!("Failed to create scan job: {}", e),
                    })?;

            let result = ScanJobCreated {
                job_id: job.id,
                session_id: session.id,
                path,
                recursive: recursive.unwrap_or(true),
                max_depth,
            };

            let message = format!("Created scan job for directory: {}", result.path);
            let output = CommandOutput::success(message, result);
            print!("{}", output.format(format));
        }

        JobAction::ProcessFile { path } => {
            let job_request = CreateJobRequest {
                job_type: JobType::ProcessFile,
                session_id: None,
                parameters: json!({
                    "file_path": path.clone(),
                    "extract_metadata": true,
                    "generate_thumbnail": true,
                    "generate_waveform": false
                }),
                max_retries: Some(3),
                scheduled_at: None,
                created_by: Some("cli".to_string()),
            };

            let job =
                create_job(job_request)
                    .await
                    .map_err(|e| GrimoireError::ProcessingFailed {
                        message: format!("Failed to create process file job: {}", e),
                    })?;

            let result = ProcessJobCreated {
                job_id: job.id,
                file_path: path,
            };

            let message = format!("Created process file job for: {}", result.file_path);
            let output = CommandOutput::success(message, result);
            print!("{}", output.format(format));
        }

        JobAction::RunProcessor { max_jobs, once } => {
            let mode = if once {
                "process all pending jobs and exit"
            } else {
                "continuous processing"
            };

            let result_op = if once {
                crate::jobs::run_job_processor_once(max_jobs as u32).await
            } else {
                crate::jobs::run_job_processor().await
            };

            result_op.map_err(|e| GrimoireError::ProcessingFailed {
                message: format!("Job processor failed: {}", e),
            })?;

            let result = ProcessorResult {
                mode: mode.to_string(),
                max_jobs,
                completed: once,
            };

            let message = if once {
                "Finished processing all pending jobs"
            } else {
                "Job processor completed"
            };

            let output = CommandOutput::success(message, result);
            print!("{}", output.format(format));
        }
    }

    Ok(())
}
