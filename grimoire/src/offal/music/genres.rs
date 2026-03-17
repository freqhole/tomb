//! genre API handlers

use crate::error::ErrorDetail;
use crate::music::crud::{query_genres, QueryParams};
use crate::music::entities::genres::{get_genre as grimoire_get_genre};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use serde_json::Value as JsonValue;

/// query genres
///
/// path: POST /api/genres/query
pub async fn query(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let mut params: QueryParams = match serde_json::from_value(body) {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new("bad_request", "bad request", &e.to_string())],
            )
        }
    };

    let target_user_id = match &params.user_id {
        Some(uid) if uid != &caller.user_id => {
            if caller.role != UserRole::Admin {
                return GrimoireResponse::failure(
                    "forbidden",
                    vec![ErrorDetail::new(
                        "forbidden",
                        "forbidden",
                        "cannot query another user's data",
                    )],
                );
            }
            uid.clone()
        }
        Some(uid) => uid.clone(),
        None => caller.user_id.clone(),
    };

    params.user_id = Some(target_user_id);

    let response = query_genres(params).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get genre by id (path param)
///
/// path: GET /api/genres/{id}
pub async fn get(_caller: &Caller, id: &str, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    let response = grimoire_get_genre(id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}
