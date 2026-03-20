//! album API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::crud::{query_albums, QueryParams};
use crate::music::entities::albums::{
    delete_album as grimoire_delete_album, get_album as grimoire_get_album,
    get_album_images as grimoire_get_album_images, remove_album_image, set_primary_album_image,
    update_album as grimoire_update_album, UpdateAlbumRequest,
};
use crate::music::entities::artists::{remove_artist_image, set_primary_artist_image};
use crate::music::entities::playlists::{remove_playlist_image, set_primary_playlist_image};
use crate::music::entities::songs::{remove_song_image, set_primary_song_image};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::upload::{DeleteImageRequest, SetPrimaryImageRequest};
use crate::users::UserRole;
use serde_json::Value as JsonValue;

/// route metadata for albums
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "query_albums",
        path: "/api/albums/query",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryParams",
        response_type: "AlbumsQueryResult",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_album",
        path: "/api/albums/{id}",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "GetAlbumRequest",
        response_type: "Album",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "delete_album",
        path: "/api/albums/{id}",
        method: Method::DELETE,
        domain: Domain::Music,
        request_type: "DeleteAlbumRequest",
        response_type: "DeleteAlbumResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "update_album",
        path: "/api/albums/update",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UpdateAlbumRequest",
        response_type: "Album",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "get_album_images",
        path: "/api/albums/{id}/images",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "String",
        response_type: "Vec<String>",
        auth: RouteAuth::Authenticated,
    },
];

/// query albums
///
/// path: POST /api/albums/query
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

    let response = query_albums(params).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get album by id (path param)
///
/// path: GET /api/albums/{id}
pub async fn get(_caller: &Caller, id: &str, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    // note: the underlying get_album doesn't support include_songs or user_id params yet
    // those would need to be added if needed for favorites/ratings
    let response = grimoire_get_album(id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get album images (path param)
///
/// path: GET /api/albums/{id}/images
pub async fn get_images(
    _caller: &Caller,
    id: &str,
    _body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let response = grimoire_get_album_images(id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// update album
///
/// path: POST /api/albums/update
pub async fn update(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let mut req: UpdateAlbumRequest = match serde_json::from_value(body) {
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

    let response = grimoire_update_album(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// delete album (path param)
///
/// path: DELETE /api/albums/{id}
pub async fn delete(caller: &Caller, id: &str, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let response = grimoire_delete_album(id, Some(caller.user_id.clone())).await;
    response.map(|_| JsonValue::Null)
}

/// delete image
///
/// path: POST /api/music/images/delete
pub async fn delete_image(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: DeleteImageRequest = match serde_json::from_value(body) {
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

    // dispatch to the correct entity's remove image function
    let response = match req.entity_type.as_str() {
        "song" => remove_song_image(&req.entity_id, &req.blob_id).await,
        "album" => remove_album_image(&req.entity_id, &req.blob_id).await,
        "artist" => remove_artist_image(&req.entity_id, &req.blob_id).await,
        "playlist" => remove_playlist_image(&req.entity_id, &req.blob_id).await,
        _ => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "unsupported entity type",
                    &format!("entity_type '{}' not supported", req.entity_type),
                )],
            )
        }
    };
    response.map(|_| JsonValue::Null)
}

/// set primary image
///
/// path: POST /api/music/images/set-primary
pub async fn set_primary_image(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: SetPrimaryImageRequest = match serde_json::from_value(body) {
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

    // dispatch to the correct entity's set primary image function
    let response = match req.entity_type.as_str() {
        "song" => set_primary_song_image(&req.entity_id, &req.blob_id).await,
        "album" => set_primary_album_image(&req.entity_id, &req.blob_id).await,
        "artist" => set_primary_artist_image(&req.entity_id, &req.blob_id).await,
        "playlist" => set_primary_playlist_image(&req.entity_id, &req.blob_id).await,
        _ => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "unsupported entity type",
                    &format!("entity_type '{}' not supported", req.entity_type),
                )],
            )
        }
    };
    response.map(|_| JsonValue::Null)
}
