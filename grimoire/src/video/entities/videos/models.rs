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
    /// "series" | "movie" | "clip" - only meaningful when `series_id` is
    /// `None` (series-attached videos are implicitly "series" content).
    pub content_type: String,
    pub title: String,
    pub description: Option<String>,
    pub media_blob_id: String,
    /// denormalized content hash of `media_blob_id`'s blob (mirrors
    /// `Song::media_blob_blake3` in spirit, field just named `blake3` here) -
    /// `#[sqlx(default)]` so a query that doesn't select it falls back to
    /// `None` instead of failing at runtime.
    #[sqlx(default)]
    pub blake3: Option<String>,
    /// this video's parent movie, when it's an "extra" (deleted scene,
    /// blooper, behind-the-scenes, trailer) - always a row in THIS SAME
    /// database (never a foreign remote's id, see repository.rs's
    /// validation). mutually exclusive with `series_id` - a video is
    /// either series-attached or movie-with-extras-attached, not both.
    pub parent_video_id: Option<String>,
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
    /// total play count from `play_eventz` (entity_type = 'video') -
    /// mirrors `Song::play_count`. `#[sqlx(default)]` so any query that
    /// forgets to select it falls back to `None` instead of failing.
    #[sqlx(default)]
    pub play_count: Option<i64>,
}

/// request for creating a new video
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateVideoRequest {
    pub series_id: Option<String>,
    pub season_id: Option<String>,
    pub episode_number: Option<i64>,
    /// "series" | "movie" | "clip" - defaults to "series" when `series_id`
    /// is set, else "movie", if omitted.
    pub content_type: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub media_blob_id: String,
    /// see `Video::parent_video_id` - validated in `create_video`
    /// (parent must exist, be `content_type = "movie"`, have no parent of
    /// its own, and not be combined with `series_id`).
    pub parent_video_id: Option<String>,
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
    pub content_type: Option<String>,
    pub title: Option<String>,
    pub description: Option<String>,
    /// see `Video::parent_video_id` - validated in `update_video` the same
    /// way `create_video` validates it.
    pub parent_video_id: Option<String>,
    pub poster_blob_id: Option<String>,
    pub duration_seconds: Option<f64>,
    pub release_date: Option<String>,
    pub updated_by: Option<String>,
    /// force `series_id` (and `season_id`, since a video can't have a
    /// season without a series) to `NULL` regardless of `series_id`'s
    /// value - plain `COALESCE`-on-write can't distinguish "no change"
    /// from "clear", so this is required to actually detach a video from
    /// its series (e.g. reclassifying a series episode as a standalone
    /// movie/clip).
    #[serde(default)]
    pub clear_series_id: bool,
    /// force `season_id` to `NULL` regardless of `season_id`'s value
    /// (e.g. converting a full episode into a season-less docuseries
    /// entry). implied by `clear_series_id` as well.
    #[serde(default)]
    pub clear_season_id: bool,
    /// force `parent_video_id` to `NULL` regardless of its value (same
    /// "COALESCE can't distinguish no-change from clear" reason as the
    /// two flags above) - e.g. un-marking a video as an extra.
    #[serde(default)]
    pub clear_parent_video_id: bool,
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
