//! Ratings API handlers

use axum::{extract::State, Json};
use axum::extract::Extension;
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::music::crud::{
    GetRatingStatsRequest, RatingStats, RemoveRatingRequest, RemoveRatingResponse,
    SetRatingResponse,
};
use grimoire::response::GrimoireResponse;
use grimoire::users::{RatingsService, SetRatingRequest};
use inventory;

use crate::{auth::middleware::AuthenticatedUser, error::ApiError, AppState};

// ============================================================================
// Route Registration
// ============================================================================

inventory::submit! {
    RouteInfo {
        name: "set_rating",
        path: "/api/ratings/set",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SetRatingRequest",
        response_type: "SetRatingResponse",
    }
}

inventory::submit! {
    RouteInfo {
        name: "remove_rating",
        path: "/api/ratings/remove",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "RemoveRatingRequest",
        response_type: "RemoveRatingResponse",
    }
}

inventory::submit! {
    RouteInfo {
        name: "get_rating_stats",
        path: "/api/ratings/stats",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetRatingStatsRequest",
        response_type: "RatingStats",
    }
}

// ============================================================================
// Handlers
// ============================================================================

/// Set a rating (1-5) for a song, artist, or album
///
/// POST /api/ratings/set
pub async fn set_rating_handler(
    State(_state): State<AppState>,
    Extension(auth_user): Extension<AuthenticatedUser>,
    Json(mut request): Json<SetRatingRequest>,
) -> Result<Json<SetRatingResponse>, ApiError> {
    // determine the target user_id
    let target_user_id = match &request.user_id {
        Some(uid) => {
            // user_id was provided - check if it's different from authenticated user
            if uid != &auth_user.user_id {
                // trying to set rating for a different user - must be admin
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
        "set_rating: user_id={}, target_type={:?}, target_id={}, rating={}, requesting_user={}",
        target_user_id,
        request.target_type,
        request.target_id,
        request.rating,
        auth_user.user_id
    );

    // set the resolved user_id in the request
    request.user_id = Some(target_user_id);

    let ratings_service = RatingsService::new();

    match ratings_service.set_rating(&request).await {
        Ok(_) => Ok(Json(SetRatingResponse {
            success: true,
            message: format!("rating set to {} stars", request.rating),
        })),
        Err(e) => Err(ApiError::Internal(e.to_string())),
    }
}

/// Remove a rating
///
/// POST /api/ratings/remove
pub async fn remove_rating_handler(
    State(_state): State<AppState>,
    Extension(auth_user): Extension<AuthenticatedUser>,
    Json(request): Json<RemoveRatingRequest>,
) -> Result<Json<RemoveRatingResponse>, ApiError> {
    // determine the target user_id
    let target_user_id = match &request.user_id {
        Some(uid) => {
            // user_id was provided - check if it's different from authenticated user
            if uid != &auth_user.user_id {
                // trying to remove rating for a different user - must be admin
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
        "remove_rating: user_id={}, target_type={}, target_id={}, requesting_user={}",
        target_user_id,
        request.target_type,
        request.target_id,
        auth_user.user_id
    );

    let ratings_service = RatingsService::new();

    match ratings_service
        .remove_rating(&target_user_id, request.target_type, &request.target_id)
        .await
    {
        Ok(_) => Ok(Json(RemoveRatingResponse {
            success: true,
            message: format!(
                "rating removed for {} {}",
                request.target_type, request.target_id
            ),
        })),
        Err(e) => Err(ApiError::Internal(e.to_string())),
    }
}

/// Get rating statistics for an entity
///
/// POST /api/ratings/stats
pub async fn get_rating_stats_handler(
    State(_state): State<AppState>,
    Json(request): Json<GetRatingStatsRequest>,
) -> Result<Json<GrimoireResponse<RatingStats>>, ApiError> {
    tracing::debug!(
        "get_rating_stats: target_type={}, target_id={}",
        request.target_type,
        request.target_id
    );

    let ratings_service = RatingsService::new();

    match ratings_service
        .get_rating_stats(request.target_type, &request.target_id)
        .await
    {
        Ok(stats) => Ok(Json(GrimoireResponse {
            success: true,
            message: format!(
                "rating stats: {:.1} stars ({} ratings)",
                stats.average_rating, stats.total_ratings
            ),
            data: Some(RatingStats {
                average_rating: stats.average_rating,
                total_ratings: stats.total_ratings,
            }),
            errors: vec![],
        })),
        Err(e) => Err(ApiError::Internal(e.to_string())),
    }
}
