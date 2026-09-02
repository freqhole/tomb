//! cross-remote relation/walk API handlers for the video domain.
//!
//! mirrors `crate::offal::music::relations` but reads from
//! `entity_taxonz`/`videoz` instead of `album_taxonz`/`albumz`. these
//! back the "universal" domain synthesized hubs (era/recently_added/
//! unassigned) and the generic categorical relation hubs (genre/mood/
//! style/label/tag) when the graph view's video domain is toggled on.
//!
//! routes:
//! * `POST /api/video/relations/videos-by-value` — fetch the full
//!   member set of a `(taxon_kind, taxon_value)` hub's video content.
//! * `POST /api/video/relations/recently-added-videos` — synthesized
//!   "recently added" hub's video content.
//! * `POST /api/video/relations/unassigned-videos` — synthesized
//!   "unassigned" hub's video content.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use zod_gen_derive::ZodSchema;

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::video::entities::videos::Video;
use crate::video::{
    list_recently_added_videos, list_unassigned_videos, list_videos_by_taxon_value,
};

/// route metadata.
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "videos_by_value",
        path: "/api/video/relations/videos-by-value",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "VideosByValueRequest",
        response_type: "VideosByValueResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "recently_added_videos",
        path: "/api/video/relations/recently-added-videos",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "RecentlyAddedVideosRequest",
        response_type: "RecentlyAddedVideosResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "unassigned_videos",
        path: "/api/video/relations/unassigned-videos",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "UnassignedVideosRequest",
        response_type: "UnassignedVideosResponse",
        auth: RouteAuth::Authenticated,
    },
];

// ---- videos-by-value ----

/// list-videos-by-taxon-value request payload.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct VideosByValueRequest {
    /// taxon-kind slug (e.g. `"genre"`, `"mood"`).
    pub kind: String,
    /// the value as the client already normalized it. matched against
    /// either the taxon's slug or its label (case-insensitive).
    pub value_norm: String,
    /// optional page size, default 200, capped server-side at 1000.
    pub limit: Option<u32>,
    /// optional offset; future-proofing for cursor-based paging.
    pub offset: Option<u32>,
}

/// list-videos-by-taxon-value response wrapper.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct VideosByValueResponse {
    pub kind: String,
    pub value_norm: String,
    pub videos: Vec<Video>,
    pub count: u32,
}

/// path: POST /api/video/relations/videos-by-value
pub async fn videos_by_value(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: VideosByValueRequest = match serde_json::from_value(body) {
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

    let resp = list_videos_by_taxon_value(&req.kind, &req.value_norm, req.limit, req.offset).await;
    resp.map(|videos| {
        let count = videos.len() as u32;
        serde_json::to_value(VideosByValueResponse {
            kind: req.kind,
            value_norm: req.value_norm,
            videos,
            count,
        })
        .unwrap()
    })
}

// ---- recently-added-videos ----

/// recently-added-videos request.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RecentlyAddedVideosRequest {
    /// page size; default 200, capped server-side at 1000.
    #[serde(default)]
    pub limit: Option<u32>,
}

/// recently-added-videos response.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RecentlyAddedVideosResponse {
    pub videos: Vec<Video>,
    pub count: u32,
}

/// path: POST /api/video/relations/recently-added-videos
pub async fn recently_added_videos(
    _caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let req: RecentlyAddedVideosRequest = if body.is_null() {
        RecentlyAddedVideosRequest { limit: None }
    } else {
        match serde_json::from_value(body) {
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
        }
    };

    let resp = list_recently_added_videos(req.limit).await;
    resp.map(|videos| {
        let count = videos.len() as u32;
        serde_json::to_value(RecentlyAddedVideosResponse { videos, count }).unwrap()
    })
}

// ---- unassigned-videos ----

/// unassigned-videos request — fan out the synthesized "unassigned"
/// hub to its member videos.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UnassignedVideosRequest {
    /// page size; default 200, capped server-side at 1000.
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

/// unassigned-videos response.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UnassignedVideosResponse {
    pub videos: Vec<Video>,
    pub count: u32,
}

/// path: POST /api/video/relations/unassigned-videos
pub async fn unassigned_videos(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: UnassignedVideosRequest = if body.is_null() {
        UnassignedVideosRequest {
            limit: None,
            offset: None,
        }
    } else {
        match serde_json::from_value(body) {
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
        }
    };

    let resp = list_unassigned_videos(req.limit, req.offset).await;
    resp.map(|videos| {
        let count = videos.len() as u32;
        serde_json::to_value(UnassignedVideosResponse { videos, count }).unwrap()
    })
}
