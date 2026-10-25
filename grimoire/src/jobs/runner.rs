//! job runner and orchestration
//!
//! handles dispatching jobs to the appropriate processor and running the job queue loop

use super::models::{Job, JobResult, JobStatus, JobType};
use super::music::{
    process_album_enrichment_pipeline_job, process_audiodb_album_detail_job,
    process_audiodb_artist_detail_job, process_auto_apply_album_enrichment_job,
    process_convert_webp_job, process_directory_job, process_fetch_media_job, process_file_job,
    process_import_music_job, process_lastfm_album_detail_job, process_lastfm_artist_detail_job,
    process_mb_album_detail_job, process_mb_album_search_job, process_precheck_fetch_job,
    process_reorganize_library_files_job, process_repair_library_images_job,
    process_rescan_directories_job, process_scan_directory_job, process_sync_song_by_blake3_job,
};
use super::service::{
    delete_job, get_job_session, get_next_pending_job, get_session_job_counts, mark_job_completed,
    mark_job_failed, peek_pending_jobs, try_claim_pending_job,
};
use super::video::{
    process_import_video_job, process_sync_video_by_blake3_job, process_transcode_video_job,
};
use crate::error::ErrorDetail;
use crate::jobs::job_events::{self, JobEvent, JobStatusWire};
use crate::response::GrimoireResponse;
use futures_util::FutureExt;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, Semaphore};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

tokio::task_local! {
    pub(super) static CURRENT_JOB_ID: String;
}

/// concurrency class for a job type.
/// used to cap the number of concurrent workers a class of jobs can
/// occupy, in either direction: `EnrichmentMb`/`EnrichmentLastFm`/
/// `EnrichmentAudiodb` cap bulk enrichment queues so they don't starve
/// filesystem jobs; `Heavy` caps the genuinely long-running
/// import/transcode pipeline so it can never fully saturate the pool
/// either - reserving at least one slot for quick, uncapped `Other`
/// jobs (e.g. `ConvertWebp`) that would otherwise queue behind however
/// many multi-minute heavy jobs happen to already be running, with no
/// way to preempt them once claimed (see `class_cap`'s own doc comment
/// for the full reasoning).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum JobClass {
    EnrichmentMb,
    EnrichmentLastFm,
    EnrichmentAudiodb,
    /// genuinely long-running local work (minutes, not seconds) - the
    /// media-add pipeline and video transcoding. capped below
    /// `pool_size` (see `class_cap`) so at least one worker slot always
    /// stays reachable for quick `Other` jobs even under heavy load.
    Heavy,
    Other,
}

fn job_class(job_type: &JobType) -> JobClass {
    match job_type {
        JobType::MbAlbumSearch | JobType::MbAlbumDetail => JobClass::EnrichmentMb,
        JobType::LastFmAlbumDetail | JobType::LastFmArtistDetail => JobClass::EnrichmentLastFm,
        JobType::AudioDbAlbumDetail | JobType::AudioDbArtistDetail => JobClass::EnrichmentAudiodb,
        JobType::ImportMusic
        | JobType::ImportVideo
        | JobType::TranscodeVideo
        | JobType::ProcessFile
        | JobType::ProcessDirectory
        | JobType::FetchMedia
        | JobType::PreCheckFetch => JobClass::Heavy,
        _ => JobClass::Other,
    }
}

/// number of worker slots `Heavy` jobs can never claim, reserved for
/// quick `Other` jobs (see `JobClass::Heavy`'s doc comment) - the
/// pool-saturation half of the webp-conversion starvation bug: the
/// semaphore in `run_job_processor_loop` only hands out a NEW slot once
/// an existing one finishes, so once every worker is legitimately busy
/// on a multi-minute import/transcode, a newly-submitted `ConvertWebp`
/// job has nowhere to run regardless of its priority - priority
/// ordering (see the `ConvertWebp` submission site's own doc comment on
/// its `priority: Some(10)`) only ever helps pick AMONG pending jobs
/// once a slot is actually free, it can't conjure one into existence.
const HEAVY_JOB_RESERVED_SLOTS: usize = 1;

/// max concurrent in-flight jobs for each capped class, given the pool's
/// total worker count. returns `None` for `Other` (no cap - benefits
/// from every other class's cap leaving it room). `Heavy`'s cap is
/// `pool_size - HEAVY_JOB_RESERVED_SLOTS`, floored at 1 so a
/// single-worker pool (nothing to reserve from) doesn't starve heavy
/// jobs entirely instead.
fn class_cap(class: JobClass, pool_size: usize) -> Option<usize> {
    match class {
        JobClass::EnrichmentMb => Some(2),
        JobClass::EnrichmentLastFm => Some(3),
        JobClass::EnrichmentAudiodb => Some(2),
        JobClass::Heavy => Some(pool_size.saturating_sub(HEAVY_JOB_RESERVED_SLOTS).max(1)),
        JobClass::Other => None,
    }
}

fn is_badge_progress_job(job_type: &JobType) -> bool {
    matches!(
        job_type,
        JobType::ImportMusic
            | JobType::ImportVideo
            | JobType::TranscodeVideo
            | JobType::ProcessFile
            | JobType::ProcessDirectory
            | JobType::FetchMedia
            | JobType::PreCheckFetch
            | JobType::AlbumEnrichmentPipeline
            | JobType::AutoApplyAlbumEnrichment
            | JobType::MbAlbumSearch
            | JobType::MbAlbumDetail
            | JobType::LastFmAlbumDetail
            | JobType::LastFmArtistDetail
            | JobType::AudioDbAlbumDetail
            | JobType::AudioDbArtistDetail
    )
}

fn is_enrichment_job(job_type: &JobType) -> bool {
    matches!(
        job_type,
        JobType::AlbumEnrichmentPipeline
            | JobType::AutoApplyAlbumEnrichment
            | JobType::MbAlbumSearch
            | JobType::MbAlbumDetail
            | JobType::LastFmAlbumDetail
            | JobType::LastFmArtistDetail
            | JobType::AudioDbAlbumDetail
            | JobType::AudioDbArtistDetail
    )
}

/// RAII guard: decrements a per-class in-flight counter when dropped.
/// ensures the slot is released even if the worker task panics.
struct JobClassPermit {
    class: JobClass,
    counts: Arc<StdMutex<HashMap<JobClass, usize>>>,
}

impl Drop for JobClassPermit {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.counts.lock() {
            if let Some(n) = guard.get_mut(&self.class) {
                *n = n.saturating_sub(1);
            }
        }
    }
}

/// process a single job by dispatching to the appropriate processor
/// Note: job should already be marked as 'Running' by get_next_pending_job
pub async fn process_job(job: Job) -> GrimoireResponse<JobResult> {
    let start_time = Instant::now();

    // get job type
    let job_type = match job.job_type() {
        Ok(jt) => jt,
        Err(error) => {
            let detail: ErrorDetail = error.into();
            let response = mark_job_failed(&job.id, vec![detail.clone()], false).await;
            if !response.success {
                tracing::error!(job_id=%job.id, error=%response.message, "could not record invalid job type");
            }
            return GrimoireResponse::failure("failed to parse job type", vec![detail]);
        }
    };

    // dispatch to appropriate processor based on job type
    let result = CURRENT_JOB_ID
        .scope(job.id.clone(), async {
            let pool = crate::database::connect().await?;
            super::lifecycle::ensure_active(&pool, &job.id).await?;
            match job_type {
                JobType::ScanDirectory => process_scan_directory_job(&job).await,
                JobType::RescanDirectories => process_rescan_directories_job(&job).await,
                JobType::ProcessFile => process_file_job(&job).await,
                JobType::ProcessDirectory => process_directory_job(&job).await,
                JobType::FetchMedia => process_fetch_media_job(&job).await,
                JobType::PreCheckFetch => process_precheck_fetch_job(&job).await,
                JobType::ConvertWebp => process_convert_webp_job(&job).await,
                JobType::ImportMusic => process_import_music_job(&job).await,
                JobType::MbAlbumSearch => process_mb_album_search_job(&job).await,
                JobType::MbAlbumDetail => process_mb_album_detail_job(&job).await,
                JobType::LastFmAlbumDetail => process_lastfm_album_detail_job(&job).await,
                JobType::LastFmArtistDetail => process_lastfm_artist_detail_job(&job).await,
                JobType::AudioDbAlbumDetail => process_audiodb_album_detail_job(&job).await,
                JobType::AudioDbArtistDetail => process_audiodb_artist_detail_job(&job).await,
                JobType::AlbumEnrichmentPipeline => {
                    process_album_enrichment_pipeline_job(&job).await
                }
                JobType::AutoApplyAlbumEnrichment => {
                    process_auto_apply_album_enrichment_job(&job).await
                }
                JobType::ImportVideo => process_import_video_job(&job).await,
                JobType::TranscodeVideo => process_transcode_video_job(&job).await,
                JobType::SyncSongByBlake3 => process_sync_song_by_blake3_job(&job).await,
                JobType::SyncVideoByBlake3 => process_sync_video_by_blake3_job(&job).await,
                JobType::RepairLibraryImages => process_repair_library_images_job(&job).await,
                JobType::ReorganizeLibraryFiles => process_reorganize_library_files_job(&job).await,
            }
        })
        .await;

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
            if completed_job.status == "Cancelled" {
                super::lifecycle::emit_cancelled(&completed_job, JobStatusWire::Running);
                return GrimoireResponse::success(
                    "job cancelled",
                    JobResult {
                        job: completed_job,
                        output: None,
                        processing_time_ms: processing_time,
                    },
                );
            }

            // clean up completed ProcessFile / ProcessDirectory jobs to
            // avoid bloating the jobz table (scans can produce 1000s)
            if matches!(job_type, JobType::ProcessFile | JobType::ProcessDirectory) {
                let _ = delete_job(&job.id).await;
            }

            // typed job-lifecycle emit. fires for every job; the
            // status-change and per-session rollup are decoupled so
            // session-less jobs (e.g. ConvertWebp from /api/upload/image)
            // still deliver a terminal `StatusChanged` to subscribers
            // filtered by `job_ids`. scan-rollup metadata is carried by
            // the `is_badge_progress_job` block below via `details`.
            {
                let topic = job_type.clone();
                let entity_ref = job_events::entity_ref_for_job(&job);
                let created_by = job.created_by.clone();
                let session_id_str = job.session_id.clone().unwrap_or_default();
                job_events::emit(JobEvent::StatusChanged {
                    session_id: session_id_str,
                    job_id: job.id.clone(),
                    from: Some(JobStatusWire::Running),
                    to: JobStatusWire::Completed,
                    topic: topic.clone(),
                    entity_ref: entity_ref.clone(),
                    created_by: created_by.clone(),
                });
            }
            if let Some(session_id) = &job.session_id {
                let topic = job_type.clone();
                let created_by = job.created_by.clone();
                if let Some(counts) = get_session_job_counts(session_id).await.data {
                    let total = counts.total as i64;
                    let complete = (counts.completed + counts.failed) as i64;
                    job_events::emit(JobEvent::Progress {
                        session_id: session_id.clone(),
                        complete,
                        total,
                        topic: topic.clone(),
                        entity_ref: None,
                        created_by: created_by.clone(),
                        details: None,
                    });
                    if counts.pending == 0 && counts.running == 0 {
                        job_events::emit(JobEvent::Completed {
                            session_id: session_id.clone(),
                            topic,
                            entity_ref: None,
                            created_by,
                            details: None,
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
            if is_badge_progress_job(&job_type) {
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
                        let job_params = job.parameters().ok();
                        let mut directory = job_params
                            .as_ref()
                            .and_then(|p: &serde_json::Value| {
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
                        if is_enrichment_job(&job_type) {
                            directory = "enrich://".to_string();
                        }

                        // an explicit `domain` param wins; otherwise fall back to
                        // detecting from the file path extension so the ui can
                        // still tell "music" from "video" when the job was
                        // dispatched without one (e.g. an older client).
                        let domain = job_params.as_ref().and_then(|p: &serde_json::Value| {
                            p.get("domain")
                                .and_then(|v| v.as_str())
                                .and_then(|s| match s {
                                    "music" => Some(crate::media_domain::MediaDomain::Music),
                                    "video" => Some(crate::media_domain::MediaDomain::Video),
                                    _ => None,
                                })
                                .or_else(|| {
                                    p.get("local_path")
                                        .or_else(|| p.get("file_path"))
                                        .and_then(|v| v.as_str())
                                        .and_then(|path| {
                                            crate::media_domain::detect_media_domain_from_extension(
                                                path,
                                                &crate::config::get_config(),
                                            )
                                        })
                                })
                        });

                        let rollup = serde_json::json!({
                            "directory": directory,
                            "songs_added": completed_so_far,
                            "jobs_pending": in_flight,
                            "jobs_total": session_total,
                            "domain": domain.map(|d| d.as_str()),
                        });
                        job_events::emit(JobEvent::Progress {
                            session_id: session_id.clone(),
                            complete: completed_so_far as i64,
                            total: session_total as i64,
                            topic: job_type.clone(),
                            entity_ref: None,
                            created_by: job.created_by.clone(),
                            details: Some(rollup),
                        });

                        // emit session complete when all jobs done
                        if counts.pending == 0 && counts.running == 0 {
                            job_events::emit(JobEvent::Completed {
                                session_id: session_id.clone(),
                                topic: job_type.clone(),
                                entity_ref: None,
                                created_by: job.created_by.clone(),
                                details: Some(serde_json::json!({
                                    "songs_added": completed_so_far,
                                    "albums_added": 0,
                                    "artists_added": 0,
                                    "domain": domain.map(|d| d.as_str()),
                                })),
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
            if matches!(error, super::JobError::Cancelled) {
                let cancelled = super::service::cancel_job(&job.id).await;
                return match cancelled.data {
                    Some(job) => {
                        super::lifecycle::emit_cancelled(&job, JobStatusWire::Running);
                        GrimoireResponse::success(
                            "job cancelled",
                            JobResult {
                                job,
                                output: None,
                                processing_time_ms: processing_time,
                            },
                        )
                    }
                    None => GrimoireResponse::failure("could not cancel job", cancelled.errors),
                };
            }
            // check if error should trigger retry before converting to ErrorDetail
            let is_retryable = error.is_retryable();
            info!(
                "job {} error: {:?}, is_retryable={}",
                job.id, error, is_retryable
            );
            // convert error to ErrorDetail for structured storage
            let error_detail: ErrorDetail = error.into();
            let failed_job_response =
                mark_job_failed(&job.id, vec![error_detail.clone()], is_retryable).await;
            if let Some(cancelled) = failed_job_response
                .data
                .as_ref()
                .filter(|job| job.status == "Cancelled")
            {
                super::lifecycle::emit_cancelled(cancelled, JobStatusWire::Running);
                return GrimoireResponse::success(
                    "job cancelled",
                    JobResult {
                        job: cancelled.clone(),
                        output: None,
                        processing_time_ms: processing_time,
                    },
                );
            }

            // `is_retryable` reflects the error TYPE in isolation (e.g. the
            // generic `ProcessingFailed` always reports `true`), but
            // `mark_job_failed` also factors in whether max_retries has
            // been exhausted, and persists whichever status actually won.
            // trust that persisted status here rather than re-deriving it
            // from `is_retryable` - otherwise a job that just exhausted its
            // retries (DB row: Failed) still gets emitted as "back to
            // Pending" with no `Failed` event, so the client never learns
            // the job is actually done and stuck showing a stale stage.
            let truly_exhausted = failed_job_response
                .data
                .as_ref()
                .and_then(|j| j.status().ok())
                .map(|s| matches!(s, JobStatus::Failed))
                .unwrap_or(!is_retryable);

            // phase 9.0 — typed job-lifecycle emit (failure path).
            // when retryable, mark_job_failed pushes the row back to
            // Pending so we emit StatusChanged { to: Pending } and skip
            // the Failed event; only emit Failed when the job has truly
            // exhausted retries. session-less jobs (e.g. ConvertWebp)
            // still emit StatusChanged/Failed so subscribers filtered
            // by `job_ids` receive a terminal event.
            {
                let to_status = if truly_exhausted {
                    JobStatusWire::Failed
                } else {
                    JobStatusWire::Pending
                };
                let topic = job_type.clone();
                let entity_ref = job_events::entity_ref_for_job(&job);
                let created_by = job.created_by.clone();
                let session_id_str = job.session_id.clone().unwrap_or_default();
                job_events::emit(JobEvent::StatusChanged {
                    session_id: session_id_str.clone(),
                    job_id: job.id.clone(),
                    from: Some(JobStatusWire::Running),
                    to: to_status,
                    topic: topic.clone(),
                    entity_ref: entity_ref.clone(),
                    created_by: created_by.clone(),
                });
                if truly_exhausted {
                    job_events::emit(JobEvent::Failed {
                        session_id: session_id_str,
                        job_id: job.id.clone(),
                        error_type: error_detail.error_type.clone(),
                        message: error_detail.detail.clone(),
                        topic: topic.clone(),
                        entity_ref: entity_ref.clone(),
                        created_by: created_by.clone(),
                    });
                }
            }
            if let Some(session_id) = &job.session_id {
                let topic = job_type.clone();
                let created_by = job.created_by.clone();
                if let Some(counts) = get_session_job_counts(session_id).await.data {
                    let total = counts.total as i64;
                    let complete = (counts.completed + counts.failed) as i64;
                    job_events::emit(JobEvent::Progress {
                        session_id: session_id.clone(),
                        complete,
                        total,
                        topic: topic.clone(),
                        entity_ref: None,
                        created_by: created_by.clone(),
                        details: None,
                    });
                    if counts.pending == 0 && counts.running == 0 {
                        job_events::emit(JobEvent::Completed {
                            session_id: session_id.clone(),
                            topic,
                            entity_ref: None,
                            created_by,
                            details: None,
                        });
                    }
                }
            }

            // mirror the success-path progress + completion emit so
            // ui badges don't get stuck when a session ends in
            // failure (e.g. yt-dlp 404, last ProcessFile bombs). only
            // applies to job types we already wired into the badge.
            if is_badge_progress_job(&job_type) {
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
                        let mut directory = job
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
                        if is_enrichment_job(&job_type) {
                            directory = "enrich://".to_string();
                        }
                        let rollup = serde_json::json!({
                            "directory": directory,
                            "songs_added": completed_so_far,
                            "jobs_pending": in_flight,
                            "jobs_total": session_total,
                        });
                        job_events::emit(JobEvent::Progress {
                            session_id: session_id.clone(),
                            complete: completed_so_far as i64,
                            total: session_total as i64,
                            topic: job_type.clone(),
                            entity_ref: None,
                            created_by: job.created_by.clone(),
                            details: Some(rollup),
                        });
                        // session is "done" when nothing is in flight,
                        // regardless of whether trailing jobs failed.
                        if counts.pending == 0 && counts.running == 0 {
                            job_events::emit(JobEvent::Completed {
                                session_id: session_id.clone(),
                                topic: job_type.clone(),
                                entity_ref: None,
                                created_by: job.created_by.clone(),
                                details: Some(serde_json::json!({
                                    "songs_added": completed_so_far,
                                    "albums_added": 0,
                                    "artists_added": 0,
                                })),
                            });
                        }
                    }
                }
            }
            GrimoireResponse::failure("job processing failed", vec![error_detail])
        }
    }
}

async fn process_job_safely(job: Job) -> GrimoireResponse<JobResult> {
    let job_id = job.id.clone();
    match std::panic::AssertUnwindSafe(process_job(job))
        .catch_unwind()
        .await
    {
        Ok(response) => response,
        Err(_) => {
            tracing::error!(%job_id, "job worker panicked");
            let detail = ErrorDetail::new(
                "job_worker_panicked",
                "job worker panicked",
                "the worker stopped unexpectedly; retry this job explicitly",
            );
            let response = mark_job_failed(&job_id, vec![detail.clone()], false).await;
            if !response.success {
                tracing::error!(%job_id, error=%response.message, "could not record worker panic");
                return GrimoireResponse::failure("could not record worker panic", response.errors);
            }
            GrimoireResponse::failure("job worker panicked", vec![detail])
        }
    }
}

/// Job processor that runs continuously with signal handling for graceful shutdown
/// Processes jobs one at a time, checking for SIGTERM/SIGINT to stop gracefully
///
/// This version manages its own signal handlers - use for standalone CLI operation.
/// For embedded use (e.g. server), use `run_job_processor_with_token` instead.
pub async fn run_job_processor() -> GrimoireResponse<()> {
    info!("job processor started (with internal signal handlers)");

    let cancellation_token = CancellationToken::new();
    let cancellation_token_clone = cancellation_token.clone();

    // tokio::signal::unix is gated out on windows, which only gets ctrl-c.
    #[cfg(unix)]
    tokio::spawn(async move {
        use tokio::signal::unix::{signal, SignalKind};

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

    #[cfg(windows)]
    tokio::spawn(async move {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to setup ctrl-c handler");
        info!("received ctrl-c, initiating graceful shutdown");
        cancellation_token_clone.cancel();
    });

    run_job_processor_with_token(cancellation_token).await
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
    let _owner = match acquire_runner(&cancellation_token, false).await {
        Ok(Some(owner)) => owner,
        Ok(None) => {
            return GrimoireResponse::success("job runner stopped before acquiring ownership", ())
        }
        Err(error) => {
            return GrimoireResponse::failure(
                "could not acquire job runner ownership",
                vec![error.into()],
            )
        }
    };
    let pool = match crate::database::connect().await {
        Ok(pool) => pool,
        Err(error) => {
            return GrimoireResponse::failure("could not connect job runner", vec![error.into()])
        }
    };
    match super::lifecycle::recover_interrupted(&pool).await {
        Ok(count) => info!(count, "reconciled interrupted jobs"),
        Err(error) => {
            return GrimoireResponse::failure(
                "could not recover interrupted jobs",
                vec![error.into()],
            )
        }
    }
    let monitor_token = cancellation_token.child_token();
    let (response, ()) = tokio::join!(
        async {
            let response = run_job_processor_loop(cancellation_token).await;
            monitor_token.cancel();
            response
        },
        crate::external_storage::monitor::run(monitor_token.clone())
    );
    response
}

async fn acquire_runner(
    cancellation: &CancellationToken,
    once: bool,
) -> crate::error::GrimoireResult<Option<std::fs::File>> {
    let database = crate::config::get_config().database_path();
    loop {
        if cancellation.is_cancelled() {
            return Ok(None);
        }
        let path = database.clone();
        let owner = tokio::task::spawn_blocking(move || {
            super::lifecycle::try_runner_lock(&path.canonicalize()?)
        })
        .await
        .map_err(|error| std::io::Error::other(error.to_string()))??;
        if owner.is_some() {
            return Ok(owner);
        }
        if once {
            return Err(std::io::Error::new(
                std::io::ErrorKind::WouldBlock,
                "another job runner owns this database",
            )
            .into());
        }
        tokio::select! {
            _ = cancellation.cancelled() => return Ok(None),
            _ = tokio::time::sleep(Duration::from_secs(2)) => {}
        }
    }
}

/// Internal job processing loop shared by both entry points.
///
/// runs a worker pool that drains the jobz queue in parallel. pool
/// size is taken from `config.jobs.max_concurrency` (auto = available
/// parallelism, capped at 8). a per-(job_type, key) busy set keeps
/// two workers from racing on jobs that would clobber each other
/// (e.g. two scans of the same directory). graceful shutdown stops
/// claiming new jobs and waits up to ~10s for in-flight workers.
async fn run_job_processor_loop(cancellation_token: CancellationToken) -> GrimoireResponse<()> {
    let max_workers = if crate::config::is_config_initialized() {
        crate::config::get_config().jobs.resolved_max_concurrency()
    } else {
        4
    };
    info!(
        "job processor pool starting with up to {} concurrent worker(s)",
        max_workers
    );

    let semaphore = Arc::new(Semaphore::new(max_workers));
    let busy_keys: Arc<Mutex<HashSet<(JobType, String)>>> = Arc::new(Mutex::new(HashSet::new()));
    let class_counts: Arc<StdMutex<HashMap<JobClass, usize>>> =
        Arc::new(StdMutex::new(HashMap::new()));
    let mut workers: JoinSet<()> = JoinSet::new();

    loop {
        if cancellation_token.is_cancelled() {
            info!("shutdown requested, stopping job processor");
            break;
        }

        // wait for an available worker slot (or shutdown).
        let permit = tokio::select! {
            biased;
            _ = cancellation_token.cancelled() => {
                info!("shutdown requested while waiting for worker slot");
                break;
            }
            res = semaphore.clone().acquire_owned() => match res {
                Ok(p) => p,
                Err(_) => break, // semaphore closed, shouldn't happen
            },
        };

        // peek a batch of pending jobs, skip any whose conflict key is
        // currently busy in another worker, then atomically claim the
        // first claimable candidate.
        let claimed =
            match claim_next_unblocked_job(busy_keys.clone(), class_counts.clone(), max_workers)
                .await
            {
                Ok(j) => j,
                Err(msg) => {
                    warn!("failed to peek/claim next job (will retry): {}", msg);
                    drop(permit);
                    tokio::select! {
                        _ = tokio::time::sleep(Duration::from_secs(10)) => {},
                        _ = cancellation_token.cancelled() => {
                            info!("shutdown requested during error backoff");
                            break;
                        }
                    }
                    continue;
                }
            };

        let job = match claimed {
            Some((job, class_permit)) => (job, class_permit),
            None => {
                // nothing claimable right now (queue empty, or every
                // pending job's key is busy). drop the permit and
                // sleep before peeking again.
                drop(permit);
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(2)) => {},
                    _ = cancellation_token.cancelled() => {
                        info!("shutdown requested during idle sleep");
                        break;
                    }
                }
                continue;
            }
        };

        let (job, class_permit) = job;
        let key = conflict_key_for(&job);
        let busy_keys_clone = busy_keys.clone();
        info!("processing job: {} (type: {})", job.id, job.job_type);

        workers.spawn(async move {
            let job_id = job.id.clone();
            let result = process_job_safely(job).await;
            if result.success {
                info!("job completed successfully: {}", job_id);
            } else {
                warn!("job failed: {} - {}", job_id, result.message);
            }
            // release per-class permit before releasing the semaphore slot
            drop(class_permit);
            if let Some(k) = key {
                busy_keys_clone.lock().await.remove(&k);
            }
            drop(permit);
        });

        // opportunistically harvest any workers that have finished.
        while let Some(res) = workers.try_join_next() {
            if let Err(e) = res {
                warn!("worker task panicked: {:?}", e);
            }
        }
    }

    // graceful drain: stop claiming new jobs and wait for in-flight
    // workers to finish, capped by a ~10s timeout to match the
    // existing shutdown budget.
    info!(
        "draining {} in-flight job worker(s) (up to 10s)...",
        workers.len()
    );
    let drain_deadline = tokio::time::sleep(Duration::from_secs(10));
    tokio::pin!(drain_deadline);
    loop {
        if workers.is_empty() {
            break;
        }
        tokio::select! {
            res = workers.join_next() => {
                if let Some(Err(e)) = res { warn!("worker task panicked during drain: {:?}", e) }
            }
            _ = &mut drain_deadline => {
                warn!(
                    "drain timeout reached with {} worker(s) still running; abandoning",
                    workers.len()
                );
                workers.abort_all();
                while workers.join_next().await.is_some() {}
                break;
            }
        }
    }

    // all worker futures have stopped; only this runner can own Running rows.
    let pool = match crate::database::connect().await {
        Ok(pool) => pool,
        Err(error) => {
            return GrimoireResponse::failure(
                "could not connect job runner during shutdown",
                vec![error.into()],
            )
        }
    };
    match super::lifecycle::recover_interrupted(&pool).await {
        Ok(count) => info!(count, "recorded interrupted workers during shutdown"),
        Err(error) => {
            return GrimoireResponse::failure(
                "could not record interrupted workers",
                vec![error.into()],
            )
        }
    }
    GrimoireResponse::success("job processor stopped gracefully", ())
}

/// conflict key for a job: returns `Some((job_type, key))` when two
/// concurrent jobs with the same key would clobber each other.
/// returns `None` for job types that are safe to run in parallel
/// regardless of parameters.
fn conflict_key_for(job: &Job) -> Option<(JobType, String)> {
    let job_type = job.job_type().ok()?;
    match job_type {
        JobType::ScanDirectory => {
            let params: serde_json::Value = serde_json::from_str(&job.parameters).ok()?;
            let path = params.get("directory_path")?.as_str()?.to_string();
            Some((JobType::ScanDirectory, path))
        }
        JobType::RescanDirectories => {
            // singleton: only one rescan can run at a time
            Some((JobType::RescanDirectories, String::new()))
        }
        JobType::RepairLibraryImages => {
            // singleton: a whole-library repair pass shouldn't overlap
            // with another one (or with itself if double-submitted).
            Some((JobType::RepairLibraryImages, String::new()))
        }
        JobType::ProcessFile => {
            let params: serde_json::Value = serde_json::from_str(&job.parameters).ok()?;
            // prefer an explicit grouping key (set by fetch jobs etc. so
            // all sibling ProcessFile children serialize through one
            // worker, avoiding races in find_or_create_artist /
            // find_or_create_album_for_artist). fall back to the parent
            // directory of the file so plain imports from one dir also
            // serialize. last resort: the file path itself.
            let key = params
                .get("serialization_group")
                .and_then(|v| v.as_str())
                .map(str::to_string)
                .or_else(|| {
                    let path = params.get("file_path")?.as_str()?;
                    std::path::Path::new(path)
                        .parent()
                        .and_then(|p| p.to_str())
                        .map(str::to_string)
                })
                .or_else(|| {
                    params
                        .get("file_path")
                        .and_then(|v| v.as_str())
                        .map(str::to_string)
                })?;
            Some((JobType::ProcessFile, key))
        }
        JobType::ProcessDirectory => {
            let params: serde_json::Value = serde_json::from_str(&job.parameters).ok()?;
            let path = params.get("directory_path")?.as_str()?.to_string();
            Some((JobType::ProcessDirectory, path))
        }
        // other job types (fetch, webp convert, import, mb/lastfm/audiodb
        // enrichment) have unique per-row keys and are safe to interleave;
        // rate-limiting for external apis is enforced via the global gates
        // in `jobs::rate_limit`.
        //
        // the two pipeline orchestrators serialize per album_id so two
        // concurrent bulk-enrich requests for the same album don't
        // double-fan-out child jobs.
        jt @ (JobType::AlbumEnrichmentPipeline | JobType::AutoApplyAlbumEnrichment) => {
            let params: serde_json::Value = serde_json::from_str(&job.parameters).ok()?;
            let album_id = params.get("album_id")?.as_str()?.to_string();
            Some((jt, album_id))
        }
        _ => None,
    }
}

/// peek a batch of pending jobs and claim the first whose conflict key
/// isn't already busy in another worker. atomic claim via
/// `try_claim_pending_job` handles cross-worker races on the same row.
/// returns `Ok(None)` when the queue is empty or every candidate is
/// blocked.
async fn claim_next_unblocked_job(
    busy_keys: Arc<Mutex<HashSet<(JobType, String)>>>,
    class_counts: Arc<StdMutex<HashMap<JobClass, usize>>>,
    pool_size: usize,
) -> Result<Option<(Job, Option<JobClassPermit>)>, String> {
    // peek at least one job, and grab a few extras so we can skip
    // past blocked keys without re-querying every iteration.
    let limit = (pool_size as u32 + 4).max(8);
    let peek = peek_pending_jobs(limit).await;
    if !peek.success {
        let msgs: Vec<String> = peek.errors.iter().map(|e| e.detail.clone()).collect();
        return Err(msgs.join(", "));
    }
    let candidates = peek.data.unwrap_or_default();
    if candidates.is_empty() {
        return Ok(None);
    }

    for candidate in candidates {
        let candidate_type = match candidate.job_type() {
            Ok(jt) => jt,
            Err(_) => continue,
        };

        // check per-class concurrency cap before reserving the key.
        // increment inside the lock to atomically reserve the slot.
        let class = job_class(&candidate_type);
        let class_permit: Option<JobClassPermit> = if let Some(cap) = class_cap(class, pool_size) {
            match class_counts.lock() {
                Ok(mut guard) => {
                    let current = guard.get(&class).copied().unwrap_or(0);
                    if current >= cap {
                        continue; // class is at cap, skip this candidate
                    }
                    *guard.entry(class).or_insert(0) += 1;
                    Some(JobClassPermit {
                        class,
                        counts: class_counts.clone(),
                    })
                }
                Err(_) => continue,
            }
        } else {
            None
        };

        let key = conflict_key_for(&candidate);
        // reserve the key (if any) before issuing the claim so a
        // second worker peeking the same row in parallel skips it.
        if let Some(ref k) = key {
            let mut guard = busy_keys.lock().await;
            if guard.contains(k) {
                // release class slot we just reserved
                drop(class_permit);
                continue;
            }
            guard.insert(k.clone());
        }
        let claim = try_claim_pending_job(&candidate.id).await;
        if !claim.success {
            if let Some(ref k) = key {
                busy_keys.lock().await.remove(k);
            }
            drop(class_permit);
            let msgs: Vec<String> = claim.errors.iter().map(|e| e.detail.clone()).collect();
            return Err(msgs.join(", "));
        }
        match claim.data.flatten() {
            Some(job) => return Ok(Some((job, class_permit))),
            None => {
                // another worker won the row race; release reservations
                // and keep scanning the rest of the batch.
                if let Some(ref k) = key {
                    busy_keys.lock().await.remove(k);
                }
                drop(class_permit);
                continue;
            }
        }
    }
    Ok(None)
}

/// run the job processor once - process all pending jobs and then exit
pub async fn run_job_processor_once(max_jobs: u32) -> GrimoireResponse<()> {
    let _owner = match acquire_runner(&CancellationToken::new(), true).await {
        Ok(Some(owner)) => owner,
        Ok(None) => return GrimoireResponse::success("job runner stopped", ()),
        Err(error) => {
            return GrimoireResponse::failure(
                "could not acquire job runner ownership",
                vec![error.into()],
            )
        }
    };
    let pool = match crate::database::connect().await {
        Ok(pool) => pool,
        Err(error) => {
            return GrimoireResponse::failure("could not connect job runner", vec![error.into()])
        }
    };
    if let Err(error) = super::lifecycle::recover_interrupted(&pool).await {
        return GrimoireResponse::failure("could not recover interrupted jobs", vec![error.into()]);
    }
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
                let process_response = process_job_safely(job).await;
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

#[cfg(test)]
mod tests {
    use super::*;

    // the media-add pipeline + video transcoding - exactly what the
    // webp-conversion starvation report named ("media add, transcode").
    #[test]
    fn job_class_classifies_the_heavy_pipeline_correctly() {
        for jt in [
            JobType::ImportMusic,
            JobType::ImportVideo,
            JobType::TranscodeVideo,
            JobType::ProcessFile,
            JobType::ProcessDirectory,
            JobType::FetchMedia,
            JobType::PreCheckFetch,
        ] {
            assert_eq!(job_class(&jt), JobClass::Heavy, "{jt:?} should be Heavy");
        }
    }

    // ConvertWebp (the job actually being starved) and the cross-remote
    // sync jobs (already have their own priority boost, need no class
    // cap) must both land in the uncapped `Other` bucket, not `Heavy` -
    // otherwise they'd be competing for the SAME reserved slot they're
    // supposed to benefit from.
    #[test]
    fn job_class_does_not_misclassify_quick_or_already_prioritized_jobs_as_heavy() {
        for jt in [
            JobType::ConvertWebp,
            JobType::SyncSongByBlake3,
            JobType::SyncVideoByBlake3,
            JobType::ScanDirectory,
            JobType::RescanDirectories,
            JobType::RepairLibraryImages,
            JobType::ReorganizeLibraryFiles,
        ] {
            assert_eq!(job_class(&jt), JobClass::Other, "{jt:?} should be Other");
        }
    }

    #[test]
    fn heavy_class_cap_always_leaves_room_for_other_jobs() {
        // typical pool sizes: cap is strictly less than pool_size, so at
        // least one slot can never be claimed by a Heavy job.
        assert_eq!(class_cap(JobClass::Heavy, 8), Some(7));
        assert_eq!(class_cap(JobClass::Heavy, 4), Some(3));
        assert_eq!(class_cap(JobClass::Heavy, 2), Some(1));
    }

    #[test]
    fn heavy_class_cap_never_drops_to_zero_on_a_single_worker_pool() {
        // nothing to reserve from on a 1-worker pool - Heavy still gets
        // its one slot rather than being starved entirely (quick jobs
        // just compete in the same FIFO at that point, same as today).
        assert_eq!(class_cap(JobClass::Heavy, 1), Some(1));
        assert_eq!(class_cap(JobClass::Heavy, 0), Some(1));
    }

    #[test]
    fn other_class_is_never_capped_regardless_of_pool_size() {
        assert_eq!(class_cap(JobClass::Other, 1), None);
        assert_eq!(class_cap(JobClass::Other, 8), None);
    }

    #[test]
    fn enrichment_class_caps_are_unaffected_by_pool_size() {
        // pre-existing behavior (fixed caps, not pool-relative) must
        // survive the signature change unchanged.
        assert_eq!(class_cap(JobClass::EnrichmentMb, 1), Some(2));
        assert_eq!(class_cap(JobClass::EnrichmentMb, 8), Some(2));
        assert_eq!(class_cap(JobClass::EnrichmentLastFm, 8), Some(3));
        assert_eq!(class_cap(JobClass::EnrichmentAudiodb, 8), Some(2));
    }
}

