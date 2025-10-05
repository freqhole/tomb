use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchQuery {
    pub query: Option<String>,
    pub search_type: SearchType,
    pub structured_search: Option<String>, // "key:value" format for JSONB field searches
    pub domains: Vec<String>,              // ["music", "photos", "videos", "documents"]
    pub filters: SearchFilters,
    pub pagination: PaginationOptions,
    pub ordering: SearchOrdering,
}

impl Default for SearchQuery {
    fn default() -> Self {
        Self {
            query: None,
            search_type: SearchType::WebSearch,
            structured_search: None,
            domains: vec!["music".to_string()],
            filters: SearchFilters::default(),
            pagination: PaginationOptions::default(),
            ordering: SearchOrdering::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SearchType {
    WebSearch, // Natural language queries with operators
    PlainText, // Simple text matching (AND all terms)
    Phrase,    // Exact phrase matching
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SearchFilters {
    // === BASIC FILTERS ===
    pub artist: Option<String>,
    pub artist_exact: Option<bool>,
    pub album: Option<String>,
    pub album_exact: Option<bool>,
    pub album_artist: Option<String>,
    pub genre: Option<String>,
    pub title_search: Option<String>,

    // === NUMERIC RANGE FILTERS ===
    pub year: Option<i32>,
    pub year_min: Option<i32>,
    pub year_max: Option<i32>,
    pub rating: Option<i32>,
    pub rating_min: Option<i32>,
    pub rating_max: Option<i32>,
    pub bpm: Option<i32>,
    pub bpm_min: Option<i32>,
    pub bpm_max: Option<i32>,
    pub duration_seconds: Option<i64>,
    pub duration_min: Option<i32>,
    pub duration_max: Option<i32>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,

    // === BOOLEAN FILTERS ===
    pub is_favorite: Option<bool>,
    pub favorites_only: Option<bool>,
    pub has_thumbnail: Option<bool>,
    pub has_lyrics: Option<bool>,
    pub has_waveform: Option<bool>,
    pub is_compilation: Option<bool>,

    // === ARRAY/MULTI-VALUE FILTERS ===
    pub tags: Option<Vec<String>>,
    pub tags_any: Option<Vec<String>>,
    pub tags_exclude: Option<Vec<String>>,
    pub genres: Option<Vec<String>>,
    pub artists: Option<Vec<String>>,
    pub albums: Option<Vec<String>>,

    // === FILE/TECHNICAL FILTERS ===
    pub file_format: Option<String>,
    pub file_formats: Option<Vec<String>>,
    pub bitrate_min: Option<i32>,
    pub bitrate_max: Option<i32>,
    pub sample_rate_min: Option<i32>,
    pub sample_rate_max: Option<i32>,
    pub file_size_min: Option<i64>,
    pub file_size_max: Option<i64>,

    // === DATE FILTERS ===
    pub created_after: Option<OffsetDateTime>,
    pub created_before: Option<OffsetDateTime>,
    pub updated_after: Option<OffsetDateTime>,
    pub updated_before: Option<OffsetDateTime>,
    pub added_after: Option<OffsetDateTime>,
    pub added_before: Option<OffsetDateTime>,

    // === ADVANCED ADMIN FILTERS ===
    pub key_signature: Option<String>,
    pub key_signatures: Option<Vec<String>>,
    pub mood: Option<String>,
    pub energy_level_min: Option<f32>,
    pub energy_level_max: Option<f32>,
    pub tempo_category: Option<String>,

    // === LIBRARY MANAGEMENT ===
    pub playlist_id: Option<String>,
    pub not_in_playlist: Option<String>,
    pub duplicate_check: Option<String>,
    pub missing_metadata: Option<Vec<String>>,
    pub has_errors: Option<bool>,
    pub needs_review: Option<bool>,

    // === RESPONSE OPTIONS ===
    pub include_deleted: Option<bool>,
    pub include_hidden: Option<bool>,
    pub full_metadata: Option<bool>,
    pub include_file_info: Option<bool>,
    pub include_statistics: Option<bool>,
    pub include_related: Option<bool>,

    // === NULL CHECKING FILTERS ===
    pub rating_is_null: Option<bool>,
    pub genre_is_null: Option<bool>,
    pub year_is_null: Option<bool>,
    pub bpm_is_null: Option<bool>,
    pub key_signature_is_null: Option<bool>,
    pub artist_is_null: Option<bool>,
    pub album_is_null: Option<bool>,
    pub album_artist_is_null: Option<bool>,

    // === LEGACY FIELDS ===
    pub media_blob_id: Option<String>,
    pub metadata_filter: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginationOptions {
    pub page: u32,
    pub page_size: u32,
}

impl Default for PaginationOptions {
    fn default() -> Self {
        Self {
            page: 1,
            page_size: 50,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchOrdering {
    pub sort_by: SortBy,
    pub direction: SortDirection,
    pub raw_sort: Option<String>, // Allow bypassing enum for more sort options
}

impl Default for SearchOrdering {
    fn default() -> Self {
        Self {
            sort_by: SortBy::Relevance,
            direction: SortDirection::Desc,
            raw_sort: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SortBy {
    Relevance,
    CreatedAt,
    UpdatedAt,
    Title,
    Artist,
    Album,
    Rating,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SortDirection {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub total_count: u64,
    pub results: Vec<SearchResultItem>,
    pub facets: Vec<SearchFacet>,
    pub suggestions: Vec<SearchSuggestion>,
    pub query_time_ms: u64,
    pub page: u32,
    pub page_size: u32,
    pub total_pages: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResultItem {
    pub id: Uuid,
    pub result_type: String, // "song", "playlist", "photo", etc.
    pub title: String,
    pub subtitle: Option<String>,
    pub description: Option<String>,
    pub thumbnail_blob_id: Option<String>,
    pub media_blob_id: Option<String>,
    pub relevance_score: f32,
    pub metadata: serde_json::Value,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchFacet {
    pub field: String,
    pub values: Vec<FacetValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FacetValue {
    pub value: String,
    pub count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchSuggestion {
    pub text: String,
    pub category: String,
    pub frequency: u32,
}

// Song-specific search result (for compatibility with existing code)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SongSearchResult {
    pub id: Uuid,
    pub media_blob_id: String,
    pub thumbnail_blob_id: Option<String>,
    pub waveform_blob_id: Option<String>,
    pub thumbnail_blob_ids: Option<Vec<String>>,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub duration: Option<time::Duration>,
    pub genre: Option<String>,
    pub sub_genres: Option<Vec<String>>,
    pub year: Option<i32>,
    pub bpm: Option<i32>,
    pub key_signature: Option<String>,
    pub rating: Option<i32>,
    pub is_favorite: bool,
    pub tags: Option<Vec<String>>,
    pub metadata: Option<serde_json::Value>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub version: i64,
    pub search_rank: f32,
}

// Music search result (unified songs + playlists)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicSearchResult {
    pub result_type: String, // "song" or "playlist"
    pub id: Uuid,
    pub title: String,
    pub subtitle: String,
    pub description: Option<String>,
    pub media_blob_id: Option<String>,
    pub thumbnail_blob_id: Option<String>,
    pub search_rank: f32,
    pub metadata: Option<serde_json::Value>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

// Helper for converting between different search result types
impl From<MusicSearchResult> for SearchResultItem {
    fn from(music_result: MusicSearchResult) -> Self {
        Self {
            id: music_result.id,
            result_type: music_result.result_type,
            title: music_result.title,
            subtitle: Some(music_result.subtitle),
            description: music_result.description,
            thumbnail_blob_id: music_result.thumbnail_blob_id,
            media_blob_id: music_result.media_blob_id,
            relevance_score: music_result.search_rank,
            metadata: music_result.metadata.unwrap_or_default(),
            created_at: music_result.created_at,
            updated_at: music_result.updated_at,
        }
    }
}

// Error types for search operations
#[derive(Debug, thiserror::Error)]
pub enum SearchError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Invalid query: {0}")]
    InvalidQuery(String),
    #[error("Search timeout")]
    Timeout,
    #[error("Invalid pagination parameters: page={page}, page_size={page_size}")]
    InvalidPagination { page: u32, page_size: u32 },
}

// Convenience constructors
impl SearchQuery {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_query(mut self, query: &str) -> Self {
        self.query = Some(query.to_string());
        self
    }

    pub fn with_search_type(mut self, search_type: SearchType) -> Self {
        self.search_type = search_type;
        self
    }

    pub fn with_structured_search(mut self, structured: &str) -> Self {
        self.structured_search = Some(structured.to_string());
        self
    }

    pub fn with_domains(mut self, domains: Vec<String>) -> Self {
        self.domains = domains;
        self
    }

    pub fn with_pagination(mut self, page: u32, page_size: u32) -> Self {
        self.pagination = PaginationOptions { page, page_size };
        self
    }

    pub fn with_sort(mut self, sort_by: SortBy, direction: SortDirection) -> Self {
        self.ordering = SearchOrdering {
            sort_by,
            direction,
            raw_sort: None,
        };
        self
    }

    pub fn with_artist_filter(mut self, artist: &str) -> Self {
        self.filters.artist = Some(artist.to_string());
        self
    }

    pub fn with_genre_filter(mut self, genre: &str) -> Self {
        self.filters.genre = Some(genre.to_string());
        self
    }

    pub fn with_raw_sort(mut self, sort_field: &str, direction: SortDirection) -> Self {
        self.ordering = SearchOrdering {
            sort_by: SortBy::CreatedAt, // Default fallback
            direction,
            raw_sort: Some(sort_field.to_string()),
        };
        self
    }

    pub fn with_favorites_only(mut self) -> Self {
        self.filters.favorites_only = Some(true);
        self
    }

    // Validation
    pub fn validate(&self) -> Result<(), SearchError> {
        if self.pagination.page == 0 {
            return Err(SearchError::InvalidPagination {
                page: self.pagination.page,
                page_size: self.pagination.page_size,
            });
        }

        if self.pagination.page_size == 0 || self.pagination.page_size > 1000 {
            return Err(SearchError::InvalidPagination {
                page: self.pagination.page,
                page_size: self.pagination.page_size,
            });
        }

        Ok(())
    }
}

impl SearchFilters {
    /// Check if any filters are set (useful for determining if a filter-only search is valid)
    pub fn has_any_filters(&self) -> bool {
        // Basic filters
        self.artist.is_some()
            || self.album.is_some()
            || self.album_artist.is_some()
            || self.genre.is_some()
            || self.title_search.is_some()
            // Numeric filters
            || self.year.is_some()
            || self.year_min.is_some()
            || self.year_max.is_some()
            || self.rating.is_some()
            || self.rating_min.is_some()
            || self.rating_max.is_some()
            || self.bpm.is_some()
            || self.bpm_min.is_some()
            || self.bpm_max.is_some()
            || self.duration_seconds.is_some()
            || self.duration_min.is_some()
            || self.duration_max.is_some()
            || self.track_number.is_some()
            || self.disc_number.is_some()
            // Boolean filters
            || self.is_favorite.is_some()
            || self.favorites_only.is_some()
            || self.has_thumbnail.is_some()
            || self.has_lyrics.is_some()
            || self.has_waveform.is_some()
            || self.is_compilation.is_some()
            // Array filters
            || self.tags.is_some()
            || self.tags_any.is_some()
            || self.tags_exclude.is_some()
            || self.genres.is_some()
            || self.artists.is_some()
            || self.albums.is_some()
            // File/technical filters
            || self.file_format.is_some()
            || self.file_formats.is_some()
            || self.bitrate_min.is_some()
            || self.bitrate_max.is_some()
            || self.sample_rate_min.is_some()
            || self.sample_rate_max.is_some()
            || self.file_size_min.is_some()
            || self.file_size_max.is_some()
            // Date filters
            || self.created_after.is_some()
            || self.created_before.is_some()
            || self.updated_after.is_some()
            || self.updated_before.is_some()
            || self.added_after.is_some()
            || self.added_before.is_some()
            // Advanced filters
            || self.key_signature.is_some()
            || self.key_signatures.is_some()
            || self.mood.is_some()
            || self.energy_level_min.is_some()
            || self.energy_level_max.is_some()
            || self.tempo_category.is_some()
            // Library management
            || self.playlist_id.is_some()
            || self.not_in_playlist.is_some()
            || self.duplicate_check.is_some()
            || self.missing_metadata.is_some()
            || self.has_errors.is_some()
            || self.needs_review.is_some()
            // Legacy
            || self.media_blob_id.is_some()
            || self.metadata_filter.is_some()
    }
}
