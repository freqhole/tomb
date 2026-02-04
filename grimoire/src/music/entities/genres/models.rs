//! genre domain models

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// genre model for music domain
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct Genre {
    pub id: String,
    pub name: String,
    pub created_at: i64, // unix timestamp UTC
}

/// genre with statistics (from genre_query_view)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct GenreWithStats {
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub album_count: i64,
    pub song_count: i64,
    pub total_duration: i64,
}

/// request for creating a new genre
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateGenreRequest {
    pub name: String,
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
