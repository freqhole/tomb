//! bulk video update - applies the same field values to every id in
//! `video_ids`, mirroring the offal/cli shape of music's `update_songs`
//! (always id-list based, even for a single video).

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

use crate::error::{ErrorDetail, GrimoireError};
use crate::response::GrimoireResponse;
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
    pub title: Option<String>,
    pub description: Option<String>,
    pub poster_blob_id: Option<String>,
    pub duration_seconds: Option<f64>,
    pub release_date: Option<String>,
    pub updated_by: Option<String>,
}

/// result of a bulk video update operation
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdateVideosResult {
    pub videos_updated: u32,
    pub videos_failed: Vec<String>,
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

    for video_id in &req.video_ids {
        let response = update_video(UpdateVideoRequest {
            video_id: video_id.clone(),
            series_id: req.series_id.clone(),
            season_id: req.season_id.clone(),
            episode_number: req.episode_number,
            title: req.title.clone(),
            description: req.description.clone(),
            poster_blob_id: req.poster_blob_id.clone(),
            duration_seconds: req.duration_seconds,
            release_date: req.release_date.clone(),
            updated_by: req.updated_by.clone(),
        })
        .await;

        if response.success {
            videos_updated += 1;
        } else {
            videos_failed.push(video_id.clone());
        }
    }

    let success = videos_failed.is_empty();
    let message = if success {
        format!("updated {} video(s)", videos_updated)
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
