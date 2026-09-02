//! domain-agnostic favorites API handlers
//!
//! set favorite status and bulk-check favorite status for any
//! `FavoriteTarget` (song/album/artist/taxon/playlist/video). rich,
//! music-specific listing endpoints (`list_favorites` returning full
//! song/album/artist/playlist objects, `list_beloved`) stay under
//! `offal::music::favorites` since their response shapes are inherently
//! music-only.

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::{FavoriteTarget, FavoritesService, SetFavoriteRequest, UserRole};
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use zod_gen_derive::ZodSchema;

/// request for bulk-checking favorite status of a list of target ids of a
/// single target_type. domain-agnostic - works for any `FavoriteTarget`
/// (song/album/artist/taxon/playlist/video), not just music.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetFavoriteStatusBulkRequest {
    pub target_type: FavoriteTarget,
    pub target_ids: Vec<String>,
}

/// a single target's favorite status
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct FavoriteStatusItem {
    pub target_id: String,
    pub is_favorite: bool,
}

/// route metadata for domain-agnostic favorites
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "set_favorite",
        path: "/api/entities/favorites/set",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "SetFavoriteRequest",
        response_type: "SetFavoriteResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "get_favorite_status_bulk",
        path: "/api/entities/favorites/status-bulk",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "GetFavoriteStatusBulkRequest",
        response_type: "Vec<FavoriteStatusItem>",
        auth: RouteAuth::Authenticated,
    },
];

/// set favorite status
///
/// path: POST /api/entities/favorites/set
pub async fn set(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let mut req: SetFavoriteRequest = match serde_json::from_value(body) {
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

    let service = FavoritesService::new();
    let response = service.set_favorite(&req).await;
    response.map(|_| JsonValue::Null)
}

/// bulk-check favorite status for a list of target ids (single target_type)
///
/// path: POST /api/entities/favorites/status-bulk
pub async fn get_status_bulk(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetFavoriteStatusBulkRequest = match serde_json::from_value(body) {
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
    let targets: Vec<(FavoriteTarget, String)> = req
        .target_ids
        .into_iter()
        .map(|id| (target_type, id))
        .collect();

    let response = FavoritesService::new()
        .get_favorite_status_bulk(&caller.user_id, targets)
        .await;

    match response.data {
        Some(rows) => {
            let items: Vec<FavoriteStatusItem> = rows
                .into_iter()
                .map(|(_, target_id, is_favorite)| FavoriteStatusItem {
                    target_id,
                    is_favorite,
                })
                .collect();
            GrimoireResponse::success(&response.message, serde_json::to_value(items).unwrap())
        }
        None => GrimoireResponse::failure(&response.message, response.errors),
    }
}
