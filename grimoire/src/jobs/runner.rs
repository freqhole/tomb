//! job runner and orchestration
//!
//! handles dispatching jobs to the appropriate processor and running the job queue loop

use super::models::{Job, JobResult, JobType};
use super::music::{
    process_album_enrichment_pipeline_job, process_audiodb_album_detail_job,
    process_audiodb_artist_detail_job, process_auto_apply_album_enrichment_job,
    process_convert_webp_job, process_fetch_media_job, process_file_job, process_import_music_job,
    process_lastfm_album_detail_job, process_lastfm_artist_detail_job, process_mb_album_detail_job,
    process_mb_album_search_job, process_rescan_directories_job, process_scan_directory_job,
};
use super::service::{
    delete_job, get_job_session, get_next_pending_job, get_session_job_counts, mark_job_completed,
    mark_job_failed,
};
use crate::error::ErrorDetail;
use crate::events::{emit, GrimoireEvent};
use crate::jobs::job_events::{self, JobEvent, JobStatusWire};
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
        JobType::MbAlbumSearch => process_mb_album_search_job(&job).await,
        JobType::MbAlbumDetail => process_mb_album_detail_job(&job).await,
        JobType::LastFmAlbumDetail => process_lastfm_album_detail_job(&job).await,
        JobType::LastFmArtistDetail => process_lastfm_artist_detail_job(&job).await,
        JobType::AudioDbAlbumDetail => process_audiodb_album_detail_job(&job).await,
        JobType::AudioDbArtistDetail => process_audiodb_artist_detail_job(&job).await,
        JobType::AlbumEnrichmentPipeline => process_album_enrichment_pipeline_job(&job).await,
        JobType::AutoApplyAlbumEnrichment => process_auto_apply_album_enrichment_job(&job).await,
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

            // phase 9.0 — typed job-lifecycle emit. fires for every
            // session-bound job (the import/scan world also benefits;
            // the legacy `GrimoireEvent::JobProgress` block below stays
            // for backwards-compat with the add-music modal until
            // phase 9.8 swaps that consumer over).
            if let Some(session_id) = &job.session_id {
                job_events::emit(JobEvent::StatusChanged {
                    session_id: session_id.clone(),
                    job_id: job.id.clone(),
                    from: Some(JobStatusWire::Running),
                    to: JobStatusWire::Completed,
                });
                if let Some(counts) = get_session_job_counts(session_id).await.data {
                    let total = counts.total as i64;
                    let complete = (counts.completed + counts.failed) as i64;
                    job_events::emit(JobEvent::Progress {
                        session_id: session_id.clone(),
                        complete,
                        total,
                    });
                    if counts.pending == 0 && counts.running == 0 {
                        job_events::emit(JobEvent::Completed {
                            session_id: session_id.clone(),
                        });
                    }
                }
            }

            // emit progress event for ImportMusic, ProcessFile, and
            // FetchMedia jobs (for UI updates). ProcessFile / FetchMedia
            // rows are deleted on completion, so we read the canonical
            // `total` from the session.progress field (set once by the
            // scanner / fetch-handler) and derive
            // completed = total - (pending + running + failed).
            if job_type == JobType::ImportMusic
                || job_type == JobType::ProcessFile
                || job_type == JobType::FetchMedia
            {
                if let Some(session_id) = &job.session_id {
                    if let Ok(counts) = get_session_job_counts(session_id).await.data.ok_or(()) {
                        // try to read the original total from session.progress;
                        // fall back to live counts if missing.
                        let session_total = get_job_session(session_id)
                            .await
                            .data
                            .and_then(|s| s.progress().ok())
                            .map(|p| p.total as u32)
                            .filter(|t| *t > 0)
                            .unwrap_or(counts.total);

                        let in_flight = counts.pending + counts.running;
                        let completed_so_far = session_total
                            .saturating_sub(in_flight)
                            .saturating_sub(counts.failed);

                        // extract directory from job parameters.
                        // for FetchMedia jobs there's no path on disk
                        // yet, so fall back to the source url so ui
                        // subscribers can classify it as a fetch.
                        let directory = job
                            .parameters()
                            .ok()
                            .and_then(|p: serde_json::Value| {
                                if let Some(path) = p
                                    .get("local_path")
                                    .or_else(|| p.get("file_path"))
                                    .and_then(|v| v.as_str())
                                {
                                    Path::new(path).parent().map(|p| p.display().to_string())
                                } else {
                                    p.get("url").and_then(|v| v.as_str()).map(|s| s.to_string())
                                }
                            })
                            .unwrap_or_default();

                        emit(GrimoireEvent::JobProgress {
                            session_id: session_id.clone(),
                            directory,
                            songs_added: completed_so_far,
                            jobs_pending: in_flight,
                            jobs_total: session_total,
                        });

                        // emit session complete when all jobs done
                        if counts.pending == 0 && counts.running == 0 {
                            emit(GrimoireEvent::JobSessionComplete {
                                session_id: session_id.clone(),
                                songs_added: completed_so_far,
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

            // phase 9.0 — typed job-lifecycle emit (failure path).
            // when retryable, mark_job_failed pushes the row back to
            // Pending so we emit StatusChanged { to: Pending } and skip
            // the Failed event; only emit Failed when the job has truly
            // exhausted retries.
            if let Some(session_id) = &job.session_id {
                let to_status = if is_retryable {
                    JobStatusWire::Pending
                } else {
                    JobStatusWire::Failed
                };
                job_events::emit(JobEvent::StatusChanged {
                    session_id: session_id.clone(),
                    job_id: job.id.clone(),
                    from: Some(JobStatusWire::Running),
                    to: to_status,
                });
                if !is_retryable {
                    job_events::emit(JobEvent::Failed {
                        session_id: session_id.clone(),
                        job_id: job.id.clone(),
                        error_type: error_detail.error_type.clone(),
                        message: error_detail.detail.clone(),
                    });
                }
                if let Some(counts) = get_session_job_counts(session_id).await.data {
                    let total = counts.total as i64;
                    let complete = (counts.completed + counts.failed) as i64;
                    job_events::emit(JobEvent::Progress {
                        session_id: session_id.clone(),
                        complete,
                        total,
                    });
                    if counts.pending == 0 && counts.running == 0 {
                        job_events::emit(JobEvent::Completed {
                            session_id: session_id.clone(),
                        });
                    }
                }
            }

            // mirror the success-path progress + completion emit so
            // ui badges don't get stuck when a session ends in
            // failure (e.g. yt-dlp 404, last ProcessFile bombs). only
            // applies to job types we already wired into the badge.
            if matches!(
                job_type,
                JobType::ImportMusic | JobType::ProcessFile | JobType::FetchMedia
            ) {
                if let Some(session_id) = &job.session_id {
                    if let Ok(counts) = get_session_job_counts(session_id).await.data.ok_or(()) {
                        let session_total = get_job_session(session_id)
                            .await
                            .data
                            .and_then(|s| s.progress().ok())
                            .map(|p| p.total as u32)
                            .filter(|t| *t > 0)
                            .unwrap_or(counts.total);
                        let in_flight = counts.pending + counts.running;
                        let completed_so_far = session_total
                            .saturating_sub(in_flight)
                            .saturating_sub(counts.failed);
                        let directory = job
                            .parameters()
                            .ok()
                            .and_then(|p: serde_json::Value| {
                                if let Some(path) = p
                                    .get("local_path")
                                    .or_else(|| p.get("file_path"))
                                    .and_then(|v| v.as_str())
                                {
                                    Path::new(path).parent().map(|p| p.display().to_string())
                                } else {
                                    p.get("url").and_then(|v| v.as_str()).map(|s| s.to_string())
                                }
                            })
                            .unwrap_or_default();
                        emit(GrimoireEvent::JobProgress {
                            session_id: session_id.clone(),
                            directory,
                            songs_added: completed_so_far,
                            jobs_pending: in_flight,
                            jobs_total: session_total,
                        });
                        // session is "done" when nothing is in flight,
                        // regardless of whether trailing jobs failed.
                        if counts.pending == 0 && counts.running == 0 {
                            emit(GrimoireEvent::JobSessionComplete {
                                session_id: session_id.clone(),
                                songs_added: completed_so_far,
                                albums_added: 0,
                                artists_added: 0,
                            });
                        }
                    }
                }
            }
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
