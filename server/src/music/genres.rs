//! Genres API handlers

use axum::{
    extract::{Path, State},
    Extension, Json,
};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::music::crud::{query_genres, GenresQueryResult, QueryParams};
use grimoire::music::entities::genres::{
    create_sub_genre, delete_sub_genre, find_or_create_sub_genre, get_sub_genre, list_sub_genres,
    list_sub_genres_for_genre, query_sub_genres, CreateSubGenreRequest, DeleteSubGenreRequest,
    FindOrCreateSubGenreRequest, FindOrCreateSubGenreResponse, ListSubGenresForGenreRequest,
    QuerySubGenresRequest, SubGenre,
};
use grimoire::response::GrimoireResponse;
use inventory;

use crate::{auth::middleware::AuthenticatedUser, error::ApiError, AppState};

// ============================================================================
// Route Registration
// ============================================================================

inventory::submit! {
    RouteInfo {
        name: "query_genres",
        path: "/api/genres/query",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryParams",
        response_type: "GenresQueryResult",
    }
}

inventory::submit! {
    RouteInfo {
        name: "get_genre",
        path: "/api/genres/{id}",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "GetGenreRequest",
        response_type: "Genre",
    }
}

inventory::submit! {
    RouteInfo {
        name: "list_sub_genres",
        path: "/api/sub-genres/list",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "String",
        response_type: "Vec<SubGenre>",
    }
}

inventory::submit! {
    RouteInfo {
        name: "query_sub_genres",
        path: "/api/sub-genres/query",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QuerySubGenresRequest",
        response_type: "Vec<SubGenre>",
    }
}

inventory::submit! {
    RouteInfo {
        name: "get_sub_genre",
        path: "/api/sub-genres/{id}",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "GetSubGenreRequest",
        response_type: "SubGenre",
    }
}

inventory::submit! {
    RouteInfo {
        name: "create_sub_genre",
        path: "/api/sub-genres/create",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "CreateSubGenreRequest",
        response_type: "SubGenre",
    }
}

inventory::submit! {
    RouteInfo {
        name: "delete_sub_genre",
        path: "/api/sub-genres/delete",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "DeleteSubGenreRequest",
        response_type: "EmptyResponse",
    }
}

inventory::submit! {
    RouteInfo {
        name: "list_sub_genres_for_genre",
        path: "/api/sub-genres/for-genre",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ListSubGenresForGenreRequest",
        response_type: "Vec<SubGenre>",
    }
}

inventory::submit! {
    RouteInfo {
        name: "find_or_create_sub_genre",
        path: "/api/sub-genres/find-or-create",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "FindOrCreateSubGenreRequest",
        response_type: "FindOrCreateSubGenreResponse",
    }
}

// ============================================================================
// Handlers
// ============================================================================

/// Query genres with flexible filtering, search, and pagination
///
/// POST /api/genres/query
pub async fn query_genres_handler(
    Extension(auth_user): Extension<AuthenticatedUser>,
    State(_state): State<AppState>,
    Json(mut params): Json<QueryParams>,
) -> Result<Json<GrimoireResponse<GenresQueryResult>>, ApiError> {
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
        "query_genres: params={:?}, requesting_user={}",
        params,
        auth_user.user_id
    );

    let response = query_genres(params).await;

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

/// Get a single genre by ID
///
/// GET /api/genres/{id}
pub async fn get_genre_handler(
    State(_state): State<AppState>,
    Path(genre_id): Path<String>,
) -> Result<Json<GrimoireResponse<grimoire::music::entities::genres::Genre>>, ApiError> {
    tracing::debug!("get_genre: id={}", genre_id);

    let response = grimoire::music::entities::genres::get_genre(&genre_id).await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    Ok(Json(response))
}

// ============================================================================
// Sub-Genre Handlers
// ============================================================================

/// List all sub-genres
///
/// GET /api/sub-genres/list
pub async fn list_sub_genres_handler(
    State(_state): State<AppState>,
) -> Result<Json<GrimoireResponse<Vec<SubGenre>>>, ApiError> {
    tracing::debug!("list_sub_genres");

    let response = list_sub_genres().await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    Ok(Json(response))
}

/// Query/search sub-genres by name
///
/// POST /api/sub-genres/query
pub async fn query_sub_genres_handler(
    State(_state): State<AppState>,
    Json(req): Json<QuerySubGenresRequest>,
) -> Result<Json<GrimoireResponse<Vec<SubGenre>>>, ApiError> {
    tracing::debug!("query_sub_genres: search={}", req.search);

    let response = query_sub_genres(&req.search).await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    Ok(Json(response))
}

/// Get a single sub-genre by ID
///
/// GET /api/sub-genres/{id}
pub async fn get_sub_genre_handler(
    State(_state): State<AppState>,
    Path(sub_genre_id): Path<String>,
) -> Result<Json<GrimoireResponse<SubGenre>>, ApiError> {
    tracing::debug!("get_sub_genre: id={}", sub_genre_id);

    let response = get_sub_genre(&sub_genre_id).await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    Ok(Json(response))
}

/// Create a new sub-genre
///
/// POST /api/sub-genres/create
pub async fn create_sub_genre_handler(
    State(_state): State<AppState>,
    Json(req): Json<CreateSubGenreRequest>,
) -> Result<Json<GrimoireResponse<SubGenre>>, ApiError> {
    tracing::debug!("create_sub_genre: name={}", req.name);

    let response = create_sub_genre(req).await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    Ok(Json(response))
}

/// Delete a sub-genre (soft delete)
///
/// POST /api/sub-genres/delete
pub async fn delete_sub_genre_handler(
    State(_state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<DeleteSubGenreRequest>,
) -> Result<Json<GrimoireResponse<grimoire::health::EmptyResponse>>, ApiError> {
    tracing::debug!("delete_sub_genre: id={}", req.id);

    let user_id = Some(user.user_id);
    let response = delete_sub_genre(&req.id, user_id).await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    Ok(Json(GrimoireResponse {
        success: true,
        message: response.message,
        data: Some(grimoire::health::EmptyResponse { success: true }),
        errors: vec![],
    }))
}

/// List sub-genres for a parent genre
///
/// POST /api/sub-genres/for-genre
pub async fn list_sub_genres_for_genre_handler(
    State(_state): State<AppState>,
    Json(req): Json<ListSubGenresForGenreRequest>,
) -> Result<Json<GrimoireResponse<Vec<SubGenre>>>, ApiError> {
    tracing::debug!(
        "list_sub_genres_for_genre: parent_genre_id={}",
        req.parent_genre_id
    );

    let response = list_sub_genres_for_genre(&req.parent_genre_id).await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    Ok(Json(response))
}

/// Find or create a sub-genre
///
/// POST /api/sub-genres/find-or-create
pub async fn find_or_create_sub_genre_handler(
    State(_state): State<AppState>,
    Json(req): Json<FindOrCreateSubGenreRequest>,
) -> Result<Json<GrimoireResponse<FindOrCreateSubGenreResponse>>, ApiError> {
    tracing::debug!(
        "find_or_create_sub_genre: name={}, parent_genre_id={}",
        req.name,
        req.parent_genre_id
    );

    let response = find_or_create_sub_genre(req.name, req.parent_genre_id).await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    let data = response
        .data
        .map(|(sub_genre, created)| FindOrCreateSubGenreResponse { sub_genre, created });

    Ok(Json(GrimoireResponse {
        success: response.success,
        message: response.message,
        data,
        errors: response.errors,
    }))
}
