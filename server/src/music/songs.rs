//! Songs API handlers

use axum::{
    extract::{Extension, Path, State},
    Json,
};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::music::crud::{
    delete_song, list_recent_songs, query_songs, update_songs, DeleteSongRequest,
    DeleteSongResponse, QueryParams, RecentSongsRequest, SongsQueryResult, UpdateSongsRequest,
    UpdateSongsResult,
};
use grimoire::response::GrimoireResponse;
use inventory;

use crate::auth::middleware::AuthenticatedUser;
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
            if !auth_user.role.is_admin() {
                return Err(ApiError::Forbidden);
            }
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

/// Delete a song
///
/// DELETE /api/songs/{id}
pub async fn delete_song_handler(
    State(_state): State<AppState>,
    Path(song_id): Path<String>,
    Json(request): Json<DeleteSongRequest>,
) -> Result<Json<DeleteSongResponse>, ApiError> {
    tracing::debug!("delete_song: id={}, user_id={}", song_id, request.user_id);

    let response = delete_song(&song_id, Some(request.user_id.clone())).await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    Ok(Json(DeleteSongResponse {
        success: true,
        message: format!("song {} deleted successfully", song_id),
    }))
}
