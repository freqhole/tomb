//! `ReorganizeLibraryFiles` job processor - processes one batch job's
//! fixed, disjoint list of song/video ids (see
//! `maintenance::reorganize_library`'s module doc comment for why this
//! job type has no phase/offset/carry chain the way
//! `RepairLibraryImages` does: each batch is fully self-contained, which
//! is what lets many of them run in parallel safely).
//!
//! cancellation: checked once before each domain's batch starts (song
//! ids, then video ids) - a cancel between the two still lets whichever
//! one already started finish, matching every other batch job's
//! cancellation granularity in this codebase (see
//! `repair_library_images_processor::is_cancelled`).

use crate::database;
use crate::jobs::{Job, JobError};
use serde_json::{json, Value};
use tracing::info;

use super::models::{ReorganizeLibraryFilesJobResult, ReorganizeLibraryFilesParams};

pub async fn process_reorganize_library_files_job(job: &Job) -> Result<Option<Value>, JobError> {
    let params: ReorganizeLibraryFilesParams = job.parameters()?;
    info!(
        "processing ReorganizeLibraryFiles batch: job={} songs={} videos={} dry_run={}",
        job.id,
        params.song_ids.len(),
        params.video_ids.len(),
        params.dry_run
    );

    let created_by = match job.created_by.as_ref() {
        Some(user_id) => resolve_username(user_id)
            .await
            .map(|username| (user_id.clone(), username)),
        None => None,
    };

    let mut totals = crate::maintenance::ReorganizeLibraryResult::default();

    if !params.song_ids.is_empty() && !is_cancelled(&job.id).await {
        let resp = crate::maintenance::reorganize_songs_batch(
            &params.song_ids,
            &params.target_directory,
            &params.source_directory,
            params.dry_run,
            params.embed_tags,
            created_by.clone(),
        )
        .await;
        let Some(result) = resp.data else {
            return Err(JobError::ProcessingFailed {
                reason: resp.message,
            });
        };
        totals.merge(result);
    }

    if !params.video_ids.is_empty() && !is_cancelled(&job.id).await {
        let resp = crate::maintenance::reorganize_videos_batch(
            &params.video_ids,
            &params.target_directory,
            &params.source_directory,
            params.dry_run,
            created_by.clone(),
        )
        .await;
        let Some(result) = resp.data else {
            return Err(JobError::ProcessingFailed {
                reason: resp.message,
            });
        };
        totals.merge(result);
    }

    if !params.dry_run {
        crate::maintenance::register_target_directory(
            &params.target_directory,
            created_by.map(|(id, _)| id),
        )
        .await;
    }

    info!(
        "ReorganizeLibraryFiles batch done (job={}): songs_moved={}, videos_moved={}, tags_embedded={}, errors={}",
        job.id,
        totals.songs_moved,
        totals.videos_moved,
        totals.tags_embedded,
        totals.errors.len()
    );

    Ok(Some(json!(ReorganizeLibraryFilesJobResult { totals })))
}

async fn is_cancelled(job_id: &str) -> bool {
    crate::jobs::get_job(job_id)
        .await
        .data
        .and_then(|j| j.status().ok())
        .map(|s| matches!(s, crate::jobs::JobStatus::Cancelled))
        .unwrap_or(false)
}

async fn resolve_username(user_id: &str) -> Option<String> {
    let pool = database::connect().await.ok()?;
    sqlx::query_scalar!("SELECT username FROM user_accountz WHERE id = ?", user_id)
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten()
}
