//! Genre models and types for music genre API endpoints
//!
//! This module contains all the data structures used for genre operations,
//! matching the server implementation exactly.

use serde::{Deserialize, Serialize};

/// Individual genre statistics
#[derive(Debug, Serialize)]
pub struct GenreStat {
    pub name: String,
    pub song_count: i64,
    pub album_count: i64,
    pub artist_count: i64,
    pub total_duration: i64,
}

/// Response for GET /api/music/genres
#[derive(Debug, Serialize)]
pub struct GenreStatsResponse {
    pub genres: Vec<GenreStat>,
    pub total: i64,
}

/// Request body for POST /api/music/genres
#[derive(Debug, Deserialize)]
pub struct GenreSearchBody {
    pub genre: Option<String>,
    pub artist: Option<String>,
    pub q: Option<String>,
    pub tags: Option<Vec<String>>,
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

/// Internal request parameters for genre search
#[derive(Debug)]
pub struct GenreSearchRequest {
    pub genre: Option<String>,
    pub artist: Option<String>,
    pub q: Option<String>,
    pub tags: Option<Vec<String>>,
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,
    pub page: Option<i64>,
    pub page_size: Option<i64>,
}

impl From<GenreSearchBody> for GenreSearchRequest {
    fn from(body: GenreSearchBody) -> Self {
        Self {
            genre: body.genre,
            artist: body.artist,
            q: body.q,
            tags: body.tags,
            sort_by: body.sort_by,
            sort_direction: body.sort_direction,
            page: body.page,
            page_size: body.page_size,
        }
    }
}

/// Artist summary within a genre
#[derive(Debug, Serialize)]
pub struct GenreArtist {
    pub artist: String,
    pub song_count: i64,
    pub album_count: i64,
    pub total_duration: i64,
    pub genres: Vec<String>,
    pub avg_rating: Option<f64>,
    pub favorite_count: i64,
}

/// Album summary within a genre/artist
#[derive(Debug, Serialize)]
pub struct GenreAlbum {
    pub album: Option<String>,
    pub artist: Option<String>,
    pub year: Option<i32>,
    pub track_count: i64,
    pub disc_count: i64,
    pub total_duration: Option<String>,
    pub genres: Option<String>,
    pub avg_rating: Option<f64>,
    pub favorite_count: i64,
    pub album_thumbnail_id: Option<String>,
}

/// Response when searching for artists within genres
#[derive(Debug, Serialize)]
pub struct GenreArtistsResponse {
    pub artists: Vec<GenreArtist>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub total_pages: i64,
    pub has_next: bool,
    pub has_prev: bool,
}

/// Response when searching for albums within genre/artist
#[derive(Debug, Serialize)]
pub struct GenreAlbumsResponse {
    pub albums: Vec<GenreAlbum>,
    pub total: i64,
    pub page: i64,
    pub page_size: i64,
    pub total_pages: i64,
    pub has_next: bool,
    pub has_prev: bool,
}
