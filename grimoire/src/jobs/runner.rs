//! job runner and orchestration
//!
//! handles dispatching jobs to the appropriate processor and running the job queue loop

use super::models::{Job, JobResult, JobType};
use super::music::{
    process_album_enrichment_pipeline_job, process_audiodb_album_detail_job,
    process_audiodb_artist_detail_job, process_auto_apply_album_enrichment_job,
    process_convert_webp_job, process_directory_job, process_fetch_media_job, process_file_job,
    process_import_music_job, process_lastfm_album_detail_job, process_lastfm_artist_detail_job,
    process_mb_album_detail_job, process_mb_album_search_job, process_rescan_directories_job,
    process_scan_directory_job,
};
use super::service::{
    delete_job, get_job_session, get_next_pending_job, get_session_job_counts, mark_job_completed,
    mark_job_failed, peek_pending_jobs, try_claim_pending_job,
};
use crate::error::ErrorDetail;
use crate::jobs::job_events::{self, JobEvent, JobStatusWire};
use crate::response::GrimoireResponse;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};
use tokio::sync::{Mutex, Semaphore};
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;
use tracing::{debug, info, warn};

/// concurrency class for a job type.
/// used to cap the number of concurrent enrichment workers per source
/// so bulk enrichment queues don't starve filesystem jobs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
enum JobClass {
    EnrichmentMb,
    EnrichmentLastFm,
    EnrichmentAudiodb,
    Other,
}

fn job_class(job_type: &JobType) -> JobClass {
    match job_type {
        JobType::MbAlbumSearch | JobType::MbAlbumDetail => JobClass::EnrichmentMb,
        JobType::LastFmAlbumDetail | JobType::LastFmArtistDetail => JobClass::EnrichmentLastFm,
        JobType::AudioDbAlbumDetail | JobType::AudioDbArtistDetail => JobClass::EnrichmentAudiodb,
        _ => JobClass::Other,
    }
}

/// max concurrent in-flight jobs for each capped class.
/// returns `None` for `Other` (no cap).
fn class_cap(class: JobClass) -> Option<usize> {
    match class {
        JobClass::EnrichmentMb => Some(2),
        JobClass::EnrichmentLastFm => Some(3),
        JobClass::EnrichmentAudiodb => Some(2),
        JobClass::Other => None,
    }
}

fn is_badge_progress_job(job_type: &JobType) -> bool {
    matches!(
        job_type,
        JobType::ImportMusic
            | JobType::ProcessFile
            | JobType::ProcessDirectory
            | JobType::FetchMedia
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
        Err(e) => return GrimoireResponse::failure("failed to parse job type", vec![e.into()]),
    };

    // dispatch to appropriate processor based on job type
    let result = match job_type {
        JobType::ScanDirectory => process_scan_directory_job(&job).await,
        JobType::RescanDirectories => process_rescan_directories_job(&job).await,
        JobType::ProcessFile => process_file_job(&job).await,
        JobType::ProcessDirectory => process_directory_job(&job).await,
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
            // exhausted retries. session-less jobs (e.g. ConvertWebp)
            // still emit StatusChanged/Failed so subscribers filtered
            // by `job_ids` receive a terminal event.
            {
                let to_status = if is_retryable {
                    JobStatusWire::Pending
                } else {
                    JobStatusWire::Failed
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
                if !is_retryable {
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
            let result = process_job(job).await;
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
                while let Some(_) = workers.join_next().await {}
                break;
            }
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
        let class_permit: Option<JobClassPermit> = if let Some(cap) = class_cap(class) {
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
