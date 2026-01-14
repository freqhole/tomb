//! Playlist handlers

use axum::{
    extract::{Extension, Path},
    Json,
};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::music::crud::{query_playlists, QueryParams};
use grimoire::music::entities::playlists::{
    create_playlist, get_playlist, CreatePlaylistRequest, Playlist,
};

use crate::{auth::middleware::AuthenticatedUser, error::ApiError};

/// List playlists
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

/// Create a new playlist
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

/// Get a playlist by id
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
