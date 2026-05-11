//! genre API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::crud::{query_genres, GetGenreRequest, QueryParams};
use crate::music::entities::genres::get_genre as grimoire_get_genre;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use serde_json::Value as JsonValue;

/// route metadata for genres
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "query_genres",
        path: "/api/genres/query",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryParams",
        response_type: "GenresQueryResult",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_genre",
        path: "/api/genres/get",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetGenreRequest",
        response_type: "GenreQueryResult",
        auth: RouteAuth::Authenticated,
    },
];

/// query genres
///
/// path: POST /api/genres/query
pub async fn query(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let mut params: QueryParams = match serde_json::from_value(body) {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let target_user_id = match &params.user_id {
        Some(uid) if uid != &caller.user_id => {
            if !caller.is_admin() {
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

/// get genre by id
///
/// path: POST /api/genres/get
pub async fn get(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetGenreRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = grimoire_get_genre(&req.id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}
