//! song API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::crud::{
    list_recent_songs, query_songs, update_songs as grimoire_update_songs,
    BulkClearSongArtworkRequest, BulkDeleteSongsRequest, DeleteSongRequest, QueryParams,
    RecentSongsRequest, UpdateSongsRequest,
};
use crate::music::entities::songs::{
    bulk_clear_song_artwork as grimoire_bulk_clear_artwork,
    bulk_delete_songs as grimoire_bulk_delete, delete_song as grimoire_delete_song,
};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use serde_json::Value as JsonValue;

/// route metadata for songs
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "query_songs",
        path: "/api/songs/query",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryParams",
        response_type: "SongsQueryResult",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "recent_songs",
        path: "/api/songs/recent",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "RecentSongsRequest",
        response_type: "Vec<Song>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "update_songs",
        path: "/api/songs/update",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UpdateSongsRequest",
        response_type: "UpdateSongsResult",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "bulk_delete_songs",
        path: "/api/songs/bulk-delete",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "BulkDeleteSongsRequest",
        response_type: "BulkDeleteSongsResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "bulk_clear_song_artwork",
        path: "/api/songs/bulk-clear-artwork",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "BulkClearSongArtworkRequest",
        response_type: "BulkClearSongArtworkResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "delete_song",
        path: "/api/songs/delete",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "DeleteSongRequest",
        response_type: "DeleteSongResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
];

/// query songs
///
/// path: POST /api/songs/query
pub async fn query(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let mut params: QueryParams = match serde_json::from_value(body) {
        Ok(p) => p,
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

    // determine the target user_id for favorites/ratings
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

    let response = query_songs(params).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get recent songs
///
/// path: POST /api/songs/recent
pub async fn recent(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RecentSongsRequest = match serde_json::from_value(body) {
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

    // note: list_recent_songs doesn't support user_id for favorites/ratings yet
    let response = list_recent_songs(req.limit).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// update songs
///
/// path: POST /api/songs/update
pub async fn update(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let mut req: UpdateSongsRequest = match serde_json::from_value(body) {
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

    // inject authenticated user id
    req.user_id = Some(caller.user_id.clone());
    req.updated_by = Some(caller.user_id.clone());

    // normalize the request (handles conflicts between different update fields)
    let req = req.normalize();

    let response = grimoire_update_songs(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// bulk delete songs
///
/// path: POST /api/songs/bulk-delete
pub async fn bulk_delete(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: BulkDeleteSongsRequest = match serde_json::from_value(body) {
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

    // Call the repository function with extracted fields
    let response = grimoire_bulk_delete(req.song_ids, Some(caller.user_id.clone())).await;
    let message = response.message.clone();
    GrimoireResponse::success(&message, serde_json::to_value(response).unwrap())
}

/// bulk clear song artwork
///
/// path: POST /api/songs/bulk-clear-artwork
pub async fn bulk_clear_artwork(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: BulkClearSongArtworkRequest = match serde_json::from_value(body) {
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

    // Call the repository function with extracted fields
    let response = grimoire_bulk_clear_artwork(req.song_ids).await;
    let message = response.message.clone();
    GrimoireResponse::success(&message, serde_json::to_value(response).unwrap())
}

/// delete a single song
///
/// path: POST /api/songs/delete
pub async fn delete(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: DeleteSongRequest = match serde_json::from_value(body) {
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

    let response = grimoire_delete_song(&req.id, Some(caller.user_id.clone())).await;
    response.map(|_| JsonValue::Null)
}
