//! music-specific favorites listing handlers
//!
//! these endpoints return rich, music-only shapes (full song/album/artist/
//! playlist objects, or album+artist "beloved" ids), so they stay under
//! `offal::music` even though favorites themselves are domain-agnostic.
//! generic set/bulk-status-check endpoints live in
//! `offal::entities::favorites`.

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::{
    query_favorites, ListBelovedResponse, ListFavoritesRequest, ListFavoritesResponse,
};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::{FavoritesService, UserRole};
use serde_json::Value as JsonValue;

/// route metadata for music-specific favorites listing
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "list_favorites",
        path: "/api/favorites/list",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ListFavoritesRequest",
        response_type: "ListFavoritesResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "list_beloved",
        path: "/api/favorites/beloved",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ListBelovedRequest",
        response_type: "ListBelovedResponse",
        auth: RouteAuth::Authenticated,
    },
];

/// list favorites
///
/// path: POST /api/favorites/list
pub async fn list(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ListFavoritesRequest = match serde_json::from_value(body) {
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

    let limit = req.limit.unwrap_or(50);
    let offset = req.offset.unwrap_or(0);
    let target_type = req.target_type.as_ref().map(|t| t.to_string());
    let target_type_str = target_type.as_deref();

    let response = query_favorites(&caller.user_id, target_type_str, limit, offset).await;

    match response.data {
        Some(favorites) => {
            let total_count = favorites.len() as i64;
            let has_more = favorites.len() >= limit as usize;

            GrimoireResponse::success(
                format!("found {} favorites", favorites.len()),
                serde_json::to_value(ListFavoritesResponse {
                    favorites,
                    total_count,
                    has_more,
                    offset: offset as i64,
                    limit: limit as i64,
                })
                .unwrap(),
            )
        }
        None => GrimoireResponse::failure(&response.message, response.errors),
    }
}

/// list "beloved" album + artist + video ids — favorited by any user on
/// this remote (direct favorites unioned with song-favorite-derived ids).
pub async fn list_beloved(_caller: &Caller, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    let response = FavoritesService::new().list_beloved_ids().await;
    match response.data {
        Some((album_ids, artist_ids, video_ids)) => {
            let payload = ListBelovedResponse {
                album_ids,
                artist_ids,
                video_ids,
            };
            GrimoireResponse::success(&response.message, serde_json::to_value(payload).unwrap())
        }
        None => GrimoireResponse::failure(&response.message, response.errors),
    }
}
