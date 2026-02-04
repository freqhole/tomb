//! search domain models for full-text search and autocomplete

use serde::{Deserialize, Serialize};
use zod_gen::ZodSchema as ZodSchemaTrait;
use zod_gen_derive::ZodSchema;

/// search field enum for scoping searches
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SearchField {
    All,
    Artists,
    Albums,
    Songs,
    Genres,
    Playlists,
}

impl Default for SearchField {
    fn default() -> Self {
        SearchField::All
    }
}

impl ZodSchemaTrait for SearchField {
    fn zod_schema() -> String {
        r#"z.union([z.literal("all"), z.literal("artists"), z.literal("albums"), z.literal("songs"), z.literal("genres"), z.literal("playlists")])"#.to_string()
    }
}

/// suggestion type for autocomplete results
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SuggestionType {
    Artist,
    Album,
    Song,
    Genre,
    Playlist,
}

impl ZodSchemaTrait for SuggestionType {
    fn zod_schema() -> String {
        r#"z.union([z.literal("artist"), z.literal("album"), z.literal("song"), z.literal("genre"), z.literal("playlist")])"#.to_string()
    }
}

/// sort direction for query results
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SortDirection {
    Asc,
    Desc,
}

impl ZodSchemaTrait for SortDirection {
    fn zod_schema() -> String {
        r#"z.union([z.literal("asc"), z.literal("desc")])"#.to_string()
    }
}

/// filter with include/exclude lists
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct FilterSet {
    #[serde(default)]
    pub include: Vec<String>, // must have at least one of these (OR)
    #[serde(default)]
    pub exclude: Vec<String>, // must NOT have any of these (AND NOT)
}

/// global query context (shared state from web app)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq)]
pub struct QueryContext {
    #[serde(default)]
    pub tags: Option<FilterSet>, // tag filters (from tagz table)
    #[serde(default)]
    pub sort_field: Option<String>,
    #[serde(default)]
    pub sort_direction: Option<SortDirection>,
    #[serde(default)]
    pub search_query: Option<String>,
}

/// autocomplete request
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SuggestionsRequest {
    pub field: SearchField,
    pub partial: String,
    #[serde(default)]
    pub page: Option<u32>,
    #[serde(default)]
    pub page_size: Option<u32>,
    #[serde(default)]
    pub context: Option<QueryContext>,
}

/// suggestion result with confidence score
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct Suggestion {
    pub value: String,
    pub display: String,
    pub highlight: String, // markdown bold **match**
    pub count: i64,
    pub suggestion_type: SuggestionType,
    pub confidence: f32,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
    pub entity_id: String, // primary key for navigation
    pub is_favorite: bool,
}

/// autocomplete response
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SuggestionsResponse {
    pub suggestions: Vec<Suggestion>,
    pub query_time_ms: u64,
    pub total_count: u64,
    pub page: u32,
    pub page_size: u32,
    pub total_pages: u32,
    pub has_next: bool,
    pub has_prev: bool,
}

/// full search request
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SearchRequest {
    pub query: String,
    #[serde(default)]
    pub field: Option<SearchField>,
    #[serde(default)]
    pub page: Option<u32>,
    #[serde(default)]
    pub page_size: Option<u32>,
    #[serde(default)]
    pub context: Option<QueryContext>,
}

/// search response with full entity details
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SearchResponse {
    pub songs: Vec<SongSearchResult>,
    #[serde(default)]
    pub artists: Option<Vec<ArtistSearchResult>>,
    #[serde(default)]
    pub albums: Option<Vec<AlbumSearchResult>>,
    #[serde(default)]
    pub genres: Option<Vec<GenreSearchResult>>,
    #[serde(default)]
    pub playlists: Option<Vec<PlaylistSearchResult>>,
    pub total_count: i64,
    pub page: u32,
    pub page_size: u32,
    pub total_pages: u32,
    pub has_next: bool,
    pub has_prev: bool,
    pub query_time_ms: u64,
    #[serde(default)]
    pub applied_filters: Option<serde_json::Value>,
    #[serde(default)]
    pub sort_applied: Option<String>,
}

/// song search result with ranking
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SongSearchResult {
    pub id: String,
    pub title: String,
    pub artist_names: Vec<String>,
    pub album_title: Option<String>,
    pub album_id: Option<String>,
    pub duration: Option<i64>,
    pub thumbnail_url: Option<String>,
    pub user_rating: Option<i32>,
    pub is_favorite: bool,
    pub search_rank: f32,
    pub match_type: String,        // which field matched
    pub highlight: Option<String>, // highlighted match text
}

/// artist search result with aggregates
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ArtistSearchResult {
    pub id: String,
    pub name: String,
    pub song_count: i64,
    pub album_count: i64,
    pub genres: Vec<String>,
    pub user_rating: Option<i32>,
    pub is_favorite: bool,
    pub search_rank: f32,
    pub highlight: Option<String>,
}

/// album search result with details
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AlbumSearchResult {
    pub id: String,
    pub title: String,
    pub artist_names: Vec<String>,
    pub genres: Vec<String>,
    pub song_count: i64,
    pub thumbnail_url: Option<String>,
    pub user_rating: Option<i32>,
    pub is_favorite: bool,
    pub search_rank: f32,
    pub highlight: Option<String>,
}

/// genre search result with aggregates
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GenreSearchResult {
    pub genre: String,
    pub genre_id: String,
    pub song_count: i64,
    pub artist_count: i64,
    #[serde(default)]
    pub representative_song_id: Option<String>,
    #[serde(default)]
    pub representative_thumbnail: Option<String>,
    #[serde(default)]
    pub avg_rating: Option<f64>,
    pub search_rank: f32,
}

/// playlist search result
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PlaylistSearchResult {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub song_count: i64,
    pub is_public: bool,
    pub created_by: String,
    pub thumbnail_url: Option<String>,
    pub search_rank: f32,
    pub highlight: Option<String>,
}

/// field match type for confidence calculation
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum MatchType {
    Title,    // threshold 0.0
    Name,     // threshold 0.0
    Filename, // threshold 0.8
    Lyrics,   // threshold 0.7
    Metadata, // threshold 0.8
}

impl MatchType {
    /// get confidence threshold for this match type
    pub fn threshold(&self) -> f32 {
        match self {
            MatchType::Title | MatchType::Name => 0.0,
            MatchType::Filename | MatchType::Metadata => 0.8,
            MatchType::Lyrics => 0.7,
        }
    }

    /// parse match type from string
    pub fn from_str(s: &str) -> Self {
        match s {
            "title" => MatchType::Title,
            "filename" => MatchType::Filename,
            "lyrics" => MatchType::Lyrics,
            "metadata" => MatchType::Metadata,
            _ => MatchType::Name,
        }
    }

    /// convert match type to string
    pub fn as_str(&self) -> &'static str {
        match self {
            MatchType::Title => "title",
            MatchType::Name => "name",
            MatchType::Filename => "filename",
            MatchType::Lyrics => "lyrics",
            MatchType::Metadata => "metadata",
        }
    }
}
