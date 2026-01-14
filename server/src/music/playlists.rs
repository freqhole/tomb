//! playlist handlers

use axum::{
    extract::{Extension, Path},
    Json,
};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::music::crud::{query_playlists, QueryParams};
use grimoire::music::entities::playlists::{
    add_songs_to_playlist, create_playlist, delete_playlist, get_playlist,
    remove_playlist_thumbnail, remove_songs_from_playlist, update_playlist, update_songs_position,
    AddSongsToPlaylistRequest, CreatePlaylistRequest, DeletePlaylistRequest, Playlist,
    RemovePlaylistThumbnailRequest, RemoveSongsFromPlaylistRequest, ReorderPlaylistSongsRequest,
    UpdatePlaylistRequest,
};
use grimoire::EmptyResponse;

use crate::{auth::middleware::AuthenticatedUser, error::ApiError};

/// list playlists
pub async fn list_playlists(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(params): Json<QueryParams>,
) -> Result<Json<serde_json::Value>, ApiError> {
    let response = query_playlists(params).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(|data| Json(serde_json::to_value(data).unwrap()))
}

inventory::submit! {
    RouteInfo {
        name: "list_playlists",
        path: "/api/music/playlists/list",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryParams",
        response_type: "Vec<PlaylistQueryResult>",
    }
}

/// create a new playlist
pub async fn create_playlist_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(mut req): Json<CreatePlaylistRequest>,
) -> Result<Json<Playlist>, ApiError> {
    // inject authenticated user id
    req.created_by_id = Some(user.user_id);

    let response = create_playlist(req).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "create_playlist",
        path: "/api/music/playlists",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "CreatePlaylistRequest",
        response_type: "Playlist",
    }
}

/// get a playlist by id
pub async fn get_playlist_by_id(
    Extension(_user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> Result<Json<Playlist>, ApiError> {
    let response = get_playlist(&id).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "get_playlist_by_id",
        path: "/api/music/playlists/{id}",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "String",
        response_type: "Playlist",
    }
}

/// update playlist metadata
pub async fn update_playlist_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(mut req): Json<UpdatePlaylistRequest>,
) -> Result<Json<Playlist>, ApiError> {
    // inject authenticated user id for audit trail
    if req.updated_by.is_none() {
        req.updated_by = Some(user.user_id);
    }

    let playlist_id = req.playlist_id.clone();
    let response = update_playlist(&playlist_id, req).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "update_playlist",
        path: "/api/playlists/update",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UpdatePlaylistRequest",
        response_type: "Playlist",
    }
}

/// delete a playlist (soft delete)
pub async fn delete_playlist_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<DeletePlaylistRequest>,
) -> Result<Json<EmptyResponse>, ApiError> {
    let deleted_by = req.deleted_by.or(Some(user.user_id));
    let response = delete_playlist(&req.playlist_id, deleted_by).await;

    response
        .data
        .map(|_| Json(EmptyResponse::ok()))
        .ok_or_else(|| ApiError::Internal(response.message))
}

inventory::submit! {
    RouteInfo {
        name: "delete_playlist",
        path: "/api/playlists/delete",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "DeletePlaylistRequest",
        response_type: "EmptyResponse",
    }
}

/// add songs to a playlist
pub async fn add_songs_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<AddSongsToPlaylistRequest>,
) -> Result<Json<EmptyResponse>, ApiError> {
    let response = add_songs_to_playlist(&req.playlist_id, &req.song_ids).await;

    response
        .data
        .map(|_| Json(EmptyResponse::ok()))
        .ok_or_else(|| ApiError::Internal(response.message))
}

inventory::submit! {
    RouteInfo {
        name: "add_songs_to_playlist",
        path: "/api/playlists/add-songs",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "AddSongsToPlaylistRequest",
        response_type: "EmptyResponse",
    }
}

/// remove songs from a playlist
pub async fn remove_songs_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<RemoveSongsFromPlaylistRequest>,
) -> Result<Json<EmptyResponse>, ApiError> {
    let response = remove_songs_from_playlist(&req.playlist_id, req.song_ids).await;

    response
        .data
        .map(|_| Json(EmptyResponse::ok()))
        .ok_or_else(|| ApiError::Internal(response.message))
}

inventory::submit! {
    RouteInfo {
        name: "remove_songs_from_playlist",
        path: "/api/playlists/remove-songs",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "RemoveSongsFromPlaylistRequest",
        response_type: "EmptyResponse",
    }
}

/// reorder songs in a playlist
pub async fn reorder_songs_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<ReorderPlaylistSongsRequest>,
) -> Result<Json<EmptyResponse>, ApiError> {
    // convert Vec<String> to Vec<&str> for the grimoire function
    let song_ids_refs: Vec<&str> = req.song_ids.iter().map(|s| s.as_str()).collect();
    let response = update_songs_position(&req.playlist_id, &song_ids_refs, req.new_position).await;

    response
        .data
        .map(|_| Json(EmptyResponse::ok()))
        .ok_or_else(|| ApiError::Internal(response.message))
}

inventory::submit! {
    RouteInfo {
        name: "reorder_playlist_songs",
        path: "/api/playlists/reorder",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ReorderPlaylistSongsRequest",
        response_type: "EmptyResponse",
    }
}

/// remove playlist thumbnail
pub async fn remove_thumbnail_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<RemovePlaylistThumbnailRequest>,
) -> Result<Json<Playlist>, ApiError> {
    let cleanup = req.cleanup_blob.unwrap_or(false);
    let deleted_by = req.deleted_by.or(Some(user.user_id));
    let response = remove_playlist_thumbnail(&req.playlist_id, cleanup, deleted_by).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "remove_playlist_thumbnail",
        path: "/api/playlists/remove-thumbnail",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "RemovePlaylistThumbnailRequest",
        response_type: "Playlist",
    }
}
