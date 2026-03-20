//! analytics API handlers

use crate::analytics::MediaEvent;
use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::analytics::admin::{
    get_overview_stats, get_top_albums, get_top_artists, get_top_songs, get_user_stats,
};
use crate::music::analytics::events::{create_play_event, record_play_event};
use crate::music::analytics::queries::{get_song_play_analytics, get_user_listening_history};
use crate::music::analytics::MusicPlayEvent;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use serde::Deserialize;
use serde_json::Value as JsonValue;

/// route metadata for analytics
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "record_play",
        path: "/api/analytics/play",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "RecordPlayRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "listening_history",
        path: "/api/analytics/listening-history",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ListeningHistoryRequest",
        response_type: "ListeningHistoryResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "song_analytics",
        path: "/api/analytics/song-stats",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SongAnalyticsRequest",
        response_type: "PlayAnalytics",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "top_songs",
        path: "/api/analytics/top-songs",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "TopSongsRequest",
        response_type: "Vec<TopSong>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "top_albums",
        path: "/api/analytics/top-albums",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "TopAlbumsRequest",
        response_type: "Vec<TopAlbum>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "top_artists",
        path: "/api/analytics/top-artists",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "TopArtistsRequest",
        response_type: "Vec<TopArtist>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "activity_feed",
        path: "/api/analytics/feed",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "FeedRequest",
        response_type: "FeedResponse",
        auth: RouteAuth::Authenticated,
    },
];

/// record a play event (canonical endpoint)
///
/// path: POST /api/analytics/play
#[derive(Deserialize)]
struct RecordPlayRequest {
    media_blob_id: String,
    song_id: String,
    session_id: Option<String>,
    event_data: Option<serde_json::Value>,
}

pub async fn record_play(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RecordPlayRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "offal: record_play: bad request");
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            );
        }
    };

    tracing::debug!(
        user_id = %caller.user_id,
        media_blob_id = %req.media_blob_id,
        song_id = %req.song_id,
        session_id = ?req.session_id,
        "offal: record_play"
    );

    let (media_event, music_event) = create_play_event(
        req.media_blob_id,
        req.song_id,
        Some(caller.user_id.clone()),
        req.session_id,
        req.event_data,
    );

    let response = record_play_event(&media_event, &music_event).await;

    if !response.success {
        tracing::warn!(
            message = %response.message,
            errors = ?response.errors,
            "offal: record_play: failed"
        );
    }

    response.map(|_| JsonValue::Null)
}

/// record a play event (legacy endpoint with separate events)
///
/// path: POST /api/analytics/events
#[derive(Deserialize)]
struct RecordEventRequest {
    media_event: MediaEvent,
    play_event: MusicPlayEvent,
}

pub async fn record_event(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RecordEventRequest = match serde_json::from_value(body) {
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

    let response = record_play_event(&req.media_event, &req.play_event).await;
    response.map(|ids| serde_json::to_value(ids).unwrap())
}

/// get user listening history
///
/// path: POST /api/analytics/history
#[derive(Deserialize)]
struct HistoryRequest {
    user_id: Option<String>,
    limit: i64,
    offset: i64,
}

pub async fn history(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: HistoryRequest = match serde_json::from_value(body) {
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

    // can only query own history unless admin
    let target_user = match req.user_id {
        Some(uid) if uid != caller.user_id => {
            if caller.role != UserRole::Admin {
                return GrimoireResponse::failure(
                    "forbidden",
                    vec![ErrorDetail::new(
                        "forbidden",
                        "forbidden",
                        "cannot query another user's history",
                    )],
                );
            }
            uid
        }
        Some(uid) => uid,
        None => caller.user_id.clone(),
    };

    let response = get_user_listening_history(&target_user, req.limit, req.offset).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get analytics for a specific song
///
/// path: POST /api/analytics/song
#[derive(Deserialize)]
struct SongAnalyticsRequest {
    song_id: String,
}

pub async fn song_analytics(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: SongAnalyticsRequest = match serde_json::from_value(body) {
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

    let response = get_song_play_analytics(&req.song_id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get top songs (admin)
///
/// path: POST /api/analytics/top/songs
#[derive(Deserialize, Default)]
struct TopRequest {
    limit: Option<i64>,
}

pub async fn top_songs(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: TopRequest = serde_json::from_value(body).unwrap_or_default();
    let response = get_top_songs(req.limit.unwrap_or(50)).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get top albums (admin)
///
/// path: POST /api/analytics/top/albums
pub async fn top_albums(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: TopRequest = serde_json::from_value(body).unwrap_or_default();
    let response = get_top_albums(req.limit.unwrap_or(50)).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get top artists (admin)
///
/// path: POST /api/analytics/top/artists
pub async fn top_artists(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: TopRequest = serde_json::from_value(body).unwrap_or_default();
    let response = get_top_artists(req.limit.unwrap_or(50)).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get overview stats (admin)
///
/// path: POST /api/analytics/overview
pub async fn overview(caller: &Caller, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let response = get_overview_stats().await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get user stats
///
/// path: POST /api/analytics/user-stats
#[derive(Deserialize)]
struct UserStatsRequest {
    user_id: Option<String>,
}

pub async fn user_stats(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: UserStatsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(_) => UserStatsRequest { user_id: None },
    };

    let target_user = match req.user_id {
        Some(uid) if uid != caller.user_id => {
            if caller.role != UserRole::Admin {
                return GrimoireResponse::failure(
                    "forbidden",
                    vec![ErrorDetail::new(
                        "forbidden",
                        "forbidden",
                        "cannot query another user's stats",
                    )],
                );
            }
            uid
        }
        Some(uid) => uid,
        None => caller.user_id.clone(),
    };

    let response = get_user_stats(&target_user).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get feed events
///
/// path: POST /api/analytics/feed
#[derive(Deserialize)]
struct FeedRequest {
    limit: Option<i64>,
    offset: Option<i64>,
    feed_types: Option<Vec<crate::music::analytics::FeedItemType>>,
    user_id: Option<String>,
}

pub async fn feed(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: FeedRequest = match serde_json::from_value(body) {
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

    // admins can filter by user, non-admins see all feed
    let user_filter = match req.user_id {
        Some(uid) if caller.role != UserRole::Admin && uid != caller.user_id => {
            return GrimoireResponse::failure(
                "forbidden",
                vec![ErrorDetail::new(
                    "forbidden",
                    "forbidden",
                    "cannot filter by another user",
                )],
            );
        }
        x => x,
    };

    let limit = req.limit.unwrap_or(20);
    let offset = req.offset.unwrap_or(0);
    let feed_types = req.feed_types.as_deref();

    let response = crate::music::analytics::get_combined_feed(
        limit,
        offset,
        feed_types,
        user_filter.as_deref(),
        Some(&caller.user_id),
    )
    .await;

    response.map(|(items, total)| {
        serde_json::json!({
            "items": items,
            "total": total
        })
    })
}
