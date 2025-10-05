// genre models and types for music genre api endpoints
use serde::{Deserialize, Serialize};

/// individual genre statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenreStat {
    pub name: String,
    pub song_count: i64,
    pub album_count: i64,
    pub artist_count: i64,
    pub total_duration: i64, // total duration in seconds
}

/// response for GET /api/music/genres
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenreStatsResponse {
    pub genres: Vec<GenreStat>,
    pub total: i64,
}

/// request parameters for POST /api/music/genres
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenreSearchRequest {
    pub genre: Option<String>,          // filter to specific genre
    pub artist: Option<String>,         // filter to specific artist within genre
    pub q: Option<String>,              // search query term
    pub tags: Option<Vec<String>>,      // tag filters
    pub sort_by: Option<String>,        // "genre", "songs", "albums", "rating"
    pub sort_direction: Option<String>, // "asc" or "desc"
    pub page: Option<i32>,              // page number (1-based)
    pub page_size: Option<i32>,         // items per page
}

impl Default for GenreSearchRequest {
    fn default() -> Self {
        Self {
            genre: None,
            artist: None,
            q: None,
            tags: None,
            sort_by: Some("songs".to_string()),
            sort_direction: Some("desc".to_string()),
            page: Some(1),
            page_size: Some(50),
        }
    }
}

/// artist summary within a genre
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenreArtist {
    pub artist: String,
    pub song_count: i64,
    pub album_count: i64,
    pub total_duration: i64,
    pub genres: Vec<String>, // all genres for this artist
    pub avg_rating: Option<f64>,
    pub favorite_count: i64,
}

/// album summary within a genre/artist
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenreAlbum {
    pub album: Option<String>,
    pub artist: Option<String>,
    pub year: Option<i32>,
    pub track_count: i64,
    pub disc_count: i64,
    pub total_duration: Option<String>, // formatted duration string
    pub genres: Option<String>,         // comma-separated genres
    pub avg_rating: Option<f64>,
    pub favorite_count: i64,
    pub album_thumbnail_id: Option<String>,
}

/// response when searching for artists within genres (no artist filter)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenreArtistsResponse {
    pub artists: Vec<GenreArtist>,
    pub total: i64,
    pub page: i32,
    pub page_size: i32,
    pub total_pages: i64,
    pub has_next: bool,
    pub has_prev: bool,
}

/// response when searching for albums within genre/artist (with artist filter)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenreAlbumsResponse {
    pub albums: Vec<GenreAlbum>,
    pub total: i64,
    pub page: i32,
    pub page_size: i32,
    pub total_pages: i64,
    pub has_next: bool,
    pub has_prev: bool,
}

/// unified response for POST /api/music/genres
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum GenreSearchResponse {
    Artists(GenreArtistsResponse),
    Albums(GenreAlbumsResponse),
}

impl GenreSearchRequest {
    /// validate request parameters
    pub fn validate(&self) -> Result<(), String> {
        if let Some(page) = self.page {
            if page < 1 {
                return Err("page must be >= 1".to_string());
            }
        }

        if let Some(page_size) = self.page_size {
            if page_size < 1 || page_size > 100 {
                return Err("page_size must be between 1 and 100".to_string());
            }
        }

        if let Some(sort_by) = &self.sort_by {
            let valid_sorts = ["genre", "songs", "albums", "rating"];
            if !valid_sorts.contains(&sort_by.as_str()) {
                return Err(format!(
                    "sort_by must be one of: {}",
                    valid_sorts.join(", ")
                ));
            }
        }

        if let Some(sort_direction) = &self.sort_direction {
            let valid_directions = ["asc", "desc"];
            if !valid_directions.contains(&sort_direction.as_str()) {
                return Err("sort_direction must be 'asc' or 'desc'".to_string());
            }
        }

        Ok(())
    }

    /// get effective page (1-based)
    pub fn effective_page(&self) -> i32 {
        self.page.unwrap_or(1).max(1)
    }

    /// get effective page size
    pub fn effective_page_size(&self) -> i32 {
        self.page_size.unwrap_or(50).clamp(1, 100)
    }

    /// get effective sort field
    pub fn effective_sort_by(&self) -> &str {
        self.sort_by.as_deref().unwrap_or("songs")
    }

    /// get effective sort direction
    pub fn effective_sort_direction(&self) -> &str {
        self.sort_direction.as_deref().unwrap_or("desc")
    }

    /// calculate offset for pagination
    pub fn offset(&self) -> i64 {
        ((self.effective_page() - 1) * self.effective_page_size()) as i64
    }

    /// calculate limit for pagination
    pub fn limit(&self) -> i64 {
        self.effective_page_size() as i64
    }
}
