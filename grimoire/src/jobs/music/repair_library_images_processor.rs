//! repair library images job processor
//!
//! runs `maintenance::repair_library_images`'s two phases (waveform
//! backfill, then directory-grouped thumbnail backfill/cleanup) as a
//! chain of small batch jobs rather than one long-running job: each
//! invocation handles one batch and, if there's more work, enqueues the
//! next batch (same phase, or the next phase once this one's exhausted)
//! carrying the running totals forward in its parameters. this keeps any
//! single job short - cancelling the currently in-flight/pending batch
//! just stops the chain (see `is_cancelled` below), and re-running the
//! whole thing from the top (re-enqueueing phase `Waveforms`/offset 0) is
//! always safe since every check in `maintenance::repair_library_images`
//! is itself idempotent.

use crate::database;
use crate::jobs::{create_job, CreateJobRequest, Job, JobError, JobType};
use crate::maintenance::{RepairLibraryImagesPhase, DIRECTORY_BATCH_SIZE, WAVEFORM_BATCH_SIZE};
use serde_json::{json, Value};
use tracing::info;

use super::models::{RepairLibraryImagesJobResult, RepairLibraryImagesParams};

/// process one batch of a `RepairLibraryImages` job chain.
pub async fn process_repair_library_images_job(job: &Job) -> Result<Option<Value>, JobError> {
    let params: RepairLibraryImagesParams = job.parameters()?;
    info!(
        "processing RepairLibraryImages batch: job={} phase={:?} directory_offset={}",
        job.id, params.phase, params.directory_offset
    );

    let created_by = match job.created_by.as_ref() {
        Some(user_id) => resolve_username(user_id)
            .await
            .map(|username| (user_id.clone(), username)),
        None => None,
    };

    let mut totals = params.carry.clone();
    let continuation = match params.phase {
        RepairLibraryImagesPhase::Waveforms if !params.options.backfill_waveforms => {
            // waveform sub-job disabled - skip straight to the directory
            // phase (itself a no-op batch if none of its sub-jobs are
            // enabled either, handled below).
            Some((RepairLibraryImagesPhase::Directories, 0))
        }
        RepairLibraryImagesPhase::Waveforms => {
            let resp = crate::maintenance::repair_waveforms_batch(
                params.dry_run,
                WAVEFORM_BATCH_SIZE,
                params.scan_directory.as_deref(),
                created_by.clone(),
            )
            .await;
            let Some(outcome) = resp.data else {
                return Err(JobError::ProcessingFailed {
                    reason: resp.message,
                });
            };
            totals.merge(outcome.result);
            if outcome.more_remaining {
                Some((RepairLibraryImagesPhase::Waveforms, 0))
            } else {
                // waveform phase exhausted - move on to the directory pass.
                Some((RepairLibraryImagesPhase::Directories, 0))
            }
        }
        RepairLibraryImagesPhase::Directories if !params.options.any_directory_action() => None,
        RepairLibraryImagesPhase::Directories => {
            let resp = crate::maintenance::repair_directories_batch(
                params.dry_run,
                params.directory_offset,
                DIRECTORY_BATCH_SIZE,
                params.scan_directory.as_deref(),
                params.options,
                created_by.clone(),
            )
            .await;
            let Some(outcome) = resp.data else {
                return Err(JobError::ProcessingFailed {
                    reason: resp.message,
                });
            };
            totals.merge(outcome.result);
            outcome
                .more_remaining
                .then_some((RepairLibraryImagesPhase::Directories, outcome.next_offset))
        }
    };

    // cancelling this job stops the chain here - don't enqueue a
    // continuation for a run the caller asked to stop.
    let (done, next_job_id) = match continuation {
        Some((phase, directory_offset)) if !is_cancelled(&job.id).await => {
            let next = enqueue_next_batch(
                job,
                phase,
                directory_offset,
                params.dry_run,
                params.scan_directory.clone(),
                params.options,
                totals.clone(),
            )
            .await?;
            (false, Some(next))
        }
        _ => (true, None),
    };

    if done {
        info!(
            "RepairLibraryImages chain done (job={}): waveforms_backfilled={}, thumbnails_backfilled={}, \
             thumbnails_removed={}, left_ambiguous={}, errors={}",
            job.id,
            totals.songs_waveforms_backfilled,
            totals.albums_thumbnails_backfilled,
            totals.albums_thumbnails_removed_overapplied,
            totals.albums_left_ambiguous,
            totals.errors.len()
        );
    }

    Ok(Some(json!(RepairLibraryImagesJobResult {
        totals,
        done,
        next_job_id,
    })))
}

async fn is_cancelled(job_id: &str) -> bool {
    crate::jobs::get_job(job_id)
        .await
        .data
        .and_then(|j| j.status().ok())
        .map(|s| matches!(s, crate::jobs::JobStatus::Cancelled))
        .unwrap_or(false)
}

async fn enqueue_next_batch(
    job: &Job,
    phase: RepairLibraryImagesPhase,
    directory_offset: i64,
    dry_run: bool,
    scan_directory: Option<String>,
    options: crate::maintenance::RepairLibraryImagesOptions,
    carry: crate::maintenance::RepairLibraryImagesResult,
) -> Result<String, JobError> {
    let params = RepairLibraryImagesParams {
        dry_run,
        phase,
        directory_offset,
        scan_directory,
        options,
        carry,
    };
    let parameters = serde_json::to_value(&params).map_err(|e| JobError::ProcessingFailed {
        reason: format!("failed to serialize next batch's parameters: {e}"),
    })?;
    let req = CreateJobRequest {
        job_type: JobType::RepairLibraryImages,
        session_id: job.session_id.clone(),
        parameters,
        max_retries: Some(1),
        scheduled_at: None,
        created_by: job.created_by.clone(),
        priority: None,
    };
    let resp = create_job(req).await;
    resp.data
        .map(|j| j.id)
        .ok_or_else(|| JobError::ProcessingFailed {
            reason: format!("failed to enqueue next repair batch: {}", resp.message),
        })
}

async fn resolve_username(user_id: &str) -> Option<String> {
    let pool = database::connect().await.ok()?;
    sqlx::query_scalar!("SELECT username FROM user_accountz WHERE id = ?", user_id)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten()
}

