//! domain-agnostic ratings API handlers
//!
//! set/remove/query ratings for any `RatingTarget` (song/artist/album/video).
//! response shapes here are already generic (target_type/target_id/stats),
//! unlike some of the favorites listing endpoints, so this module moved here
//! in full.

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::{RatingTarget, RatingsService, SetRatingRequest, UserRole};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use zod_gen_derive::ZodSchema;

/// request for bulk-fetching the caller's own rating of a list of target
/// ids of a single target_type. domain-agnostic - works for any
/// `RatingTarget` (song/artist/album/video), not just music.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetRatingStatusBulkRequest {
    pub target_type: RatingTarget,
    pub target_ids: Vec<String>,
}

/// the caller's own rating (if any) for a single target
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RatingStatusItem {
    pub target_id: String,
    pub rating: Option<i32>,
}

/// route metadata for ratings
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "set_rating",
        path: "/api/entities/ratings/set",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "SetRatingRequest",
        response_type: "SetRatingResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "remove_rating",
        path: "/api/entities/ratings/remove",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "RemoveRatingRequest",
        response_type: "RemoveRatingResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "get_rating_stats",
        path: "/api/entities/ratings/stats",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "GetRatingStatsRequest",
        response_type: "RatingStats",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_rating_status_bulk",
        path: "/api/entities/ratings/status-bulk",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "GetRatingStatusBulkRequest",
        response_type: "Vec<RatingStatusItem>",
        auth: RouteAuth::Authenticated,
    },
];

/// set a rating
///
/// path: POST /api/entities/ratings/set
pub async fn set(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let mut req: SetRatingRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
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
            vec![ErrorDetail::new(
                "rating_error",
                "rating error",
                e.to_string(),
            )],
        ),
    }
}

/// remove a rating
///
/// path: POST /api/entities/ratings/remove
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
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            )
        }
    };

    let service = RatingsService::new();
    match service
        .remove_rating(&caller.user_id, req.target_type, &req.target_id)
        .await
    {
        Ok(removed) => {
            GrimoireResponse::success("rating removed", serde_json::to_value(removed).unwrap())
        }
        Err(e) => GrimoireResponse::failure(
            "failed to remove rating",
            vec![ErrorDetail::new(
                "rating_error",
                "rating error",
                e.to_string(),
            )],
        ),
    }
}

/// get rating stats for an item
///
/// path: POST /api/entities/ratings/stats
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
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            )
        }
    };

    let service = RatingsService::new();
    match service
        .get_rating_stats(req.target_type, &req.target_id)
        .await
    {
        Ok(stats) => {
            GrimoireResponse::success("rating stats", serde_json::to_value(stats).unwrap())
        }
        Err(e) => GrimoireResponse::failure(
            "failed to get rating stats",
            vec![ErrorDetail::new(
                "rating_error",
                "rating error",
                e.to_string(),
            )],
        ),
    }
}

/// bulk-fetch the caller's own rating for a list of target ids (single
/// target_type)
///
/// path: POST /api/entities/ratings/status-bulk
pub async fn get_status_bulk(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetRatingStatusBulkRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            )
        }
    };

    let target_type = req.target_type;
    let targets: Vec<(RatingTarget, String)> = req
        .target_ids
        .into_iter()
        .map(|id| (target_type, id))
        .collect();

    let service = RatingsService::new();
    match service.get_ratings_bulk(&caller.user_id, targets).await {
        Ok(rows) => {
            let items: Vec<RatingStatusItem> = rows
                .into_iter()
                .map(|(_, target_id, rating)| RatingStatusItem { target_id, rating })
                .collect();
            GrimoireResponse::success("rating status", serde_json::to_value(items).unwrap())
        }
        Err(e) => GrimoireResponse::failure(
            "failed to get rating status",
            vec![ErrorDetail::new(
                "rating_error",
                "rating error",
                e.to_string(),
            )],
        ),
    }
}
