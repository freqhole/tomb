//! video domain models (the unified entity: standalone + episodes)

use crate::music::crud::ImageMetadata;
use crate::JsonVec;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// video model (~ songz for the video domain). covers a standalone
/// movie/clip (`series_id`/`season_id` both `None`), a season-less
/// docuseries episode (`series_id` set, `season_id` `None`), and a full tv
/// episode (both set).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct Video {
    pub id: String,
    pub series_id: Option<String>,
    pub season_id: Option<String>,
    pub episode_number: Option<i64>,
    pub title: String,
    pub description: Option<String>,
    pub media_blob_id: String,
    pub poster_blob_id: Option<String>,
    pub duration_seconds: Option<f64>,
    pub release_date: Option<String>,
    pub created_at: i64,         // unix timestamp UTC
    pub updated_at: i64,         // unix timestamp UTC
    pub deleted_at: Option<i64>, // unix timestamp UTC
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
    pub deleted_by: Option<String>,
    /// images linked via the generic `entity_imagez` table (posters +
    /// waveforms) - `#[sqlx(default)]` so any query that forgets to
    /// select it falls back to `None` instead of failing at runtime.
    #[sqlx(default)]
    pub images: Option<JsonVec<ImageMetadata>>,
}

/// request for creating a new video
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateVideoRequest {
    pub series_id: Option<String>,
    pub season_id: Option<String>,
    pub episode_number: Option<i64>,
    pub title: String,
    pub description: Option<String>,
    pub media_blob_id: String,
    pub poster_blob_id: Option<String>,
    pub duration_seconds: Option<f64>,
    pub release_date: Option<String>,
    pub created_by: Option<String>,
}

/// request for updating a video
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdateVideoRequest {
    pub video_id: String,
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

/// video with enriched metadata from the media blob (codec, container, bitrate, etc.)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct VideoWithMetadata {
    pub video: Video,
    pub created_by_username: Option<String>,
    pub updated_by_username: Option<String>,
    pub blob_size: Option<i64>,
    pub blob_width: Option<i64>,
    pub blob_height: Option<i64>,
    pub codec: Option<String>,
    pub container: Option<String>,
    pub bitrate: Option<i64>,
    pub frame_rate: Option<f64>,
}
