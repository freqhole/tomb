//! enqueue forced transcodes for videos that already have rendition blobs.

use crate::jobs::{CreateJobRequest, JobType, TranscodeVideoParams};
use crate::response::GrimoireResponse;
use serde::{Deserialize, Serialize};
use sqlx::Row;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RetranscodeVideoRenditionsSummary {
    pub videos_with_renditions: u32,
    pub jobs_enqueued: u32,
    pub pending_jobs_skipped: u32,
    pub enqueue_failures: u32,
}

/// enqueue forced transcodes for every active video with at least one active
/// rendition, or just the requested video when `video_id` is provided.
pub async fn enqueue_retranscode_video_renditions(
    video_id: Option<&str>,
    created_by: Option<String>,
) -> GrimoireResponse<RetranscodeVideoRenditionsSummary> {
    let pool = match crate::database::connect().await {
        Ok(pool) => pool,
        Err(error) => {
            return GrimoireResponse::failure("failed to connect to database", vec![error.into()])
        }
    };

    let query = if video_id.is_some() {
        "SELECT DISTINCT v.id, v.media_blob_id
         FROM videoz v
         JOIN media_blobz r ON r.parent_blob_id = v.media_blob_id
         WHERE v.deleted_at IS NULL
           AND r.blob_type = 'rendition'
           AND r.deleted_at IS NULL
           AND v.id = ?
         ORDER BY v.id"
    } else {
        "SELECT DISTINCT v.id, v.media_blob_id
         FROM videoz v
         JOIN media_blobz r ON r.parent_blob_id = v.media_blob_id
         WHERE v.deleted_at IS NULL
           AND r.blob_type = 'rendition'
           AND r.deleted_at IS NULL
         ORDER BY v.id"
    };
    let candidate_rows = match if let Some(video_id) = video_id {
        sqlx::query(query).bind(video_id).fetch_all(&pool).await
    } else {
        sqlx::query(query).fetch_all(&pool).await
    } {
        Ok(rows) => rows,
        Err(error) => {
            return GrimoireResponse::failure(
                "failed to find videos with renditions",
                vec![error.into()],
            );
        }
    };

    let mut candidates = Vec::with_capacity(candidate_rows.len());
    for row in candidate_rows {
        let id: String = match row.try_get("id") {
            Ok(value) => value,
            Err(error) => {
                return GrimoireResponse::failure("failed to read video id", vec![error.into()])
            }
        };
        let media_blob_id: String = match row.try_get("media_blob_id") {
            Ok(value) => value,
            Err(error) => {
                return GrimoireResponse::failure(
                    "failed to read source blob id",
                    vec![error.into()],
                )
            }
        };
        candidates.push((id, media_blob_id));
    }

    let pending_rows = match sqlx::query(
        "SELECT parameters FROM jobz WHERE job_type = 'TranscodeVideo' AND status = 'Pending'",
    )
    .fetch_all(&pool)
    .await
    {
        Ok(rows) => rows,
        Err(error) => {
            return GrimoireResponse::failure(
                "failed to inspect pending transcode jobs",
                vec![error.into()],
            )
        }
    };
    let pending_forced_video_ids: std::collections::HashSet<String> = pending_rows
        .iter()
        .filter_map(|row| row.try_get::<String, _>("parameters").ok())
        .filter_map(|parameters| serde_json::from_str::<TranscodeVideoParams>(&parameters).ok())
        .filter(|params| params.force)
        .map(|params| params.video_id)
        .collect();

    let videos_with_renditions = candidates.len() as u32;
    let mut summary = RetranscodeVideoRenditionsSummary {
        videos_with_renditions,
        jobs_enqueued: 0,
        pending_jobs_skipped: 0,
        enqueue_failures: 0,
    };
    for (video_id, media_blob_id) in candidates {
        if pending_forced_video_ids.contains(&video_id) {
            summary.pending_jobs_skipped += 1;
            continue;
        }
        let parameters = match serde_json::to_value(TranscodeVideoParams {
            media_blob_id,
            video_id,
            force: true,
        }) {
            Ok(parameters) => parameters,
            Err(error) => {
                tracing::warn!(error = %error, "failed to serialize forced video transcode parameters");
                summary.enqueue_failures += 1;
                continue;
            }
        };
        let response = crate::jobs::create_job(CreateJobRequest {
            job_type: JobType::TranscodeVideo,
            session_id: None,
            parameters,
            max_retries: Some(3),
            scheduled_at: None,
            created_by: created_by.clone(),
            priority: None,
        })
        .await;
        if response.success {
            summary.jobs_enqueued += 1;
        } else {
            tracing::warn!(message = %response.message, "failed to enqueue forced video transcode");
            summary.enqueue_failures += 1;
        }
    }

    let message = format!(
        "forced video transcode jobs: {} enqueued, {} matching pending job(s) skipped, {} failure(s)",
        summary.jobs_enqueued, summary.pending_jobs_skipped, summary.enqueue_failures
    );
    GrimoireResponse::success(&message, summary)
}
