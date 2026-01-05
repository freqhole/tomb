//! search models placeholder
//! TODO: migrate from legacylib/src/search/ with sqlite fts5

use serde::{Deserialize, Serialize};

/// search query types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SearchType {
    FullText,   // sqlite fts5 full-text search
    Exact,      // exact phrase matching
    Wildcard,   // pattern matching with wildcards
    Structured, // field-specific searches
}

/// search filters for music content
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchFilter {
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year_from: Option<i64>,
    pub year_to: Option<i64>,
    pub duration_from: Option<i64>,
    pub duration_to: Option<i64>,
    pub rating_min: Option<i64>,
    pub is_favorite: Option<bool>,
    pub has_thumbnail: Option<bool>,
}

/// search request with query and filters
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchRequest {
    pub query: Option<String>,
    pub search_type: SearchType,
    pub filters: Option<SearchFilter>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,
}

/// unified search query for all domains
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    pub query_text: String,
    pub search_type: SearchType,
    pub domains: Vec<String>, // ["songs", "artists", "albums", "playlists"]
    pub filters: SearchFilter,
    pub max_results: usize,
}

/// song search result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongSearchResult {
    pub song_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub duration: Option<i64>,
    pub year: Option<i64>,
    pub relevance_score: f64,
    pub match_type: String,
    pub snippet: Option<String>, // highlighted text snippet
}

/// artist search result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtistSearchResult {
    pub artist_id: String,
    pub name: String,
    pub song_count: i64,
    pub album_count: i64,
    pub relevance_score: f64,
    pub snippet: Option<String>,
}

/// album search result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlbumSearchResult {
    pub album_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub year: Option<i64>,
    pub song_count: i64,
    pub total_duration: i64,
    pub relevance_score: f64,
    pub snippet: Option<String>,
}

/// unified search result containing all result types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub songs: Vec<SongSearchResult>,
    pub artists: Vec<ArtistSearchResult>,
    pub albums: Vec<AlbumSearchResult>,
    pub total_results: usize,
    pub search_time_ms: u64,
    pub query_info: SearchQueryInfo,
}

/// information about the executed search query
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQueryInfo {
    pub original_query: String,
    pub processed_query: String,
    pub search_type: SearchType,
    pub filters_applied: Vec<String>,
    pub suggestions: Vec<String>,
}
