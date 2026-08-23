//! video series API handlers

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use zod_gen_derive::ZodSchema;

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use crate::video::{
    create_video_series, delete_video_series as grimoire_delete_video_series, get_series_detail,
    get_video_series, list_video_seriez, update_video_series as grimoire_update_video_series,
    CreateVideoSeriesRequest, UpdateVideoSeriesRequest,
};

/// request for getting or deleting a video series by id
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetVideoSeriesRequest {
    pub id: String,
}

/// request for listing video series
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListVideoSeriesRequest {
    pub limit: Option<u32>,
    pub offset: Option<u32>,
}

/// request for deleting a video series
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct DeleteVideoSeriesRequest {
    pub id: String,
}

/// route metadata for video series
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "create_video_series",
        path: "/api/video/series",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "CreateVideoSeriesRequest",
        response_type: "VideoSeries",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "list_video_series",
        path: "/api/video/series/list",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "ListVideoSeriesRequest",
        response_type: "Vec<VideoSeries>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_video_series",
        path: "/api/video/series/get",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "GetVideoSeriesRequest",
        response_type: "VideoSeries",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_video_series_detail",
        path: "/api/video/series/detail",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "GetVideoSeriesRequest",
        response_type: "SeriesDetail",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "update_video_series",
        path: "/api/video/series/update",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "UpdateVideoSeriesRequest",
        response_type: "VideoSeries",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "delete_video_series",
        path: "/api/video/series/delete",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "DeleteVideoSeriesRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
];

/// create a video series
///
/// path: POST /api/video/series
pub async fn create(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = crate::acl_bridge::require_scope(caller, "create_video_series").await {
        return resp;
    }

    let mut req: CreateVideoSeriesRequest = match serde_json::from_value(body) {
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

    let response = create_video_series(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// list video series
///
/// path: POST /api/video/series/list
pub async fn list(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ListVideoSeriesRequest = match serde_json::from_value(body) {
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

    let response = list_video_seriez(req.limit, req.offset).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get a video series by id
///
/// path: POST /api/video/series/get
pub async fn get(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetVideoSeriesRequest = match serde_json::from_value(body) {
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

    let response = get_video_series(&req.id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get a video series plus every season (with its videos) and any
/// season-less videos attached directly to it
///
/// path: POST /api/video/series/detail
pub async fn detail(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetVideoSeriesRequest = match serde_json::from_value(body) {
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

    let response = get_series_detail(&req.id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// update a video series
///
/// path: POST /api/video/series/update
pub async fn update(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = crate::acl_bridge::require_scope(caller, "update_video_series").await {
        return resp;
    }

    let mut req: UpdateVideoSeriesRequest = match serde_json::from_value(body) {
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

    let response = grimoire_update_video_series(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// delete a video series, cascading to its seasons/videos and cleaning up
/// entity_taxonz/playlist_itemz/playback_progressz rows
///
/// path: POST /api/video/series/delete
pub async fn delete(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = crate::acl_bridge::require_scope(caller, "delete_video_series").await {
        return resp;
    }

    let req: DeleteVideoSeriesRequest = match serde_json::from_value(body) {
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

    let response = grimoire_delete_video_series(&req.id, Some(caller.user_id.clone())).await;
    response.map(|_| JsonValue::Null)
}
