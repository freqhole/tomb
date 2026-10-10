//! repair library images job processor
//!
//! runs `maintenance::repair_library_images`'s phases (song waveform
//! backfill, video waveform backfill, video thumbnail backfill, then
//! directory-grouped song/album thumbnail backfill/cleanup) as a chain
//! of small batch jobs rather than one long-running job: each
//! invocation handles one batch and, if there's more work, enqueues the
//! next batch (same phase, or the next phase once this one's exhausted)
//! carrying the running totals forward in its parameters. this keeps any
//! single job short - cancelling the currently in-flight/pending batch
//! just stops the chain (see `is_cancelled` below), and re-running the
//! whole thing from the top (re-enqueueing phase `Waveforms`/offset 0) is
//! always safe since every check in `maintenance::repair_library_images`
//! is itself idempotent.

use crate::database;
use crate::jobs::job_events::{self, JobEvent};
use crate::jobs::{create_job, CreateJobRequest, Job, JobError, JobType};
use crate::maintenance::{
    RepairLibraryImagesPhase, DIRECTORY_BATCH_SIZE, VIDEO_THUMBNAIL_BATCH_SIZE, WAVEFORM_BATCH_SIZE,
};
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
            // song (and video) waveform sub-job disabled - skip both
            // waveform phases straight to the video thumbnail phase
            // (itself a no-op batch if that's disabled too, handled below).
            Some((RepairLibraryImagesPhase::VideoThumbnails, 0))
        }
        RepairLibraryImagesPhase::Waveforms => {
            let resp = crate::maintenance::repair_waveforms_batch(
                params.dry_run,
                WAVEFORM_BATCH_SIZE,
                params.directory_offset,
                params.scan_directory.as_deref(),
                created_by.clone(),
            )
            .await;
            let Some(outcome) = resp.data else {
                return Err(JobError::ProcessingFailed {
                    reason: resp.message,
                });
            };
            let backfilled_this_batch = outcome.result.songs_waveforms_backfilled;
            totals.merge(outcome.result);
            if outcome.more_remaining {
                let next_offset = crate::maintenance::repair_library_images::next_batch_offset(
                    params.dry_run,
                    backfilled_this_batch,
                    params.directory_offset,
                    WAVEFORM_BATCH_SIZE,
                );
                Some((RepairLibraryImagesPhase::Waveforms, next_offset))
            } else {
                // song waveform phase exhausted - move on to video waveforms.
                Some((RepairLibraryImagesPhase::VideoWaveforms, 0))
            }
        }
        RepairLibraryImagesPhase::VideoWaveforms if !params.options.backfill_waveforms => {
            Some((RepairLibraryImagesPhase::VideoThumbnails, 0))
        }
        RepairLibraryImagesPhase::VideoWaveforms => {
            let resp = crate::maintenance::repair_video_waveforms_batch(
                params.dry_run,
                WAVEFORM_BATCH_SIZE,
                params.directory_offset,
                params.scan_directory.as_deref(),
                created_by.clone(),
            )
            .await;
            let Some(outcome) = resp.data else {
                return Err(JobError::ProcessingFailed {
                    reason: resp.message,
                });
            };
            let backfilled_this_batch = outcome.result.videos_waveforms_backfilled;
            totals.merge(outcome.result);
            if outcome.more_remaining {
                let next_offset = crate::maintenance::repair_library_images::next_batch_offset(
                    params.dry_run,
                    backfilled_this_batch,
                    params.directory_offset,
                    WAVEFORM_BATCH_SIZE,
                );
                Some((RepairLibraryImagesPhase::VideoWaveforms, next_offset))
            } else {
                Some((RepairLibraryImagesPhase::VideoThumbnails, 0))
            }
        }
        RepairLibraryImagesPhase::VideoThumbnails if !params.options.backfill_video_thumbnails => {
            Some((RepairLibraryImagesPhase::Directories, 0))
        }
        RepairLibraryImagesPhase::VideoThumbnails => {
            let resp = crate::maintenance::repair_video_thumbnails_batch(
                params.dry_run,
                VIDEO_THUMBNAIL_BATCH_SIZE,
                params.directory_offset,
                params.scan_directory.as_deref(),
                created_by.clone(),
            )
            .await;
            let Some(outcome) = resp.data else {
                return Err(JobError::ProcessingFailed {
                    reason: resp.message,
                });
            };
            let backfilled_this_batch = outcome.result.videos_thumbnails_backfilled;
            totals.merge(outcome.result);
            if outcome.more_remaining {
                let next_offset = crate::maintenance::repair_library_images::next_batch_offset(
                    params.dry_run,
                    backfilled_this_batch,
                    params.directory_offset,
                    VIDEO_THUMBNAIL_BATCH_SIZE,
                );
                Some((RepairLibraryImagesPhase::VideoThumbnails, next_offset))
            } else {
                // video thumbnail phase exhausted - move on to the
                // song/album directory pass.
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

    // live progress tick for anything watching this session (eg. the
    // charnel wizard's repair-library progress card) - running totals so
    // far, not just this one batch's slice, since that's what's actually
    // useful to show a user staring at a multi-minute chain. see
    // `job_events::JobEvent::Stage`'s own doc comment.
    {
        let phase_label = match params.phase {
            RepairLibraryImagesPhase::Waveforms => "backfilling song waveforms",
            RepairLibraryImagesPhase::VideoWaveforms => "backfilling video waveforms",
            RepairLibraryImagesPhase::VideoThumbnails => "backfilling video thumbnails",
            RepairLibraryImagesPhase::Directories => "backfilling album/directory art",
        };
        // only mention counts that are actually non-zero - a user
        // staring at "0 song waveform(s), 0 video waveform(s), 0 video
        // thumbnail(s), 12 album thumbnail(s)" has to hunt for the one
        // real number in a wall of zeros.
        let mut parts = Vec::new();
        if totals.songs_waveforms_backfilled > 0 {
            parts.push(format!(
                "{} song waveform(s)",
                totals.songs_waveforms_backfilled
            ));
        }
        if totals.videos_waveforms_backfilled > 0 {
            parts.push(format!(
                "{} video waveform(s)",
                totals.videos_waveforms_backfilled
            ));
        }
        if totals.videos_thumbnails_backfilled > 0 {
            parts.push(format!(
                "{} video thumbnail(s)",
                totals.videos_thumbnails_backfilled
            ));
        }
        if totals.albums_thumbnails_backfilled > 0 {
            parts.push(format!(
                "{} album thumbnail(s)",
                totals.albums_thumbnails_backfilled
            ));
        }
        let counts = if parts.is_empty() {
            "nothing backfilled yet".to_string()
        } else {
            format!("{} backfilled so far", parts.join(", "))
        };
        let message = format!(
            "{} (batch at offset {}): {}{}",
            phase_label,
            params.directory_offset,
            counts,
            if totals.errors.is_empty() {
                String::new()
            } else {
                format!(", {} error(s)", totals.errors.len())
            },
        );
        job_events::emit(JobEvent::Stage {
            session_id: job.session_id.clone(),
            job_id: job.id.clone(),
            stage: format!("{:?}", params.phase),
            message: Some(message),
            topic: JobType::RepairLibraryImages,
            entity_ref: None,
            created_by: job.created_by.clone(),
            details: Some(json!({
                "phase": format!("{:?}", params.phase),
                "directory_offset": params.directory_offset,
                "songs_waveforms_backfilled": totals.songs_waveforms_backfilled,
                "videos_waveforms_backfilled": totals.videos_waveforms_backfilled,
                "videos_thumbnails_backfilled": totals.videos_thumbnails_backfilled,
                "albums_thumbnails_backfilled": totals.albums_thumbnails_backfilled,
                "albums_thumbnails_removed_overapplied": totals.albums_thumbnails_removed_overapplied,
                "errors": totals.errors.len(),
            })),
        });
    }

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
             thumbnails_removed={}, left_ambiguous={}, video_waveforms_backfilled={}, \
             video_thumbnails_backfilled={}, errors={}",
            job.id,
            totals.songs_waveforms_backfilled,
            totals.albums_thumbnails_backfilled,
            totals.albums_thumbnails_removed_overapplied,
            totals.albums_left_ambiguous,
            totals.videos_waveforms_backfilled,
            totals.videos_thumbnails_backfilled,
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
