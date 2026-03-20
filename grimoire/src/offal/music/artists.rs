//! artist API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::crud::{query_artists, QueryParams};
use crate::music::entities::artists::{
    create_artist, delete_artist as grimoire_delete_artist, get_artist as grimoire_get_artist,
    get_artist_images as grimoire_get_artist_images, update_artist as grimoire_update_artist,
    CreateArtistRequest, UpdateArtistRequest,
};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use serde_json::Value as JsonValue;

/// route metadata for artists
/// matches server inventory routes
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "create_artist",
        path: "/api/music/artists",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "CreateArtistRequest",
        response_type: "Artist",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "query_artists",
        path: "/api/artists/query",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryParams",
        response_type: "ArtistsQueryResult",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_artist",
        path: "/api/artists/{id}",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "GetArtistRequest",
        response_type: "Artist",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "delete_artist",
        path: "/api/artists/{id}",
        method: Method::DELETE,
        domain: Domain::Music,
        request_type: "DeleteArtistRequest",
        response_type: "DeleteArtistResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "update_artist",
        path: "/api/artists/update",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UpdateArtistRequest",
        response_type: "Artist",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "get_artist_images",
        path: "/api/artists/{id}/images",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "String",
        response_type: "Vec<String>",
        auth: RouteAuth::Authenticated,
    },
];

/// query artists
///
/// path: POST /api/artists/query
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

    let response = query_artists(params).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// create artist
///
/// path: POST /api/music/artists
pub async fn create(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new(
                "forbidden",
                "forbidden",
                "admin only",
            )],
        );
    }

    let req: CreateArtistRequest = match serde_json::from_value(body) {
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

    let response = create_artist(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get artist by id (path param)
///
/// path: GET /api/artists/{id}
pub async fn get(_caller: &Caller, id: &str, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    // note: the underlying get_artist doesn't support include_albums or user_id params yet
    let response = grimoire_get_artist(id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get artist images (path param)
///
/// path: GET /api/artists/{id}/images
pub async fn get_images(
    _caller: &Caller,
    id: &str,
    _body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let response = grimoire_get_artist_images(id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// update artist
///
/// path: POST /api/artists/update
pub async fn update(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let mut req: UpdateArtistRequest = match serde_json::from_value(body) {
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

    // inject authenticated user id
    req.updated_by = Some(caller.user_id.clone());

    let response = grimoire_update_artist(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// delete artist (path param)
///
/// path: DELETE /api/artists/{id}
pub async fn delete(caller: &Caller, id: &str, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let response = grimoire_delete_artist(id, Some(caller.user_id.clone())).await;
    response.map(|_| JsonValue::Null)
}
