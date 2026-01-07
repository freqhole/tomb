//! song domain models

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// song model for music domain
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, FromRow)]
pub struct Song {
    pub id: String,
    pub media_blob_id: String,
    pub thumbnail_blob_id: Option<String>,
    pub waveform_blob_id: Option<String>,
    pub title: String,
    pub track_number: i64,
    pub disc_number: i64,
    pub duration: Option<i64>,
    pub year: Option<i64>,
    pub bpm: Option<i64>,
    pub key_signature: Option<String>,
    pub metadata: Option<String>,
    pub lyrics: Option<String>,
    pub processing_status: Option<String>,
    pub processing_notes: Option<String>,
    pub created_at: i64,         // unix timestamp UTC
    pub updated_at: i64,         // unix timestamp UTC
    pub deleted_at: Option<i64>, // unix timestamp UTC
    pub deleted_by: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
}

/// request for creating a new song
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSongRequest {
    pub media_blob_id: String,
    pub title: String,
    pub track_number: i64,
    pub disc_number: i64,
    pub duration: Option<i64>,
    pub year: Option<i64>,
    pub bpm: Option<i64>,
    pub key_signature: Option<String>,
    pub lyrics: Option<String>,
    pub created_by: Option<String>,
}
