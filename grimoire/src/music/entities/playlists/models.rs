//! playlist domain models

use crate::music::crud::{EntityUrl, ImageMetadata};
use crate::JsonVec;
use clap::Parser;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// playlist model for music domain
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct Playlist {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub is_public: i64, // sqlite boolean (0/1)
    pub images: Option<JsonVec<ImageMetadata>>,
    pub urls: Option<JsonVec<EntityUrl>>,
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

/// request for getting a playlist by id
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetPlaylistRequest {
    pub id: String,
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
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, Parser)]
pub struct AddSongsToPlaylistRequest {
    /// Playlist ID
    #[arg(long)]
    pub playlist_id: String,

    /// Song IDs to add (comma-separated)
    #[arg(long, value_delimiter = ',')]
    pub song_ids: Vec<String>,
}

/// request for updating playlist metadata
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, Parser)]
pub struct UpdatePlaylistRequest {
    /// Playlist ID
    #[arg(long)]
    pub playlist_id: String,
    /// New playlist title
    #[arg(long)]
    pub title: Option<String>,

    /// New playlist description
    #[arg(long)]
    pub description: Option<String>,

    /// Make playlist public or private
    #[arg(long)]
    pub is_public: Option<bool>,

    /// Entity URLs (replaces all existing URLs)
    #[arg(skip)]
    pub entity_urls: Option<Vec<crate::music::crud::EntityUrl>>,

    /// User ID performing the update
    #[arg(long)]
    pub updated_by: Option<String>,
}

/// request for deleting a playlist
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, Parser)]
pub struct DeletePlaylistRequest {
    /// Playlist ID
    #[arg(long)]
    pub playlist_id: String,

    /// User ID performing the delete
    #[arg(long)]
    pub deleted_by: Option<String>,
}

/// request for removing songs from a playlist
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, Parser)]
pub struct RemoveSongsFromPlaylistRequest {
    /// Playlist ID
    #[arg(long)]
    pub playlist_id: String,

    /// Song IDs to remove (comma-separated)
    #[arg(long, value_delimiter = ',')]
    pub song_ids: Vec<String>,
}

/// request for reordering songs in a playlist
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, Parser)]
pub struct ReorderPlaylistSongsRequest {
    /// Playlist ID
    #[arg(long)]
    pub playlist_id: String,

    /// Song IDs to reorder (comma-separated)
    #[arg(long, value_delimiter = ',')]
    pub song_ids: Vec<String>,

    /// New position for the songs
    #[arg(long)]
    pub new_position: i64,
}

/// request for removing a playlist thumbnail
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, Parser)]
pub struct RemovePlaylistThumbnailRequest {
    /// Playlist ID
    #[arg(long)]
    pub playlist_id: String,

    /// Whether to clean up unused blob
    #[arg(long)]
    pub cleanup_blob: Option<bool>,

    /// User ID performing the operation
    #[arg(long)]
    pub deleted_by: Option<String>,
}
