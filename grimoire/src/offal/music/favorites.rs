//! favorites API handlers

use crate::error::ErrorDetail;
use crate::music::{query_favorites, ListFavoritesRequest, ListFavoritesResponse};
use crate::music::users::{SetFavoriteRequest, FavoritesService};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

/// set favorite status
///
/// path: POST /api/favorites/set
pub async fn set(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let mut req: SetFavoriteRequest = match serde_json::from_value(body) {
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

    let service = FavoritesService::new();
    let response = service.set_favorite(&req).await;
    response.map(|_| JsonValue::Null)
}

/// list favorites
///
/// path: POST /api/favorites/list
pub async fn list(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ListFavoritesRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new("bad_request", "bad request", &e.to_string())],
            )
        }
    };

    let limit = req.limit.unwrap_or(50);
    let offset = req.offset.unwrap_or(0);
    let target_type = req.target_type.as_ref().map(|t| t.to_string());
    let target_type_str = target_type.as_deref();

    let response = query_favorites(
        &caller.user_id,
        target_type_str,
        limit,
        offset,
    ).await;

    match response.data {
        Some(favorites) => {
            let total_count = favorites.len() as i64;
            let has_more = favorites.len() >= limit as usize;

            GrimoireResponse::success(
                &format!("found {} favorites", favorites.len()),
                serde_json::to_value(ListFavoritesResponse {
                    favorites,
                    total_count,
                    has_more,
                    offset: offset as i64,
                    limit: limit as i64,
                }).unwrap(),
            )
        }
        None => GrimoireResponse::failure(
            &response.message,
            response.errors,
        ),
    }
}
