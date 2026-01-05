//! album domain models

use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

/// album model (normalized table)
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Album {
    pub rowid: i64,
    pub id: String,
    pub title: String,
    pub artist_id: Option<i64>,
    pub album_artist: Option<String>,
    pub year: Option<i32>,
    pub musicbrainz_id: Option<String>,
    pub song_count: i32,
    pub total_duration: i32,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

/// request for creating a new album
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateAlbumRequest {
    pub title: String,
    pub artist_id: Option<i64>,
    pub album_artist: Option<String>,
    pub year: Option<i32>,
    pub musicbrainz_id: Option<String>,
}
