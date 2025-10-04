//! Song and playlist HTTP API handlers
//!
//! This module provides REST API endpoints for managing songs and playlists.

use crate::auth::require_admin;
use crate::auth::AuthenticatedUser;
use crate::download::routes::{download_urls, get_job_status};
use axum::{
    extract::{DefaultBodyLimit, Extension, Multipart, Path, Query},
    http::StatusCode,
    middleware as axum_middleware,
    response::Json,
    routing::{delete, get, post, put},
    Router,
};
use grimoire::config::AppConfig;
use grimoire::music::models::SongWithUserPrefs;
use grimoire::music::models::{
    BulkUpdatePreferencesRequest,
    UpdateUserPreferenceRequest as GrimoireUpdateUserPreferenceRequest, UserSongPreference,
};
use grimoire::music::{
    AlbumSummary, AlbumTrack, BulkUpdateSongsRequest, CreatePlaylist, MusicRepository, Playlist,
    PlaylistQuery, PlaylistService, PlaylistSummary, PlaylistWithCount, Song, SongQuery,
    UpdatePlaylist,
};
use grimoire::thumbnails::ThumbnailService;
use grimoire::DatabaseConnection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::error::WebauthnError;
use crate::media::{CreateMediaBlob, MediaService};

/// Song list response
#[derive(Debug, Serialize)]
pub struct SongListResponse {
    pub songs: Vec<SongResponse>,
    pub total: i64,
    pub page: Option<i32>,
    pub page_size: Option<i32>,
    pub total_pages: Option<i32>,
    pub has_next: bool,
    pub has_prev: bool,
}

/// Song response for API
#[derive(Debug, Serialize)]
pub struct SongResponse {
    pub id: Uuid,
    pub title: String,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub album_artist: Option<String>,
    pub track_number: Option<i32>,
    pub disc_number: Option<i32>,
    pub duration_seconds: Option<i64>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub bpm: Option<i32>,
    pub key_signature: Option<String>,
    pub user_rating: Option<i32>,
    pub user_is_favorite: bool,
    pub tags: Vec<String>,
    pub display_title: String,
    pub detailed_display_title: String,
    pub created_at: String,
    pub media_blob_id: String,
    pub thumbnail_blob_id: Option<String>,
    pub waveform_blob_id: Option<String>,
    pub thumbnail_blob_ids: Vec<String>,
    pub preference_updated_at: Option<String>,
}

impl From<SongWithUserPrefs> for SongResponse {
    fn from(song: SongWithUserPrefs) -> Self {
        let display_title = song.display_title();
        let detailed_display_title = match &song.artist {
            Some(artist) => format!("{} - {}", artist, song.title),
            None => song.title.clone(),
        };

        Self {
            id: song.id,
            title: song.title,
            artist: song.artist,
            album: song.album,
            album_artist: song.album_artist,
            track_number: song.track_number,
            disc_number: song.disc_number,
            duration_seconds: song.duration_seconds,
            genre: song.genre,
            year: song.year,
            bpm: song.bpm,
            key_signature: song.key_signature,
            user_rating: song.rating,
            user_is_favorite: song.is_favorite,
            tags: song.tags.unwrap_or_default(),
            display_title,
            detailed_display_title,
            created_at: song.created_at.format(&Rfc3339).unwrap_or_default(),
            media_blob_id: song.media_blob_id,
            thumbnail_blob_id: song.thumbnail_blob_id.clone(),
            waveform_blob_id: song.waveform_blob_id,
            thumbnail_blob_ids: song.thumbnail_blob_id.map_or(Vec::new(), |id| vec![id]),
            preference_updated_at: song
                .preference_updated_at
                .map(|dt| dt.format(&Rfc3339).unwrap_or_default()),
        }
    }
}

impl From<Song> for SongResponse {
    fn from(song: Song) -> Self {
        let duration_seconds = song.duration.map(|d| d.microseconds / 1_000_000);
        let display_title = song.display_title();
        let detailed_display_title = song.detailed_display_title();

        Self {
            id: song.id,
            title: song.title,
            artist: song.artist,
            album: song.album,
            album_artist: song.album_artist,
            track_number: song.track_number,
            disc_number: song.disc_number,
            duration_seconds,
            genre: song.genre,
            year: song.year,
            bpm: song.bpm,
            key_signature: song.key_signature,
            user_rating: None,
            user_is_favorite: false,
            tags: song.tags.unwrap_or_default(),
            display_title,
            detailed_display_title,
            created_at: song
                .created_at
                .format(&Rfc3339)
                .unwrap_or_else(|_| song.created_at.to_string()),
            media_blob_id: song.media_blob_id,
            thumbnail_blob_id: song.thumbnail_blob_id,
            waveform_blob_id: song.waveform_blob_id,
            thumbnail_blob_ids: song.thumbnail_blob_ids.unwrap_or_default(),
            preference_updated_at: None,
        }
    }
}

/// Playlist response for API
#[derive(Debug, Serialize)]
pub struct PlaylistResponse {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub is_public: bool,
    pub is_collaborative: bool,
    pub song_count: Option<i64>,
    pub visibility: String,
    pub created_at: String,
    pub media_blob_id: Option<String>,
    pub thumbnail_blob_id: Option<String>,
}

impl From<Playlist> for PlaylistResponse {
    fn from(playlist: Playlist) -> Self {
        let visibility = playlist.visibility_string().to_string();
        Self {
            id: playlist.id,
            title: playlist.title,
            description: playlist.description,
            is_public: playlist.is_public,
            is_collaborative: playlist.is_collaborative,
            song_count: None,
            visibility,
            created_at: playlist.created_at.to_string(),
            media_blob_id: playlist.media_blob_id,
            thumbnail_blob_id: playlist.thumbnail_blob_id,
        }
    }
}

impl From<PlaylistWithCount> for PlaylistResponse {
    fn from(playlist_with_count: PlaylistWithCount) -> Self {
        let mut response = PlaylistResponse::from(playlist_with_count.playlist);
        response.song_count = Some(playlist_with_count.song_count);
        response
    }
}

/// Playlist list response
#[derive(Debug, Serialize)]
pub struct PlaylistListResponse {
    pub playlists: Vec<PlaylistResponse>,
    pub total: i64,
    pub page: Option<i32>,
    pub page_size: Option<i32>,
    pub total_pages: Option<i32>,
    pub has_next: bool,
    pub has_prev: bool,
}

/// Song query parameters for API
#[derive(Debug, Deserialize, Clone)]
pub struct SongQueryParams {
    pub favorites: Option<bool>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub rating_min: Option<i32>,
    pub title_search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub page: Option<i32>,
    pub page_size: Option<i32>,
    pub media_blob_id: Option<String>,
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,
}

// Pagination utilities

/// Calculate pagination metadata
pub fn calculate_pagination(
    total: i64,
    page: Option<i32>,
    page_size: Option<i32>,
    offset: Option<i64>,
    limit: Option<i64>,
) -> (Option<i32>, Option<i32>, Option<i32>, bool, bool, i64, i64) {
    // Determine effective page_size
    let effective_page_size = if let Some(ps) = page_size {
        ps.max(1).min(1000) // Limit page size between 1 and 1000
    } else if let Some(l) = limit {
        l.max(1).min(1000) as i32
    } else {
        100 // Default page size
    };

    // Determine effective page and offset
    let (effective_page, effective_offset) = if let Some(p) = page {
        let page_num = p.max(1);
        let calculated_offset = ((page_num - 1) * effective_page_size) as i64;
        (Some(page_num), calculated_offset)
    } else if let Some(o) = offset {
        let offset_val = o.max(0);
        let calculated_page = (offset_val / effective_page_size as i64) + 1;
        (Some(calculated_page as i32), offset_val)
    } else {
        (Some(1), 0)
    };

    let total_pages = if total > 0 {
        Some(((total as f64) / (effective_page_size as f64)).ceil() as i32)
    } else {
        Some(0)
    };

    let has_next = if let (Some(page_num), Some(total_p)) = (effective_page, total_pages) {
        page_num < total_p
    } else {
        effective_offset + (effective_page_size as i64) < total
    };

    let has_prev = if let Some(page_num) = effective_page {
        page_num > 1
    } else {
        effective_offset > 0
    };

    (
        effective_page,
        Some(effective_page_size),
        total_pages,
        has_next,
        has_prev,
        effective_offset,
        effective_page_size as i64,
    )
}

/// Convert page-based parameters to offset/limit for database queries
pub fn resolve_pagination_params(params: &SongQueryParams) -> (Option<i64>, Option<i64>) {
    let (_, _, _, _, _, offset, limit) = calculate_pagination(
        0, // total doesn't matter for this calculation
        params.page,
        params.page_size,
        params.offset,
        params.limit,
    );
    (Some(offset), Some(limit))
}

/// Convert page-based parameters to offset/limit for playlist queries
pub fn resolve_playlist_pagination_params(
    params: &PlaylistQueryParams,
) -> (Option<i64>, Option<i64>) {
    let (_, _, _, _, _, offset, limit) = calculate_pagination(
        0, // total doesn't matter for this calculation
        params.page,
        params.page_size,
        params.offset,
        params.limit,
    );
    (Some(offset), Some(limit))
}

impl From<SongQueryParams> for SongQuery {
    fn from(params: SongQueryParams) -> Self {
        use crate::media::sorting::{
            normalize_sort_direction, validate_sort_field, DEFAULT_SORT_DIRECTION,
            DEFAULT_SORT_FIELD,
        };

        // Resolve pagination parameters (page/page_size take precedence over offset/limit)
        let (resolved_offset, resolved_limit) = resolve_pagination_params(&params);

        // Handle sorting with defaults
        let sort_field = params.sort_by.as_deref().unwrap_or(DEFAULT_SORT_FIELD);
        let sort_direction = normalize_sort_direction(
            params
                .sort_direction
                .as_deref()
                .unwrap_or(DEFAULT_SORT_DIRECTION),
        );

        Self {
            // Basic filters
            artist: params.artist,
            album: params.album,
            album_artist: None,
            genre: params.genre,
            title_search: params.title_search,

            // Numeric filters
            year: params.year,
            rating_min: params.rating_min,
            rating_max: None,
            bpm_min: None,
            bpm_max: None,

            // Duration filters
            duration_min: None,
            duration_max: None,

            // Boolean filters
            favorites_only: params.favorites,
            has_thumbnail: None,
            has_waveform: None,

            // Array filters
            tags: None,

            // Date filters
            created_after: None,
            updated_after: None,

            // JSONB filters
            metadata_filter: None,

            // Musical filters
            key_signature: None,

            // Media blob filter
            media_blob_id: params.media_blob_id,

            // Pagination (use resolved values)
            limit: resolved_limit,
            offset: resolved_offset,

            // Ordering - use shared sorting logic
            order_by: validate_sort_field(sort_field).map(|s| s.to_string()),
            order_direction: Some(sort_direction.to_string()),
        }
    }
}

/// Playlist query parameters for API
#[derive(Debug, Deserialize, Clone)]
pub struct PlaylistQueryParams {
    pub public_only: Option<bool>,
    pub title_search: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub page: Option<i32>,
    pub page_size: Option<i32>,
}

/// Artist query parameters for API
#[derive(Debug, Deserialize, Clone)]
pub struct ArtistQueryParams {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub page: Option<i32>,
    pub page_size: Option<i32>,
}

/// Album query parameters for API
#[derive(Debug, Deserialize, Clone)]
pub struct AlbumQueryParams {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
    pub page: Option<i32>,
    pub page_size: Option<i32>,
}

/// Album list response with pagination metadata
#[derive(Debug, Serialize)]
pub struct AlbumListResponse {
    pub albums: Vec<AlbumSummaryResponse>,
    pub total: i64,
    pub page: Option<i32>,
    pub page_size: Option<i32>,
    pub total_pages: Option<i32>,
    pub has_next: bool,
    pub has_prev: bool,
}

impl From<PlaylistQueryParams> for PlaylistQuery {
    fn from(params: PlaylistQueryParams) -> Self {
        // Resolve pagination parameters (page/page_size take precedence over offset/limit)
        let (resolved_offset, resolved_limit) = resolve_playlist_pagination_params(&params);

        Self {
            public_only: params.public_only,
            client_id: None,
            title_search: params.title_search,
            limit: resolved_limit,
            offset: resolved_offset,
            ..Default::default()
        }
    }
}

/// Create playlist request
#[derive(Debug, Clone, Deserialize)]
pub struct CreatePlaylistRequest {
    pub title: String,
    pub description: Option<String>,
    pub is_public: Option<bool>,
    pub is_collaborative: Option<bool>,
    pub song_ids: Option<Vec<Uuid>>,
    pub media_blob_id: Option<String>,
    pub thumbnail_blob_id: Option<String>,
}

impl From<CreatePlaylistRequest> for CreatePlaylist {
    fn from(req: CreatePlaylistRequest) -> Self {
        Self {
            title: req.title,
            description: req.description,
            client_id: Some("web".to_string()),
            is_public: req.is_public,
            is_collaborative: req.is_collaborative,
            metadata: None,
            media_blob_id: req.media_blob_id,
            thumbnail_blob_id: req.thumbnail_blob_id,
        }
    }
}

/// Update playlist request
#[derive(Debug, Deserialize)]
pub struct UpdatePlaylistRequest {
    pub title: Option<String>,
    pub description: Option<String>,
    pub is_public: Option<bool>,
    pub is_collaborative: Option<bool>,
    pub media_blob_id: Option<String>,
    pub thumbnail_blob_id: Option<String>,
}

impl From<UpdatePlaylistRequest> for UpdatePlaylist {
    fn from(req: UpdatePlaylistRequest) -> Self {
        Self {
            title: req.title,
            description: req.description,
            is_public: req.is_public,
            is_collaborative: req.is_collaborative,
            metadata: None,
            media_blob_id: req.media_blob_id,
            thumbnail_blob_id: req.thumbnail_blob_id,
        }
    }
}

/// Add songs to playlist request
#[derive(Debug, Deserialize)]
pub struct AddSongsRequest {
    pub song_ids: Vec<Uuid>,
}

/// Move song in playlist request
#[derive(Debug, Deserialize)]
pub struct MoveSongRequest {
    pub song_id: Uuid,
    pub to_position: i32,
}

/// Reorder playlist request
#[derive(Debug, Deserialize)]
pub struct ReorderPlaylistRequest {
    pub song_ids: Vec<Uuid>,
}

/// Create playlist from album request
#[derive(Debug, Deserialize)]
pub struct CreatePlaylistFromAlbumRequest {
    pub title: Option<String>,
    pub is_public: Option<bool>,
}

/// Album summary response
#[derive(Debug, Serialize)]
pub struct AlbumSummaryResponse {
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

impl From<AlbumSummary> for AlbumSummaryResponse {
    fn from(album: AlbumSummary) -> Self {
        let formatted_duration = album.formatted_total_duration();
        let primary_artist = album.primary_artist().cloned();
        Self {
            album: album.album,
            artist: primary_artist,
            year: album.year,
            track_count: album.track_count,
            disc_count: album.disc_count,
            total_duration: formatted_duration,
            genres: album.genres,
            avg_rating: album.avg_rating,
            favorite_count: album.favorite_count,
            album_thumbnail_id: album.album_thumbnail_id,
        }
    }
}

/// Album tracks request for POST endpoint
#[derive(Debug, Deserialize)]
pub struct AlbumTracksRequest {
    pub album: String,
    pub artist: Option<String>,
}

/// Album tracks response
#[derive(Debug, Serialize)]
pub struct AlbumTracksResponse {
    pub album: String,
    pub artist: Option<String>,
    pub tracks: Vec<AlbumTrackResponse>,
}

/// Album track response
#[derive(Debug, Serialize)]
pub struct AlbumTrackResponse {
    pub song_id: Uuid,
    pub title: String,
    pub artist: Option<String>,
    pub disc_number: Option<i32>,
    pub track_number: Option<i32>,
    pub duration: Option<i64>,
    pub genre: Option<String>,
    pub year: Option<i32>,
    pub rating: Option<i32>,
    pub is_favorite: bool,
    pub media_blob_id: String,
    pub thumbnail_id: Option<String>,
    pub waveform_id: Option<String>,
    pub track_display: String,
}

impl From<AlbumTrack> for AlbumTrackResponse {
    fn from(track: AlbumTrack) -> Self {
        let duration_seconds = track.duration_seconds();
        let track_display = track.track_display();
        Self {
            song_id: track.song_id,
            title: track.title.clone(),
            artist: track.artist,
            disc_number: track.disc_number,
            track_number: track.track_number,
            duration: duration_seconds,
            genre: track.genre,
            year: track.year,
            rating: track.rating,
            is_favorite: track.is_favorite,
            media_blob_id: track.media_blob_id,
            thumbnail_id: track.thumbnail_id,
            waveform_id: track.waveform_id,
            track_display,
        }
    }
}

/// Playlist summary response
#[derive(Debug, Serialize)]
pub struct PlaylistSummaryResponse {
    #[serde(flatten)]
    pub playlist: PlaylistResponse,
    pub song_count: i64,
    pub total_duration: Option<String>,
    pub song_preview: String,
}

impl From<PlaylistSummary> for PlaylistSummaryResponse {
    fn from(summary: PlaylistSummary) -> Self {
        Self {
            playlist: PlaylistResponse::from(summary.to_playlist()),
            song_count: summary.song_count,
            total_duration: summary.formatted_total_duration(),
            song_preview: summary.song_preview(),
        }
    }
}

/// Playlist songs response
#[derive(Debug, Serialize)]
pub struct PlaylistSongsResponse {
    pub playlist: PlaylistResponse,
    pub songs: Vec<PlaylistSongResponse>,
}

/// Playlist song response with position
#[derive(Debug, Serialize)]
pub struct PlaylistSongResponse {
    pub position: i32,
    pub song: SongResponse,
    pub added_at: String,
}

/// Update song request
#[derive(Debug, Deserialize)]
pub struct UpdateSongRequest {
    pub is_favorite: Option<bool>,
    pub rating: Option<i32>,
}

// user preference request types
#[derive(Debug, Deserialize)]
pub struct UpdateUserPreferenceRequest {
    pub is_favorite: Option<bool>,
    pub rating: Option<i32>,
}

#[derive(Debug, Deserialize)]
pub struct BulkUpdateUserPreferencesRequest {
    pub song_ids: Vec<Uuid>,
    pub updates: UpdateUserPreferenceRequest,
}

/// Delete songs request
#[derive(Debug, Deserialize)]
pub struct DeleteSongsRequest {
    pub song_ids: Vec<String>,
}

// user preference response types
#[derive(Debug, Serialize)]
pub struct UserPreferenceResponse {
    pub user_id: Uuid,
    pub song_id: Uuid,
    pub is_favorite: bool,
    pub rating: Option<i32>,
    pub updated_at: String,
}

impl From<UserSongPreference> for UserPreferenceResponse {
    fn from(pref: UserSongPreference) -> Self {
        Self {
            user_id: pref.user_id,
            song_id: pref.song_id,
            is_favorite: pref.is_favorite,
            rating: pref.rating,
            updated_at: pref.updated_at.format(&Rfc3339).unwrap_or_default(),
        }
    }
}

impl From<UpdateUserPreferenceRequest> for GrimoireUpdateUserPreferenceRequest {
    fn from(req: UpdateUserPreferenceRequest) -> Self {
        Self {
            is_favorite: req.is_favorite,
            rating: req.rating,
        }
    }
}

impl From<BulkUpdateUserPreferencesRequest> for BulkUpdatePreferencesRequest {
    fn from(req: BulkUpdateUserPreferencesRequest) -> Self {
        Self {
            song_ids: req.song_ids,
            updates: req.updates.into(),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct BulkUserPreferenceResponse {
    pub message: String,
    pub updated_preferences: Vec<UserPreferenceResponse>,
}

/// Bulk song metadata update response
#[derive(Debug, Serialize)]
pub struct BulkUpdateSongsResponse {
    pub message: String,
    pub updated_songs: Vec<SongResponse>,
    pub operations_summary: BulkOperationSummary,
}

#[derive(Debug, Serialize)]
pub struct BulkOperationSummary {
    pub total_songs: usize,
    pub successful_updates: usize,
    pub failed_updates: usize,
    pub tag_operations: Option<TagOperationSummary>,
}

#[derive(Debug, Serialize)]
pub struct TagOperationSummary {
    pub operation_type: String,
    pub tags_affected: Vec<String>,
    pub songs_modified: usize,
}

/// Song update response
#[derive(Debug, Serialize)]
pub struct SongUpdateResponse {
    pub message: String,
    pub song: SongResponse,
}

/// Artist summary response
#[derive(Debug, Serialize)]
pub struct ArtistSummary {
    pub artist: String,
    pub song_count: i64,
    pub album_count: i64,
    pub total_duration: i64,
    pub genres: Vec<String>,
    pub avg_rating: Option<f64>,
    pub favorite_count: i64,
}

/// Artists list response
#[derive(Debug, Serialize)]
pub struct ArtistsListResponse {
    pub artists: Vec<ArtistSummary>,
    pub total: i64,
    pub page: Option<i32>,
    pub page_size: Option<i32>,
    pub total_pages: Option<i32>,
    pub has_next: bool,
    pub has_prev: bool,
}

/// Artists filter request for POST endpoint
#[derive(Debug, Deserialize)]
pub struct ArtistsFilterRequest {
    pub tags: Option<Vec<String>>,
    pub query: Option<String>,
    pub page: Option<i32>,
    pub page_size: Option<i32>,
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,
}

/// Artists filter response
#[derive(Debug, Serialize)]
pub struct ArtistsFilterResponse {
    pub artists: Vec<ArtistSummary>,
    pub total: i64,
    pub page: i32,
    pub page_size: i32,
    pub total_pages: i32,
    pub has_next: bool,
    pub has_prev: bool,
}

/// Albums filter request for POST endpoint
#[derive(Debug, Deserialize)]
pub struct AlbumsFilterRequest {
    pub tags: Option<Vec<String>>,
    pub query: Option<String>,
    pub artist: Option<String>,
    pub year_min: Option<i32>,
    pub year_max: Option<i32>,
    pub page: Option<i32>,
    pub page_size: Option<i32>,
    pub sort_by: Option<String>,
    pub sort_direction: Option<String>,
}

/// Albums filter response
#[derive(Debug, Serialize)]
pub struct AlbumsFilterResponse {
    pub albums: Vec<AlbumSummaryResponse>,
    pub total: i64,
    pub page: i32,
    pub page_size: i32,
    pub total_pages: i32,
    pub has_next: bool,
    pub has_prev: bool,
}

// Route handlers

/// List songs
pub async fn list_songs(
    Extension(db): Extension<DatabaseConnection>,
    user: Option<Extension<AuthenticatedUser>>,
    Query(params): Query<SongQueryParams>,
) -> Result<Json<SongListResponse>, WebauthnError> {
    use crate::media::sorting::{
        normalize_sort_direction, validate_sort_field, DEFAULT_SORT_DIRECTION, DEFAULT_SORT_FIELD,
    };

    let repository = MusicRepository::new(db.pool().clone());
    let repository2 = MusicRepository::new(db.pool().clone());

    // Get total count for pagination metadata
    let total_count = repository2
        .get_song_count()
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    let mut query = SongQuery::from(params.clone());

    // Handle raw sorting for fields that don't have enum variants
    let sort_field = params.sort_by.as_deref().unwrap_or(DEFAULT_SORT_FIELD);
    let sort_direction = normalize_sort_direction(
        params
            .sort_direction
            .as_deref()
            .unwrap_or(DEFAULT_SORT_DIRECTION),
    );

    // Validate and apply sorting - all supported fields use string-based ordering
    if let Some(valid_field) = validate_sort_field(sort_field) {
        query.order_by = Some(valid_field.to_string());
        query.order_direction = Some(sort_direction.to_string());
    }

    let songs = repository
        .search_songs_with_user_context(user.map(|u| u.user().id), query)
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    let song_responses: Vec<SongResponse> = songs.into_iter().map(SongResponse::from).collect();

    // Calculate pagination metadata
    let (page, page_size, total_pages, has_next, has_prev, _, _) = calculate_pagination(
        total_count,
        params.page,
        params.page_size,
        params.offset,
        params.limit,
    );

    Ok(Json(SongListResponse {
        songs: song_responses,
        total: total_count,
        page,
        page_size,
        total_pages,
        has_next,
        has_prev,
    }))
}

/// Get song by ID
pub async fn get_song(
    Extension(db): Extension<DatabaseConnection>,
    Path(song_id): Path<Uuid>,
) -> Result<Json<SongResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let song = service
        .get_song(song_id)
        .await
        .map_err(|_| WebauthnError::UserNotFound)?;

    Ok(Json(SongResponse::from(song)))
}

/// Update song (favorite status, rating)
pub async fn update_song(
    Extension(db): Extension<DatabaseConnection>,
    Path(song_id): Path<Uuid>,
    Json(req): Json<UpdateSongRequest>,
) -> Result<Json<SongUpdateResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let mut updated_song = None;
    let mut actions: Vec<String> = Vec::new();

    if let Some(is_favorite) = req.is_favorite {
        let song = service
            .set_song_favorite(song_id, is_favorite)
            .await
            .map_err(|_| WebauthnError::DatabaseError)?;
        updated_song = Some(song);
        actions.push(if is_favorite {
            "favorited".to_string()
        } else {
            "unfavorited".to_string()
        });
    }

    if let Some(rating) = req.rating {
        let song = service
            .rate_song(song_id, Some(rating))
            .await
            .map_err(|_| WebauthnError::BadRequest)?;
        updated_song = Some(song);
        actions.push(format!("rated {}", rating));
    }

    let song = updated_song.ok_or(WebauthnError::BadRequest)?;
    let message = if actions.is_empty() {
        "No changes made".to_string()
    } else {
        format!("Song {}", actions.join(" and "))
    };

    Ok(Json(SongUpdateResponse {
        message,
        song: SongResponse::from(song),
    }))
}

/// Update user song preferences (favorite status, rating)
pub async fn update_song_preferences(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(song_id): Path<Uuid>,
    Json(req): Json<UpdateUserPreferenceRequest>,
) -> Result<Json<UserPreferenceResponse>, WebauthnError> {
    let user_id = user.user().id;

    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let preference = service
        .set_user_song_favorite(user_id, song_id, req.is_favorite.unwrap_or(false))
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    if let Some(rating) = req.rating {
        let preference = service
            .rate_user_song(user_id, song_id, Some(rating))
            .await
            .map_err(|_| WebauthnError::BadRequest)?;

        return Ok(Json(UserPreferenceResponse::from(preference)));
    }

    Ok(Json(UserPreferenceResponse::from(preference)))
}

/// Bulk update user preferences for multiple songs
pub async fn bulk_update_user_preferences(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<BulkUpdateUserPreferencesRequest>,
) -> Result<Json<BulkUserPreferenceResponse>, WebauthnError> {
    let user_id = user.user().id;

    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let preferences = service
        .bulk_update_user_preferences(user_id, req.into())
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    let updated_preferences = preferences
        .into_iter()
        .map(UserPreferenceResponse::from)
        .collect();

    Ok(Json(BulkUserPreferenceResponse {
        message: "preferences updated successfully".to_string(),
        updated_preferences,
    }))
}

/// Bulk update song metadata (admin-only)
pub async fn bulk_update_songs(
    Extension(db): Extension<DatabaseConnection>,
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<BulkUpdateSongsRequest>,
) -> Result<Json<BulkUpdateSongsResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    // Use grimoire service to update songs directly
    let updated_songs = service
        .bulk_update_songs(req)
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    let successful_updates = updated_songs.len();

    // Create operation summary
    let tag_operation_summary = updated_songs.first().and_then(|_| {
        // For now, create a simple summary - we could enhance this later
        Some(TagOperationSummary {
            operation_type: "bulk operation".to_string(),
            tags_affected: vec![], // Could extract from request if needed
            songs_modified: successful_updates,
        })
    });

    let summary = BulkOperationSummary {
        total_songs: successful_updates,
        successful_updates,
        failed_updates: 0, // grimoire handles failures internally
        tag_operations: tag_operation_summary,
    };

    let message = format!("successfully updated {} songs", successful_updates);

    let response_songs: Vec<SongResponse> =
        updated_songs.into_iter().map(SongResponse::from).collect();

    Ok(Json(BulkUpdateSongsResponse {
        message,
        updated_songs: response_songs,
        operations_summary: summary,
    }))
}

/// Delete songs (admin-only)
pub async fn delete_songs(
    Extension(user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Json(request): Json<DeleteSongsRequest>,
) -> Result<Json<HashMap<String, serde_json::Value>>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());

    let mut deleted_count = 0;
    for song_id in request.song_ids {
        let uuid = Uuid::parse_str(&song_id).map_err(|_| WebauthnError::BadRequest)?;

        if repository
            .delete_song(uuid, Some(user.user().id))
            .await
            .map_err(|_| WebauthnError::DatabaseError)?
        {
            deleted_count += 1;
        }
    }

    Ok(Json(HashMap::from([(
        "deleted_count".to_string(),
        serde_json::Value::Number(deleted_count.into()),
    )])))
}

/// List artists with summaries
pub async fn list_artists(
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<ArtistQueryParams>,
) -> Result<Json<ArtistsListResponse>, WebauthnError> {
    let _repository = MusicRepository::new(db.pool().clone());

    // Get total count of unique artists for pagination metadata
    let total_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(DISTINCT s.artist) FROM songs s WHERE s.artist IS NOT NULL",
    )
    .fetch_one(db.pool())
    .await
    .map_err(|e| WebauthnError::SqlxError(e))?;

    // Calculate pagination parameters
    let (_, _, _, _, _, offset, limit) = calculate_pagination(
        total_count,
        params.page,
        params.page_size,
        params.offset,
        params.limit,
    );

    // Get artists with their statistics with pagination
    let artists_data = sqlx::query!(
        r#"
        SELECT
            s.artist,
            COUNT(DISTINCT s.id) as song_count,
            COUNT(DISTINCT s.album) as album_count,
            COALESCE(SUM(EXTRACT(EPOCH FROM s.duration)), 0) as total_duration,
            AVG(s.rating) as avg_rating,
            COUNT(CASE WHEN s.is_favorite THEN 1 END) as favorite_count,
            ARRAY_AGG(DISTINCT s.genre) FILTER (WHERE s.genre IS NOT NULL) as genres
        FROM songs s
        WHERE s.artist IS NOT NULL
        GROUP BY s.artist
        ORDER BY s.artist ASC
        LIMIT $1 OFFSET $2
        "#,
        limit,
        offset
    )
    .fetch_all(db.pool())
    .await
    .map_err(|e| WebauthnError::SqlxError(e))?;

    let artists: Vec<ArtistSummary> = artists_data
        .into_iter()
        .map(|row| ArtistSummary {
            artist: row.artist.unwrap_or_default(),
            song_count: row.song_count.unwrap_or(0),
            album_count: row.album_count.unwrap_or(0),
            total_duration: row
                .total_duration
                .map(|d| d.to_string().parse::<f64>().unwrap_or(0.0) as i64)
                .unwrap_or(0),
            genres: row.genres.unwrap_or_default(),
            avg_rating: row
                .avg_rating
                .map(|r| r.to_string().parse::<f64>().unwrap_or(0.0)),
            favorite_count: row.favorite_count.unwrap_or(0),
        })
        .collect();

    // Calculate pagination metadata
    let (page, page_size, total_pages, has_next, has_prev, _, _) = calculate_pagination(
        total_count,
        params.page,
        params.page_size,
        params.offset,
        params.limit,
    );

    Ok(Json(ArtistsListResponse {
        artists,
        total: total_count,
        page,
        page_size,
        total_pages,
        has_next,
        has_prev,
    }))
}

/// Filter artists with tag support (POST /api/music/artists)
pub async fn filter_artists(
    Extension(db): Extension<DatabaseConnection>,
    Json(request): Json<ArtistsFilterRequest>,
) -> Result<Json<ArtistsFilterResponse>, WebauthnError> {
    use grimoire::music::repository::filters;

    // Calculate pagination parameters
    let page = request.page.unwrap_or(1);
    let page_size = request.page_size.unwrap_or(50);
    let offset = (page - 1) * page_size;

    // Get filtered artists count for pagination
    let total_count = filters::get_filtered_artists_count(
        db.pool(),
        request.tags.as_deref(),
        request.query.as_deref(),
    )
    .await
    .map_err(|_| WebauthnError::SqlxError(sqlx::Error::RowNotFound))?;

    // Get filtered artists
    let artists_data = filters::filter_artists(
        db.pool(),
        request.tags.as_deref(),
        request.query.as_deref(),
        request.sort_by.as_deref(),
        request.sort_direction.as_deref(),
        page_size as i64,
        offset as i64,
    )
    .await
    .map_err(|_| WebauthnError::SqlxError(sqlx::Error::RowNotFound))?;

    // Convert to ArtistSummary
    let artists: Vec<ArtistSummary> = artists_data
        .into_iter()
        .map(|result| ArtistSummary {
            artist: result.artist,
            song_count: result.song_count,
            album_count: result.album_count,
            total_duration: result.total_duration as i64,
            genres: result.genres,
            avg_rating: result.avg_rating,
            favorite_count: result.favorite_count,
        })
        .collect();

    // Calculate pagination metadata
    let total_pages = ((total_count as f64) / (page_size as f64)).ceil() as i32;
    let has_next = page < total_pages;
    let has_prev = page > 1;

    Ok(Json(ArtistsFilterResponse {
        artists,
        total: total_count,
        page,
        page_size,
        total_pages,
        has_next,
        has_prev,
    }))
}

/// Filter albums with tag support (POST /api/music/albums)
pub async fn filter_albums(
    Extension(db): Extension<DatabaseConnection>,
    Json(request): Json<AlbumsFilterRequest>,
) -> Result<Json<AlbumsFilterResponse>, WebauthnError> {
    use grimoire::music::repository::filters;

    // Calculate pagination parameters
    let page = request.page.unwrap_or(1);
    let page_size = request.page_size.unwrap_or(50);
    let offset = (page - 1) * page_size;

    // Get filtered albums count for pagination
    let total_count = filters::get_filtered_albums_count(
        db.pool(),
        request.tags.as_deref(),
        request.query.as_deref(),
        request.artist.as_deref(),
        request.year_min,
        request.year_max,
    )
    .await
    .map_err(|_| WebauthnError::SqlxError(sqlx::Error::RowNotFound))?;

    // Get filtered albums
    let albums = filters::filter_albums(
        db.pool(),
        request.tags.as_deref(),
        request.query.as_deref(),
        request.artist.as_deref(),
        request.year_min,
        request.year_max,
        request.sort_by.as_deref(),
        request.sort_direction.as_deref(),
        page_size as i64,
        offset as i64,
    )
    .await
    .map_err(|_| WebauthnError::SqlxError(sqlx::Error::RowNotFound))?;

    // Convert to AlbumSummaryResponse
    let responses: Vec<AlbumSummaryResponse> =
        albums.into_iter().map(AlbumSummaryResponse::from).collect();

    // Calculate pagination metadata
    let total_pages = ((total_count as f64) / (page_size as f64)).ceil() as i32;
    let has_next = page < total_pages;
    let has_prev = page > 1;

    Ok(Json(AlbumsFilterResponse {
        albums: responses,
        total: total_count,
        page,
        page_size,
        total_pages,
        has_next,
        has_prev,
    }))
}

/// List playlists
pub async fn list_playlists(
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<PlaylistQueryParams>,
) -> Result<Json<PlaylistListResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let repository2 = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    // Get total count for pagination metadata
    let total_count = repository2
        .get_playlist_count()
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    let query = PlaylistQuery::from(params.clone());
    let playlists = service
        .query_playlists(query)
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    let playlist_responses: Vec<PlaylistResponse> =
        playlists.into_iter().map(PlaylistResponse::from).collect();

    // Calculate pagination metadata
    let (page, page_size, total_pages, has_next, has_prev, _, _) = calculate_pagination(
        total_count,
        params.page,
        params.page_size,
        params.offset,
        params.limit,
    );

    Ok(Json(PlaylistListResponse {
        playlists: playlist_responses,
        total: total_count,
        page,
        page_size,
        total_pages,
        has_next,
        has_prev,
    }))
}

/// Get playlist by ID
pub async fn get_playlist(
    Extension(db): Extension<DatabaseConnection>,
    Path(playlist_id): Path<Uuid>,
) -> Result<Json<PlaylistResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let playlist = service
        .get_playlist(playlist_id)
        .await
        .map_err(|_| WebauthnError::UserNotFound)?;

    let song_count = service
        .get_playlist_song_count(playlist_id)
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    let mut response = PlaylistResponse::from(playlist);
    response.song_count = Some(song_count);

    Ok(Json(response))
}

/// Create playlist
pub async fn create_playlist(
    Extension(db): Extension<DatabaseConnection>,
    Json(req): Json<CreatePlaylistRequest>,
) -> Result<Json<PlaylistResponse>, WebauthnError> {
    tracing::debug!("Creating playlist with request: {:?}", req);

    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let song_ids = req.song_ids.clone().unwrap_or_default();
    let create_params = CreatePlaylist::from(req);

    tracing::debug!(
        "Creating playlist with params: {:?}, song_ids: {:?}",
        create_params,
        song_ids
    );

    let (playlist, _added_songs) = service
        .create_playlist_with_songs(create_params, Some(song_ids), Some("web".to_string()))
        .await
        .map_err(|e| {
            tracing::error!("Failed to create playlist: {:?}", e);
            WebauthnError::BadRequest
        })?;

    tracing::debug!("Successfully created playlist: {:?}", playlist);
    Ok(Json(PlaylistResponse::from(playlist)))
}

/// Update playlist
pub async fn update_playlist(
    Extension(db): Extension<DatabaseConnection>,
    Path(playlist_id): Path<Uuid>,
    Json(req): Json<UpdatePlaylistRequest>,
) -> Result<Json<PlaylistResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let update_params = UpdatePlaylist::from(req);
    let playlist = service
        .update_playlist(playlist_id, update_params)
        .await
        .map_err(|_| WebauthnError::BadRequest)?;

    Ok(Json(PlaylistResponse::from(playlist)))
}

/// Delete playlist
pub async fn delete_playlist(
    Extension(db): Extension<DatabaseConnection>,
    Path(playlist_id): Path<Uuid>,
) -> Result<StatusCode, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let _deleted = service
        .delete_playlist(playlist_id, None)
        .await
        .map_err(|_| WebauthnError::UserNotFound)?;

    Ok(StatusCode::NO_CONTENT)
}

/// Get playlist songs
pub async fn get_playlist_songs(
    Extension(db): Extension<DatabaseConnection>,
    Path(playlist_id): Path<Uuid>,
) -> Result<Json<PlaylistSongsResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let playlist = service
        .get_playlist(playlist_id)
        .await
        .map_err(|_| WebauthnError::UserNotFound)?;

    let playlist_songs = service
        .get_playlist_songs(playlist_id)
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    let songs: Vec<PlaylistSongResponse> = playlist_songs
        .into_iter()
        .map(|ps| PlaylistSongResponse {
            position: ps.position,
            song: SongResponse::from(ps.song),
            added_at: ps.added_at.to_string(),
        })
        .collect();

    Ok(Json(PlaylistSongsResponse {
        playlist: PlaylistResponse::from(playlist),
        songs,
    }))
}

/// Add songs to playlist
pub async fn add_songs_to_playlist(
    Extension(db): Extension<DatabaseConnection>,
    Path(playlist_id): Path<Uuid>,
    Json(req): Json<AddSongsRequest>,
) -> Result<Json<HashMap<String, serde_json::Value>>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let (added, skipped) = service
        .add_songs_to_playlist(playlist_id, req.song_ids, Some("web".to_string()))
        .await
        .map_err(|_| WebauthnError::BadRequest)?;

    let mut response = HashMap::new();
    response.insert("added_songs".to_string(), serde_json::json!(added));
    response.insert("skipped_songs".to_string(), serde_json::json!(skipped));
    response.insert(
        "message".to_string(),
        serde_json::json!(format!(
            "Added {} songs, skipped {} songs",
            added.len(),
            skipped.len()
        )),
    );

    Ok(Json(response))
}

/// Remove songs from playlist
pub async fn remove_songs_from_playlist(
    Extension(db): Extension<DatabaseConnection>,
    Path(playlist_id): Path<Uuid>,
    Json(req): Json<AddSongsRequest>, // Reuse the same request structure
) -> Result<Json<HashMap<String, serde_json::Value>>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let (removed_count, not_found) = service
        .remove_songs_from_playlist(playlist_id, req.song_ids)
        .await
        .map_err(|_| WebauthnError::BadRequest)?;

    let mut response = HashMap::new();
    response.insert(
        "removed_count".to_string(),
        serde_json::json!(removed_count),
    );
    response.insert("not_found_songs".to_string(), serde_json::json!(not_found));
    response.insert(
        "message".to_string(),
        serde_json::json!(format!(
            "Removed {} songs, {} not found in playlist",
            removed_count,
            not_found.len()
        )),
    );

    Ok(Json(response))
}

/// Move song in playlist
pub async fn move_song_in_playlist(
    Extension(db): Extension<DatabaseConnection>,
    Path(playlist_id): Path<Uuid>,
    Json(req): Json<MoveSongRequest>,
) -> Result<Json<HashMap<String, serde_json::Value>>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    service
        .move_playlist_song(playlist_id, req.song_id, req.to_position)
        .await
        .map_err(|_| WebauthnError::BadRequest)?;

    let mut response = HashMap::new();
    response.insert(
        "message".to_string(),
        serde_json::json!(format!(
            "Moved song {} to position {}",
            req.song_id, req.to_position
        )),
    );

    Ok(Json(response))
}

/// Reorder playlist
pub async fn reorder_playlist(
    Extension(db): Extension<DatabaseConnection>,
    Path(playlist_id): Path<Uuid>,
    Json(req): Json<ReorderPlaylistRequest>,
) -> Result<Json<HashMap<String, serde_json::Value>>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    service
        .reorder_playlist(playlist_id, &req.song_ids)
        .await
        .map_err(|_| WebauthnError::BadRequest)?;

    let mut response = HashMap::new();
    response.insert(
        "message".to_string(),
        serde_json::json!(format!("Reordered {} songs", req.song_ids.len())),
    );

    Ok(Json(response))
}

/// Get playlist summaries
pub async fn get_playlist_summaries(
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<Vec<PlaylistSummaryResponse>>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let limit = params
        .get("limit")
        .and_then(|l| l.parse::<i64>().ok())
        .or(Some(20));

    let summaries = service
        .get_playlist_summaries(limit)
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    let responses: Vec<PlaylistSummaryResponse> = summaries
        .into_iter()
        .map(PlaylistSummaryResponse::from)
        .collect();

    Ok(Json(responses))
}

/// Get album summaries
pub async fn get_album_summaries(
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<AlbumQueryParams>,
) -> Result<Json<AlbumListResponse>, WebauthnError> {
    tracing::debug!("get_album_summaries called with params: {:?}", params);

    let _repository = MusicRepository::new(db.pool().clone());
    let _service = PlaylistService::new(_repository);

    // Get total count of unique albums for pagination metadata
    let total_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(DISTINCT s.album) FROM songs s WHERE s.album IS NOT NULL",
    )
    .fetch_one(db.pool())
    .await
    .map_err(|e| WebauthnError::SqlxError(e))?;

    // Calculate pagination parameters
    let (_, _, _, _, _, offset, limit) = calculate_pagination(
        total_count,
        params.page,
        params.page_size,
        params.offset,
        params.limit,
    );

    // Get albums directly with pagination since service doesn't support offset
    let albums = sqlx::query_as::<_, AlbumSummary>(
        "SELECT * FROM album_summary ORDER BY year DESC NULLS LAST, album LIMIT $1 OFFSET $2",
    )
    .bind(limit)
    .bind(offset)
    .fetch_all(db.pool())
    .await
    .map_err(|e| {
        tracing::error!("Error getting album summaries: {:?}", e);
        WebauthnError::SqlxError(e)
    })?;

    tracing::debug!("Got {} albums from service", albums.len());

    let responses: Vec<AlbumSummaryResponse> =
        albums.into_iter().map(AlbumSummaryResponse::from).collect();

    // Calculate pagination metadata
    let (page, page_size, total_pages, has_next, has_prev, _, _) = calculate_pagination(
        total_count,
        params.page,
        params.page_size,
        params.offset,
        params.limit,
    );

    tracing::debug!("Converted to {} responses", responses.len());

    Ok(Json(AlbumListResponse {
        albums: responses,
        total: total_count,
        page,
        page_size,
        total_pages,
        has_next,
        has_prev,
    }))
}

/// Get album tracks
pub async fn get_album_tracks(
    Extension(db): Extension<DatabaseConnection>,
    Path(album): Path<String>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<AlbumTracksResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let artist = params.get("artist").map(|s| s.as_str());

    let tracks = service
        .get_album_tracks(&album, artist)
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    let track_responses: Vec<AlbumTrackResponse> =
        tracks.into_iter().map(AlbumTrackResponse::from).collect();

    Ok(Json(AlbumTracksResponse {
        album: album.clone(),
        artist: artist.map(|s| s.to_string()),
        tracks: track_responses,
    }))
}

/// Get album tracks via POST request
pub async fn get_album_tracks_post(
    Extension(db): Extension<DatabaseConnection>,
    Json(request): Json<AlbumTracksRequest>,
) -> Result<Json<AlbumTracksResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let tracks = service
        .get_album_tracks(&request.album, request.artist.as_deref())
        .await
        .map_err(|_| WebauthnError::DatabaseError)?;

    let track_responses: Vec<AlbumTrackResponse> =
        tracks.into_iter().map(AlbumTrackResponse::from).collect();

    Ok(Json(AlbumTracksResponse {
        album: request.album,
        artist: request.artist,
        tracks: track_responses,
    }))
}

/// Create playlist from album
pub async fn create_playlist_from_album(
    Extension(db): Extension<DatabaseConnection>,
    Path(album): Path<String>,
    Query(params): Query<HashMap<String, String>>,
    Json(req): Json<CreatePlaylistFromAlbumRequest>,
) -> Result<Json<PlaylistResponse>, WebauthnError> {
    let repository = MusicRepository::new(db.pool().clone());
    let service = PlaylistService::new(repository);

    let artist = params.get("artist").map(|s| s.as_str());
    let title = req.title.unwrap_or_else(|| match artist {
        Some(artist) => format!("{} - {}", artist, album),
        None => album.clone(),
    });

    let playlist = service
        .create_playlist_from_album(
            title,
            &album,
            artist,
            req.is_public,
            Some("web".to_string()),
        )
        .await
        .map_err(|_| WebauthnError::BadRequest)?;

    Ok(Json(PlaylistResponse::from(playlist)))
}

/// Get songs by artist
pub async fn get_artist_songs(
    Extension(db): Extension<DatabaseConnection>,
    Path(artist): Path<String>,
    Query(params): Query<SongQueryParams>,
) -> Result<Json<SongListResponse>, WebauthnError> {
    // Get total count for this artist for pagination metadata
    let total_count = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM songs WHERE artist = $1 AND deleted_at IS NULL",
    )
    .bind(&artist)
    .fetch_one(db.pool())
    .await
    .map_err(|e| WebauthnError::SqlxError(e))?;

    // Calculate pagination parameters
    let (_, _, _, _, _, offset, limit) = calculate_pagination(
        total_count,
        params.page,
        params.page_size,
        params.offset,
        params.limit,
    );

    // Get songs with pagination
    let songs = sqlx::query_as::<_, Song>(
        "SELECT * FROM songs WHERE artist = $1 AND deleted_at IS NULL ORDER BY album, track_number, title LIMIT $2 OFFSET $3"
    )
    .bind(&artist)
    .bind(limit)
    .bind(offset)
    .fetch_all(db.pool())
    .await
    .map_err(|_| WebauthnError::DatabaseError)?;

    let song_responses: Vec<SongResponse> = songs.into_iter().map(SongResponse::from).collect();

    // Calculate pagination metadata
    let (page, page_size, total_pages, has_next, has_prev, _, _) = calculate_pagination(
        total_count,
        params.page,
        params.page_size,
        params.offset,
        params.limit,
    );

    Ok(Json(SongListResponse {
        songs: song_responses,
        total: total_count,
        page,
        page_size,
        total_pages,
        has_next,
        has_prev,
    }))
}

/// Upload media blob request structure
#[derive(Debug, Deserialize)]
pub struct UploadMediaBlobRequest {
    pub filename: String,
    pub mime_type: Option<String>,
    pub metadata: Option<serde_json::Value>,
}

/// Upload media blob response structure
#[derive(Debug, Serialize)]
pub struct UploadMediaBlobResponse {
    pub id: String,
    pub sha256: String,
    pub size: Option<i64>,
    pub mime: Option<String>,
    pub created_at: OffsetDateTime,
    pub message: String,
}

/// Upload a media blob via HTTP (for files under 10MB)
pub async fn upload_media_blob(
    Extension(db): Extension<DatabaseConnection>,
    Extension(config): Extension<AppConfig>,
    mut multipart: Multipart,
) -> Result<Json<UploadMediaBlobResponse>, StatusCode> {
    let mut file_data: Option<Vec<u8>> = None;
    let mut filename: Option<String> = None;
    let mut mime_type: Option<String> = None;
    let mut metadata: Option<serde_json::Value> = None;

    // Parse multipart form data
    info!("Starting multipart parsing for media blob upload");

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        error!("Failed to read multipart field: {}", e);
        error!("Multipart parsing error details: {:?}", e);
        StatusCode::BAD_REQUEST
    })? {
        let field_name = field.name().unwrap_or("").to_string();
        info!("Processing multipart field: {}", field_name);

        match field_name.as_str() {
            "file" => {
                let file_filename = field.file_name().map(|s| s.to_string());
                let file_content_type = field.content_type().map(|s| s.to_string());

                info!(
                    "File field - filename: {:?}, content_type: {:?}",
                    file_filename, file_content_type
                );

                let data = field.bytes().await.map_err(|e| {
                    error!("Failed to read file data: {}", e);
                    error!("File data read error details: {:?}", e);
                    StatusCode::BAD_REQUEST
                })?;

                info!("Successfully read file data: {} bytes", data.len());

                // Validate file size (must be under 10MB for blob storage)
                if data.len() as u64 > config.media.max_blob_file_size {
                    error!(
                        "File size {} bytes exceeds maximum blob size {} bytes",
                        data.len(),
                        config.media.max_blob_file_size
                    );
                    return Err(StatusCode::PAYLOAD_TOO_LARGE);
                }

                file_data = Some(data.to_vec());
                if filename.is_none() {
                    filename = file_filename;
                }
                if mime_type.is_none() {
                    mime_type = file_content_type;
                }
            }
            "filename" => {
                let text = field.text().await.map_err(|e| {
                    error!("Failed to read filename field: {}", e);
                    error!("Filename field error details: {:?}", e);
                    StatusCode::BAD_REQUEST
                })?;
                info!("Filename field: {}", text);
                filename = Some(text);
            }
            "mime_type" => {
                let text = field.text().await.map_err(|e| {
                    error!("Failed to read mime_type field: {}", e);
                    error!("Mime type field error details: {:?}", e);
                    StatusCode::BAD_REQUEST
                })?;
                info!("Mime type field: {}", text);
                mime_type = Some(text);
            }
            "metadata" => {
                let text = field.text().await.map_err(|e| {
                    error!("Failed to read metadata field: {}", e);
                    error!("Metadata field error details: {:?}", e);
                    StatusCode::BAD_REQUEST
                })?;
                info!("Metadata field: {}", text);
                metadata = Some(serde_json::from_str(&text).map_err(|e| {
                    error!("Invalid metadata JSON: {}", e);
                    StatusCode::BAD_REQUEST
                })?);
            }
            _ => {
                // Ignore unknown fields
                warn!("Unknown multipart field: {}", field_name);
                // Try to consume the field data to avoid issues
                let _ = field.bytes().await;
            }
        }
    }

    info!("Multipart parsing completed");

    // Validate required fields
    let data = file_data.ok_or_else(|| {
        error!("No file data provided");
        StatusCode::BAD_REQUEST
    })?;

    let filename = filename.unwrap_or_else(|| "unnamed".to_string());

    // Calculate SHA256 hash
    let sha256 = {
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        hasher.update(&data);
        format!("{:x}", hasher.finalize())
    };

    // Create media blob
    let create_params = CreateMediaBlob {
        data: Some(data.clone()),
        sha256: sha256.clone(),
        size: Some(data.len() as i64),
        mime: mime_type.clone(),
        source_client_id: Some("http-upload".to_string()),
        local_path: None,
        parent_blob_id: None,
        blob_type: Some("original".to_string()),
        content_id: None,
        metadata: metadata.unwrap_or_else(|| {
            serde_json::json!({
                "filename": filename,
                "upload_method": "http"
            })
        }),
    };

    // Create media service and upload blob
    let media_repository = crate::media::MediaRepository::new(&db);
    let media_service = MediaService::new(media_repository);

    let created_blob = media_service
        .create_blob(create_params, &config.media)
        .await
        .map_err(|e| {
            error!("Failed to create media blob: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    // Enqueue thumbnail generation if applicable
    if let Some(ref mime) = created_blob.mime {
        if mime.starts_with("image/") || mime.starts_with("video/") {
            let thumbnail_service = ThumbnailService::new_with_defaults(&db);
            match thumbnail_service
                .auto_enqueue_for_media_blob(&created_blob.id)
                .await
            {
                Ok(job_ids) => {
                    info!(
                        "🖼️ Enqueued {} thumbnail jobs for blob {}: {:?}",
                        job_ids.len(),
                        created_blob.id,
                        job_ids
                    );
                }
                Err(e) => {
                    warn!(
                        "⚠️ Failed to enqueue thumbnail jobs for blob {}: {}",
                        created_blob.id, e
                    );
                }
            }
        }
    }

    info!(
        "✅ Successfully uploaded media blob {} via HTTP (size: {} bytes, mime: {:?})",
        created_blob.id,
        created_blob.size.unwrap_or(0),
        created_blob.mime
    );

    Ok(Json(UploadMediaBlobResponse {
        id: created_blob.id,
        sha256: created_blob.sha256,
        size: created_blob.size,
        mime: created_blob.mime,
        created_at: created_blob.created_at,
        message: "Media blob uploaded successfully".to_string(),
    }))
}

/// Create the router for song and playlist routes
pub fn create_routes() -> Router {
    Router::new()
        // Song routes
        .route("/songs", get(list_songs))
        .route("/songs/{song_id}", get(get_song))
        .route("/songs/{song_id}", put(update_song))
        // User preference routes
        .route("/songs/{song_id}/preferences", put(update_song_preferences))
        .route("/songs/preferences/bulk", put(bulk_update_user_preferences))
        // Artist routes
        .route("/artists", get(list_artists).post(filter_artists))
        .route("/artists/{artist}/songs", get(get_artist_songs))
        // Playlist routes
        .route("/playlists", get(list_playlists))
        .route("/playlists", post(create_playlist))
        .route("/playlists/{playlist_id}", get(get_playlist))
        .route("/playlists/{playlist_id}", put(update_playlist))
        .route("/playlists/{playlist_id}", delete(delete_playlist))
        .route("/playlists/{playlist_id}/songs", get(get_playlist_songs))
        .route(
            "/playlists/{playlist_id}/songs",
            post(add_songs_to_playlist),
        )
        .route(
            "/playlists/{playlist_id}/songs",
            delete(remove_songs_from_playlist),
        )
        .route(
            "/playlists/{playlist_id}/songs/move",
            put(move_song_in_playlist),
        )
        .route("/playlists/{playlist_id}/reorder", put(reorder_playlist))
        // Enhanced views and summaries
        .route("/playlists/summaries", get(get_playlist_summaries))
        .route("/albums", get(get_album_summaries).post(filter_albums))
        .route("/albums/tracks", post(get_album_tracks_post))
        .route("/albums/{album}/tracks", get(get_album_tracks))
        .route(
            "/albums/{album}/create-playlist",
            post(create_playlist_from_album),
        )
        // Media blob upload route (with increased body limit)
        .route(
            "/upload_media_blob",
            post(upload_media_blob).layer(DefaultBodyLimit::max(10 * 1024 * 1024)), // 10MB limit for media blobs
        )
        // Bulk song metadata update route (admin-only)
        .route(
            "/songs/bulk",
            put(bulk_update_songs).layer(axum_middleware::from_fn(require_admin)),
        )
        // Delete songs route (admin-only)
        .route(
            "/songs/delete",
            post(delete_songs).layer(axum_middleware::from_fn(require_admin)),
        )
        // Download routes
        .route(
            "/download-urls",
            post(download_urls).layer(axum_middleware::from_fn(require_admin)),
        )
        .route("/download-job-status/{job_id}", get(get_job_status))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_song_response_conversion() {
        use grimoire::music::Song;
        use time::OffsetDateTime;

        let song = Song {
            id: Uuid::new_v4(),
            media_blob_id: "abc1234".to_string(),
            thumbnail_blob_id: None,
            waveform_blob_id: None,
            thumbnail_blob_ids: None,
            title: "Test Song".to_string(),
            artist: Some("Test Artist".to_string()),
            album: Some("Test Album".to_string()),
            album_artist: None,
            track_number: Some(1),
            disc_number: Some(1),
            duration: None,
            genre: Some("Rock".to_string()),
            year: Some(2023),
            bpm: None,
            key_signature: None,
            rating: Some(5),
            is_favorite: true,
            tags: vec!["rock".to_string(), "classic".to_string()],
            metadata: serde_json::Value::Null,
            deleted_at: None,
            deleted_by: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
            version: 1,
        };

        let response = SongResponse::from(song.clone());
        assert_eq!(response.id, song.id);
        assert_eq!(response.title, song.title);
        assert_eq!(response.display_title, "Test Artist - Test Song");
        assert_eq!(
            response.detailed_display_title,
            "Test Artist - Test Song (Test Album)"
        );
    }
}
