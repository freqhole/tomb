//! video season API handlers

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use zod_gen_derive::ZodSchema;

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use crate::video::{
    create_video_season, delete_video_season as grimoire_delete_video_season, get_video_season,
    list_video_seasons, update_video_season as grimoire_update_video_season,
    CreateVideoSeasonRequest, UpdateVideoSeasonRequest,
};

/// request for getting a video season by id
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetVideoSeasonRequest {
    pub id: String,
}

/// request for listing seasons. `series_id = None` returns every season
/// in the library (bulk graph-viz fetch); `Some(id)` scopes to one series.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListVideoSeasonsRequest {
    #[serde(default)]
    pub series_id: Option<String>,
}

/// request for deleting a video season
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct DeleteVideoSeasonRequest {
    pub id: String,
}

/// route metadata for video seasons
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "create_video_season",
        path: "/api/video/seasons",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "CreateVideoSeasonRequest",
        response_type: "VideoSeason",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "list_video_seasons",
        path: "/api/video/seasons/list",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "ListVideoSeasonsRequest",
        response_type: "Vec<VideoSeason>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_video_season",
        path: "/api/video/seasons/get",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "GetVideoSeasonRequest",
        response_type: "VideoSeason",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "update_video_season",
        path: "/api/video/seasons/update",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "UpdateVideoSeasonRequest",
        response_type: "VideoSeason",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "delete_video_season",
        path: "/api/video/seasons/delete",
        method: Method::POST,
        domain: Domain::Video,
        request_type: "DeleteVideoSeasonRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
];

/// create a video season
///
/// path: POST /api/video/seasons
pub async fn create(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = crate::acl_bridge::require_scope(caller, "create_video_season").await {
        return resp;
    }

    let req: CreateVideoSeasonRequest = match serde_json::from_value(body) {
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

    let response = create_video_season(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// list seasons - every season in the library when `series_id` is
/// omitted, or every season in one series when it's set.
///
/// path: POST /api/video/seasons/list
pub async fn list(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ListVideoSeasonsRequest = match serde_json::from_value(body) {
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

    let response = list_video_seasons(req.series_id.as_deref()).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get a video season by id
///
/// path: POST /api/video/seasons/get
pub async fn get(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetVideoSeasonRequest = match serde_json::from_value(body) {
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

    let response = get_video_season(&req.id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// update a video season
///
/// path: POST /api/video/seasons/update
pub async fn update(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = crate::acl_bridge::require_scope(caller, "update_video_season").await {
        return resp;
    }

    let req: UpdateVideoSeasonRequest = match serde_json::from_value(body) {
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

    let response = grimoire_update_video_season(req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// delete a video season, cascading to its videos and cleaning up
/// entity_taxonz/playlist_itemz/playback_progressz rows
///
/// path: POST /api/video/seasons/delete
pub async fn delete(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = crate::acl_bridge::require_scope(caller, "delete_video_season").await {
        return resp;
    }

    let req: DeleteVideoSeasonRequest = match serde_json::from_value(body) {
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

    let response = grimoire_delete_video_season(&req.id, Some(caller.user_id.clone())).await;
    response.map(|_| JsonValue::Null)
}
