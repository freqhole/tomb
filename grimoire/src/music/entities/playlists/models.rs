//! playlist domain models

use serde::{Deserialize, Serialize};

/// playlist model for music domain
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Playlist {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub is_public: i64, // sqlite boolean (0/1)
    pub thumbnail_blob_id: Option<String>,
    pub created_by_id: Option<String>,
    pub created_at: i64, // unix timestamp UTC
    pub updated_at: i64, // unix timestamp UTC
    pub deleted_at: Option<i64>,
    pub deleted_by: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
}

/// request for creating a new playlist
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePlaylistRequest {
    pub title: String,
    pub description: Option<String>,
    pub is_public: Option<bool>,
    pub created_by_id: Option<String>,
}

/// playlist song association model
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PlaylistSong {
    pub playlist_id: String,
    pub song_id: String,
    pub position: i64,
    pub added_at: i64, // unix timestamp UTC
}

/// request for adding songs to a playlist
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddSongsToPlaylistRequest {
    pub playlist_id: String,
    pub song_ids: Vec<String>,
}

/// request for updating playlist metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePlaylistRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub is_public: Option<bool>,
    pub thumbnail_blob_id: Option<String>,
    pub updated_by: Option<String>,
}

/// playlist with song count for efficient listing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistWithCount {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub is_public: i64, // sqlite boolean (0/1)
    pub thumbnail_blob_id: Option<String>,
    pub created_by_id: Option<String>,
    pub created_at: i64, // unix timestamp UTC
    pub updated_at: i64, // unix timestamp UTC
    pub deleted_at: Option<i64>,
    pub deleted_by: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
    pub song_count: i64,
}
