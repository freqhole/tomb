//! playback / resume progress API handlers (video domain)
//!
//! exposes the already-implemented `crate::video::crud::playback_progressz`
//! functions over http. `entity_type` is validated against
//! `VideoEntityType` (video/video_series/video_season) so callers can't
//! write garbage into the shared `playback_progressz` table.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use zod_gen_derive::ZodSchema;

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::video::{
    get_playback_progress, list_playback_progress_for_user, upsert_playback_progress,
    VideoEntityType,
};

/// request for saving playback progress for a video-domain entity
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

/// request for getting playback progress for a single video-domain entity
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetPlaybackProgressRequest {
    pub entity_type: String,
    pub entity_id: String,
}

/// request for listing the caller's most recently updated playback
/// progress rows (e.g. a "continue watching" rail)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListPlaybackProgressRequest {
    pub limit: Option<u32>,
}

/// route metadata for playback progress
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "upsert_playback_progress",
        path: "/api/video/progress/upsert",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "UpsertPlaybackProgressRequest",
        response_type: "PlaybackProgress",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_playback_progress",
        path: "/api/video/progress/get",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "GetPlaybackProgressRequest",
        // codegen's response_type -> zod schema mapping only special-cases
        // `Vec<T>` (not `Option<T>`), so this returns a 0-or-1-element list
        // rather than a nullable single object.
        response_type: "Vec<PlaybackProgress>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "list_playback_progress",
        path: "/api/video/progress/list",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "ListPlaybackProgressRequest",
        response_type: "Vec<PlaybackProgress>",
        auth: RouteAuth::Authenticated,
    },
];

fn parse_entity_type(entity_type: &str) -> Result<VideoEntityType, GrimoireResponse<JsonValue>> {
    VideoEntityType::parse(entity_type).map_err(|e| {
        GrimoireResponse::failure(
            "bad request",
            vec![ErrorDetail::new(
                "bad_request",
                "bad request",
                e.to_string(),
            )],
        )
    })
}

/// save (create or update) playback progress
///
/// path: POST /api/video/progress/upsert
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

    let entity_type = match parse_entity_type(&req.entity_type) {
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
/// path: POST /api/video/progress/get
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

    let entity_type = match parse_entity_type(&req.entity_type) {
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

/// list the caller's most recently updated playback progress rows
///
/// path: POST /api/video/progress/list
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

    let response = list_playback_progress_for_user(&caller.user_id, req.limit).await;

    match response.data {
        Some(rows) => {
            GrimoireResponse::success(&response.message, serde_json::to_value(rows).unwrap())
        }
        None => GrimoireResponse::failure(&response.message, response.errors),
    }
}
