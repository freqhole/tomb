//! generic playback/resume progress API handlers (`playback_progressz`)
//!
//! domain-neutral - `entity_type` is validated against
//! `resolve_progress_entity_type` (video/video_series/video_season/song)
//! so callers can't write garbage into the shared `playback_progressz`
//! table. replaces the old video-only `/api/video/progress/*` routes
//! (`crate::offal::video::progress`), mirroring `playlist_items.rs`'s own
//! identical move once songs needed generalized playlist membership too.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use zod_gen_derive::ZodSchema;

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::playback_progress::{
    get_playback_progress, list_playback_progress_by_blake3, list_playback_progress_for_user,
    upsert_playback_progress,
};
use crate::response::GrimoireResponse;

use super::resolve_progress_entity_type;

/// request for saving playback progress for an entity
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpsertPlaybackProgressRequest {
    pub entity_type: String,
    pub entity_id: String,
    pub position_fraction: f64,
    pub position_seconds: Option<f64>,
    pub duration_seconds: Option<f64>,
    pub position_locator: Option<String>,
    pub completed_at: Option<i64>,
}

/// request for getting playback progress for a single entity
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetPlaybackProgressRequest {
    pub entity_type: String,
    pub entity_id: String,
}

/// request for listing playback progress rows. exactly one of `blake3_in`
/// (precise - every row whose content hash is in this list) or `limit`
/// (approximate - the caller's N most recently updated rows, any entity
/// type) should be used:
///
/// - a caller that already knows exactly which content it cares about
///   (e.g. "every episode in this series") should always use `blake3_in` -
///   precise and not subject to being crowded out by unrelated recent
///   activity the way a `limit`-capped recency scan would be.
/// - `limit` remains for a true global "continue watching"/"continue
///   listening" rail with no specific content set in mind.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListPlaybackProgressRequest {
    pub limit: Option<u32>,
    /// precise content-hash filter - see the struct doc comment above.
    /// when non-empty, this takes priority and `limit` is ignored.
    #[serde(default)]
    pub blake3_in: Option<Vec<String>>,
}

/// route metadata for generic playback progress
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "upsert_playback_progress",
        path: "/api/entities/progress/upsert",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "UpsertPlaybackProgressRequest",
        response_type: "PlaybackProgress",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_playback_progress",
        path: "/api/entities/progress/get",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "GetPlaybackProgressRequest",
        // codegen's response_type -> zod schema mapping only special-cases
        // `Vec<T>` (not `Option<T>`), so this returns a 0-or-1-element list
        // rather than a nullable single object.
        response_type: "Vec<PlaybackProgress>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "list_playback_progress",
        path: "/api/entities/progress/list",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "ListPlaybackProgressRequest",
        response_type: "Vec<PlaybackProgress>",
        auth: RouteAuth::Authenticated,
    },
];

/// save (create or update) playback progress
///
/// path: POST /api/entities/progress/upsert
pub async fn upsert(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: UpsertPlaybackProgressRequest = match serde_json::from_value(body) {
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

    let entity_type = match resolve_progress_entity_type(&req.entity_type) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let response = upsert_playback_progress(
        &caller.user_id,
        entity_type,
        &req.entity_id,
        req.position_fraction,
        req.position_seconds,
        req.duration_seconds,
        req.position_locator,
        req.completed_at,
    )
    .await;

    match response.data {
        Some(progress) => {
            GrimoireResponse::success(&response.message, serde_json::to_value(progress).unwrap())
        }
        None => GrimoireResponse::failure(&response.message, response.errors),
    }
}

/// get playback progress for a single entity
///
/// path: POST /api/entities/progress/get
///
/// returns a 0-or-1-element list (see the `Vec<PlaybackProgress>` note on
/// the route's response_type above) rather than a nullable single object.
pub async fn get(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetPlaybackProgressRequest = match serde_json::from_value(body) {
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

    let entity_type = match resolve_progress_entity_type(&req.entity_type) {
        Ok(t) => t,
        Err(e) => return e,
    };

    let response = get_playback_progress(&caller.user_id, entity_type, &req.entity_id).await;

    if response.data.is_none() && !response.success {
        return GrimoireResponse::failure(&response.message, response.errors);
    }

    let rows: Vec<_> = response.data.flatten().into_iter().collect();
    GrimoireResponse::success(&response.message, serde_json::to_value(rows).unwrap())
}

/// list the caller's playback progress rows - precise (`blake3_in`) or
/// recency-capped (`limit`), see `ListPlaybackProgressRequest`'s doc
/// comment.
///
/// path: POST /api/entities/progress/list
pub async fn list(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ListPlaybackProgressRequest = match serde_json::from_value(body) {
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

    let response = match req.blake3_in {
        Some(hashes) if !hashes.is_empty() => {
            list_playback_progress_by_blake3(&caller.user_id, &hashes).await
        }
        _ => list_playback_progress_for_user(&caller.user_id, req.limit).await,
    };

    match response.data {
        Some(rows) => {
            GrimoireResponse::success(&response.message, serde_json::to_value(rows).unwrap())
        }
        None => GrimoireResponse::failure(&response.message, response.errors),
    }
}
