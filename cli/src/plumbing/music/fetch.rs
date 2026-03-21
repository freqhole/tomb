//! Fetch CLI commands - external media fetching operations
//! Uses offal dispatch where routes exist

use crate::plumbing::dispatch::dispatch_to_offal;
use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::jobs::{list_jobs, Job, JobType};
use serde_json::json;

#[derive(Subcommand)]
pub enum FetchAction {
    /// Fetch media from external URL (youtube, soundcloud, etc.)
    Url {
        /// URL to fetch
        url: String,
    },
    /// Get fetch job status and result
    Status {
        /// Job ID
        job_id: String,
    },
    /// List fetch jobs (no offal route - local filtering)
    List {
        /// Maximum number of jobs to list
        #[arg(long, default_value = "20")]
        limit: usize,
    },
}

/// Handle fetch commands
pub async fn handle_command(action: FetchAction) -> CommandOutput<serde_json::Value> {
    match action {
        FetchAction::Url { url } => {
            dispatch_to_offal("/api/music/fetch", json!({ "url": url })).await
        }

        FetchAction::Status { job_id } => {
            dispatch_to_offal("/api/music/fetch/status", json!({ "job_id": job_id })).await
        }

        // List doesn't have an offal route - uses direct grimoire call with local filtering
        FetchAction::List { limit } => {
            let response = list_jobs(None, None, Some(limit as u32 * 2), None).await;

            if !response.success {
                return CommandOutput::failure(response.message, response.errors, ());
            }

            let Some(jobs) = response.data else {
                return CommandOutput::failure("no jobs data returned", vec![], ());
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

            CommandOutput::success(format!("found {} fetch jobs", job_list.len()), job_list)
        }
    }
}
