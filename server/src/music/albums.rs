//! Albums API handlers

use axum::{
    extract::{Extension, Path, State},
    Json,
};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::music::crud::{
    delete_album, get_album, query_albums, AlbumsQueryResult, DeleteAlbumRequest,
    DeleteAlbumResponse, QueryParams,
};
use grimoire::response::GrimoireResponse;
use inventory;

use crate::{auth::middleware::AuthenticatedUser, error::ApiError, AppState};

// ============================================================================
// Route Registration
// ============================================================================

inventory::submit! {
    RouteInfo {
        name: "query_albums",
        path: "/api/albums/query",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryParams",
        response_type: "AlbumsQueryResult",
    }
}

inventory::submit! {
    RouteInfo {
        name: "get_album",
        path: "/api/albums/{id}",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "GetAlbumRequest",
        response_type: "Album",
    }
}

inventory::submit! {
    RouteInfo {
        name: "delete_album",
        path: "/api/albums/{id}",
        method: Method::DELETE,
        domain: Domain::Music,
        request_type: "DeleteAlbumRequest",
        response_type: "DeleteAlbumResponse",
    }
}

// ============================================================================
// Handlers
// ============================================================================

/// Query albums with flexible filtering, search, and pagination
///
/// POST /api/albums/query
pub async fn query_albums_handler(
    Extension(auth_user): Extension<AuthenticatedUser>,
    State(_state): State<AppState>,
    Json(mut params): Json<QueryParams>,
) -> Result<Json<GrimoireResponse<AlbumsQueryResult>>, ApiError> {
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
        "query_albums: params={:?}, requesting_user={}",
        params,
        auth_user.user_id
    );

    let response = query_albums(params).await;

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

/// Get a single album by ID
///
/// GET /api/albums/{id}
pub async fn get_album_handler(
    State(_state): State<AppState>,
    Path(album_id): Path<String>,
) -> Result<Json<GrimoireResponse<grimoire::music::entities::albums::Album>>, ApiError> {
    tracing::debug!("get_album: id={}", album_id);

    let response = get_album(&album_id).await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    Ok(Json(response))
}

/// Delete an album
///
/// DELETE /api/albums/{id}
pub async fn delete_album_handler(
    State(_state): State<AppState>,
    Path(album_id): Path<String>,
    Json(request): Json<DeleteAlbumRequest>,
) -> Result<Json<DeleteAlbumResponse>, ApiError> {
    tracing::debug!("delete_album: id={}, user_id={}", album_id, request.user_id);

    let response = delete_album(&album_id, Some(request.user_id.clone())).await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    Ok(Json(DeleteAlbumResponse {
        success: true,
        message: format!("album {} deleted successfully", album_id),
    }))
}
