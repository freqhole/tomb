//! playlist handlers

use axum::{
    extract::{Extension, Path},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use grimoire::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use grimoire::music::crud::{
    query_playlist_songs, query_playlists, PlaylistSongsQueryResult, PlaylistsQueryResult,
    QueryParams, QueryPlaylistSongsRequest,
};
use grimoire::music::entities::playlists::{
    add_songs_to_playlist, compute_playlist_etag, create_playlist, delete_playlist, get_playlist,
    get_playlist_images, remove_songs_from_playlist, update_playlist, update_songs_position,
    AddSongsToPlaylistRequest, CreatePlaylistRequest, DeletePlaylistRequest, Playlist,
    RemoveSongsFromPlaylistRequest, ReorderPlaylistSongsRequest, UpdatePlaylistRequest,
};
use grimoire::users::UserRole;
use grimoire::EmptyResponse;

use crate::auth::{check_owner_or_admin, check_role, AuthenticatedUser};
use crate::error::ApiError;

/// list playlists
pub async fn list_playlists(
    Extension(auth_user): Extension<AuthenticatedUser>,
    Json(mut params): Json<QueryParams>,
) -> Result<Json<PlaylistsQueryResult>, ApiError> {
    // determine the target user_id for favorites/ratings
    let target_user_id = match &params.user_id {
        Some(uid) if uid != &auth_user.user_id => {
            // requesting data for a different user - must be admin
            check_role(&auth_user, UserRole::Admin)?;
            uid.clone()
        }
        Some(uid) => uid.clone(),
        None => auth_user.user_id.clone(),
    };

    // inject the resolved user_id into query params for favorite/rating lookups
    params.user_id = Some(target_user_id);

    tracing::debug!(
        "list_playlists: params={:?}, requesting_user={}",
        params,
        auth_user.user_id
    );

    let response = query_playlists(params).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(|data| Json(data.into()))
}

inventory::submit! {
    RouteInfo {
        name: "list_playlists",
        path: "/api/music/playlists/list",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryParams",
        response_type: "PlaylistsQueryResult",
        auth: RouteAuth::Authenticated,
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
        auth: RouteAuth::Role(UserRole::Member),
    }
}

/// get a playlist by id with etag support
pub async fn get_playlist_by_id(
    Extension(_user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    // compute etag for this playlist
    let etag_response = compute_playlist_etag(&id).await;
    let etag = etag_response
        .data
        .ok_or_else(|| ApiError::Internal(etag_response.message))?;

    // check if client sent If-None-Match header
    if let Some(if_none_match) = headers.get(header::IF_NONE_MATCH) {
        if let Ok(client_etag) = if_none_match.to_str() {
            if client_etag == etag {
                // etag matches, return 304 not modified
                return Ok((StatusCode::NOT_MODIFIED, [(header::ETAG, etag)]).into_response());
            }
        }
    }

    // fetch full playlist data
    let response = get_playlist(&id).await;

    let playlist = response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))?;

    // return playlist with etag header
    Ok(([(header::ETAG, etag)], Json(playlist)).into_response())
}

inventory::submit! {
    RouteInfo {
        name: "get_playlist_by_id",
        path: "/api/music/playlists/{id}",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "GetPlaylistRequest",
        response_type: "Playlist",
        auth: RouteAuth::Authenticated,
    }
}

/// get playlist etag only (HEAD request)
/// returns only etag header without body for cheap sync checks
pub async fn get_playlist_etag_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> Result<Response, ApiError> {
    // compute etag for this playlist
    let etag_response = compute_playlist_etag(&id).await;
    let etag = etag_response
        .data
        .ok_or_else(|| ApiError::Internal(etag_response.message))?;

    // return empty response with etag header
    Ok((StatusCode::OK, [(header::ETAG, etag)]).into_response())
}

inventory::submit! {
    RouteInfo {
        name: "get_playlist_etag",
        path: "/api/music/playlists/{id}/etag",
        method: Method::HEAD,
        domain: Domain::Music,
        request_type: "GetPlaylistRequest",
        response_type: "String",
        auth: RouteAuth::Authenticated,
    }
}

/// update playlist metadata
pub async fn update_playlist_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(mut req): Json<UpdatePlaylistRequest>,
) -> Result<Json<Playlist>, ApiError> {
    // fetch playlist to check ownership
    let playlist_response = get_playlist(&req.playlist_id).await;
    let playlist = playlist_response.data.ok_or(ApiError::NotFound)?;

    // check ownership: owner OR admin can update
    check_owner_or_admin(&user, playlist.created_by_id.as_deref())?;

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
        auth: RouteAuth::OwnerOr(UserRole::Admin),
    }
}

/// delete a playlist (soft delete)
/// owner or admin can delete, viewer/member cannot delete others' playlists
pub async fn delete_playlist_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<DeletePlaylistRequest>,
) -> Result<Json<EmptyResponse>, ApiError> {
    // fetch playlist to check ownership
    let playlist_response = get_playlist(&req.playlist_id).await;
    let playlist = playlist_response.data.ok_or(ApiError::NotFound)?;

    // check ownership: owner OR admin can delete
    check_owner_or_admin(&user, playlist.created_by_id.as_deref())?;

    let response = delete_playlist(&req.playlist_id, Some(user.user_id)).await;

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
        auth: RouteAuth::OwnerOr(UserRole::Admin),
    }
}

/// add songs to a playlist
pub async fn add_songs_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<AddSongsToPlaylistRequest>,
) -> Result<Json<EmptyResponse>, ApiError> {
    // fetch playlist to check ownership
    let playlist_response = get_playlist(&req.playlist_id).await;
    let playlist = playlist_response.data.ok_or(ApiError::NotFound)?;

    // check ownership: owner OR admin can add songs
    check_owner_or_admin(&user, playlist.created_by_id.as_deref())?;

    let response = add_songs_to_playlist(
        &req.playlist_id,
        &req.song_ids,
        Some((&user.user_id, &user.username)),
    )
    .await;

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
        auth: RouteAuth::OwnerOr(UserRole::Admin),
    }
}

/// remove songs from a playlist
pub async fn remove_songs_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<RemoveSongsFromPlaylistRequest>,
) -> Result<Json<EmptyResponse>, ApiError> {
    // fetch playlist to check ownership
    let playlist_response = get_playlist(&req.playlist_id).await;
    let playlist = playlist_response.data.ok_or(ApiError::NotFound)?;

    // check ownership: owner OR admin can remove songs
    check_owner_or_admin(&user, playlist.created_by_id.as_deref())?;

    let response = remove_songs_from_playlist(
        &req.playlist_id,
        req.song_ids,
        Some((&user.user_id, &user.username)),
    )
    .await;

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
        auth: RouteAuth::OwnerOr(UserRole::Admin),
    }
}

/// reorder songs in a playlist
pub async fn reorder_songs_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<ReorderPlaylistSongsRequest>,
) -> Result<Json<EmptyResponse>, ApiError> {
    // fetch playlist to check ownership
    let playlist_response = get_playlist(&req.playlist_id).await;
    let playlist = playlist_response.data.ok_or(ApiError::NotFound)?;

    // check ownership: owner OR admin can reorder songs
    check_owner_or_admin(&user, playlist.created_by_id.as_deref())?;

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
        name: "query_playlist_songs",
        path: "/api/playlists/songs",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "QueryPlaylistSongsRequest",
        response_type: "PlaylistSongsQueryResult",
        auth: RouteAuth::Authenticated,
    }
}

/// query playlist songs with full metadata
///
/// POST /api/playlists/songs
pub async fn query_playlist_songs_handler(
    Extension(auth_user): Extension<AuthenticatedUser>,
    Json(req): Json<QueryPlaylistSongsRequest>,
) -> Result<Json<PlaylistSongsQueryResult>, ApiError> {
    tracing::debug!(
        "query_playlist_songs: playlist_id={}, q={:?}, user_id={}",
        req.playlist_id,
        req.q,
        auth_user.user_id
    );

    let mut params = QueryParams {
        q: req.q,
        sort_by: req.sort_by,
        sort_direction: req.sort_direction,
        limit: req.limit.map(|l| l as u32),
        offset: req.offset.map(|o| o as u32),
        ..Default::default()
    };

    // inject authenticated user_id for favorites/ratings lookups
    params.user_id = Some(auth_user.user_id);

    let response = query_playlist_songs(&req.playlist_id, params).await;

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    let data = response.data.map(|qr| qr.into());

    data.ok_or_else(|| ApiError::Internal("No data returned".to_string()))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "reorder_playlist_songs",
        path: "/api/playlists/reorder",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ReorderPlaylistSongsRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::OwnerOr(UserRole::Admin),
    }
}

/// get all image blob IDs for a playlist and its related entities
pub async fn get_playlist_images_handler(
    Path(playlist_id): Path<String>,
) -> Result<Json<Vec<String>>, ApiError> {
    tracing::debug!("get_playlist_images: id={}", playlist_id);

    let response = get_playlist_images(&playlist_id).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "get_playlist_images",
        path: "/api/playlists/{id}/images",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "String",
        response_type: "Vec<String>",
        auth: RouteAuth::Authenticated,
    }
}
