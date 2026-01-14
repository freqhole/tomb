//! analytics handlers

use axum::{extract::Extension, Json};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::music::analytics::{
    create_play_event, get_combined_feed, get_song_play_analytics, get_top_albums, get_top_artists,
    get_top_songs, get_user_listening_history, record_play_event, FeedRequest, FeedResponse,
    ListeningHistoryRequest, ListeningHistoryResponse, PlayAnalytics, RecordPlayRequest,
    SongAnalyticsRequest, TopAlbum, TopAlbumsRequest, TopArtist, TopArtistsRequest, TopSong,
    TopSongsRequest,
};
use grimoire::EmptyResponse;

use crate::{auth::middleware::AuthenticatedUser, error::ApiError};

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
    }
}

/// get combined activity feed
pub async fn feed_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Json(req): Json<FeedRequest>,
) -> Result<Json<FeedResponse>, ApiError> {
    let limit = req.limit.unwrap_or(50);
    let offset = req.offset.unwrap_or(0);

    let response = get_combined_feed(limit, offset).await;

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
    }
}
