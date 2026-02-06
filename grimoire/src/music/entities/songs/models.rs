//! song domain models

use crate::music::crud::{EntityUrl, ImageMetadata};
use crate::JsonVec;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// song model for music domain
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct Song {
    pub id: String,
    pub media_blob_id: String,
    pub images: Option<JsonVec<ImageMetadata>>,
    pub urls: Option<JsonVec<EntityUrl>>,
    pub title: String,
    pub track_number: i64,
    pub disc_number: i64,
    pub duration: Option<i64>,
    pub bpm: Option<i64>,
    pub track_artist: Option<String>,
    pub metadata: Option<String>,
    pub lyrics: Option<String>,
    pub created_at: i64,         // unix timestamp UTC
    pub updated_at: i64,         // unix timestamp UTC
    pub deleted_at: Option<i64>, // unix timestamp UTC
    pub deleted_by: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
}

/// request for creating a new song
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateSongRequest {
    pub media_blob_id: String,
    pub title: String,
    pub track_number: i64,
    pub disc_number: i64,
    pub duration: Option<i64>,
    pub bpm: Option<i64>,
    pub track_artist: Option<String>,
    pub metadata: Option<String>,
    pub lyrics: Option<String>,
    pub created_by: Option<String>,
}
