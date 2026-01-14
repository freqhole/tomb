//! Ratings API handlers

use axum::{extract::State, Json};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::music::crud::{
    GetRatingStatsRequest, RatingStats, RemoveRatingRequest, RemoveRatingResponse,
    SetRatingResponse,
};
use grimoire::response::GrimoireResponse;
use grimoire::users::{RatingTarget, RatingsService, SetRatingRequest};
use inventory;

use crate::{error::ApiError, AppState};

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
    Json(request): Json<SetRatingRequest>,
) -> Result<Json<SetRatingResponse>, ApiError> {
    tracing::debug!(
        "set_rating: user_id={}, target_type={:?}, target_id={}, rating={}",
        request.user_id,
        request.target_type,
        request.target_id,
        request.rating
    );

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
    Json(request): Json<RemoveRatingRequest>,
) -> Result<Json<RemoveRatingResponse>, ApiError> {
    tracing::debug!(
        "remove_rating: user_id={}, target_type={}, target_id={}",
        request.user_id,
        request.target_type,
        request.target_id
    );

    let ratings_service = RatingsService::new();

    let rating_target = match parse_rating_target(&request.target_type) {
        Ok(target) => target,
        Err(e) => {
            return Err(ApiError::BadRequest(e));
        }
    };

    match ratings_service
        .remove_rating(&request.user_id, rating_target, &request.target_id)
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

    let rating_target = match parse_rating_target(&request.target_type) {
        Ok(target) => target,
        Err(e) => {
            return Err(ApiError::BadRequest(e));
        }
    };

    match ratings_service
        .get_rating_stats(rating_target, &request.target_id)
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

fn parse_rating_target(target_type: &str) -> Result<RatingTarget, String> {
    match target_type.to_lowercase().as_str() {
        "song" => Ok(RatingTarget::Song),
        "artist" => Ok(RatingTarget::Artist),
        "album" => Ok(RatingTarget::Album),
        _ => Err(format!(
            "invalid target type: {}. must be 'song', 'artist', or 'album'",
            target_type
        )),
    }
}
