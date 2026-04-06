//! audio domain models
//!
//! for general-purpose audio files: samples, voice memos, in-progress tracks.
//! this is NOT the music library (songs/albums/artists) — that's in the music module.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// audio entity — a general-purpose audio file
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct Audio {
    pub id: String,
    pub media_blob_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub original_filename: Option<String>,
    pub duration: Option<i64>,
    pub sample_rate: Option<i64>,
    pub channels: Option<i64>,
    pub bitrate: Option<i64>,
    pub metadata: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub deleted_by: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
}

/// request for creating a new audio entity
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateAudioRequest {
    pub media_blob_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub original_filename: Option<String>,
    pub duration: Option<i64>,
    pub sample_rate: Option<i64>,
    pub channels: Option<i64>,
    pub bitrate: Option<i64>,
    pub metadata: Option<String>,
    pub created_by: Option<String>,
}
