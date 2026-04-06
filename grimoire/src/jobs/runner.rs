//! job runner and orchestration
//!
//! handles dispatching jobs to the appropriate processor and running the job queue loop

use super::media::audio_processor::process_media_file_job;
use super::media::document_processor::process_generate_document_thumbnail_job;
use super::media::photo_processor::process_generate_photo_thumbnail_job;
use super::media::video_processor::process_generate_video_thumbnail_job;
use super::models::{Job, JobResult, JobType};
use super::music::{
    process_convert_webp_job, process_fetch_media_job, process_file_job, process_import_music_job,
    process_rescan_directories_job, process_scan_directory_job,
};
use super::service::{
    delete_job, get_next_pending_job, get_session_job_counts, mark_job_completed, mark_job_failed,
};
use crate::error::ErrorDetail;
use crate::events::{emit, GrimoireEvent};
use crate::response::GrimoireResponse;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

/// process a single job by dispatching to the appropriate processor
/// Note: job should already be marked as 'Running' by get_next_pending_job
pub async fn process_job(job: Job) -> GrimoireResponse<JobResult> {
    let start_time = Instant::now();

    // get job type
    let job_type = match job.job_type() {
        Ok(jt) => jt,
        Err(e) => return GrimoireResponse::failure("failed to parse job type", vec![e.into()]),
    };

    // dispatch to appropriate processor based on job type
    let result = match job_type {
        JobType::ScanDirectory => process_scan_directory_job(&job).await,
        JobType::RescanDirectories => process_rescan_directories_job(&job).await,
        JobType::ProcessFile => process_file_job(&job).await,
        JobType::FetchMedia => process_fetch_media_job(&job).await,
        JobType::ConvertWebp => process_convert_webp_job(&job).await,
        JobType::ImportMusic => process_import_music_job(&job).await,
        JobType::GeneratePhotoThumbnail => process_generate_photo_thumbnail_job(&job).await,
        JobType::GenerateVideoThumbnail => process_generate_video_thumbnail_job(&job).await,
        JobType::GenerateDocumentThumbnail => process_generate_document_thumbnail_job(&job).await,
        JobType::ProcessMediaFile => process_media_file_job(&job).await,
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

            // clean up completed ProcessFile jobs to avoid bloating the jobz table
            if job_type == JobType::ProcessFile {
                let _ = delete_job(&job.id).await;
            }

            // emit progress event for ImportMusic jobs (for UI updates)
            if job_type == JobType::ImportMusic {
                if let Some(session_id) = &job.session_id {
                    // get session stats for progress
                    if let Ok(counts) = get_session_job_counts(session_id).await.data.ok_or(()) {
                        // extract directory from job parameters (parent of local_path)
                        let directory = job
                            .parameters()
                            .ok()
                            .and_then(|p: serde_json::Value| {
                                p.get("local_path")
                                    .and_then(|v| v.as_str())
                                    .and_then(|path| Path::new(path).parent())
                                    .map(|p| p.display().to_string())
                            })
                            .unwrap_or_default();

                        emit(GrimoireEvent::JobProgress {
                            session_id: session_id.clone(),
                            directory,
                            songs_added: counts.completed,
                            jobs_pending: counts.pending + counts.running,
                            jobs_total: counts.total,
                        });

                        // emit session complete when all jobs done
                        if counts.pending == 0 && counts.running == 0 {
                            emit(GrimoireEvent::JobSessionComplete {
                                session_id: session_id.clone(),
                                songs_added: counts.completed,
                                albums_added: 0,  // TODO: track these
                                artists_added: 0, // TODO: track these
                            });
                        }
                    }
                }
            }

            let job_result = JobResult {
                job: completed_job,
                output: None, // could include the output here if needed
                processing_time_ms: processing_time,
            };
            GrimoireResponse::success("job processed successfully", job_result)
        }
        Err(error) => {
            // check if error should trigger retry before converting to ErrorDetail
            let is_retryable = error.is_retryable();
            info!(
                "job {} error: {:?}, is_retryable={}",
                job.id, error, is_retryable
            );
            // convert error to ErrorDetail for structured storage
            let error_detail: ErrorDetail = error.into();
            let _failed_job_response =
                mark_job_failed(&job.id, vec![error_detail.clone()], is_retryable).await;
            GrimoireResponse::failure("job processing failed", vec![error_detail])
        }
    }
}

/// Job processor that runs continuously with signal handling for graceful shutdown
/// Processes jobs one at a time, checking for SIGTERM/SIGINT to stop gracefully
///
/// This version manages its own signal handlers - use for standalone CLI operation.
/// For embedded use (e.g. server), use `run_job_processor_with_token` instead.
pub async fn run_job_processor() -> GrimoireResponse<()> {
    use tokio::signal::unix::{signal, SignalKind};

    info!("job processor started (with internal signal handlers)");

    let cancellation_token = CancellationToken::new();
    let cancellation_token_clone = cancellation_token.clone();

    // Spawn signal handlers
    tokio::spawn(async move {
        let mut sigterm = signal(SignalKind::terminate()).expect("failed to setup SIGTERM handler");
        let mut sigint = signal(SignalKind::interrupt()).expect("failed to setup SIGINT handler");

        tokio::select! {
            _ = sigterm.recv() => {
                info!("received SIGTERM, initiating graceful shutdown");
                cancellation_token_clone.cancel();
            }
            _ = sigint.recv() => {
                info!("received SIGINT, initiating graceful shutdown");
                cancellation_token_clone.cancel();
            }
        }
    });

    run_job_processor_loop(cancellation_token).await
}

/// Job processor that runs with an externally-provided cancellation token
///
/// Use this when embedding the job processor in a server or other host that
/// manages its own signal handling. The caller is responsible for cancelling
/// the token when shutdown is requested.
pub async fn run_job_processor_with_token(
    cancellation_token: CancellationToken,
) -> GrimoireResponse<()> {
    info!("job processor started (with external cancellation token)");
    run_job_processor_loop(cancellation_token).await
}

/// Internal job processing loop shared by both entry points
async fn run_job_processor_loop(cancellation_token: CancellationToken) -> GrimoireResponse<()> {
    let current_job_id = Arc::new(RwLock::new(None::<String>));

    loop {
        // Check if shutdown requested
        if cancellation_token.is_cancelled() {
            info!("shutdown requested, stopping job processor");
            return GrimoireResponse::success("job processor stopped gracefully", ());
        }

        let next_job_response = get_next_pending_job().await;
        let next_job = match next_job_response.data {
            Some(job_opt) => job_opt,
            None => {
                // log the error but don't kill the processor - this is likely a transient
                // db pool timeout, especially on slower hardware
                let error_msgs: Vec<String> = next_job_response
                    .errors
                    .iter()
                    .map(|e| e.detail.clone())
                    .collect();
                warn!(
                    "failed to get next pending job (will retry): {}",
                    error_msgs.join(", ")
                );
                // back off a bit before retrying
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(10)) => {},
                    _ = cancellation_token.cancelled() => {
                        info!("shutdown requested during error backoff, stopping job processor");
                        return GrimoireResponse::success("job processor stopped gracefully", ());
                    }
                }
                continue;
            }
        };

        match next_job {
            Some(job) => {
                // Update current job ID
                {
                    let mut current_job = current_job_id.write().await;
                    *current_job = Some(job.id.clone());
                }

                info!("processing job: {} (type: {})", job.id, job.job_type);

                // Process job with cancellation check - if cancelled during job,
                // let the job finish but exit immediately after
                let result = process_job(job.clone()).await;

                // Check cancellation after job completes
                let should_exit = cancellation_token.is_cancelled();

                // Clear current job ID
                {
                    let mut current_job = current_job_id.write().await;
                    *current_job = None;
                }

                // Log result
                if result.success {
                    info!("job completed successfully: {}", job.id);
                } else {
                    warn!("job failed: {} - {}", job.id, result.message);
                }

                // Exit if shutdown was requested during job processing
                if should_exit {
                    info!("shutdown was requested during job processing, stopping now");
                    return GrimoireResponse::success("job processor stopped gracefully", ());
                }
            }
            None => {
                // no jobs available, wait a bit before checking again
                // Use select to allow interruption during sleep
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {},
                    _ = cancellation_token.cancelled() => {
                        info!("shutdown requested during sleep, stopping job processor");
                        return GrimoireResponse::success("job processor stopped gracefully", ());
                    }
                }
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
                // log the error but don't kill the processor - transient db pool timeout
                let error_msgs: Vec<String> = next_job_response
                    .errors
                    .iter()
                    .map(|e| e.detail.clone())
                    .collect();
                warn!(
                    "failed to get next pending job (will retry): {}",
                    error_msgs.join(", ")
                );
                tokio::time::sleep(Duration::from_secs(10)).await;
                continue;
            }
        };

        match next_job {
            Some(job) => {
                debug!("processing job: {}", job.id);
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
