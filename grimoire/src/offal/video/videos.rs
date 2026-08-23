//! video API handlers

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use zod_gen_derive::ZodSchema;

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use crate::video::{
    create_video, delete_video as grimoire_delete_video, get_video, list_videos_by_season,
    list_videos_by_series, list_videos_unattached, update_video as grimoire_update_video,
    CreateVideoRequest, UpdateVideoRequest,
};

/// request for getting a video by id
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetVideoRequest {
    pub id: String,
}

/// request for listing every video attached to a series (season-grouped
/// and season-less alike)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListVideosBySeriesRequest {
    pub series_id: String,
}

/// request for listing every video in a season
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListVideosBySeasonRequest {
    pub season_id: String,
}

/// request for listing standalone videos (no series at all)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListVideosUnattachedRequest {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

/// request for deleting a video
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct DeleteVideoRequest {
    pub id: String,
}

/// route metadata for videos
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "create_video",
        path: "/api/video/videos",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "CreateVideoRequest",
        response_type: "Video",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "get_video",
        path: "/api/video/videos/get",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "GetVideoRequest",
        response_type: "Video",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "list_videos_by_series",
        path: "/api/video/videos/list-by-series",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "ListVideosBySeriesRequest",
        response_type: "Vec<Video>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "list_videos_by_season",
        path: "/api/video/videos/list-by-season",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "ListVideosBySeasonRequest",
        response_type: "Vec<Video>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "list_videos_unattached",
        path: "/api/video/videos/list-unattached",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "ListVideosUnattachedRequest",
        response_type: "Vec<Video>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "update_video",
        path: "/api/video/videos/update",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "UpdateVideoRequest",
        response_type: "Video",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "delete_video",
        path: "/api/video/videos/delete",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "DeleteVideoRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
];

/// create a video
///
/// path: POST /api/video/videos
pub async fn create(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = crate::acl_bridge::require_scope(caller, "create_video").await {
        return resp;
    }

    let mut req: CreateVideoRequest = match serde_json::from_value(body) {
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
    req.created_by = Some(caller.user_id.clone());

    let response = create_video(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get a video by id
///
/// path: POST /api/video/videos/get
pub async fn get(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetVideoRequest = match serde_json::from_value(body) {
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

    let response = get_video(&req.id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// list every video attached to a series
///
/// path: POST /api/video/videos/list-by-series
pub async fn list_by_series(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ListVideosBySeriesRequest = match serde_json::from_value(body) {
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

    let response = list_videos_by_series(&req.series_id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// list every video in a season
///
/// path: POST /api/video/videos/list-by-season
pub async fn list_by_season(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ListVideosBySeasonRequest = match serde_json::from_value(body) {
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

    let response = list_videos_by_season(&req.season_id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// list standalone videos (movies/clips with no series at all)
///
/// path: POST /api/video/videos/list-unattached
pub async fn list_unattached(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ListVideosUnattachedRequest = match serde_json::from_value(body) {
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

    let response = list_videos_unattached(req.limit, req.offset).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// update a video
///
/// path: POST /api/video/videos/update
pub async fn update(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = crate::acl_bridge::require_scope(caller, "update_video").await {
        return resp;
    }

    let mut req: UpdateVideoRequest = match serde_json::from_value(body) {
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
    req.updated_by = Some(caller.user_id.clone());

    let response = grimoire_update_video(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// delete a video, cleaning up entity_taxonz/playlist_itemz/
/// playback_progressz rows
///
/// path: POST /api/video/videos/delete
pub async fn delete(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = crate::acl_bridge::require_scope(caller, "delete_video").await {
        return resp;
    }

    let req: DeleteVideoRequest = match serde_json::from_value(body) {
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

    let response = grimoire_delete_video(&req.id, Some(caller.user_id.clone())).await;
    response.map(|_| JsonValue::Null)
}
