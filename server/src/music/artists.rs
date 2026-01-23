//! Artist handlers

use axum::{
    extract::{Extension, Path, State},
    Json,
};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::music::crud::{
    delete_artist, get_artist, query_artists, ArtistsQueryResult, DeleteArtistRequest,
    DeleteArtistResponse, QueryParams,
};
use grimoire::music::entities::artists::{
    create_artist, update_artist, Artist, CreateArtistRequest, UpdateArtistRequest,
};
use grimoire::response::GrimoireResponse;
use inventory;

use crate::{auth::middleware::AuthenticatedUser, error::ApiError, AppState};

/// Create a new artist
pub async fn create_artist_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(mut req): Json<CreateArtistRequest>,
) -> Result<Json<Artist>, ApiError> {
    // inject authenticated user id
    req.created_by = Some(user.user_id);

    let response = create_artist(req).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "create_artist",
        path: "/api/music/artists",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "CreateArtistRequest",
        response_type: "Artist",
    }
}

inventory::submit! {
    RouteInfo {
        name: "query_artists",
        path: "/api/artists/query",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryParams",
        response_type: "ArtistsQueryResult",
    }
}

inventory::submit! {
    RouteInfo {
        name: "get_artist",
        path: "/api/artists/{id}",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "GetArtistRequest",
        response_type: "Artist",
    }
}

inventory::submit! {
    RouteInfo {
        name: "delete_artist",
        path: "/api/artists/{id}",
        method: Method::DELETE,
        domain: Domain::Music,
        request_type: "DeleteArtistRequest",
        response_type: "DeleteArtistResponse",
    }
}

inventory::submit! {
    RouteInfo {
        name: "update_artist",
        path: "/api/artists/update",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UpdateArtistRequest",
        response_type: "Artist",
    }
}

// ============================================================================
// Handlers
// ============================================================================

/// Query artists with flexible filtering, search, and pagination
///
/// POST /api/artists/query
pub async fn query_artists_handler(
    Extension(auth_user): Extension<AuthenticatedUser>,
    State(_state): State<AppState>,
    Json(mut params): Json<QueryParams>,
) -> Result<Json<GrimoireResponse<ArtistsQueryResult>>, ApiError> {
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
        "query_artists: params={:?}, requesting_user={}",
        params,
        auth_user.user_id
    );

    let response = query_artists(params).await;

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

/// Get a single artist by ID
///
/// GET /api/artists/{id}
pub async fn get_artist_handler(
    State(_state): State<AppState>,
    Path(artist_id): Path<String>,
) -> Result<Json<GrimoireResponse<Artist>>, ApiError> {
    tracing::debug!("get_artist: id={}", artist_id);

    let response = get_artist(&artist_id).await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    Ok(Json(response))
}

/// Delete an artist
///
/// DELETE /api/artists/{id}
pub async fn delete_artist_handler(
    State(_state): State<AppState>,
    Path(artist_id): Path<String>,
    Json(request): Json<DeleteArtistRequest>,
) -> Result<Json<DeleteArtistResponse>, ApiError> {
    tracing::debug!(
        "delete_artist: id={}, user_id={}",
        artist_id,
        request.user_id
    );

    let response = delete_artist(&artist_id, Some(request.user_id.clone())).await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    Ok(Json(DeleteArtistResponse {
        success: true,
        message: format!("artist {} deleted successfully", artist_id),
    }))
}

/// Update an artist's metadata (admin only)
///
/// POST /api/artists/update
pub async fn update_artist_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(mut req): Json<UpdateArtistRequest>,
) -> Result<Json<Artist>, ApiError> {
    // require admin
    if !user.role.is_admin() {
        return Err(ApiError::Forbidden);
    }

    // inject authenticated user id
    req.updated_by = Some(user.user_id);

    tracing::debug!("update_artist: id={}, name={:?}", req.artist_id, req.name);

    let response = update_artist(req).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}
