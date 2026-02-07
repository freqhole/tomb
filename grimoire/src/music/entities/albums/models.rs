//! album domain models

use crate::music::crud::{EntityUrl, ImageMetadata};
use crate::JsonVec;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// lightweight genre reference with id and name
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct GenreRef {
    pub id: String,
    pub name: String,
}

/// album model for music domain
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct Album {
    pub id: String,
    pub title: String,
    pub album_type: String,
    pub release_date: Option<String>,
    pub label: Option<String>,
    pub genres: Option<JsonVec<GenreRef>>,
    pub images: Option<JsonVec<ImageMetadata>>,
    pub urls: Option<JsonVec<EntityUrl>>,
    pub song_count: i64,
    pub total_duration: i64,
    pub created_at: i64,         // unix timestamp UTC
    pub updated_at: i64,         // unix timestamp UTC
    pub deleted_at: Option<i64>, // unix timestamp UTC
    pub deleted_by: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
}

/// request for creating a new album
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateAlbumRequest {
    pub title: String,
    pub album_type: Option<String>,
    pub release_date: Option<String>,
    pub label: Option<String>,
    pub created_by: Option<String>,
}

/// request for updating an album
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdateAlbumRequest {
    pub album_id: String,
    pub title: Option<String>,
    /// artist id (preferred) or name (will find first match or create new)
    pub artist_id: Option<String>,
    pub artist_name: Option<String>,
    pub album_type: Option<String>,
    pub release_date: Option<String>, // flexible: "2023", "2023-06", "2023-06-15"
    pub label: Option<String>,
    /// genre ids (preferred) or names (will find or create)
    pub genre_ids: Option<Vec<String>>,
    pub genres: Option<Vec<String>>,
    /// entity URLs (replaces all existing URLs)
    pub entity_urls: Option<Vec<EntityUrl>>,
    pub updated_by: Option<String>,
}
