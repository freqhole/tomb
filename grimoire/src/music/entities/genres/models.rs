//! genre domain models

use crate::JsonVec;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

use super::super::shared::ImageMetadata;

/// primary genre model for music domain
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct Genre {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub images: Option<JsonVec<ImageMetadata>>,
    pub created_at: i64, // unix timestamp UTC
}

/// sub-genre model for music domain
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct SubGenre {
    pub id: String,
    pub name: String,
    pub parent_genre_id: Option<String>,
    pub created_at: i64, // unix timestamp UTC
}

/// request for creating a new genre
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateGenreRequest {
    pub name: String,
}

/// request for creating a new sub-genre
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateSubGenreRequest {
    pub name: String,
    pub parent_genre_id: Option<String>,
}

/// genre statistics for API responses
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenreStat {
    pub name: String,
    pub song_count: i64,
    pub album_count: i64,
    pub artist_count: i64,
    pub total_duration: i64,
}

/// request for querying sub-genres by name
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct QuerySubGenresRequest {
    pub search: String,
}

/// request for getting a sub-genre by id
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetSubGenreRequest {
    pub id: String,
}

/// request for deleting a sub-genre
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct DeleteSubGenreRequest {
    pub id: String,
}

/// request for listing sub-genres for a parent genre
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListSubGenresForGenreRequest {
    pub parent_genre_id: String,
}

/// request for finding or creating a sub-genre
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct FindOrCreateSubGenreRequest {
    pub name: String,
    pub parent_genre_id: String,
}

/// response for find_or_create_sub_genre (returns sub-genre and created flag)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct FindOrCreateSubGenreResponse {
    pub sub_genre: SubGenre,
    pub created: bool,
}
