//! Genres API handlers

use axum::{
    extract::{Path, State},
    Json,
};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::music::crud::{query_genres, GenresQueryResult, QueryParams};
use grimoire::response::GrimoireResponse;
use inventory;

use crate::{error::ApiError, AppState};

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

// ============================================================================
// Handlers
// ============================================================================

/// Query genres with flexible filtering, search, and pagination
///
/// POST /api/genres/query
pub async fn query_genres_handler(
    State(_state): State<AppState>,
    Json(params): Json<QueryParams>,
) -> Result<Json<GrimoireResponse<GenresQueryResult>>, ApiError> {
    tracing::debug!("query_genres: params={:?}", params);

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
