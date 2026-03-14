//! Songs API handlers

use axum::{
    extract::{Extension, Path, State},
    Json,
};
use grimoire::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use grimoire::music::crud::{
    bulk_clear_song_artwork, bulk_delete_songs, delete_song, list_recent_songs, query_songs,
    update_songs, BulkClearSongArtworkRequest, BulkClearSongArtworkResponse,
    BulkDeleteSongsRequest, BulkDeleteSongsResponse, DeleteSongRequest, DeleteSongResponse,
    QueryParams, RecentSongsRequest, SongsQueryResult, UpdateSongsRequest, UpdateSongsResult,
};
use grimoire::response::GrimoireResponse;
use grimoire::users::UserRole;
use inventory;

use crate::auth::{check_role, AuthenticatedUser};
use crate::error::ApiError;
use crate::AppState;

// ============================================================================
// Route Registration
// ============================================================================

inventory::submit! {
    RouteInfo {
        name: "query_songs",
        path: "/api/songs/query",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryParams",
        response_type: "SongsQueryResult",
        auth: RouteAuth::Authenticated,
    }
}

inventory::submit! {
    RouteInfo {
        name: "recent_songs",
        path: "/api/songs/recent",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "RecentSongsRequest",
        response_type: "SongsQueryResult",
        auth: RouteAuth::Authenticated,
    }
}

inventory::submit! {
    RouteInfo {
        name: "update_songs",
        path: "/api/songs/update",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UpdateSongsRequest",
        response_type: "UpdateSongsResult",
        auth: RouteAuth::Role(UserRole::Admin),
    }
}

inventory::submit! {
    RouteInfo {
        name: "delete_song",
        path: "/api/songs/{id}",
        method: Method::DELETE,
        domain: Domain::Music,
        request_type: "DeleteSongRequest",
        response_type: "DeleteSongResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    }
}

inventory::submit! {
    RouteInfo {
        name: "bulk_delete_songs",
        path: "/api/songs/bulk-delete",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "BulkDeleteSongsRequest",
        response_type: "BulkDeleteSongsResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    }
}

inventory::submit! {
    RouteInfo {
        name: "bulk_clear_song_artwork",
        path: "/api/songs/bulk-clear-artwork",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "BulkClearSongArtworkRequest",
        response_type: "BulkClearSongArtworkResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    }
}

// ============================================================================
// Handlers
// ============================================================================

/// Query songs with flexible filtering, search, and pagination
///
/// POST /api/songs/query
pub async fn query_songs_handler(
    Extension(auth_user): Extension<AuthenticatedUser>,
    State(_state): State<AppState>,
    Json(mut params): Json<QueryParams>,
) -> Result<Json<GrimoireResponse<SongsQueryResult>>, ApiError> {
    // determine the target user_id for favorites/ratings
    let target_user_id = match &params.user_id {
        Some(uid) if uid != &auth_user.user_id => {
            // requesting data for a different user - must be admin
            check_role(&auth_user, UserRole::Admin)?;
            uid.clone()
        }
        Some(uid) => uid.clone(),
        None => auth_user.user_id.clone(),
    };

    // inject the resolved user_id into query params for favorite/rating lookups
    params.user_id = Some(target_user_id);

    tracing::debug!(
        "query_songs: params={:?}, requesting_user={}",
        params,
        auth_user.user_id
    );

    let response = query_songs(params).await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    let data = response.data.map(|qr| qr.into());
    Ok(Json(GrimoireResponse {
        success: response.success,
        message: response.message,
        data,
        errors: response.errors,
    }))
}

/// Get recent songs
///
/// POST /api/songs/recent
pub async fn recent_songs_handler(
    State(_state): State<AppState>,
    Json(request): Json<RecentSongsRequest>,
) -> Result<Json<GrimoireResponse<SongsQueryResult>>, ApiError> {
    tracing::debug!("recent_songs: limit={:?}", request.limit);

    let response = list_recent_songs(request.limit).await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    let data = response.data.map(|qr| qr.into());
    Ok(Json(GrimoireResponse {
        success: response.success,
        message: response.message,
        data,
        errors: response.errors,
    }))
}

/// Update songs with bulk operations
///
/// POST /api/songs/update
pub async fn update_songs_handler(
    State(_state): State<AppState>,
    Json(mut request): Json<UpdateSongsRequest>,
) -> Result<Json<GrimoireResponse<UpdateSongsResult>>, ApiError> {
    tracing::debug!("update_songs: song_ids={:?}", request.song_ids);

    // Normalize the request (handles conflicts between different update fields)
    request = request.normalize();

    let response = update_songs(request).await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    Ok(Json(response))
}

/// Delete a song (admin only)
///
/// DELETE /api/songs/{id}
pub async fn delete_song_handler(
    Extension(user): Extension<AuthenticatedUser>,
    State(_state): State<AppState>,
    Path(song_id): Path<String>,
    body: Option<Json<DeleteSongRequest>>,
) -> Result<Json<DeleteSongResponse>, ApiError> {
    // require admin
    check_role(&user, UserRole::Admin)?;

    let user_id = body
        .and_then(|b| b.user_id.clone())
        .unwrap_or_else(|| user.user_id.clone());
    tracing::debug!("delete_song: id={}, user_id={}", song_id, user_id);

    let response = delete_song(&song_id, Some(user_id)).await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    Ok(Json(DeleteSongResponse {
        success: true,
        message: format!("song {} deleted successfully", song_id),
    }))
}

/// Bulk delete songs (admin only)
///
/// POST /api/songs/bulk-delete
pub async fn bulk_delete_songs_handler(
    Extension(user): Extension<AuthenticatedUser>,
    State(_state): State<AppState>,
    Json(request): Json<BulkDeleteSongsRequest>,
) -> Result<Json<BulkDeleteSongsResponse>, ApiError> {
    check_role(&user, UserRole::Admin)?;

    let user_id = request.user_id.unwrap_or_else(|| user.user_id.clone());
    tracing::debug!(
        "bulk_delete_songs: count={}, user_id={}",
        request.song_ids.len(),
        user_id
    );

    let response = bulk_delete_songs(request.song_ids, Some(user_id)).await;
    Ok(Json(response))
}

/// Bulk clear artwork from songs (preserves waveform images)
///
/// POST /api/songs/bulk-clear-artwork
pub async fn bulk_clear_song_artwork_handler(
    Extension(user): Extension<AuthenticatedUser>,
    State(_state): State<AppState>,
    Json(request): Json<BulkClearSongArtworkRequest>,
) -> Result<Json<BulkClearSongArtworkResponse>, ApiError> {
    check_role(&user, UserRole::Admin)?;

    tracing::debug!(
        "bulk_clear_song_artwork: count={}",
        request.song_ids.len()
    );

    let response = bulk_clear_song_artwork(request.song_ids).await;
    Ok(Json(response))
}
