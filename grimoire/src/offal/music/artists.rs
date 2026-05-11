//! artist API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::crud::{query_artists, DeleteArtistRequest, GetArtistRequest, QueryParams};
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
        path: "/api/artists/get",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetArtistRequest",
        response_type: "Artist",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "delete_artist",
        path: "/api/artists/delete",
        method: Method::POST,
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
        path: "/api/artists/images",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetArtistRequest",
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
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
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

/// get artist by id
///
/// path: POST /api/artists/get
pub async fn get(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetArtistRequest = match serde_json::from_value(body) {
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

    let response = grimoire_get_artist(&req.id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get artist images
///
/// path: POST /api/artists/images
pub async fn get_images(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetArtistRequest = match serde_json::from_value(body) {
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

    let response = grimoire_get_artist_images(&req.id).await;
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

/// delete artist
///
/// path: POST /api/artists/delete
pub async fn delete(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: DeleteArtistRequest = match serde_json::from_value(body) {
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

    let response = grimoire_delete_artist(&req.id, Some(caller.user_id.clone())).await;
    response.map(|_| JsonValue::Null)
}
