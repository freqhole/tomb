//! analytics handlers

use axum::{
    extract::{Extension, Path},
    Json,
};
use grimoire::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use grimoire::music::analytics::{
    create_listen_session, create_play_event, delete_listen_session, get_combined_feed,
    get_listen_session, get_song_play_analytics, get_top_albums, get_top_artists, get_top_songs,
    get_user_listening_history, list_listen_sessions, record_play_event,
    update_listen_session_progress, update_listen_session_songs, update_listen_session_status,
    CreateListenSessionRequest, FeedRequest, FeedResponse, ListListenSessionsRequest,
    ListListenSessionsResponse, ListenSession, ListeningHistoryRequest, ListeningHistoryResponse,
    PlayAnalytics, RecordPlayRequest, SongAnalyticsRequest, TopAlbum, TopAlbumsRequest, TopArtist,
    TopArtistsRequest, TopSong, TopSongsRequest, UpdateListenSessionProgressRequest,
    UpdateListenSessionSongsRequest,
};
use grimoire::response::GrimoireResponse;
use grimoire::users::UserRole;
use grimoire::EmptyResponse;

use crate::auth::{check_owner, AuthenticatedUser};
use crate::error::ApiError;

// helper to map GrimoireResponse errors to appropriate ApiError
fn map_response_error<T>(response: &GrimoireResponse<T>) -> ApiError {
    // check for specific error types that should map to 404
    let is_not_found = response
        .errors
        .iter()
        .any(|e| e.error_type == "session_not_found");

    if is_not_found {
        ApiError::NotFound
    } else {
        ApiError::Internal(response.message.clone())
    }
}

/// record a play event
pub async fn record_play_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<RecordPlayRequest>,
) -> Result<Json<EmptyResponse>, ApiError> {
    // create play event with authenticated user id
    let (media_event, music_event) = create_play_event(
        req.media_blob_id,
        req.song_id,
        Some(user.user_id.clone()),
        req.session_id,
        req.event_data,
    );

    let response = record_play_event(&media_event, &music_event).await;

    response
        .data
        .map(|_| Json(EmptyResponse::ok()))
        .ok_or_else(|| ApiError::Internal(response.message))
}

inventory::submit! {
    RouteInfo {
        name: "record_play",
        path: "/api/analytics/play",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "RecordPlayRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Member),
    }
}

/// get listening history for user
pub async fn listening_history_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<ListeningHistoryRequest>,
) -> Result<Json<ListeningHistoryResponse>, ApiError> {
    // use authenticated user id if not specified
    let user_id = req.user_id.unwrap_or(user.user_id);
    let limit = req.limit.unwrap_or(50);
    let offset = req.offset.unwrap_or(0);

    let response = get_user_listening_history(&user_id, limit, offset).await;

    response
        .data
        .map(|(items, total)| Json(ListeningHistoryResponse { items, total }))
        .ok_or_else(|| ApiError::Internal(response.message))
}

inventory::submit! {
    RouteInfo {
        name: "listening_history",
        path: "/api/analytics/listening-history",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ListeningHistoryRequest",
        response_type: "ListeningHistoryResponse",
        auth: RouteAuth::Authenticated,
    }
}

/// get song play analytics
pub async fn song_analytics_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<SongAnalyticsRequest>,
) -> Result<Json<PlayAnalytics>, ApiError> {
    let response = get_song_play_analytics(&req.song_id).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "song_analytics",
        path: "/api/analytics/song-stats",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SongAnalyticsRequest",
        response_type: "PlayAnalytics",
        auth: RouteAuth::Authenticated,
    }
}

/// get top songs
pub async fn top_songs_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<TopSongsRequest>,
) -> Result<Json<Vec<TopSong>>, ApiError> {
    let limit = req.limit.unwrap_or(50);

    // note: days filter not implemented yet in grimoire, ignored for now
    let response = get_top_songs(limit).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "top_songs",
        path: "/api/analytics/top-songs",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "TopSongsRequest",
        response_type: "Vec<TopSong>",
        auth: RouteAuth::Authenticated,
    }
}

/// get top albums
pub async fn top_albums_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<TopAlbumsRequest>,
) -> Result<Json<Vec<TopAlbum>>, ApiError> {
    let limit = req.limit.unwrap_or(50);

    // note: days filter not implemented yet in grimoire, ignored for now
    let response = get_top_albums(limit).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "top_albums",
        path: "/api/analytics/top-albums",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "TopAlbumsRequest",
        response_type: "Vec<TopAlbum>",
        auth: RouteAuth::Authenticated,
    }
}

/// get top artists
pub async fn top_artists_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<TopArtistsRequest>,
) -> Result<Json<Vec<TopArtist>>, ApiError> {
    let limit = req.limit.unwrap_or(50);

    // note: days filter not implemented yet in grimoire, ignored for now
    let response = get_top_artists(limit).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "top_artists",
        path: "/api/analytics/top-artists",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "TopArtistsRequest",
        response_type: "Vec<TopArtist>",
        auth: RouteAuth::Authenticated,
    }
}

/// get combined activity feed
pub async fn feed_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<FeedRequest>,
) -> Result<Json<FeedResponse>, ApiError> {
    let limit = req.limit.unwrap_or(50);
    let offset = req.offset.unwrap_or(0);

    let response = get_combined_feed(
        limit,
        offset,
        req.feed_types.as_deref(),
        req.user_id.as_deref(),
        Some(&user.user_id),
    )
    .await;

    response
        .data
        .map(|(items, total)| Json(FeedResponse { items, total }))
        .ok_or_else(|| ApiError::Internal(response.message))
}

inventory::submit! {
    RouteInfo {
        name: "activity_feed",
        path: "/api/analytics/feed",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "FeedRequest",
        response_type: "FeedResponse",
        auth: RouteAuth::Authenticated,
    }
}

/// create a new listen session
pub async fn create_listen_session_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<CreateListenSessionRequest>,
) -> Result<Json<ListenSession>, ApiError> {
    let response = create_listen_session(&user.user_id, &req).await;

    response
        .data
        .ok_or_else(|| ApiError::Internal(response.message))
        .map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "create_listen_session",
        path: "/api/analytics/sessions",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "CreateListenSessionRequest",
        response_type: "ListenSession",
        auth: RouteAuth::Role(UserRole::Member),
    }
}

/// list listen sessions
pub async fn list_listen_sessions_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<ListListenSessionsRequest>,
) -> Result<Json<ListListenSessionsResponse>, ApiError> {
    // always scope to the authenticated user's sessions
    let mut req = req;
    req.user_id = Some(user.user_id.clone());

    let response = list_listen_sessions(&req).await;

    response
        .data
        .map(|(items, total)| Json(ListListenSessionsResponse { items, total }))
        .ok_or_else(|| ApiError::Internal(response.message))
}

inventory::submit! {
    RouteInfo {
        name: "list_listen_sessions",
        path: "/api/analytics/sessions/list",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ListListenSessionsRequest",
        response_type: "ListListenSessionsResponse",
        auth: RouteAuth::Authenticated,
    }
}

/// get a single listen session (readable by any authenticated user)
pub async fn get_listen_session_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> Result<Json<ListenSession>, ApiError> {
    let response = get_listen_session(&id).await;

    response.data.ok_or_else(|| ApiError::NotFound).map(Json)
}

inventory::submit! {
    RouteInfo {
        name: "get_listen_session",
        path: "/api/analytics/sessions/{id}",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "String",
        response_type: "ListenSession",
        auth: RouteAuth::Authenticated,
    }
}

/// update listen session progress
pub async fn update_listen_session_progress_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
    Json(req): Json<UpdateListenSessionProgressRequest>,
) -> Result<Json<EmptyResponse>, ApiError> {
    let response = update_listen_session_progress(&id, &user.user_id, &req).await;

    if response.success {
        Ok(Json(EmptyResponse::ok()))
    } else {
        Err(map_response_error(&response))
    }
}

inventory::submit! {
    RouteInfo {
        name: "update_listen_session_progress",
        path: "/api/analytics/sessions/{id}/progress",
        method: Method::PUT,
        domain: Domain::Music,
        request_type: "UpdateListenSessionProgressRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Owner,
    }
}

/// update listen session songs (queue sync)
pub async fn update_listen_session_songs_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
    Json(req): Json<UpdateListenSessionSongsRequest>,
) -> Result<Json<EmptyResponse>, ApiError> {
    let response = update_listen_session_songs(&id, &user.user_id, &req).await;

    if response.success {
        Ok(Json(EmptyResponse::ok()))
    } else {
        Err(map_response_error(&response))
    }
}

inventory::submit! {
    RouteInfo {
        name: "update_listen_session_songs",
        path: "/api/analytics/sessions/{id}/songs",
        method: Method::PUT,
        domain: Domain::Music,
        request_type: "UpdateListenSessionSongsRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Owner,
    }
}

/// update listen session status (complete, abandon, pause)
pub async fn update_listen_session_status_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Path((id, status)): Path<(String, String)>,
) -> Result<Json<EmptyResponse>, ApiError> {
    // validate status
    let valid_statuses = ["active", "paused", "completed", "abandoned"];
    if !valid_statuses.contains(&status.as_str()) {
        return Err(ApiError::BadRequest(format!(
            "invalid status: {}. must be one of: {}",
            status,
            valid_statuses.join(", ")
        )));
    }

    let response = update_listen_session_status(&id, &user.user_id, &status).await;

    if response.success {
        Ok(Json(EmptyResponse::ok()))
    } else {
        Err(map_response_error(&response))
    }
}

inventory::submit! {
    RouteInfo {
        name: "update_listen_session_status",
        path: "/api/analytics/sessions/{id}/status/{status}",
        method: Method::PUT,
        domain: Domain::Music,
        request_type: "String",
        response_type: "EmptyResponse",
        auth: RouteAuth::Owner,
    }
}

/// delete a listen session
/// only the owner can delete their session (no admin override for listen sessions)
pub async fn delete_listen_session_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> Result<Json<EmptyResponse>, ApiError> {
    // fetch session to check ownership
    let session_response = get_listen_session(&id).await;
    let session = session_response.data.ok_or(ApiError::NotFound)?;

    // strictly owner only, no admin override for listen sessions
    check_owner(&user, Some(&session.user_id))?;

    let response = delete_listen_session(&id).await;

    if response.success {
        Ok(Json(EmptyResponse::ok()))
    } else if response.message.contains("not found") {
        Err(ApiError::NotFound)
    } else {
        Err(ApiError::Internal(response.message))
    }
}

inventory::submit! {
    RouteInfo {
        name: "delete_listen_session",
        path: "/api/analytics/sessions/{id}",
        method: Method::DELETE,
        domain: Domain::Music,
        request_type: "String",
        response_type: "EmptyResponse",
        auth: RouteAuth::Owner,
    }
}
