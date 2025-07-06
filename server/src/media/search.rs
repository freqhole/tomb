//! Music search API endpoints

use crate::auth::AuthenticatedUser;
use axum::{
    extract::{Extension, Query},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use grimoire::{
    search::{SearchQuery, SearchService, SearchType, SortBy, SortDirection},
    DatabaseConnection,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use time::OffsetDateTime;
use uuid::Uuid;

/// Query parameters for music search
#[derive(Debug, Deserialize)]
pub struct SearchParams {
    /// Search query text
    pub q: Option<String>,
    /// Search type: websearch, plainto, or phrase
    #[serde(default = "default_search_type")]
    pub search_type: String,
    /// Use structured search format (e.g., "artist:jazz")
    #[serde(default)]
    pub structured: bool,
    /// Page number (1-based)
    #[serde(default = "default_page")]
    pub page: u32,
    /// Number of results per page
    #[serde(default = "default_page_size")]
    pub page_size: u32,
    /// Sort by field
    #[serde(default)]
    pub sort_by: Option<String>,
    /// Sort direction
    #[serde(default)]
    pub sort_direction: Option<String>,
    /// Filter by artist
    pub artist: Option<String>,
    /// Filter by album
    pub album: Option<String>,
    /// Filter by genre
    pub genre: Option<String>,
    /// Filter by year
    pub year: Option<i32>,
    /// Minimum rating
    pub rating_min: Option<i32>,
    /// Maximum rating
    pub rating_max: Option<i32>,
    /// Show only favorites
    #[serde(default)]
    pub favorites_only: bool,
    /// Search only songs (exclude playlists)
    #[serde(default)]
    pub songs_only: bool,
}

/// Query parameters for filter-only browsing (no search query required)
#[derive(Debug, Deserialize)]
pub struct FilterParams {
    /// Page number (1-based)
    #[serde(default = "default_page")]
    pub page: u32,
    /// Number of results per page
    #[serde(default = "default_page_size")]
    pub page_size: u32,
    /// Sort by field
    #[serde(default)]
    pub sort_by: Option<String>,
    /// Sort direction
    #[serde(default)]
    pub sort_direction: Option<String>,
    /// Search query
    pub q: Option<String>,
    /// Filter by artist
    pub artist: Option<String>,
    /// Filter by album
    pub album: Option<String>,
    /// Filter by genre
    pub genre: Option<String>,
    /// Filter by year
    pub year: Option<i32>,
    /// Minimum rating
    pub rating_min: Option<i32>,
    /// Maximum rating
    pub rating_max: Option<i32>,
    /// Show only favorites
    #[serde(default)]
    pub favorites_only: bool,
    /// Filter only songs (exclude playlists)
    #[serde(default)]
    pub songs_only: bool,
}

/// Query parameters for search suggestions
#[derive(Debug, Deserialize)]
pub struct SuggestionParams {
    /// Partial query to get suggestions for
    pub q: String,
    /// Maximum number of suggestions
    #[serde(default = "default_suggestion_limit")]
    pub limit: u32,
}

/// Response format for music search
#[derive(Debug, Serialize)]
pub struct SearchResponse {
    /// Total number of results
    pub total_count: u64,
    /// Current page number
    pub page: u32,
    /// Number of results per page
    pub page_size: u32,
    /// Total number of pages
    pub total_pages: u32,
    /// Search query time in milliseconds
    pub query_time_ms: u64,
    /// Search results
    pub results: Vec<SearchResultResponse>,
    /// Search suggestions
    pub suggestions: Vec<SuggestionResponse>,
}

/// Individual search result
#[derive(Debug, Serialize)]
pub struct SearchResultResponse {
    /// Result ID
    pub id: Uuid,
    /// Type of result (song, playlist)
    pub result_type: String,
    /// Primary title
    pub title: String,
    /// Secondary title/subtitle
    pub subtitle: Option<String>,
    /// Description
    pub description: Option<String>,
    /// Thumbnail blob ID
    pub thumbnail_blob_id: Option<String>,
    /// Media blob ID
    pub media_blob_id: Option<String>,
    /// Relevance score
    pub relevance_score: f32,
    /// Additional metadata
    pub metadata: HashMap<String, serde_json::Value>,
    /// Creation timestamp
    #[serde(with = "time::serde::iso8601")]
    pub created_at: OffsetDateTime,
    /// Last update timestamp
    #[serde(with = "time::serde::iso8601")]
    pub updated_at: OffsetDateTime,
}

/// Search suggestion response
#[derive(Debug, Serialize)]
pub struct SuggestionResponse {
    /// Suggestion text
    pub text: String,
    /// Category (artist, album, genre, etc.)
    pub category: String,
    /// Frequency/popularity
    pub frequency: u32,
}

/// Response for songs-only search
#[derive(Debug, Serialize)]
pub struct SongSearchResponse {
    /// Total number of songs
    pub total_count: u64,
    /// Current page number
    pub page: u32,
    /// Number of results per page
    pub page_size: u32,
    /// Search query time in milliseconds
    pub query_time_ms: u64,
    /// Song results
    pub songs: Vec<SongResultResponse>,
}

/// Individual song search result
#[derive(Debug, Serialize)]
pub struct SongResultResponse {
    /// Song ID
    pub id: Uuid,
    /// Media blob ID
    pub media_blob_id: String,
    /// Thumbnail blob ID
    pub thumbnail_blob_id: Option<String>,
    /// Waveform blob ID
    pub waveform_blob_id: Option<String>,
    /// Song title
    pub title: String,
    /// Artist name
    pub artist: Option<String>,
    /// Album name
    pub album: Option<String>,
    /// Album artist
    pub album_artist: Option<String>,
    /// Track number
    pub track_number: Option<i32>,
    /// Disc number
    pub disc_number: Option<i32>,
    /// Genre
    pub genre: Option<String>,
    /// Year
    pub year: Option<i32>,
    /// BPM
    pub bpm: Option<i32>,
    /// Key signature
    pub key_signature: Option<String>,
    /// Rating (1-5)
    pub rating: Option<i32>,
    /// Is favorite
    pub is_favorite: bool,
    /// Tags
    pub tags: Vec<String>,
    /// Search relevance score
    pub search_rank: f32,
    /// Creation timestamp
    #[serde(with = "time::serde::iso8601")]
    pub created_at: OffsetDateTime,
    /// Last update timestamp
    #[serde(with = "time::serde::iso8601")]
    pub updated_at: OffsetDateTime,
}

/// Suggestions-only response
#[derive(Debug, Serialize)]
pub struct SuggestionsResponse {
    /// Search suggestions
    pub suggestions: Vec<SuggestionResponse>,
    /// Number of suggestions returned
    pub count: u32,
}

// Default values for query parameters
fn default_search_type() -> String {
    "websearch".to_string()
}

fn default_page() -> u32 {
    1
}

fn default_page_size() -> u32 {
    20
}

fn default_suggestion_limit() -> u32 {
    10
}

/// Main music search endpoint - searches both songs and playlists
pub async fn search_music(
    Extension(_user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<SearchParams>,
) -> Result<Json<SearchResponse>, StatusCode> {
    // Validate query
    if params.q.is_none() || params.q.as_ref().unwrap().trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Parse search type
    let search_type = match params.search_type.as_str() {
        "websearch" => SearchType::WebSearch,
        "plainto" => SearchType::PlainText,
        "phrase" => SearchType::Phrase,
        _ => return Err(StatusCode::BAD_REQUEST),
    };

    // Parse sort parameters
    let sort_by = match params.sort_by.as_deref() {
        Some("relevance") => SortBy::Relevance,
        Some("created_at") => SortBy::CreatedAt,
        Some("title") => SortBy::Title,
        Some("artist") => SortBy::Artist,
        Some("album") => SortBy::Album,
        Some("rating") => SortBy::Rating,
        _ => SortBy::Relevance,
    };

    let sort_direction = match params.sort_direction.as_deref() {
        Some("asc") => SortDirection::Asc,
        Some("desc") => SortDirection::Desc,
        _ => SortDirection::Desc,
    };

    // Build search query
    let mut search_query = SearchQuery::new()
        .with_search_type(search_type)
        .with_domains(vec!["music".to_string()])
        .with_pagination(params.page, params.page_size)
        .with_sort(sort_by, sort_direction);

    if params.structured {
        search_query = search_query.with_structured_search(params.q.as_ref().unwrap());
    } else {
        search_query = search_query.with_query(params.q.as_ref().unwrap());
    }

    // Apply filters
    if let Some(artist) = params.artist {
        search_query = search_query.with_artist_filter(&artist);
    }
    if let Some(genre) = params.genre {
        search_query = search_query.with_genre_filter(&genre);
    }
    if params.favorites_only {
        search_query = search_query.with_favorites_only();
    }

    // Apply additional filters
    if let Some(album) = params.album {
        search_query.filters.album = Some(album);
    }
    if let Some(year) = params.year {
        search_query.filters.year = Some(year);
    }
    if let Some(rating_min) = params.rating_min {
        search_query.filters.rating_min = Some(rating_min);
    }
    if let Some(rating_max) = params.rating_max {
        search_query.filters.rating_max = Some(rating_max);
    }

    // Execute search
    let search_service = SearchService::new(db.pool().clone());
    let search_result = search_service
        .search_music(&search_query)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Convert results
    let results = search_result
        .results
        .into_iter()
        .map(|r| SearchResultResponse {
            id: r.id,
            result_type: r.result_type,
            title: r.title,
            subtitle: r.subtitle,
            description: r.description,
            thumbnail_blob_id: r.thumbnail_blob_id,
            media_blob_id: r.media_blob_id,
            relevance_score: r.relevance_score,
            metadata: r
                .metadata
                .as_object()
                .unwrap_or(&serde_json::Map::new())
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            created_at: r.created_at,
            updated_at: r.updated_at,
        })
        .collect();

    let suggestions = search_result
        .suggestions
        .into_iter()
        .map(|s| SuggestionResponse {
            text: s.text,
            category: s.category,
            frequency: s.frequency,
        })
        .collect();

    Ok(Json(SearchResponse {
        total_count: search_result.total_count,
        page: search_result.page,
        page_size: search_result.page_size,
        total_pages: search_result.total_pages,
        query_time_ms: search_result.query_time_ms,
        results,
        suggestions,
    }))
}

/// Search only songs endpoint
pub async fn search_songs(
    Extension(_user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<SearchParams>,
) -> Result<Json<SongSearchResponse>, StatusCode> {
    // Validate query
    if params.q.is_none() || params.q.as_ref().unwrap().trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Parse search type
    let search_type = match params.search_type.as_str() {
        "websearch" => SearchType::WebSearch,
        "plainto" => SearchType::PlainText,
        "phrase" => SearchType::Phrase,
        _ => return Err(StatusCode::BAD_REQUEST),
    };

    // Parse sort parameters
    let sort_by = match params.sort_by.as_deref() {
        Some("relevance") => SortBy::Relevance,
        Some("created_at") => SortBy::CreatedAt,
        Some("title") => SortBy::Title,
        Some("artist") => SortBy::Artist,
        Some("album") => SortBy::Album,
        Some("rating") => SortBy::Rating,
        _ => SortBy::Relevance,
    };

    let sort_direction = match params.sort_direction.as_deref() {
        Some("asc") => SortDirection::Asc,
        Some("desc") => SortDirection::Desc,
        _ => SortDirection::Desc,
    };

    // Build search query
    let mut search_query = SearchQuery::new()
        .with_search_type(search_type)
        .with_domains(vec!["music".to_string()])
        .with_pagination(params.page, params.page_size)
        .with_sort(sort_by, sort_direction);

    if params.structured {
        search_query = search_query.with_structured_search(params.q.as_ref().unwrap());
    } else {
        search_query = search_query.with_query(params.q.as_ref().unwrap());
    }

    // Apply filters
    if let Some(artist) = params.artist {
        search_query = search_query.with_artist_filter(&artist);
    }
    if let Some(genre) = params.genre {
        search_query = search_query.with_genre_filter(&genre);
    }
    if params.favorites_only {
        search_query = search_query.with_favorites_only();
    }

    // Apply additional filters
    if let Some(album) = params.album {
        search_query.filters.album = Some(album);
    }
    if let Some(year) = params.year {
        search_query.filters.year = Some(year);
    }
    if let Some(rating_min) = params.rating_min {
        search_query.filters.rating_min = Some(rating_min);
    }
    if let Some(rating_max) = params.rating_max {
        search_query.filters.rating_max = Some(rating_max);
    }

    // Execute search
    let search_service = SearchService::new(db.pool().clone());
    let start_time = std::time::Instant::now();
    let song_results = search_service
        .search_songs(&search_query)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let query_time_ms = start_time.elapsed().as_millis() as u64;

    // Convert results
    let songs: Vec<SongResultResponse> = song_results
        .into_iter()
        .map(|s| SongResultResponse {
            id: s.id,
            media_blob_id: s.media_blob_id,
            thumbnail_blob_id: s.thumbnail_blob_id,
            waveform_blob_id: s.waveform_blob_id,
            title: s.title,
            artist: s.artist,
            album: s.album,
            album_artist: s.album_artist,
            track_number: s.track_number,
            disc_number: s.disc_number,
            genre: s.genre,
            year: s.year,
            bpm: s.bpm,
            key_signature: s.key_signature,
            rating: s.rating,
            is_favorite: s.is_favorite,
            tags: s.tags,
            search_rank: s.search_rank,
            created_at: s.created_at,
            updated_at: s.updated_at,
        })
        .collect();

    let total_count = songs.len() as u64;

    Ok(Json(SongSearchResponse {
        total_count,
        page: params.page,
        page_size: params.page_size,
        query_time_ms,
        songs,
    }))
}

/// Search suggestions endpoint
pub async fn search_suggestions(
    Extension(_user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<SuggestionParams>,
) -> Result<Json<SuggestionsResponse>, StatusCode> {
    // Validate query
    if params.q.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }

    // Execute search
    let search_service = SearchService::new(db.pool().clone());
    let suggestions = search_service
        .get_suggestions(&params.q)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    // Convert results
    let suggestions: Vec<SuggestionResponse> = suggestions
        .into_iter()
        .take(params.limit as usize)
        .map(|s| SuggestionResponse {
            text: s.text,
            category: s.category,
            frequency: s.frequency,
        })
        .collect();

    let count = suggestions.len() as u32;

    Ok(Json(SuggestionsResponse { suggestions, count }))
}

/// Filter-only music browsing endpoint - no search query required
pub async fn filter_music(
    Extension(_user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<FilterParams>,
) -> Result<Json<SearchResponse>, StatusCode> {
    println!("🎛️ filter_music called");

    // Validate that at least one filter or query is provided
    let has_filters = params.artist.is_some()
        || params.album.is_some()
        || params.genre.is_some()
        || params.year.is_some()
        || params.rating_min.is_some()
        || params.rating_max.is_some()
        || params.favorites_only;

    let has_query = params.q.is_some() && !params.q.as_ref().unwrap().trim().is_empty();

    if !has_filters && !has_query {
        println!("❌ No filters or query provided, returning BAD_REQUEST");
        return Err(StatusCode::BAD_REQUEST);
    }

    // Parse sort parameters
    let sort_by = match params.sort_by.as_deref() {
        Some("relevance") => SortBy::Relevance,
        Some("created_at") => SortBy::CreatedAt,
        Some("title") => SortBy::Title,
        Some("artist") => SortBy::Artist,
        Some("album") => SortBy::Album,
        Some("rating") => SortBy::Rating,
        _ => SortBy::CreatedAt, // Default to created_at for browsing
    };

    let sort_direction = match params.sort_direction.as_deref() {
        Some("asc") => SortDirection::Asc,
        Some("desc") => SortDirection::Desc,
        _ => SortDirection::Desc,
    };

    // Build search query with optional text query and filters
    let mut search_query = SearchQuery::new()
        .with_search_type(SearchType::PlainText) // Use plaintext for filter searches
        .with_domains(vec!["music".to_string()])
        .with_pagination(params.page, params.page_size)
        .with_sort(sort_by, sort_direction);

    // Add query if provided
    if let Some(query) = params.q {
        if !query.trim().is_empty() {
            search_query = search_query.with_query(&query);
        }
    }

    // Apply filters
    if let Some(artist) = params.artist {
        search_query = search_query.with_artist_filter(&artist);
    }
    if let Some(genre) = params.genre {
        search_query = search_query.with_genre_filter(&genre);
    }
    if params.favorites_only {
        search_query = search_query.with_favorites_only();
    }

    // Apply additional filters
    if let Some(album) = params.album {
        search_query.filters.album = Some(album);
    }
    if let Some(year) = params.year {
        search_query.filters.year = Some(year);
    }
    if let Some(rating_min) = params.rating_min {
        search_query.filters.rating_min = Some(rating_min);
    }
    if let Some(rating_max) = params.rating_max {
        search_query.filters.rating_max = Some(rating_max);
    }

    // Execute filter-based browsing
    let search_service = SearchService::new(db.pool().clone());

    let search_result = if params.songs_only {
        // For songs-only filtering, use the songs search method
        let songs = search_service
            .search_songs(&search_query)
            .await
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

        // Convert songs to general search result format
        let results: Vec<_> = songs
            .into_iter()
            .map(|s| grimoire::search::SearchResultItem {
                id: s.id,
                result_type: "song".to_string(),
                title: s.title.clone(),
                subtitle: s.artist.clone(),
                description: s.album.clone(),
                thumbnail_blob_id: s.thumbnail_blob_id.clone(),
                media_blob_id: Some(s.media_blob_id.clone()),
                relevance_score: s.search_rank,
                metadata: serde_json::json!({
                    "artist": s.artist,
                    "album": s.album,
                    "genre": s.genre,
                    "year": s.year,
                    "rating": s.rating,
                    "is_favorite": s.is_favorite,
                    "tags": s.tags
                }),
                created_at: s.created_at,
                updated_at: s.updated_at,
            })
            .collect();

        grimoire::search::SearchResult {
            total_count: results.len() as u64,
            page: params.page,
            page_size: params.page_size,
            total_pages: ((results.len() as f64) / (params.page_size as f64)).ceil() as u32,
            query_time_ms: 0, // Not measured for filter-only
            results,
            facets: vec![],
            suggestions: vec![],
        }
    } else {
        search_service
            .search_music(&search_query)
            .await
            .map_err(|e| {
                println!("❌ search_music error: {:?}", e);
                StatusCode::INTERNAL_SERVER_ERROR
            })?
    };

    // Convert results
    let results: Vec<SearchResultResponse> = search_result
        .results
        .into_iter()
        .map(|r| SearchResultResponse {
            id: r.id,
            result_type: r.result_type,
            title: r.title,
            subtitle: r.subtitle,
            description: r.description,
            thumbnail_blob_id: r.thumbnail_blob_id,
            media_blob_id: r.media_blob_id,
            relevance_score: r.relevance_score,
            metadata: r
                .metadata
                .as_object()
                .unwrap_or(&serde_json::Map::new())
                .iter()
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect(),
            created_at: r.created_at,
            updated_at: r.updated_at,
        })
        .collect();

    let results_count = results.len();
    let response = Json(SearchResponse {
        total_count: search_result.total_count,
        page: search_result.page,
        page_size: search_result.page_size,
        total_pages: search_result.total_pages,
        query_time_ms: search_result.query_time_ms,
        results,
        suggestions: vec![], // No suggestions for filter-only browsing
    });

    println!("🎛️ Returning response with {} results", results_count);
    Ok(response)
}

/// Create search routes
pub fn create_search_routes() -> Router {
    Router::new()
        .route("/search", get(search_music))
        .route("/search/songs", get(search_songs))
        .route("/search/suggestions", get(search_suggestions))
        .route("/filter", get(filter_music))
}
