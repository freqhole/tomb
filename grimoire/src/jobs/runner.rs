//! job runner and orchestration
//!
//! handles dispatching jobs to the appropriate processor and running the job queue loop

use super::models::{Job, JobResult, JobType};
use super::music::{
    process_convert_webp_job, process_fetch_media_job, process_file_job, process_import_music_job,
    process_scan_directory_job,
};
use super::service::{get_next_pending_job, mark_job_completed, mark_job_failed, mark_job_started};
use crate::response::GrimoireResponse;
use std::time::{Duration, Instant};
use tracing::info;

/// process a single job by dispatching to the appropriate processor
pub async fn process_job(job: Job) -> GrimoireResponse<JobResult> {
    let start_time = Instant::now();

    // mark job as started
    let started_job_response = mark_job_started(&job.id).await;
    let job = match started_job_response.data {
        Some(j) => j,
        None => {
            return GrimoireResponse::failure(
                "failed to mark job as started",
                started_job_response.errors,
            )
        }
    };

    // get job type
    let job_type = match job.job_type() {
        Ok(jt) => jt,
        Err(e) => return GrimoireResponse::failure("failed to parse job type", vec![e.into()]),
    };

    // dispatch to appropriate processor based on job type
    let result = match job_type {
        JobType::ScanDirectory => process_scan_directory_job(&job).await,
        JobType::ProcessFile => process_file_job(&job).await,
        JobType::FetchMedia => process_fetch_media_job(&job).await,
        JobType::ConvertWebp => process_convert_webp_job(&job).await,
        JobType::ImportMusic => process_import_music_job(&job).await,
    };

    let processing_time = start_time.elapsed().as_millis() as u64;

    match result {
        Ok(output) => {
            let completed_job_response = mark_job_completed(&job.id, output).await;
            let completed_job = match completed_job_response.data {
                Some(j) => j,
                None => {
                    return GrimoireResponse::failure(
                        "failed to mark job as completed",
                        completed_job_response.errors,
                    )
                }
            };

            let job_result = JobResult {
                job: completed_job,
                output: None, // could include the output here if needed
                processing_time_ms: processing_time,
            };
            GrimoireResponse::success("job processed successfully", job_result)
        }
        Err(error) => {
            let _failed_job_response = mark_job_failed(&job.id, &error.to_string()).await;
            GrimoireResponse::failure("job processing failed", vec![error.into()])
        }
    }
}

/// simple job processor that processes one job at a time in a loop
pub async fn run_job_processor() -> GrimoireResponse<()> {
    loop {
        let next_job_response = get_next_pending_job().await;
        let next_job = match next_job_response.data {
            Some(job_opt) => job_opt,
            None => {
                return GrimoireResponse::failure(
                    "failed to get next pending job",
                    next_job_response.errors,
                )
            }
        };

        match next_job {
            Some(job) => {
                info!("processing job: {}", job.id);
                process_job(job).await;
            }
            None => {
                // no jobs available, wait a bit before checking again
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        }
    }
}

/// run the job processor once - process all pending jobs and then exit
pub async fn run_job_processor_once(max_jobs: u32) -> GrimoireResponse<()> {
    let mut processed_count = 0;

    loop {
        let next_job_response = get_next_pending_job().await;
        let next_job = match next_job_response.data {
            Some(job_opt) => job_opt,
            None => {
                return GrimoireResponse::failure(
                    "failed to get next pending job",
                    next_job_response.errors,
                )
            }
        };

        match next_job {
            Some(job) => {
                info!("processing job: {}", job.id);
                let process_response = process_job(job).await;
                if process_response.success {
                    if let Some(_result) = process_response.data {
                        processed_count += 1;
                    }
                } else {
                    processed_count += 1;
                }

                // check if we've hit the max jobs limit
                if max_jobs > 0 && processed_count >= max_jobs {
                    break;
                }
            }
            None => {
                // no more jobs available, exit
                break;
            }
        }
    }

    GrimoireResponse::success("job processor completed", ())
}
