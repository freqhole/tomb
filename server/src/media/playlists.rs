//! Playlist preferences and ownership HTTP API handlers
//!
//! This module provides REST API endpoints for managing playlist user preferences
//! and ownership operations.

use axum::{
    extract::{Extension, Path},
    http::StatusCode,
    response::Json,
    routing::{get, patch, post, put},
    Router,
};
use grimoire::music::models::{
    AlbumFavoriteStatus, BulkFavoriteAlbumRequest, PlaylistOwnership, PlaylistWithUserContext,
    TransferPlaylistOwnershipRequest, UpdateUserPlaylistPreferenceRequest, UserPlaylistPreference,
    UserSongPreference,
};
use grimoire::music::MusicRepository;
use grimoire::DatabaseConnection;
use serde::{Deserialize, Serialize};
use time::format_description::well_known::Rfc3339;
use tracing::{error, info};
use uuid::Uuid;

use crate::auth::AuthenticatedUser;

/// playlist preference response for API
#[derive(Debug, Serialize)]
pub struct PlaylistPreferenceResponse {
    pub user_id: Uuid,
    pub playlist_id: Uuid,
    pub is_favorite: bool,
    pub updated_at: String,
}

/// playlist ownership response for API
#[derive(Debug, Serialize)]
pub struct PlaylistOwnershipResponse {
    pub playlist_id: Uuid,
    pub owner_user_id: Uuid,
    pub created_at: String,
}

/// playlist with user context response for API
#[derive(Debug, Serialize)]
pub struct PlaylistWithUserContextResponse {
    pub id: Uuid,
    pub title: String,
    pub description: Option<String>,
    pub song_count: i64,
    pub total_duration_seconds: Option<i64>,
    pub created_at: String,
    pub updated_at: String,
    pub user_is_favorite: bool,
    pub preference_updated_at: Option<String>,
    pub is_owned_by_user: bool,
    pub owner_user_id: Option<Uuid>,
    pub ownership_created_at: Option<String>,
}

/// album favorite status response for API
#[derive(Debug, Serialize)]
pub struct AlbumFavoriteStatusResponse {
    pub album: String,
    pub total_songs: u32,
    pub favorited_songs: u32,
    pub is_fully_favorited: bool,
}

/// bulk update response for API
#[derive(Debug, Serialize)]
pub struct BulkPreferenceUpdateResponse {
    pub updated_count: usize,
    pub preferences: Vec<UserPreferenceResponse>,
}

/// user preference response for songs (reused from songs.rs pattern)
#[derive(Debug, Serialize)]
pub struct UserPreferenceResponse {
    pub user_id: Uuid,
    pub song_id: Uuid,
    pub is_favorite: bool,
    pub rating: Option<i32>,
    pub updated_at: String,
}

/// update playlist preference request
#[derive(Debug, Deserialize)]
pub struct UpdatePlaylistPreferenceRequest {
    pub is_favorite: bool,
}

/// transfer ownership request
#[derive(Debug, Deserialize)]
pub struct TransferOwnershipRequest {
    pub to_user_id: Uuid,
}

/// bulk favorite album request
#[derive(Debug, Deserialize)]
pub struct BulkFavoriteAlbumRequestApi {
    pub album: String,
    pub is_favorite: bool,
}

/// bulk favorite playlist songs request
#[derive(Debug, Deserialize)]
pub struct BulkFavoritePlaylistRequest {
    pub is_favorite: bool,
}

// API handlers

/// update playlist preference for authenticated user
pub async fn update_playlist_preference(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(playlist_id): Path<Uuid>,
    Json(request): Json<UpdatePlaylistPreferenceRequest>,
) -> Result<Json<PlaylistPreferenceResponse>, StatusCode> {
    let music_repository = MusicRepository::new(db.pool().clone());
    let grimoire_request = UpdateUserPlaylistPreferenceRequest {
        is_favorite: request.is_favorite,
    };

    match music_repository
        .update_user_playlist_preference(user.user().id, playlist_id, grimoire_request)
        .await
    {
        Ok(preference) => {
            info!(
                "updated playlist preference for user {} on playlist {}: favorite={}",
                user.user().id,
                playlist_id,
                preference.is_favorite
            );
            Ok(Json(preference.into()))
        }
        Err(e) => {
            error!(
                "failed to update playlist preference for user {} on playlist {}: {}",
                user.user().id,
                playlist_id,
                e
            );
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// get user's playlist preferences
pub async fn get_user_playlist_preferences(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<PlaylistPreferenceResponse>>, StatusCode> {
    let music_repository = MusicRepository::new(db.pool().clone());
    match music_repository
        .get_user_playlist_preferences(user.user().id)
        .await
    {
        Ok(preferences) => Ok(Json(preferences.into_iter().map(|p| p.into()).collect())),
        Err(e) => {
            error!(
                "failed to get playlist preferences for user {}: {}",
                user.user().id,
                e
            );
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// get playlists with user context (preferences and ownership)
pub async fn get_playlists_with_user_context(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<Vec<PlaylistWithUserContextResponse>>, StatusCode> {
    let music_repository = MusicRepository::new(db.pool().clone());
    match music_repository
        .get_playlists_with_user_context(user.user().id)
        .await
    {
        Ok(playlists) => Ok(Json(playlists.into_iter().map(|p| p.into()).collect())),
        Err(e) => {
            error!(
                "failed to get playlists with user context for user {}: {}",
                user.user().id,
                e
            );
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// set playlist owner
pub async fn set_playlist_owner(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(playlist_id): Path<Uuid>,
) -> Result<Json<PlaylistOwnershipResponse>, StatusCode> {
    let music_repository = MusicRepository::new(db.pool().clone());
    match music_repository
        .set_playlist_owner(playlist_id, user.user().id)
        .await
    {
        Ok(ownership) => {
            info!(
                "set playlist ownership: playlist {} owned by user {}",
                playlist_id,
                user.user().id
            );
            Ok(Json(ownership.into()))
        }
        Err(e) => {
            error!(
                "failed to set playlist ownership for playlist {} and user {}: {}",
                playlist_id,
                user.user().id,
                e
            );
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// transfer playlist ownership
pub async fn transfer_playlist_ownership(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(playlist_id): Path<Uuid>,
    Json(request): Json<TransferOwnershipRequest>,
) -> Result<Json<PlaylistOwnershipResponse>, StatusCode> {
    let music_repository = MusicRepository::new(db.pool().clone());
    let grimoire_request = TransferPlaylistOwnershipRequest {
        from_user_id: user.user().id,
        to_user_id: request.to_user_id,
    };

    match music_repository
        .transfer_playlist_ownership(playlist_id, grimoire_request)
        .await
    {
        Ok(ownership) => {
            info!(
                "transferred playlist ownership: playlist {} from user {} to user {}",
                playlist_id,
                user.user().id,
                request.to_user_id
            );
            Ok(Json(ownership.into()))
        }
        Err(e) => {
            error!(
                "failed to transfer playlist ownership for playlist {} from user {} to user {}: {}",
                playlist_id,
                user.user().id,
                request.to_user_id,
                e
            );
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// bulk favorite all songs in an album
pub async fn bulk_favorite_album(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(request): Json<BulkFavoriteAlbumRequestApi>,
) -> Result<Json<BulkPreferenceUpdateResponse>, StatusCode> {
    let music_repository = MusicRepository::new(db.pool().clone());
    let grimoire_request = BulkFavoriteAlbumRequest {
        album: request.album.clone(),
        is_favorite: request.is_favorite,
    };

    match music_repository
        .bulk_favorite_album(user.user().id, grimoire_request)
        .await
    {
        Ok(preferences) => {
            info!(
                "bulk {} album '{}' for user {}: {} songs updated",
                if request.is_favorite {
                    "favorited"
                } else {
                    "unfavorited"
                },
                request.album,
                user.user().id,
                preferences.len()
            );
            Ok(Json(BulkPreferenceUpdateResponse {
                updated_count: preferences.len(),
                preferences: preferences.into_iter().map(|p| p.into()).collect(),
            }))
        }
        Err(e) => {
            error!(
                "failed to bulk {} album '{}' for user {}: {}",
                if request.is_favorite {
                    "favorite"
                } else {
                    "unfavorite"
                },
                request.album,
                user.user().id,
                e
            );
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// get album favorite status
pub async fn get_album_favorite_status(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(album): Path<String>,
) -> Result<Json<AlbumFavoriteStatusResponse>, StatusCode> {
    let music_repository = MusicRepository::new(db.pool().clone());
    match music_repository
        .get_album_favorite_status(user.user().id, album.clone())
        .await
    {
        Ok(status) => Ok(Json(status.into())),
        Err(e) => {
            error!(
                "failed to get album favorite status for user {} and album '{}': {}",
                user.user().id,
                album,
                e
            );
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// bulk favorite all songs in a playlist
pub async fn bulk_favorite_playlist_songs(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(playlist_id): Path<Uuid>,
    Json(request): Json<BulkFavoritePlaylistRequest>,
) -> Result<Json<BulkPreferenceUpdateResponse>, StatusCode> {
    let music_repository = MusicRepository::new(db.pool().clone());
    match music_repository
        .bulk_favorite_playlist_songs(user.user().id, playlist_id, request.is_favorite)
        .await
    {
        Ok(preferences) => {
            info!(
                "bulk {} playlist {} songs for user {}: {} songs updated",
                if request.is_favorite {
                    "favorited"
                } else {
                    "unfavorited"
                },
                playlist_id,
                user.user().id,
                preferences.len()
            );
            Ok(Json(BulkPreferenceUpdateResponse {
                updated_count: preferences.len(),
                preferences: preferences.into_iter().map(|p| p.into()).collect(),
            }))
        }
        Err(e) => {
            error!(
                "failed to bulk {} playlist {} songs for user {}: {}",
                if request.is_favorite {
                    "favorite"
                } else {
                    "unfavorite"
                },
                playlist_id,
                user.user().id,
                e
            );
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

// conversion implementations

impl From<UserPlaylistPreference> for PlaylistPreferenceResponse {
    fn from(pref: UserPlaylistPreference) -> Self {
        Self {
            user_id: pref.user_id,
            playlist_id: pref.playlist_id,
            is_favorite: pref.is_favorite,
            updated_at: pref.updated_at.format(&Rfc3339).unwrap_or_default(),
        }
    }
}

impl From<PlaylistOwnership> for PlaylistOwnershipResponse {
    fn from(ownership: PlaylistOwnership) -> Self {
        Self {
            playlist_id: ownership.playlist_id,
            owner_user_id: ownership.owner_user_id,
            created_at: ownership.created_at.format(&Rfc3339).unwrap_or_default(),
        }
    }
}

impl From<PlaylistWithUserContext> for PlaylistWithUserContextResponse {
    fn from(playlist: PlaylistWithUserContext) -> Self {
        Self {
            id: playlist.id,
            title: playlist.title,
            description: playlist.description,
            song_count: playlist.song_count,
            total_duration_seconds: playlist.total_duration.map(|d| d.microseconds / 1_000_000),
            created_at: playlist.created_at.format(&Rfc3339).unwrap_or_default(),
            updated_at: playlist.updated_at.format(&Rfc3339).unwrap_or_default(),
            user_is_favorite: playlist.user_is_favorite,
            preference_updated_at: playlist
                .preference_updated_at
                .map(|dt| dt.format(&Rfc3339).unwrap_or_default()),
            is_owned_by_user: playlist.is_owned_by_user,
            owner_user_id: playlist.owner_user_id,
            ownership_created_at: playlist
                .ownership_created_at
                .map(|dt| dt.format(&Rfc3339).unwrap_or_default()),
        }
    }
}

impl From<AlbumFavoriteStatus> for AlbumFavoriteStatusResponse {
    fn from(status: AlbumFavoriteStatus) -> Self {
        Self {
            album: status.album,
            total_songs: status.total_songs,
            favorited_songs: status.favorited_songs,
            is_fully_favorited: status.is_fully_favorited,
        }
    }
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

/// create router for playlist preference and ownership endpoints
pub fn create_routes() -> Router {
    Router::new()
        // playlist preference endpoints
        .route(
            "/api/media/playlists/{playlist_id}/preferences",
            patch(update_playlist_preference),
        )
        .route(
            "/api/media/playlists/preferences",
            get(get_user_playlist_preferences),
        )
        .route(
            "/api/media/playlists/user-context",
            get(get_playlists_with_user_context),
        )
        // playlist ownership endpoints
        .route(
            "/api/media/playlists/{playlist_id}/ownership",
            put(set_playlist_owner),
        )
        .route(
            "/api/media/playlists/{playlist_id}/ownership/transfer",
            post(transfer_playlist_ownership),
        )
        // album favorite endpoints
        .route("/api/media/albums/favorite", post(bulk_favorite_album))
        .route(
            "/api/media/albums/{album}/favorite-status",
            get(get_album_favorite_status),
        )
        // playlist bulk favorite endpoints
        .route(
            "/api/media/playlists/{playlist_id}/favorite-songs",
            post(bulk_favorite_playlist_songs),
        )
}
