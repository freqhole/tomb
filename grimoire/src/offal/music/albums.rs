//! album API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::crud::{query_albums, DeleteAlbumRequest, GetAlbumRequest, QueryParams};
use crate::music::entities::albums::metadata::{
    AutoConfirmMbMatchesRequest, ConfirmMbMatchRequest, MbMatchActionResponse, RejectMbMatchRequest,
};
use crate::music::entities::albums::{
    auto_confirm_mb_matches as grimoire_auto_confirm_mb_matches,
    confirm_mb_match as grimoire_confirm_mb_match, delete_album as grimoire_delete_album,
    get_album as grimoire_get_album, get_album_images as grimoire_get_album_images,
    reject_mb_match as grimoire_reject_mb_match, remove_album_image, set_primary_album_image,
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
        path: "/api/albums/get",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetAlbumRequest",
        response_type: "Album",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "delete_album",
        path: "/api/albums/delete",
        method: Method::POST,
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
        path: "/api/albums/images",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetAlbumRequest",
        response_type: "Vec<String>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "confirm_mb_match",
        path: "/api/albums/mb-confirm",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ConfirmMbMatchRequest",
        response_type: "MbMatchActionResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "reject_mb_match",
        path: "/api/albums/mb-reject",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "RejectMbMatchRequest",
        response_type: "MbMatchActionResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "auto_confirm_mb_matches",
        path: "/api/albums/mb-auto-confirm",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "AutoConfirmMbMatchesRequest",
        response_type: "AutoConfirmMbMatchesResult",
        auth: RouteAuth::Role(UserRole::Admin),
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

/// get album by id
///
/// path: POST /api/albums/get
pub async fn get(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetAlbumRequest = match serde_json::from_value(body) {
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

    let response = grimoire_get_album(&req.id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get album images
///
/// path: POST /api/albums/images
pub async fn get_images(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetAlbumRequest = match serde_json::from_value(body) {
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

    let response = grimoire_get_album_images(&req.id).await;
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

/// delete album
///
/// path: POST /api/albums/delete
pub async fn delete(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: DeleteAlbumRequest = match serde_json::from_value(body) {
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

    let response = grimoire_delete_album(&req.id, Some(caller.user_id.clone())).await;
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

/// confirm musicbrainz match
///
/// path: POST /api/albums/mb-confirm
pub async fn confirm_mb_match(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: ConfirmMbMatchRequest = match serde_json::from_value(body) {
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

    let response = grimoire_confirm_mb_match(
        &req.album_id,
        &req.release_group_id,
        req.release_id.as_deref(),
        &caller.user_id,
    )
    .await;

    let album_id = req.album_id.clone();
    response.map(|_meta| {
        serde_json::to_value(MbMatchActionResponse {
            album_id,
            status: crate::music::entities::albums::metadata::MbLookupStatus::Confirmed,
        })
        .unwrap()
    })
}

/// reject musicbrainz match
///
/// path: POST /api/albums/mb-reject
pub async fn reject_mb_match(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: RejectMbMatchRequest = match serde_json::from_value(body) {
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

    let response = grimoire_reject_mb_match(&req.album_id, &caller.user_id).await;

    let album_id = req.album_id.clone();
    response.map(|_meta| {
        serde_json::to_value(MbMatchActionResponse {
            album_id,
            status: crate::music::entities::albums::metadata::MbLookupStatus::Rejected,
        })
        .unwrap()
    })
}

/// auto-confirm musicbrainz matches in bulk
///
/// path: POST /api/albums/mb-auto-confirm
pub async fn auto_confirm_mb_matches(
    caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: AutoConfirmMbMatchesRequest = match serde_json::from_value(body) {
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

    let response = grimoire_auto_confirm_mb_matches(
        &req.album_ids,
        req.min_confidence,
        req.min_gap,
        &caller.user_id,
    )
    .await;

    response.map(|data| serde_json::to_value(data).unwrap())
}
