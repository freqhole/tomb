//! Favorites API handlers

use axum::{extract::State, Json};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::music::crud::{ListFavoritesRequest, ListFavoritesResponse, SetFavoriteResponse};
use grimoire::response::GrimoireResponse;
use grimoire::users::{FavoritesService, SetFavoriteRequest};
use inventory;

use crate::{auth::middleware::AuthenticatedUser, error::ApiError, AppState};
use axum::extract::Extension;

// ============================================================================
// Route Registration
// ============================================================================

inventory::submit! {
    RouteInfo {
        name: "set_favorite",
        path: "/api/favorites/set",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SetFavoriteRequest",
        response_type: "SetFavoriteResponse",
    }
}

inventory::submit! {
    RouteInfo {
        name: "list_favorites",
        path: "/api/favorites/list",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ListFavoritesRequest",
        response_type: "ListFavoritesResponse",
    }
}

// ============================================================================
// Handlers
// ============================================================================

/// Set or unset a favorite (song, artist, album, genre, playlist)
///
/// POST /api/favorites/set
pub async fn set_favorite_handler(
    State(_state): State<AppState>,
    Extension(auth_user): Extension<AuthenticatedUser>,
    Json(mut request): Json<SetFavoriteRequest>,
) -> Result<Json<SetFavoriteResponse>, ApiError> {
    // determine the target user_id
    let target_user_id = match &request.user_id {
        Some(uid) => {
            // user_id was provided - check if it's different from authenticated user
            if uid != &auth_user.user_id {
                // trying to set favorite for a different user - must be admin
                if !auth_user.role.is_admin() {
                    return Err(ApiError::Forbidden);
                }
            }
            uid.clone()
        }
        None => {
            // no user_id provided - use authenticated user
            auth_user.user_id.clone()
        }
    };

    tracing::debug!(
        "set_favorite: user_id={}, target_type={:?}, target_id={}, is_favorite={}, requesting_user={}",
        target_user_id,
        request.target_type,
        request.target_id,
        request.is_favorite,
        auth_user.user_id
    );

    // set the resolved user_id in the request
    request.user_id = Some(target_user_id);

    let favorites_service = FavoritesService::new();
    let response = favorites_service.set_favorite(&request).await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    Ok(Json(SetFavoriteResponse {
        success: true,
        message: format!(
            "favorite {} for {:?}",
            if request.is_favorite {
                "set"
            } else {
                "removed"
            },
            request.target_type
        ),
    }))
}

/// List user's favorites
///
/// POST /api/favorites/list
pub async fn list_favorites_handler(
    State(_state): State<AppState>,
    Extension(auth_user): Extension<AuthenticatedUser>,
    Json(mut request): Json<ListFavoritesRequest>,
) -> Result<Json<GrimoireResponse<ListFavoritesResponse>>, ApiError> {
    // determine the target user_id (similar logic to set_favorite)
    let target_user_id = match &request.user_id {
        Some(uid) if uid != &auth_user.user_id => {
            // requesting favorites for a different user - must be admin
            if !auth_user.role.is_admin() {
                return Err(ApiError::Forbidden);
            }
            uid.clone()
        }
        Some(uid) => uid.clone(),
        None => auth_user.user_id.clone(),
    };

    request.user_id = Some(target_user_id.clone());

    tracing::debug!(
        "list_favorites: user_id={}, target_type={:?}, limit={:?}, requesting_user={}",
        target_user_id,
        request.target_type,
        request.limit,
        auth_user.user_id
    );

    // use new query_favorites function that returns typed favorites
    let limit = request.limit.unwrap_or(50);
    let offset = request.offset.unwrap_or(0);
    let target_type = request.target_type.as_ref().map(|t| t.to_string());
    let target_type_str = target_type.as_deref();

    let response = grimoire::music::crud::query_favorites(
        &target_user_id,
        target_type_str,
        limit,
        offset,
    )
    .await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    let favorites = response.data.unwrap_or_default();
    let total_count = favorites.len() as i64;
    let has_more = favorites.len() >= limit as usize;

    Ok(Json(GrimoireResponse {
        success: true,
        message: format!("found {} favorites", favorites.len()),
        data: Some(ListFavoritesResponse {
            favorites,
            total_count,
            has_more,
            offset: offset as i64,
            limit: limit as i64,
        }),
        errors: vec![],
    }))
}
