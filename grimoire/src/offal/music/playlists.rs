//! playlist API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::crud::{
    query_playlist_songs as grimoire_query_playlist_songs, query_playlists, QueryParams,
    QueryPlaylistSongsRequest,
};
use crate::music::entities::playlists::{
    add_songs_to_playlist, create_playlist, delete_playlist as grimoire_delete_playlist,
    get_playlist, get_playlist_images as grimoire_get_playlist_images, remove_songs_from_playlist,
    update_playlist as grimoire_update_playlist, update_songs_position, AddSongsToPlaylistRequest,
    CreatePlaylistRequest, DeletePlaylistRequest, GetPlaylistRequest,
    RemoveSongsFromPlaylistRequest, ReorderPlaylistSongsRequest, UpdatePlaylistRequest,
};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use serde_json::Value as JsonValue;

/// route metadata for playlists
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "list_playlists",
        path: "/api/music/playlists/list",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryParams",
        response_type: "PlaylistsQueryResult",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "create_playlist",
        path: "/api/music/playlists",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "CreatePlaylistRequest",
        response_type: "Playlist",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "get_playlist_by_id",
        path: "/api/music/playlists/get",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetPlaylistRequest",
        response_type: "Playlist",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_playlist_etag",
        path: "/api/music/playlists/etag",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetPlaylistRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_playlist_images",
        path: "/api/playlists/images",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetPlaylistRequest",
        response_type: "Vec<String>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "update_playlist",
        path: "/api/playlists/update",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UpdatePlaylistRequest",
        response_type: "Playlist",
        auth: RouteAuth::OwnerOr(UserRole::Admin),
    },
    RouteInfo {
        name: "delete_playlist",
        path: "/api/playlists/delete",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "DeletePlaylistRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::OwnerOr(UserRole::Admin),
    },
    RouteInfo {
        name: "add_songs_to_playlist",
        path: "/api/playlists/add-songs",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "AddSongsToPlaylistRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::OwnerOr(UserRole::Admin),
    },
    RouteInfo {
        name: "remove_songs_from_playlist",
        path: "/api/playlists/remove-songs",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "RemoveSongsFromPlaylistRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::OwnerOr(UserRole::Admin),
    },
    RouteInfo {
        name: "reorder_playlist_songs",
        path: "/api/playlists/reorder",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ReorderPlaylistSongsRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::OwnerOr(UserRole::Admin),
    },
    RouteInfo {
        name: "query_playlist_songs",
        path: "/api/playlists/songs",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryPlaylistSongsRequest",
        response_type: "PlaylistSongsQueryResult",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "record_playlist_play",
        path: "/api/playlists/record-play",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetPlaylistRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Authenticated,
    },
];

/// list playlists
///
/// path: POST /api/music/playlists/list
pub async fn list(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
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

    // determine the target user_id for favorites/ratings
    let target_user_id = match &params.user_id {
        Some(uid) if uid != &caller.user_id => {
            // requesting data for a different user - must be admin
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

    let response = query_playlists(params).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// create a new playlist
///
/// path: POST /api/music/playlists
pub async fn create(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_member() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new(
                "forbidden",
                "forbidden",
                "must be member to create playlists",
            )],
        );
    }

    let mut req: CreatePlaylistRequest = match serde_json::from_value(body) {
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

    // inject caller as creator
    req.created_by_id = Some(caller.user_id.clone());

    let response = create_playlist(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get playlist by id
///
/// path: POST /api/music/playlists/get
pub async fn get(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetPlaylistRequest = match serde_json::from_value(body) {
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

    let response = get_playlist(&req.id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get playlist etag
///
/// path: POST /api/music/playlists/etag
pub async fn get_etag(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetPlaylistRequest = match serde_json::from_value(body) {
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

    let response = get_playlist(&req.id).await;
    response.map(|playlist| {
        serde_json::json!({
            "etag": playlist.updated_at.to_string()
        })
    })
}

/// get playlist images
///
/// path: POST /api/playlists/images
pub async fn get_images(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetPlaylistRequest = match serde_json::from_value(body) {
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

    let response = grimoire_get_playlist_images(&req.id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// update playlist
///
/// path: POST /api/playlists/update
pub async fn update(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: UpdatePlaylistRequest = match serde_json::from_value(body) {
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

    // check ownership
    let playlist_response = get_playlist(&req.playlist_id).await;
    if let Some(playlist) = &playlist_response.data {
        if playlist.created_by_id.as_ref() != Some(&caller.user_id) && !caller.is_admin() {
            return GrimoireResponse::failure(
                "forbidden",
                vec![ErrorDetail::new(
                    "forbidden",
                    "forbidden",
                    "can only update your own playlists",
                )],
            );
        }
    }

    let id = req.playlist_id.clone();
    let response = grimoire_update_playlist(&id, req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// delete playlist
///
/// path: POST /api/playlists/delete
pub async fn delete(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: DeletePlaylistRequest = match serde_json::from_value(body) {
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

    // check ownership
    let playlist_response = get_playlist(&req.playlist_id).await;
    if let Some(playlist) = &playlist_response.data {
        if playlist.created_by_id.as_ref() != Some(&caller.user_id) && !caller.is_admin() {
            return GrimoireResponse::failure(
                "forbidden",
                vec![ErrorDetail::new(
                    "forbidden",
                    "forbidden",
                    "can only delete your own playlists",
                )],
            );
        }
    }

    let response = grimoire_delete_playlist(&req.playlist_id, Some(caller.user_id.clone())).await;
    response.map(|_| JsonValue::Null)
}

/// add songs to playlist
///
/// path: POST /api/playlists/add-songs
pub async fn add_songs(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: AddSongsToPlaylistRequest = match serde_json::from_value(body) {
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

    // check ownership
    let playlist_response = get_playlist(&req.playlist_id).await;
    if let Some(playlist) = &playlist_response.data {
        if playlist.created_by_id.as_ref() != Some(&caller.user_id) && !caller.is_admin() {
            return GrimoireResponse::failure(
                "forbidden",
                vec![ErrorDetail::new(
                    "forbidden",
                    "forbidden",
                    "can only modify your own playlists",
                )],
            );
        }
    }

    let created_by = Some((caller.user_id.as_str(), caller.username.as_str()));
    let response = add_songs_to_playlist(&req.playlist_id, &req.song_ids, created_by).await;
    response.map(|_| JsonValue::Null)
}

/// remove songs from playlist
///
/// path: POST /api/playlists/remove-songs
pub async fn remove_songs(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RemoveSongsFromPlaylistRequest = match serde_json::from_value(body) {
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

    // check ownership
    let playlist_response = get_playlist(&req.playlist_id).await;
    if let Some(playlist) = &playlist_response.data {
        if playlist.created_by_id.as_ref() != Some(&caller.user_id) && !caller.is_admin() {
            return GrimoireResponse::failure(
                "forbidden",
                vec![ErrorDetail::new(
                    "forbidden",
                    "forbidden",
                    "can only modify your own playlists",
                )],
            );
        }
    }

    let created_by = Some((caller.user_id.as_str(), caller.username.as_str()));
    let response = remove_songs_from_playlist(&req.playlist_id, req.song_ids, created_by).await;
    response.map(|_| JsonValue::Null)
}

/// reorder playlist songs
///
/// path: POST /api/playlists/reorder
pub async fn reorder(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ReorderPlaylistSongsRequest = match serde_json::from_value(body) {
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

    // check ownership
    let playlist_response = get_playlist(&req.playlist_id).await;
    if let Some(playlist) = &playlist_response.data {
        if playlist.created_by_id.as_ref() != Some(&caller.user_id) && !caller.is_admin() {
            return GrimoireResponse::failure(
                "forbidden",
                vec![ErrorDetail::new(
                    "forbidden",
                    "forbidden",
                    "can only modify your own playlists",
                )],
            );
        }
    }

    // Convert Vec<String> to Vec<&str> for update_songs_position
    let song_ids: Vec<&str> = req.song_ids.iter().map(|s| s.as_str()).collect();
    let response = update_songs_position(&req.playlist_id, &song_ids, req.new_position).await;
    response.map(|_| JsonValue::Null)
}

/// query playlist songs
///
/// path: POST /api/playlists/songs
pub async fn query_songs(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: QueryPlaylistSongsRequest = match serde_json::from_value(body) {
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

    // Convert QueryPlaylistSongsRequest to QueryParams
    let params = QueryParams {
        q: req.q,
        sort_by: req.sort_by,
        sort_direction: req.sort_direction,
        limit: req.limit.map(|l| l as u32),
        offset: req.offset.map(|o| o as u32),
        user_id: Some(caller.user_id.clone()),
        ..Default::default()
    };

    let response = grimoire_query_playlist_songs(&req.playlist_id, params).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// record a playlist-initiated play (caller clicked "play" on a whole
/// playlist, not on a single song within it). inserts a marker row in
/// `music_play_eventz` with `playlist_id` set and `song_id = NULL`.
///
/// path: POST /api/playlists/record-play
pub async fn record_play(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetPlaylistRequest = match serde_json::from_value(body) {
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

    match crate::music::analytics::events::record_playlist_initiated_play(
        &req.id,
        &caller.user_id,
    )
    .await
    {
        Ok(_) => GrimoireResponse::success("playlist play recorded", JsonValue::Null),
        Err(e) => GrimoireResponse::failure(
            "failed to record playlist play",
            vec![ErrorDetail::new(
                "internal_error",
                "internal error",
                &e.to_string(),
            )],
        ),
    }
}
