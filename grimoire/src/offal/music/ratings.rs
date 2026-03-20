//! ratings API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::{RatingTarget, RatingsService, SetRatingRequest, UserRole};
use serde::Deserialize;
use serde_json::Value as JsonValue;

/// route metadata for ratings
/// matches server inventory routes
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "set_rating",
        path: "/api/ratings/set",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SetRatingRequest",
        response_type: "SetRatingResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "remove_rating",
        path: "/api/ratings/remove",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "RemoveRatingRequest",
        response_type: "RemoveRatingResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "get_rating_stats",
        path: "/api/ratings/stats",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetRatingStatsRequest",
        response_type: "RatingStats",
        auth: RouteAuth::Authenticated,
    },
];

/// set a rating
///
/// path: POST /api/ratings/set
pub async fn set(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let mut req: SetRatingRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new("bad_request", "bad request", &e.to_string())],
            )
        }
    };

    // always use caller's user_id
    req.user_id = Some(caller.user_id.clone());

    let service = RatingsService::new();
    match service.set_rating(&req).await {
        Ok(rating) => {
            GrimoireResponse::success("rating set", serde_json::to_value(rating).unwrap())
        }
        Err(e) => GrimoireResponse::failure(
            "failed to set rating",
            vec![ErrorDetail::new("rating_error", "rating error", &e.to_string())],
        ),
    }
}

/// remove a rating
///
/// path: POST /api/ratings/remove
#[derive(Deserialize)]
struct RemoveRatingRequest {
    target_type: RatingTarget,
    target_id: String,
}

pub async fn remove(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RemoveRatingRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new("bad_request", "bad request", &e.to_string())],
            )
        }
    };

    let service = RatingsService::new();
    match service
        .remove_rating(&caller.user_id, req.target_type, &req.target_id)
        .await
    {
        Ok(removed) => GrimoireResponse::success(
            "rating removed",
            serde_json::to_value(removed).unwrap(),
        ),
        Err(e) => GrimoireResponse::failure(
            "failed to remove rating",
            vec![ErrorDetail::new("rating_error", "rating error", &e.to_string())],
        ),
    }
}

/// get rating stats for an item
///
/// path: POST /api/ratings/stats
#[derive(Deserialize)]
struct StatsRequest {
    target_type: RatingTarget,
    target_id: String,
}

pub async fn stats(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: StatsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new("bad_request", "bad request", &e.to_string())],
            )
        }
    };

    let service = RatingsService::new();
    match service.get_rating_stats(req.target_type, &req.target_id).await {
        Ok(stats) => {
            GrimoireResponse::success("rating stats", serde_json::to_value(stats).unwrap())
        }
        Err(e) => GrimoireResponse::failure(
            "failed to get rating stats",
            vec![ErrorDetail::new("rating_error", "rating error", &e.to_string())],
        ),
    }
}
