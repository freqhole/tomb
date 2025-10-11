//! Unified music search API endpoints

use crate::auth::AuthenticatedUser;
use crate::media::songs::SongResponse;

use axum::{
    extract::{Extension, Query},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use grimoire::music::MusicRepository;
use grimoire::search::{
    SearchFilters, SearchQuery, SearchService, SearchType, SortBy, SortDirection,
};
use grimoire::DatabaseConnection;
use serde::{Deserialize, Deserializer, Serialize};
use std::collections::HashMap;
use time::OffsetDateTime;

/// POST search request body schema
#[derive(Debug, Deserialize, Clone)]
pub struct PostSearchRequest {
    // Text search
    pub query: Option<String>,
    pub search_type: Option<String>,
    pub search_fields: Option<Vec<String>>,

    // Pagination
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_page_size")]
    pub page_size: u32,

    // Sorting
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,

    // Result grouping options
    pub include_genres: Option<bool>,
    pub include_playlists: Option<bool>,

    // Filters
    pub filters: Option<PostSearchFilters>,
}

#[derive(Debug, Deserialize, Clone, Default)]
pub struct PostSearchFilters {
    // Basic filters
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub title: Option<String>,

    // Numeric range filters
    pub year: Option<i32>,
    pub year_min: Option<i32>,
    pub year_max: Option<i32>,
    pub rating: Option<i32>,
    pub rating_min: Option<i32>,
    pub rating_max: Option<i32>,

    // Boolean filters
    pub is_favorite: Option<bool>,
    pub has_thumbnail: Option<bool>,

    // Array filters
    pub tags: Option<Vec<String>>,
    pub tags_any: Option<Vec<String>>,
    pub tags_exclude: Option<Vec<String>>,
    pub genres: Option<Vec<String>>,
    pub artists: Option<Vec<String>>,
    pub albums: Option<Vec<String>>,
}

/// POST search response schema
#[derive(Debug, Serialize)]
pub struct PostSearchResponse {
    pub songs: Vec<SongResponse>,
    pub genres: Option<Vec<GenreGroupResult>>,
    pub playlists: Option<Vec<PlaylistGroupResult>>,
    pub total_count: u64,
    pub page: u32,
    pub page_size: u32,
    pub total_pages: u32,
    pub has_next: bool,
    pub has_prev: bool,
    pub query_time_ms: Option<u64>,
    pub applied_filters: Option<AppliedFiltersInfo>,
    pub sort_applied: Option<SortAppliedInfo>,
}

#[derive(Debug, Serialize)]
pub struct GenreGroupResult {
    pub genre: String,
    pub song_count: u64,
    pub artist_count: u64,
    pub representative_song_id: Option<uuid::Uuid>,
    pub representative_thumbnail: Option<String>,
    pub avg_rating: Option<f64>,
    pub search_rank: f32,
}

#[derive(Debug, Serialize)]
pub struct PlaylistGroupResult {
    pub id: uuid::Uuid,
    pub title: String,
    pub description: Option<String>,
    pub song_count: u64,
    pub is_public: bool,
    pub thumbnail_blob_id: Option<String>,
    pub created_at: std::time::SystemTime,
    pub search_rank: f32,
}

#[derive(Debug, Serialize)]
pub struct AppliedFiltersInfo {
    pub text_search: Option<String>,
    pub filters_count: u32,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Serialize)]
pub struct SortAppliedInfo {
    pub field: String,
    pub direction: String,
}

/// Custom deserializer for search_fields that handles both single strings and arrays
fn deserialize_search_fields<'de, D>(deserializer: D) -> Result<Option<Vec<String>>, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de::{Error, Visitor};
    use std::fmt;

    struct SearchFieldsVisitor;

    impl<'de> Visitor<'de> for SearchFieldsVisitor {
        type Value = Option<Vec<String>>;

        fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
            formatter.write_str("a string, array of strings, or nothing")
        }

        fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
        where
            E: Error,
        {
            // Single string parameter -> convert to single-item array
            Ok(Some(vec![value.to_string()]))
        }

        fn visit_seq<A>(self, mut seq: A) -> Result<Self::Value, A::Error>
        where
            A: serde::de::SeqAccess<'de>,
        {
            // Multiple parameters with same name -> array
            let mut vec = Vec::new();
            while let Some(element) = seq.next_element::<String>()? {
                vec.push(element);
            }
            Ok(Some(vec))
        }

        fn visit_none<E>(self) -> Result<Self::Value, E>
        where
            E: Error,
        {
            Ok(None)
        }

        fn visit_unit<E>(self) -> Result<Self::Value, E>
        where
            E: Error,
        {
            Ok(None)
        }
    }

    deserializer.deserialize_any(SearchFieldsVisitor)
}

/// Unified search parameters handling all query types
#[derive(Debug, Deserialize, Clone)]
pub struct UnifiedSearchParams {
    // === TEXT SEARCH ===
    pub q: Option<String>,
    #[serde(default = "default_search_type")]
    pub search_type: String,
    #[serde(deserialize_with = "deserialize_search_fields", default)]
    pub search_fields: Option<Vec<String>>,

    // === PAGINATION ===
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_page_size")]
    pub page_size: u32,
    pub offset: Option<u64>,
    pub limit: Option<u32>,

    // === SORTING ===
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,
    pub secondary_sort: Option<String>,

    // === BASIC FILTERS ===
    pub artist: Option<String>,
    pub artist_exact: Option<bool>,
    pub album: Option<String>,
    pub album_exact: Option<bool>,
    pub genre: Option<String>,
    pub title: Option<String>,

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
    pub duration_min: Option<i64>,
    pub duration_max: Option<i64>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,

    // === BOOLEAN FILTERS ===
    pub is_favorite: Option<bool>,
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
    pub created_after: Option<String>,
    pub created_before: Option<String>,
    pub updated_after: Option<String>,
    pub updated_before: Option<String>,
    pub added_after: Option<String>,
    pub added_before: Option<String>,

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

    // === PERFORMANCE OPTIONS ===
    pub skip_total_count: Option<bool>,
    pub explain_query: Option<bool>,

    // === NULL CHECKING FILTERS ===
    pub rating_is_null: Option<bool>,
    pub genre_is_null: Option<bool>,
    pub year_is_null: Option<bool>,
    pub bpm_is_null: Option<bool>,
    pub key_signature_is_null: Option<bool>,
    pub artist_is_null: Option<bool>,
    pub album_is_null: Option<bool>,
    pub album_artist_is_null: Option<bool>,

    // === LEGACY COMPATIBILITY ===
    #[serde(default)]
    pub favorites_only: bool,
    #[serde(default)]
    pub songs_only: bool,
}

/// Query parameters for filter options endpoint
#[derive(Debug, Deserialize)]
pub struct FilterOptionsParams {
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_filter_page_size")]
    pub page_size: u32,
    pub filter_type: Option<String>,
}

/// Query parameters for suggestions endpoint
#[derive(Debug, Deserialize)]
pub struct SuggestionsParams {
    pub field: String,
    pub partial: String,
    #[serde(default = "default_page")]
    pub page: u32,
    #[serde(default = "default_suggestions_page_size")]
    pub page_size: u32,
}

/// Unified search response
#[derive(Debug, Serialize)]
pub struct UnifiedSearchResponse {
    pub songs: Vec<SongResponse>,
    pub total_count: u64,
    pub page: u32,
    pub page_size: u32,
    pub total_pages: u32,
    pub has_next: bool,
    pub has_prev: bool,
    pub offset: u64,
    pub query_time_ms: u64,
    pub search_query: Option<String>,
    pub filters_applied: AppliedFilters,
    pub sort_applied: SortInfo,
    pub suggestions: Vec<SearchSuggestion>,
    pub filter_suggestions: Vec<FilterSuggestion>,
    pub related_searches: Vec<String>,
    pub aggregations: Option<SearchAggregations>,
    pub debug: Option<SearchDebugInfo>,
}

/// Filter options response with pagination
#[derive(Debug, Serialize)]
pub struct FilterOptionsResponse {
    pub artists: PaginatedFilterOptions,
    pub albums: PaginatedFilterOptions,
    pub genres: PaginatedFilterOptions,
    pub tags: PaginatedFilterOptions,
    pub years: Vec<FilterOption>,
    pub year_ranges: Vec<YearRange>,
    pub rating_distribution: Vec<u32>,
    pub avg_rating: f32,
    pub file_formats: Vec<FilterOption>,
    pub bitrate_ranges: Vec<BitrateRange>,
    pub duration_ranges: Vec<DurationRange>,
    pub key_signatures: Vec<FilterOption>,
    pub bpm_ranges: Vec<BpmRange>,
    pub mood_categories: Vec<FilterOption>,
    pub favorites_count: u32,
    pub has_thumbnail_count: u32,
    pub has_lyrics_count: u32,
    pub compilation_count: u32,
    pub statistics: LibraryStatistics,
}

/// Suggestions response with pagination
#[derive(Debug, Serialize)]
pub struct SuggestionResponse {
    pub suggestions: Vec<Suggestion>,
    pub query_time_ms: u64,
    pub total_count: u32,
    pub page: u32,
    pub page_size: u32,
    pub total_pages: u32,
    pub has_next: bool,
    pub has_prev: bool,
}

/// Supporting structures
#[derive(Debug, Serialize)]
pub struct PaginatedFilterOptions {
    pub items: Vec<FilterOption>,
    pub total_count: u32,
    pub page: u32,
    pub page_size: u32,
    pub total_pages: u32,
    pub has_next: bool,
    pub has_prev: bool,
}

#[derive(Debug, Serialize)]
pub struct FilterOption {
    pub value: String,
    pub label: String,
    pub count: u32,
    pub percentage: f32,
}

#[derive(Debug, Serialize)]
pub struct AppliedFilters {
    pub text_search: Option<String>,
    pub artist_filters: Vec<String>,
    pub album_filters: Vec<String>,
    pub genre_filters: Vec<String>,
    pub year_range: Option<(i32, i32)>,
    pub rating_range: Option<(i32, i32)>,
    pub duration_range: Option<(i64, i64)>,
    pub boolean_filters: HashMap<String, bool>,
    pub tag_filters: TagFilters,
    pub date_filters: DateRangeFilters,
    pub file_filters: FileFilters,
    pub total_filter_count: u32,
}

#[derive(Debug, Serialize)]
pub struct TagFilters {
    pub required_tags: Vec<String>,
    pub optional_tags: Vec<String>,
    pub excluded_tags: Vec<String>,
}

#[derive(Debug, Serialize)]
pub struct DateRangeFilters {
    pub created_after: Option<String>,
    pub created_before: Option<String>,
    pub updated_after: Option<String>,
    pub updated_before: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct FileFilters {
    pub formats: Vec<String>,
    pub bitrate_range: Option<(i32, i32)>,
    pub size_range: Option<(i64, i64)>,
}

#[derive(Debug, Serialize)]
pub struct SortInfo {
    pub primary_field: String,
    pub primary_direction: String,
    pub secondary_field: Option<String>,
    pub secondary_direction: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct SearchSuggestion {
    pub query: String,
    pub highlight: String,
    pub result_count: u32,
    pub suggestion_type: String,
}

#[derive(Debug, Serialize)]
pub struct FilterSuggestion {
    pub filter_type: String,
    pub filter_value: String,
    pub result_count: u32,
    pub confidence: f32,
}

#[derive(Debug, Serialize)]
pub struct SearchAggregations {
    pub artists: Vec<AggregationBucket>,
    pub albums: Vec<AggregationBucket>,
    pub genres: Vec<AggregationBucket>,
    pub years: Vec<AggregationBucket>,
    pub ratings: Vec<AggregationBucket>,
    pub formats: Vec<AggregationBucket>,
    pub duration_ranges: Vec<DurationBucket>,
}

#[derive(Debug, Serialize)]
pub struct AggregationBucket {
    pub value: String,
    pub count: u32,
    pub percentage: f32,
}

#[derive(Debug, Serialize)]
pub struct DurationBucket {
    pub min_seconds: i64,
    pub max_seconds: i64,
    pub label: String,
    pub count: u32,
}

#[derive(Debug, Serialize)]
pub struct SearchDebugInfo {
    pub sql_query: String,
    pub index_usage: Vec<String>,
    pub query_plan: serde_json::Value,
    pub processing_steps: Vec<ProcessingStep>,
}

#[derive(Debug, Serialize)]
pub struct ProcessingStep {
    pub step_name: String,
    pub duration_ms: u64,
    pub details: Option<serde_json::Value>,
}

#[derive(Debug, Serialize)]
pub struct YearRange {
    pub min_year: i32,
    pub max_year: i32,
    pub label: String,
    pub count: u32,
}

#[derive(Debug, Serialize)]
pub struct BitrateRange {
    pub min_bitrate: i32,
    pub max_bitrate: i32,
    pub label: String,
    pub count: u32,
}

#[derive(Debug, Serialize)]
pub struct DurationRange {
    pub min_seconds: i64,
    pub max_seconds: i64,
    pub label: String,
    pub count: u32,
}

#[derive(Debug, Serialize)]
pub struct BpmRange {
    pub min_bpm: i32,
    pub max_bpm: i32,
    pub label: String,
    pub count: u32,
}

#[derive(Debug, Serialize)]
pub struct LibraryStatistics {
    pub total_songs: u64,
    pub total_artists: u32,
    pub total_albums: u32,
    pub total_genres: u32,
    pub total_tags: u32,
    pub total_playtime_seconds: u64,
    pub avg_song_duration: f32,
    pub total_file_size_bytes: u64,
    pub last_updated: String,
}

#[derive(Debug, Serialize)]
pub struct Suggestion {
    pub value: String,
    pub display: String,
    pub highlight: String,
    pub count: u32,
    pub suggestion_type: String,
    pub confidence: f32,
    pub metadata: Option<serde_json::Value>,
}

// Default values
fn default_search_type() -> String {
    "websearch".to_string()
}

fn default_page() -> u32 {
    1
}

fn default_page_size() -> u32 {
    20
}

fn default_filter_page_size() -> u32 {
    50
}

fn default_suggestions_page_size() -> u32 {
    10
}

/// Main unified search endpoint
pub async fn search_music(
    Extension(user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<UnifiedSearchParams>,
) -> Result<Json<UnifiedSearchResponse>, StatusCode> {
    let start_time = std::time::Instant::now();

    // Convert UnifiedSearchParams to SearchQuery
    let search_query = convert_unified_params_to_search_query(params.clone());

    // Use the existing SearchService from grimoire
    let search_service = SearchService::new(db.pool().clone());

    let (search_results, total_count) = search_service
        .search_songs(Some(user.user().id), &search_query)
        .await
        .map_err(|e| {
            eprintln!("Search service failed: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Convert SongSearchResult to SongResponse with consistent field naming
    // This ensures we use user_rating, user_is_favorite, etc. like the songs endpoint
    let songs: Vec<SongResponse> = search_results
        .into_iter()
        .map(|result| {
            let duration_seconds = result
                .duration
                .map(|d| (d.whole_microseconds() / 1_000_000) as i64);

            let display_title = result.title.clone();
            let detailed_display_title = match &result.artist {
                Some(artist) => format!("{} - {}", artist, result.title),
                None => result.title.clone(),
            };

            SongResponse {
                id: result.id,
                title: result.title,
                artist: result.artist,
                album: result.album,
                album_artist: result.album_artist,
                track_number: result.track_number,
                disc_number: result.disc_number,
                duration_seconds,
                genre: result.genre,
                sub_genres: result.sub_genres.unwrap_or_default(),
                year: result.year,
                bpm: result.bpm,
                key_signature: result.key_signature,
                user_rating: result.rating,
                user_is_favorite: result.is_favorite,
                tags: result.tags.unwrap_or_default(),
                display_title,
                detailed_display_title,
                created_at: result
                    .created_at
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_default(),
                media_blob_id: result.media_blob_id,
                thumbnail_blob_id: result.thumbnail_blob_id,
                waveform_blob_id: result.waveform_blob_id,
                thumbnail_blob_ids: result.thumbnail_blob_ids.unwrap_or_default(),
                preference_updated_at: None, // Search results don't track preference timestamps
            }
        })
        .collect();

    // Use the total count from the SQL function

    let response = UnifiedSearchResponse {
        songs,
        total_count,
        page: params.page,
        page_size: params.page_size,
        total_pages: if total_count == 0 {
            0
        } else {
            (total_count as f64 / params.page_size as f64).ceil() as u32
        },
        has_next: (params.page as u64)
            < ((total_count as f64 / params.page_size as f64).ceil() as u64),
        has_prev: params.page > 1,
        offset: ((params.page - 1) * params.page_size) as u64,
        query_time_ms: start_time.elapsed().as_millis() as u64,
        search_query: params.q.clone(),
        filters_applied: build_applied_filters(&params),
        sort_applied: SortInfo {
            primary_field: params.sort_by.unwrap_or_else(|| "created_at".to_string()),
            primary_direction: params.sort_direction.unwrap_or_else(|| "desc".to_string()),
            secondary_field: params.secondary_sort,
            secondary_direction: None,
        },
        suggestions: vec![],
        filter_suggestions: vec![],
        related_searches: vec![],
        aggregations: None,
        debug: None,
    };

    Ok(Json(response))
}

/// POST search endpoint with JSON body
pub async fn search_music_post(
    Extension(user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Json(request): Json<PostSearchRequest>,
) -> Result<Json<PostSearchResponse>, StatusCode> {
    let start_time = std::time::Instant::now();

    // Clone values we need to use later
    let query_clone = request.query.clone();
    let user_clone = user.clone();
    let db_clone = db.clone();
    let _sort_by_clone = request.sort_by.clone();
    let _sort_direction_clone = request.sort_direction.clone();

    // Convert POST request to UnifiedSearchParams
    let mut params = UnifiedSearchParams {
        q: request.query,
        search_type: request.search_type.unwrap_or_else(default_search_type),
        search_fields: request.search_fields,
        page: request.page,
        page_size: request.page_size,
        sort_by: request.sort_by,
        sort_direction: request.sort_direction,
        // Default all other fields
        offset: None,
        limit: None,
        secondary_sort: None,
        artist: None,
        artist_exact: None,
        album: None,
        album_exact: None,
        genre: None,
        title: None,
        year: None,
        year_min: None,
        year_max: None,
        rating: None,
        rating_min: None,
        rating_max: None,
        bpm: None,
        bpm_min: None,
        bpm_max: None,
        duration_seconds: None,
        duration_min: None,
        duration_max: None,
        track_number: None,
        disc_number: None,
        is_favorite: None,
        has_thumbnail: None,
        has_lyrics: None,
        has_waveform: None,
        is_compilation: None,
        tags: None,
        tags_any: None,
        tags_exclude: None,
        genres: None,
        artists: None,
        albums: None,
        file_format: None,
        file_formats: None,
        bitrate_min: None,
        bitrate_max: None,
        sample_rate_min: None,
        sample_rate_max: None,
        file_size_min: None,
        file_size_max: None,
        created_after: None,
        created_before: None,
        updated_after: None,
        updated_before: None,
        added_after: None,
        added_before: None,
        key_signature: None,
        key_signatures: None,
        mood: None,
        energy_level_min: None,
        energy_level_max: None,
        tempo_category: None,
        playlist_id: None,
        not_in_playlist: None,
        duplicate_check: None,
        missing_metadata: None,
        has_errors: None,
        needs_review: None,
        include_deleted: None,
        include_hidden: None,
        full_metadata: None,
        include_file_info: None,
        include_statistics: None,
        include_related: None,
        skip_total_count: None,
        explain_query: None,
        rating_is_null: None,
        genre_is_null: None,
        year_is_null: None,
        bpm_is_null: None,
        key_signature_is_null: None,
        artist_is_null: None,
        album_is_null: None,
        album_artist_is_null: None,
        favorites_only: false,
        songs_only: false,
    };

    // Apply filters from request
    let _has_filters = request.filters.is_some();
    if let Some(filters) = request.filters {
        params.artist = filters.artist;
        params.album = filters.album;
        params.genre = filters.genre;
        params.title = filters.title;
        params.year = filters.year;
        params.year_min = filters.year_min;
        params.year_max = filters.year_max;
        params.rating = filters.rating;
        params.rating_min = filters.rating_min;
        params.rating_max = filters.rating_max;
        params.is_favorite = filters.is_favorite;
        params.has_thumbnail = filters.has_thumbnail;
        params.tags = filters.tags;
        params.tags_any = filters.tags_any;
        params.tags_exclude = filters.tags_exclude;
        params.genres = filters.genres;
        params.artists = filters.artists;
        params.albums = filters.albums;
    }

    // Use existing search logic
    let search_result = search_music(Extension(user), Extension(db), Query(params)).await?;
    let response_data = search_result.0;

    // Calculate pagination values
    let total_pages = if response_data.total_count == 0 {
        0
    } else {
        (response_data.total_count as f64 / request.page_size as f64).ceil() as u32
    };

    // Get genre aggregations if requested
    let genres = if request.include_genres.unwrap_or(false) {
        let genre_results = get_genre_aggregations(
            &db_clone,
            Some(user_clone.0.id),
            query_clone.as_deref(),
            10, // limit to 10 genre results
            0,  // no offset for genres in this context
        )
        .await?;
        Some(genre_results)
    } else {
        None
    };

    // Get playlist search results if requested
    let playlists = if request.include_playlists.unwrap_or(false) {
        let playlist_results = get_playlist_search_results(
            &db_clone,
            Some(user_clone.0.id),
            query_clone.as_deref(),
            true, // include private playlists for authenticated user
            10,   // limit to 10 playlist results
            0,    // no offset for playlists in this context
        )
        .await?;
        Some(playlist_results)
    } else {
        None
    };

    // Build PostSearchResponse
    let post_search_response = PostSearchResponse {
        songs: response_data.songs,
        genres,
        playlists,
        total_count: response_data.total_count,
        page: request.page,
        page_size: request.page_size,
        total_pages,
        has_next: request.page < total_pages,
        has_prev: request.page > 1,
        query_time_ms: Some(start_time.elapsed().as_millis() as u64),
        applied_filters: None, // TODO: implement applied filters info
        sort_applied: None,    // TODO: implement sort applied info
    };

    Ok(Json(post_search_response))
}

/// Convert UnifiedSearchParams to SearchQuery
fn convert_unified_params_to_search_query(params: UnifiedSearchParams) -> SearchQuery {
    let mut search_query = SearchQuery::new();

    // Set text search with field-specific handling
    if let Some(query) = params.q {
        // Handle field-specific search
        if let Some(ref search_fields) = params.search_fields {
            if search_fields.len() == 1 {
                match search_fields[0].as_str() {
                    "title" => {
                        // For title search, use structured search or title filter
                        search_query.filters.title_search = Some(query.clone());
                        search_query = search_query.with_query(&query);
                    }
                    "artist" => {
                        // For artist search, use artist filter
                        search_query.filters.artist = Some(query.clone());
                        search_query = search_query.with_query(&query);
                    }
                    "album" => {
                        // For album search, use album filter
                        search_query.filters.album = Some(query.clone());
                        search_query = search_query.with_query(&query);
                    }
                    "genre" => {
                        // For genre search, use genre filter
                        search_query.filters.genre = Some(query.clone());
                        search_query = search_query.with_query(&query);
                    }
                    "all" | _ => {
                        // For "all" or unrecognized fields, search all fields
                        search_query = search_query.with_query(&query);
                    }
                }
            } else {
                // Multiple fields specified, use general search
                search_query = search_query.with_query(&query);
            }
        } else {
            // No fields specified, use general search
            search_query = search_query.with_query(&query);
        }
    }

    // Set search type
    let search_type = match params.search_type.as_str() {
        "plainto" => SearchType::PlainText,
        "phrase" => SearchType::Phrase,
        _ => SearchType::WebSearch,
    };
    search_query = search_query.with_search_type(search_type);

    // Set pagination
    search_query = search_query.with_pagination(params.page, params.page_size);

    // Set sorting - use shared sorting utilities and convert to enums for SearchQuery
    use crate::media::sorting::{
        normalize_sort_direction, validate_sort_field, DEFAULT_SORT_DIRECTION, DEFAULT_SORT_FIELD,
    };

    let sort_field = params.sort_by.as_deref().unwrap_or(DEFAULT_SORT_FIELD);
    let direction_str = normalize_sort_direction(
        params
            .sort_direction
            .as_deref()
            .unwrap_or(DEFAULT_SORT_DIRECTION),
    );

    // Convert string direction to enum
    let direction = match direction_str {
        "asc" => SortDirection::Asc,
        _ => SortDirection::Desc,
    };

    // Convert field to appropriate sorting method
    search_query = if let Some(_valid_field) = validate_sort_field(sort_field) {
        match sort_field {
            "year" | "duration" | "duration_seconds" => {
                // Use raw sort for fields not in SortBy enum
                search_query.with_raw_sort(sort_field, direction)
            }
            "title" => search_query.with_sort(SortBy::Title, direction),
            "artist" => search_query.with_sort(SortBy::Artist, direction),
            "album" => search_query.with_sort(SortBy::Album, direction),
            "rating" => search_query.with_sort(SortBy::Rating, direction),
            "user_rating" => search_query.with_sort(SortBy::Rating, direction),
            "user_is_favorite" => search_query.with_raw_sort("user_is_favorite", direction),
            "updated_at" => search_query.with_sort(SortBy::UpdatedAt, direction),
            _ => search_query.with_sort(SortBy::CreatedAt, direction),
        }
    } else {
        // Fallback to default sorting for unsupported fields
        search_query.with_sort(SortBy::CreatedAt, direction)
    };

    // Set filters
    let mut filters = SearchFilters::default();

    // === BASIC FILTERS ===
    filters.artist = params.artist;
    filters.artist_exact = params.artist_exact;
    filters.album = params.album;
    filters.album_exact = params.album_exact;
    filters.album_artist = None; // Not in UnifiedSearchParams
    filters.genre = params.genre;
    filters.title_search = params.title;

    // === NUMERIC RANGE FILTERS ===
    filters.year = params.year;
    filters.year_min = params.year_min;
    filters.year_max = params.year_max;
    filters.rating = params.rating;
    filters.rating_min = params.rating_min;
    filters.rating_max = params.rating_max;
    filters.bpm = params.bpm;
    filters.bpm_min = params.bpm_min;
    filters.bpm_max = params.bpm_max;
    filters.duration_seconds = params.duration_seconds;
    filters.duration_min = params.duration_min.map(|d| d as i32);
    filters.duration_max = params.duration_max.map(|d| d as i32);
    filters.track_number = params.track_number;
    filters.disc_number = params.disc_number;

    // === BOOLEAN FILTERS ===
    filters.is_favorite = params.is_favorite;
    filters.favorites_only = params.is_favorite.or_else(|| {
        if params.favorites_only {
            Some(true)
        } else {
            None
        }
    });
    filters.has_thumbnail = params.has_thumbnail;
    filters.has_lyrics = params.has_lyrics;
    filters.has_waveform = params.has_waveform;
    filters.is_compilation = params.is_compilation;

    // === ARRAY/MULTI-VALUE FILTERS ===
    filters.tags = params.tags;
    filters.tags_any = params.tags_any;
    filters.tags_exclude = params.tags_exclude;
    filters.genres = params.genres;
    filters.artists = params.artists;
    filters.albums = params.albums;

    // === FILE/TECHNICAL FILTERS ===
    filters.file_format = params.file_format;
    filters.file_formats = params.file_formats;
    filters.bitrate_min = params.bitrate_min;
    filters.bitrate_max = params.bitrate_max;
    filters.sample_rate_min = params.sample_rate_min;
    filters.sample_rate_max = params.sample_rate_max;
    filters.file_size_min = params.file_size_min;
    filters.file_size_max = params.file_size_max;

    // === DATE FILTERS ===
    filters.created_after = params.created_after.and_then(|s| {
        OffsetDateTime::parse(&s, &time::format_description::well_known::Rfc3339).ok()
    });
    filters.created_before = params.created_before.and_then(|s| {
        OffsetDateTime::parse(&s, &time::format_description::well_known::Rfc3339).ok()
    });
    filters.updated_after = params.updated_after.and_then(|s| {
        OffsetDateTime::parse(&s, &time::format_description::well_known::Rfc3339).ok()
    });
    filters.updated_before = params.updated_before.and_then(|s| {
        OffsetDateTime::parse(&s, &time::format_description::well_known::Rfc3339).ok()
    });
    filters.added_after = params.added_after.and_then(|s| {
        OffsetDateTime::parse(&s, &time::format_description::well_known::Rfc3339).ok()
    });
    filters.added_before = params.added_before.and_then(|s| {
        OffsetDateTime::parse(&s, &time::format_description::well_known::Rfc3339).ok()
    });

    // === ADVANCED ADMIN FILTERS ===
    filters.key_signature = params.key_signature;
    filters.key_signatures = params.key_signatures;
    filters.mood = params.mood;
    filters.energy_level_min = params.energy_level_min;
    filters.energy_level_max = params.energy_level_max;
    filters.tempo_category = params.tempo_category;

    // === LIBRARY MANAGEMENT ===
    filters.playlist_id = params.playlist_id;
    filters.not_in_playlist = params.not_in_playlist;
    filters.duplicate_check = params.duplicate_check;
    filters.missing_metadata = params.missing_metadata;
    filters.has_errors = params.has_errors;
    filters.needs_review = params.needs_review;

    // === RESPONSE OPTIONS ===
    filters.include_deleted = params.include_deleted;
    filters.include_hidden = params.include_hidden;
    filters.full_metadata = params.full_metadata;
    filters.include_file_info = params.include_file_info;
    filters.include_statistics = params.include_statistics;
    filters.include_related = params.include_related;

    // === NULL CHECKING FILTERS ===
    filters.rating_is_null = params.rating_is_null;
    filters.genre_is_null = params.genre_is_null;
    filters.year_is_null = params.year_is_null;
    filters.bpm_is_null = params.bpm_is_null;
    filters.key_signature_is_null = params.key_signature_is_null;
    filters.artist_is_null = params.artist_is_null;
    filters.album_is_null = params.album_is_null;
    filters.album_artist_is_null = params.album_artist_is_null;

    // === LEGACY FIELDS ===
    // media_blob_id not available in UnifiedSearchParams - it's an internal field
    filters.media_blob_id = None;
    filters.metadata_filter = None; // Could be expanded later

    search_query.filters = filters;
    search_query
}

/// Build AppliedFilters from UnifiedSearchParams
fn build_applied_filters(params: &UnifiedSearchParams) -> AppliedFilters {
    AppliedFilters {
        text_search: params.q.clone(),
        artist_filters: params
            .artist
            .as_ref()
            .map(|a| vec![a.clone()])
            .unwrap_or_default(),
        album_filters: params
            .album
            .as_ref()
            .map(|a| vec![a.clone()])
            .unwrap_or_default(),
        genre_filters: params
            .genre
            .as_ref()
            .map(|g| vec![g.clone()])
            .unwrap_or_default(),
        year_range: if params.year_min.is_some() || params.year_max.is_some() {
            Some((
                params.year_min.unwrap_or(1900),
                params.year_max.unwrap_or(2030),
            ))
        } else {
            None
        },
        rating_range: if params.rating_min.is_some() || params.rating_max.is_some() {
            Some((
                params.rating_min.unwrap_or(0),
                params.rating_max.unwrap_or(5),
            ))
        } else {
            None
        },
        duration_range: if params.duration_min.is_some() || params.duration_max.is_some() {
            Some((
                params.duration_min.unwrap_or(0),
                params.duration_max.unwrap_or(3600),
            ))
        } else {
            None
        },
        boolean_filters: HashMap::new(),
        tag_filters: TagFilters {
            required_tags: params.tags.clone().unwrap_or_default(),
            optional_tags: params.tags_any.clone().unwrap_or_default(),
            excluded_tags: params.tags_exclude.clone().unwrap_or_default(),
        },
        date_filters: DateRangeFilters {
            created_after: params.created_after.clone(),
            created_before: params.created_before.clone(),
            updated_after: params.updated_after.clone(),
            updated_before: params.updated_before.clone(),
        },
        file_filters: FileFilters {
            formats: params.file_formats.clone().unwrap_or_default(),
            bitrate_range: if params.bitrate_min.is_some() || params.bitrate_max.is_some() {
                Some((
                    params.bitrate_min.unwrap_or(64),
                    params.bitrate_max.unwrap_or(320),
                ))
            } else {
                None
            },
            size_range: if params.file_size_min.is_some() || params.file_size_max.is_some() {
                Some((
                    params.file_size_min.unwrap_or(0),
                    params.file_size_max.unwrap_or(1024 * 1024 * 1024),
                ))
            } else {
                None
            },
        },
        total_filter_count: 0,
    }
}

/// Filter options endpoint with pagination
pub async fn get_filter_options(
    Extension(_user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<FilterOptionsParams>,
) -> Result<Json<FilterOptionsResponse>, StatusCode> {
    let repository = MusicRepository::new(db.pool().clone());

    // get library statistics
    let total_songs =
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM songs s WHERE s.deleted_at IS NULL")
            .fetch_one(db.pool())
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? as u64;

    let total_artists = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(DISTINCT s.artist) FROM songs s WHERE s.artist IS NOT NULL AND s.deleted_at IS NULL"
    )
    .fetch_one(db.pool())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? as u64;

    let total_albums = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(DISTINCT s.album) FROM songs s WHERE s.album IS NOT NULL AND s.deleted_at IS NULL"
    )
    .fetch_one(db.pool())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? as u64;

    let total_genres = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(DISTINCT s.genre) FROM songs s WHERE s.genre IS NOT NULL AND s.deleted_at IS NULL"
    )
    .fetch_one(db.pool())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? as u64;

    let favorites_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM songs s WHERE s.is_favorite = true AND s.deleted_at IS NULL",
    )
    .fetch_one(db.pool())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? as u64;

    let has_thumbnail_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM songs s WHERE s.thumbnail_blob_id IS NOT NULL AND s.deleted_at IS NULL"
    )
    .fetch_one(db.pool())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)? as u64;

    // get artist options with pagination
    let offset = (params.page - 1) * params.page_size;
    let artists_query = sqlx::query_as::<_, (String, i64)>(
        "SELECT s.artist, COUNT(*) as song_count
         FROM songs s
         WHERE s.artist IS NOT NULL AND s.deleted_at IS NULL
         GROUP BY s.artist
         ORDER BY song_count DESC, s.artist ASC
         LIMIT $1 OFFSET $2",
    )
    .bind(params.page_size as i64)
    .bind(offset as i64)
    .fetch_all(db.pool())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let artist_items: Vec<FilterOption> = artists_query
        .into_iter()
        .map(|(artist, count)| FilterOption {
            value: artist.clone(),
            label: artist,
            count: count as u32,
            percentage: (count as f64 / total_songs as f64 * 100.0) as f32,
        })
        .collect();

    // get album options with pagination
    let albums_query = sqlx::query_as::<_, (String, i64)>(
        "SELECT s.album, COUNT(*) as song_count
         FROM songs s
         WHERE s.album IS NOT NULL AND s.deleted_at IS NULL
         GROUP BY s.album
         ORDER BY song_count DESC, s.album ASC
         LIMIT $1 OFFSET $2",
    )
    .bind(params.page_size as i64)
    .bind(offset as i64)
    .fetch_all(db.pool())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let album_items: Vec<FilterOption> = albums_query
        .into_iter()
        .map(|(album, count)| FilterOption {
            value: album.clone(),
            label: album,
            count: count as u32,
            percentage: (count as f64 / total_songs as f64 * 100.0) as f32,
        })
        .collect();

    // get genre options with pagination
    let genres_query = sqlx::query_as::<_, (String, i64)>(
        "SELECT s.genre, COUNT(*) as song_count
         FROM songs s
         WHERE s.genre IS NOT NULL AND s.deleted_at IS NULL
         GROUP BY s.genre
         ORDER BY song_count DESC, s.genre ASC
         LIMIT $1 OFFSET $2",
    )
    .bind(params.page_size as i64)
    .bind(offset as i64)
    .fetch_all(db.pool())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let genre_items: Vec<FilterOption> = genres_query
        .into_iter()
        .map(|(genre, count)| FilterOption {
            value: genre.clone(),
            label: genre,
            count: count as u32,
            percentage: (count as f64 / total_songs as f64 * 100.0) as f32,
        })
        .collect();

    // get year distribution
    let years_query = sqlx::query_as::<_, (i32, i64)>(
        "SELECT s.year, COUNT(*) as song_count
         FROM songs s
         WHERE s.year IS NOT NULL AND s.deleted_at IS NULL
         GROUP BY s.year
         ORDER BY s.year DESC",
    )
    .fetch_all(db.pool())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let years: Vec<FilterOption> = years_query
        .into_iter()
        .map(|(year, count)| FilterOption {
            value: year.to_string(),
            label: year.to_string(),
            count: count as u32,
            percentage: (count as f64 / total_songs as f64 * 100.0) as f32,
        })
        .collect();

    // create year ranges
    let year_ranges = vec![
        YearRange {
            min_year: 1950,
            max_year: 1969,
            label: "1950s-1960s".to_string(),
            count: 0,
        },
        YearRange {
            min_year: 1970,
            max_year: 1989,
            label: "1970s-1980s".to_string(),
            count: 0,
        },
        YearRange {
            min_year: 1990,
            max_year: 2009,
            label: "1990s-2000s".to_string(),
            count: 0,
        },
        YearRange {
            min_year: 2010,
            max_year: 2030,
            label: "2010s+".to_string(),
            count: 0,
        },
    ];

    // get rating distribution
    let rating_distribution = vec![0, 0, 0, 0, 0, 0]; // 0-5 star ratings
    let avg_rating = 0.0;

    // calculate pagination for artists, albums, genres
    let total_pages = if total_artists == 0 {
        0
    } else {
        (total_artists as f64 / params.page_size as f64).ceil() as u32
    };

    let response = FilterOptionsResponse {
        artists: PaginatedFilterOptions {
            items: artist_items,
            total_count: total_artists as u32,
            page: params.page,
            page_size: params.page_size,
            total_pages,
            has_next: params.page < total_pages,
            has_prev: params.page > 1,
        },
        albums: PaginatedFilterOptions {
            items: album_items,
            total_count: total_albums as u32,
            page: params.page,
            page_size: params.page_size,
            total_pages: if total_albums == 0 {
                0
            } else {
                (total_albums as f64 / params.page_size as f64).ceil() as u32
            },
            has_next: params.page < ((total_albums as f64 / params.page_size as f64).ceil() as u32),
            has_prev: params.page > 1,
        },
        genres: PaginatedFilterOptions {
            items: genre_items,
            total_count: total_genres as u32,
            page: params.page,
            page_size: params.page_size,
            total_pages: if total_genres == 0 {
                0
            } else {
                (total_genres as f64 / params.page_size as f64).ceil() as u32
            },
            has_next: params.page < ((total_genres as f64 / params.page_size as f64).ceil() as u32),
            has_prev: params.page > 1,
        },
        tags: {
            // Get tags with pagination using grimoire repository
            let tag_data = repository
                .get_available_tags(params.page, params.page_size)
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            let tag_items: Vec<FilterOption> = tag_data
                .into_iter()
                .map(|(tag, count)| FilterOption {
                    value: tag.clone(),
                    label: tag,
                    count,
                    percentage: (count as f64 / total_songs as f64 * 100.0) as f32,
                })
                .collect();

            let total_tags = repository
                .get_total_tags_count()
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
                as u64;

            PaginatedFilterOptions {
                items: tag_items,
                total_count: total_tags as u32,
                page: params.page,
                page_size: params.page_size,
                total_pages: if total_tags == 0 {
                    0
                } else {
                    (total_tags as f64 / params.page_size as f64).ceil() as u32
                },
                has_next: params.page
                    < ((total_tags as f64 / params.page_size as f64).ceil() as u32),
                has_prev: params.page > 1,
            }
        },
        years,
        year_ranges,
        rating_distribution,
        avg_rating,
        file_formats: vec![],
        bitrate_ranges: vec![],
        duration_ranges: vec![],
        key_signatures: vec![],
        bpm_ranges: vec![],
        mood_categories: vec![],
        favorites_count: favorites_count as u32,
        has_thumbnail_count: has_thumbnail_count as u32,
        has_lyrics_count: 0,
        compilation_count: 0,
        statistics: LibraryStatistics {
            total_songs: total_songs,
            total_artists: total_artists as u32,
            total_albums: total_albums as u32,
            total_genres: total_genres as u32,
            total_tags: repository
                .get_total_tags_count()
                .await
                .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?,
            total_playtime_seconds: 0u64,
            avg_song_duration: 0.0,
            total_file_size_bytes: 0u64,
            last_updated: "".to_string(),
        },
    };

    Ok(Json(response))
}

/// Search suggestions endpoint with pagination
pub async fn get_suggestions(
    Extension(user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<SuggestionsParams>,
) -> Result<Json<SuggestionResponse>, StatusCode> {
    let start_time = std::time::Instant::now();

    let field = params.field.as_str();
    let partial = params.partial.trim().to_lowercase();

    if partial.is_empty() {
        let response = SuggestionResponse {
            suggestions: vec![],
            query_time_ms: start_time.elapsed().as_millis() as u64,
            total_count: 0,
            page: params.page,
            page_size: params.page_size,
            total_pages: 0,
            has_next: false,
            has_prev: false,
        };
        return Ok(Json(response));
    }

    let offset = (params.page - 1) * params.page_size;
    let limit = params.page_size as i64;

    let suggestions = match field {
        "all" => {
            // For "all" field, return mixed suggestions from different categories
            let mut all_suggestions = Vec::new();

            // Get top artists
            let artists = sqlx::query_as::<_, (String, i64)>(
                "SELECT s.artist, COUNT(*) as song_count
                 FROM songs s
                 WHERE s.artist IS NOT NULL
                   AND LOWER(s.artist) LIKE '%' || $1 || '%'
                   AND s.deleted_at IS NULL
                 GROUP BY s.artist
                 ORDER BY song_count DESC, s.artist ASC
                 LIMIT 3",
            )
            .bind(&partial)
            .fetch_all(db.pool())
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            for (value, count) in artists {
                all_suggestions.push(Suggestion {
                    value: value.clone(),
                    display: format!("{} (artist)", value),
                    highlight: highlight_match(&value, &partial),
                    count: count as u32,
                    suggestion_type: "artist".to_string(),
                    confidence: calculate_confidence(&value, &partial),
                    metadata: None,
                });
            }

            // Get top albums
            let albums = sqlx::query_as::<_, (String, String, i64)>(
                "SELECT s.album,
                        COALESCE(s.album_artist, s.artist, 'unknown artist') as artist,
                        COUNT(*) as song_count
                 FROM songs s
                 WHERE s.album IS NOT NULL
                   AND LOWER(s.album) LIKE '%' || $1 || '%'
                   AND s.deleted_at IS NULL
                 GROUP BY s.album, COALESCE(s.album_artist, s.artist, 'unknown artist')
                 ORDER BY song_count DESC, s.album ASC
                 LIMIT 3",
            )
            .bind(&partial)
            .fetch_all(db.pool())
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            for (album, artist, count) in albums {
                let metadata = serde_json::json!({
                    "artist": artist,
                    "album": album.clone()
                });
                all_suggestions.push(Suggestion {
                    value: album.clone(),
                    display: format!("{} - {} (album)", album, artist),
                    highlight: highlight_match(&album, &partial),
                    count: count as u32,
                    suggestion_type: "album".to_string(),
                    confidence: calculate_confidence(&album, &partial),
                    metadata: Some(metadata),
                });
            }

            // Get top song titles
            let titles = sqlx::query_as::<_, (String, String, String)>(
                "SELECT s.title,
                        COALESCE(s.artist, 'unknown artist') as artist,
                        s.id::text
                 FROM songs s
                 WHERE s.title IS NOT NULL
                   AND LOWER(s.title) LIKE '%' || $1 || '%'
                   AND s.deleted_at IS NULL
                 ORDER BY s.title ASC
                 LIMIT 3",
            )
            .bind(&partial)
            .fetch_all(db.pool())
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            for (title, artist, _id) in titles {
                all_suggestions.push(Suggestion {
                    value: title.clone(),
                    display: format!("{} - {} (song)", title, artist),
                    highlight: highlight_match(&title, &partial),
                    count: 1,
                    suggestion_type: "title".to_string(),
                    confidence: calculate_confidence(&title, &partial),
                    metadata: None,
                });
            }

            // Get genre suggestions
            let genres = sqlx::query!(
                r#"
                SELECT value, display, highlight, count, suggestion_type, confidence
                FROM get_genre_suggestions($1, 3)
                "#,
                &partial
            )
            .fetch_all(db.pool())
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            for genre in genres {
                all_suggestions.push(Suggestion {
                    value: genre.value.unwrap_or_default(),
                    display: format!("{} (genre)", genre.display.unwrap_or_default()),
                    highlight: genre.highlight.unwrap_or_default(),
                    count: genre.count.unwrap_or(0) as u32,
                    suggestion_type: "genre".to_string(),
                    confidence: genre.confidence.unwrap_or(0.0),
                    metadata: None,
                });
            }

            // Get playlist suggestions
            let playlists = sqlx::query!(
                r#"
                SELECT value, display, highlight, count, suggestion_type, confidence, playlist_id
                FROM get_playlist_suggestions($1, $2, 3)
                "#,
                &partial,
                user.0.id
            )
            .fetch_all(db.pool())
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            for playlist in playlists {
                let playlist_id = playlist.playlist_id.unwrap_or_default();
                let metadata = serde_json::json!({
                    "playlist_id": playlist_id.to_string()
                });
                all_suggestions.push(Suggestion {
                    value: playlist.value.unwrap_or_default(),
                    display: format!("{} (playlist)", playlist.display.unwrap_or_default()),
                    highlight: playlist.highlight.unwrap_or_default(),
                    count: playlist.count.unwrap_or(0) as u32,
                    suggestion_type: "playlist".to_string(),
                    confidence: playlist.confidence.unwrap_or(0.0),
                    metadata: Some(metadata),
                });
            }

            // Sort by confidence and limit total results
            all_suggestions.sort_by(|a, b| {
                b.confidence
                    .partial_cmp(&a.confidence)
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
            all_suggestions.truncate(limit as usize);
            all_suggestions
        }
        "artist" => {
            let query = sqlx::query_as::<_, (String, i64)>(
                "SELECT s.artist, COUNT(*) as song_count
                 FROM songs s
                 WHERE s.artist IS NOT NULL
                   AND LOWER(s.artist) LIKE '%' || $1 || '%'
                   AND s.deleted_at IS NULL
                 GROUP BY s.artist
                 ORDER BY song_count DESC, s.artist ASC
                 LIMIT $2 OFFSET $3",
            )
            .bind(&partial)
            .bind(limit)
            .bind(offset as i64)
            .fetch_all(db.pool())
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            query
                .into_iter()
                .map(|(value, count)| Suggestion {
                    value: value.clone(),
                    display: value.clone(),
                    highlight: highlight_match(&value, &partial),
                    count: count as u32,
                    suggestion_type: "artist".to_string(),
                    confidence: calculate_confidence(&value, &partial),
                    metadata: None,
                })
                .collect()
        }
        "album" => {
            let query = sqlx::query_as::<_, (String, String, i64)>(
                "SELECT s.album,
                        COALESCE(s.album_artist, s.artist, 'unknown artist') as artist,
                        COUNT(*) as song_count
                 FROM songs s
                 WHERE s.album IS NOT NULL
                   AND LOWER(s.album) LIKE '%' || $1 || '%'
                   AND s.deleted_at IS NULL
                 GROUP BY s.album, COALESCE(s.album_artist, s.artist, 'unknown artist')
                 ORDER BY song_count DESC, s.album ASC
                 LIMIT $2 OFFSET $3",
            )
            .bind(&partial)
            .bind(limit)
            .bind(offset as i64)
            .fetch_all(db.pool())
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            query
                .into_iter()
                .map(|(album, artist, count)| {
                    let metadata = serde_json::json!({
                        "artist": artist,
                        "album": album.clone()
                    });
                    Suggestion {
                        value: album.clone(),
                        display: format!("{} - {}", album, artist),
                        highlight: highlight_match(&album, &partial),
                        count: count as u32,
                        suggestion_type: "album".to_string(),
                        confidence: calculate_confidence(&album, &partial),
                        metadata: Some(metadata),
                    }
                })
                .collect()
        }
        "title" => {
            let query = sqlx::query_as::<_, (String, String, String)>(
                "SELECT s.title,
                        COALESCE(s.artist, 'unknown artist') as artist,
                        s.id::text
                 FROM songs s
                 WHERE s.title IS NOT NULL
                   AND LOWER(s.title) LIKE '%' || $1 || '%'
                   AND s.deleted_at IS NULL
                 ORDER BY s.title ASC
                 LIMIT $2 OFFSET $3",
            )
            .bind(&partial)
            .bind(limit)
            .bind(offset as i64)
            .fetch_all(db.pool())
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            query
                .into_iter()
                .map(|(title, artist, _id)| Suggestion {
                    value: title.clone(),
                    display: format!("{} - {}", title, artist),
                    highlight: highlight_match(&title, &partial),
                    count: 1,
                    suggestion_type: "title".to_string(),
                    confidence: calculate_confidence(&title, &partial),
                    metadata: None,
                })
                .collect()
        }
        "genre" => {
            let query = sqlx::query_as::<_, (String, i64)>(
                "SELECT s.genre, COUNT(*) as song_count
                 FROM songs s
                 WHERE s.genre IS NOT NULL
                   AND LOWER(s.genre) LIKE '%' || $1 || '%'
                   AND s.deleted_at IS NULL
                 GROUP BY s.genre
                 ORDER BY song_count DESC, s.genre ASC
                 LIMIT $2 OFFSET $3",
            )
            .bind(&partial)
            .bind(limit)
            .bind(offset as i64)
            .fetch_all(db.pool())
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

            query
                .into_iter()
                .map(|(value, count)| Suggestion {
                    value: value.clone(),
                    display: value.clone(),
                    highlight: highlight_match(&value, &partial),
                    count: count as u32,
                    suggestion_type: "genre".to_string(),
                    confidence: calculate_confidence(&value, &partial),
                    metadata: None,
                })
                .collect()
        }
        _ => vec![],
    };

    let total_count = suggestions.len() as u32;
    let total_pages = if total_count == 0 {
        0
    } else {
        (total_count as f64 / params.page_size as f64).ceil() as u32
    };

    let response = SuggestionResponse {
        suggestions,
        query_time_ms: start_time.elapsed().as_millis() as u64,
        total_count,
        page: params.page,
        page_size: params.page_size,
        total_pages,
        has_next: params.page < total_pages,
        has_prev: params.page > 1,
    };

    Ok(Json(response))
}

/// Helper function to highlight matching text in suggestions
fn highlight_match(text: &str, partial: &str) -> String {
    let lower_text = text.to_lowercase();
    let lower_partial = partial.to_lowercase();

    if let Some(start) = lower_text.find(&lower_partial) {
        let end = start + partial.len();
        format!(
            "{}**{}**{}",
            &text[..start],
            &text[start..end],
            &text[end..]
        )
    } else {
        text.to_string()
    }
}

/// Helper function to calculate confidence score for suggestions
fn calculate_confidence(text: &str, partial: &str) -> f32 {
    let lower_text = text.to_lowercase();
    let lower_partial = partial.to_lowercase();

    if lower_text == lower_partial {
        1.0
    } else if lower_text.starts_with(&lower_partial) {
        0.9
    } else if lower_text.contains(&lower_partial) {
        0.7
    } else {
        0.1
    }
}

/// Get genre aggregations for search results
async fn get_genre_aggregations(
    db: &DatabaseConnection,
    user_id: Option<uuid::Uuid>,
    search_query: Option<&str>,
    limit: i32,
    offset: i32,
) -> Result<Vec<GenreGroupResult>, StatusCode> {
    let rows = sqlx::query!(
        r#"
        SELECT
            genre, song_count, artist_count, representative_song_id,
            representative_thumbnail, avg_rating, search_rank
        FROM get_genre_aggregations($1, $2, $3, $4)
        "#,
        search_query,
        user_id,
        limit,
        offset
    )
    .fetch_all(db.pool())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let results = rows
        .into_iter()
        .map(|row| GenreGroupResult {
            genre: row.genre.unwrap_or_default(),
            song_count: row.song_count.unwrap_or(0) as u64,
            artist_count: row.artist_count.unwrap_or(0) as u64,
            representative_song_id: row.representative_song_id,
            representative_thumbnail: row.representative_thumbnail,
            avg_rating: row
                .avg_rating
                .map(|r| r.to_string().parse::<f64>().unwrap_or(0.0)),
            search_rank: row.search_rank.unwrap_or(1.0),
        })
        .collect();

    Ok(results)
}

/// Get playlist search results for search results
async fn get_playlist_search_results(
    db: &DatabaseConnection,
    user_id: Option<uuid::Uuid>,
    search_query: Option<&str>,
    include_private: bool,
    limit: i32,
    offset: i32,
) -> Result<Vec<PlaylistGroupResult>, StatusCode> {
    let rows = sqlx::query!(
        r#"
        SELECT
            id, title, description, song_count, is_public,
            thumbnail_blob_id, created_at, search_rank
        FROM get_playlist_search_results($1, $2, $3, $4, $5)
        "#,
        search_query,
        user_id,
        include_private,
        limit,
        offset
    )
    .fetch_all(db.pool())
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    let results = rows
        .into_iter()
        .map(|row| PlaylistGroupResult {
            id: row.id.unwrap(),
            title: row.title.unwrap_or_default(),
            description: row.description,
            song_count: row.song_count.unwrap_or(0) as u64,
            is_public: row.is_public.unwrap_or(false),
            thumbnail_blob_id: row.thumbnail_blob_id,
            created_at: row.created_at.unwrap().into(),
            search_rank: row.search_rank.unwrap_or(1.0),
        })
        .collect();

    Ok(results)
}

/// Create search routes
pub fn create_search_routes() -> Router {
    #[allow(unused_imports)]
    use axum::routing::post;
    Router::new()
        .route("/search", get(search_music).post(search_music_post))
        .route("/filter-options", get(get_filter_options))
        .route("/suggestions", get(get_suggestions))
}
