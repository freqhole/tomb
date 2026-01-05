//! genre domain models

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// primary genre model for music domain
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, FromRow)]
pub struct Genre {
    pub rowid: i64,
    pub id: String,
    pub name: String,
    pub created_at: i64, // unix timestamp UTC
}

/// sub-genre model for music domain
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SubGenre {
    pub rowid: i64,
    pub id: String,
    pub name: String,
    pub parent_genre_rowid: Option<i64>,
    pub created_at: i64, // unix timestamp UTC
}

/// request for creating a new genre
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateGenreRequest {
    pub name: String,
}

/// request for creating a new sub-genre
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateSubGenreRequest {
    pub name: String,
    pub parent_genre_rowid: Option<i64>,
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

/// response for genre statistics listing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenreStatsResponse {
    pub genres: Vec<GenreStat>,
    pub total: i64,
}
