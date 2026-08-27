//! bulk video update - applies the same field values to every id in
//! `video_ids`, mirroring the offal/cli shape of music's `update_songs`
//! (always id-list based, even for a single video).

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::response::GrimoireResponse;
use crate::video::crud::delete::{delete_video_season_if_unused, delete_video_series_if_unused};
use crate::video::entities::videos::{update_video, UpdateVideoRequest};

/// request to bulk-update videos - every field besides `video_ids` is
/// applied as-is (via the same `COALESCE`-on-write semantics as a single
/// video update) to each id in the list.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdateVideosRequest {
    pub video_ids: Vec<String>,
    pub series_id: Option<String>,
    pub season_id: Option<String>,
    pub episode_number: Option<i64>,
    pub content_type: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub poster_blob_id: Option<String>,
    pub duration_seconds: Option<f64>,
    pub release_date: Option<String>,
    pub updated_by: Option<String>,
    /// force `series_id`/`season_id` to `NULL` on every video in the list -
    /// see `UpdateVideoRequest::clear_series_id` for why plain `COALESCE`
    /// can't express this via `series_id: None` alone.
    #[serde(default)]
    pub clear_series_id: bool,
    /// force `season_id` to `NULL` on every video in the list.
    #[serde(default)]
    pub clear_season_id: bool,
}

/// a single video's failure reason within a bulk update - preserves the
/// real per-video error (rather than discarding it down to a bare id) so
/// callers/clients can surface something actionable.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct VideoUpdateFailure {
    pub video_id: String,
    pub reason: String,
}

/// result of a bulk video update operation
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdateVideosResult {
    pub videos_updated: u32,
    pub videos_failed: Vec<VideoUpdateFailure>,
}

/// bulk-update videos. best-effort - a failed id is recorded but doesn't
/// stop the rest from being updated.
pub async fn update_videos(req: UpdateVideosRequest) -> GrimoireResponse<UpdateVideosResult> {
    if req.video_ids.is_empty() {
        return GrimoireResponse::failure(
            "Validation failed",
            vec![GrimoireError::Validation {
                field: "video_ids".to_string(),
                message: "video_ids cannot be empty".to_string(),
            }
            .into()],
        );
    }

    let mut videos_updated: u32 = 0;
    let mut videos_failed = Vec::new();

    // collect old series/season ids for orphan cleanup - only needed when
    // this update actually intends to change series/season (COALESCE means
    // `None` here leaves the video's existing value untouched, so there's
    // nothing to potentially orphan in that case).
    let need_old_series = req.series_id.is_some();
    let need_old_season = req.season_id.is_some();
    let mut old_series_ids: Vec<String> = Vec::new();
    let mut old_season_ids: Vec<String> = Vec::new();

    if need_old_series || need_old_season {
        if let Ok(pool) = database::connect().await {
            for video_id in &req.video_ids {
                if let Ok(Some(row)) = sqlx::query!(
                    "SELECT series_id, season_id FROM videoz WHERE id = ?",
                    video_id
                )
                .fetch_optional(&pool)
                .await
                {
                    if need_old_series {
                        if let Some(id) = row.series_id {
                            old_series_ids.push(id);
                        }
                    }
                    if need_old_season {
                        if let Some(id) = row.season_id {
                            old_season_ids.push(id);
                        }
                    }
                }
            }
        }
    }

    for video_id in &req.video_ids {
        let response = update_video(UpdateVideoRequest {
            video_id: video_id.clone(),
            series_id: req.series_id.clone(),
            season_id: req.season_id.clone(),
            episode_number: req.episode_number,
            content_type: req.content_type.clone(),
            title: req.title.clone(),
            description: req.description.clone(),
            poster_blob_id: req.poster_blob_id.clone(),
            duration_seconds: req.duration_seconds,
            release_date: req.release_date.clone(),
            updated_by: req.updated_by.clone(),
            clear_series_id: req.clear_series_id,
            clear_season_id: req.clear_season_id,
        })
        .await;

        if response.success {
            videos_updated += 1;
        } else {
            // preserve the real per-video reason (the underlying
            // `update_video()` response's own error detail, falling back
            // to its message) instead of discarding it down to just the id.
            let reason = response
                .errors
                .first()
                .map(|e| e.detail.clone())
                .unwrap_or_else(|| response.message.clone());
            videos_failed.push(VideoUpdateFailure {
                video_id: video_id.clone(),
                reason,
            });
        }
    }

    // cleanup orphaned series/seasons - mirrors music's
    // `update_songs()`/`delete_artist_if_unused` pattern: any old
    // series/season id a video moved away from that no longer has any
    // non-deleted video attached gets soft-deleted. best-effort - a
    // failure here doesn't fail the overall update, since the videos
    // themselves already updated successfully.
    if let Some(ref new_series_id) = req.series_id {
        for old_series_id in old_series_ids {
            if old_series_id != *new_series_id {
                let _ = delete_video_series_if_unused(&old_series_id).await;
            }
        }
    }
    if let Some(ref new_season_id) = req.season_id {
        for old_season_id in old_season_ids {
            if old_season_id != *new_season_id {
                let _ = delete_video_season_if_unused(&old_season_id).await;
            }
        }
    }

    let success = videos_failed.is_empty();
    let message = if success {
        format!("updated {} video(s)", videos_updated)
    } else if videos_failed.len() == 1 {
        // the common single-video-edit-modal case: surface the real
        // reason directly in the top-level message, since that's what
        // `createCallFn`'s synthetic client-side error prioritizes.
        format!("failed to update video: {}", videos_failed[0].reason)
    } else {
        format!(
            "updated {} video(s), {} failed",
            videos_updated,
            videos_failed.len()
        )
    };

    if success {
        GrimoireResponse::success(
            message,
            UpdateVideosResult {
                videos_updated,
                videos_failed,
            },
        )
    } else {
        GrimoireResponse {
            success: false,
            message,
            data: Some(UpdateVideosResult {
                videos_updated,
                videos_failed,
            }),
            errors: vec![ErrorDetail::new(
                "partial_update_failure",
                "Some videos failed to update",
                "one or more video_ids failed to update - see videos_failed",
            )],
        }
    }
}
