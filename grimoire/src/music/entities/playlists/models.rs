//! playlist domain models

use clap::Parser;
use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// playlist model for music domain
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
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
    /// Song count - always calculated via COUNT() in queries
    pub song_count: i64,
}

/// request for creating a new playlist
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, Parser)]
pub struct CreatePlaylistRequest {
    /// Playlist title
    #[arg(long)]
    pub title: Option<String>,

    /// Playlist description
    #[arg(long)]
    pub description: Option<String>,

    /// Make playlist public
    #[arg(long)]
    pub is_public: Option<bool>,

    /// User ID creating the playlist
    #[arg(long)]
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
#[derive(Debug, Clone, Serialize, Deserialize, Parser)]
pub struct AddSongsToPlaylistRequest {
    /// Playlist ID
    #[arg(long)]
    pub playlist_id: String,

    /// Song IDs to add (comma-separated)
    #[arg(long, value_delimiter = ',')]
    pub song_ids: Vec<String>,
}

/// request for updating playlist metadata
#[derive(Debug, Clone, Serialize, Deserialize, Parser)]
pub struct UpdatePlaylistRequest {
    /// New playlist title
    #[arg(long)]
    pub title: Option<String>,

    /// New playlist description
    #[arg(long)]
    pub description: Option<String>,

    /// Make playlist public or private
    #[arg(long)]
    pub is_public: Option<bool>,

    /// Thumbnail blob ID
    #[arg(long)]
    pub thumbnail_blob_id: Option<String>,

    /// User ID performing the update
    #[arg(long)]
    pub updated_by: Option<String>,
}
