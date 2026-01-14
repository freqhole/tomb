//! Fetch CLI commands - external media fetching operations

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::jobs::{create_job, get_job, list_jobs, CreateJobRequest, Job, JobType};
use grimoire::music::fetch::FetchMediaParams;
use serde_json::json;

#[derive(Subcommand)]
pub enum FetchAction {
    /// Fetch media from external URL (youtube, soundcloud, etc.)
    Url {
        /// URL to fetch
        url: String,
        /// User ID who initiated the fetch
        #[arg(long)]
        user_id: Option<String>,
    },
    /// Get fetch job status and result
    Status {
        /// Job ID
        job_id: String,
    },
    /// List fetch jobs
    List {
        /// Maximum number of jobs to list
        #[arg(long, default_value = "20")]
        limit: usize,
    },
}

/// Handle fetch commands
pub async fn handle_command(action: FetchAction) -> CommandOutput<serde_json::Value> {
    match action {
        FetchAction::Url { url, user_id } => {
            let params = FetchMediaParams {
                url: url.clone(),
                user_id,
            };

            let job_request = CreateJobRequest {
                job_type: JobType::FetchMedia,
                session_id: None,
                parameters: json!(params),
                max_retries: Some(3),
                scheduled_at: None, // immediate
                created_by: Some("cli".to_string()),
            };

            let response = create_job(job_request).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(job) = response.data else {
                return CommandOutput::failure("No job data returned", vec![], ());
            };

            let message = format!("Created fetch job for URL: {}", url);
            CommandOutput::success(message, job)
        }

        FetchAction::Status { job_id } => {
            let response = get_job(&job_id).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(job) = response.data else {
                return CommandOutput::failure("Job not found", vec![], ());
            };

            let message = format!("Fetch job status: {:?}", job.status);
            CommandOutput::success(message, job)
        }

        FetchAction::List { limit } => {
            // fetch all jobs and filter by FetchMedia job type
            let response = list_jobs(None, None, Some(limit as u32 * 2), None).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(jobs) = response.data else {
                return CommandOutput::failure("No jobs data returned", vec![], ());
            };

            // filter to only FetchMedia jobs
            let job_list: Vec<Job> = jobs
                .into_iter()
                .filter(|job| {
                    job.job_type()
                        .map(|jt| jt == JobType::FetchMedia)
                        .unwrap_or(false)
                })
                .take(limit)
                .collect();

            let message = format!("Found {} fetch jobs", job_list.len());
            CommandOutput::success(message, job_list)
        }
    }
}
