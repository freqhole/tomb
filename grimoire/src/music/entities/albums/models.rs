//! album domain models

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// album model for music domain
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct Album {
    pub id: String,
    pub title: String,
    pub album_type: String,
    pub release_date: Option<String>,
    pub release_date_precision: Option<String>,
    pub label: Option<String>,
    pub genre_id: Option<String>,
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
    pub release_date_precision: Option<String>,
    pub label: Option<String>,
    pub genre_id: Option<String>,
    pub created_by: Option<String>,
}
