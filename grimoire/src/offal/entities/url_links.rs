//! generic entity <-> url link API handlers (`entity_urlz`)

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use zod_gen_derive::ZodSchema;

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;

use super::resolve_video_entity_type;

/// request for listing every url linked to an entity
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetEntityUrlsRequest {
    pub entity_type: String,
    pub entity_id: String,
}

/// request for adding a named link to an entity
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AddEntityUrlRequest {
    pub entity_type: String,
    pub entity_id: String,
    pub name: Option<String>,
    pub url: String,
}

/// request for removing a link from an entity
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RemoveEntityUrlRequest {
    pub entity_type: String,
    pub entity_id: String,
    pub id: String,
}

/// route metadata for entity <-> url links
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "get_entity_urls",
        path: "/api/entities/urls/get",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "GetEntityUrlsRequest",
        response_type: "Vec<EntityUrl>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "add_entity_url",
        path: "/api/entities/urls/add",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "AddEntityUrlRequest",
        response_type: "EntityUrl",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "remove_entity_url",
        path: "/api/entities/urls/remove",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "RemoveEntityUrlRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
];

/// list every url linked to an entity
///
/// path: POST /api/entities/urls/get
pub async fn get(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetEntityUrlsRequest = match serde_json::from_value(body) {
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

    let entity_type = match resolve_video_entity_type(&req.entity_type) {
        Ok(t) => t,
        Err(resp) => return resp,
    };

    let response = crate::video::list_entity_urls(entity_type, &req.entity_id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// add a named link to an entity
///
/// path: POST /api/entities/urls/add
pub async fn add(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = crate::acl_bridge::require_scope(caller, "add_entity_url").await {
        return resp;
    }

    let req: AddEntityUrlRequest = match serde_json::from_value(body) {
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

    let entity_type = match resolve_video_entity_type(&req.entity_type) {
        Ok(t) => t,
        Err(resp) => return resp,
    };

    let response = crate::video::add_entity_url(
        entity_type,
        &req.entity_id,
        req.name,
        &req.url,
        Some(caller.user_id.clone()),
    )
    .await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// remove a link from an entity
///
/// path: POST /api/entities/urls/remove
pub async fn remove(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = crate::acl_bridge::require_scope(caller, "remove_entity_url").await {
        return resp;
    }

    let req: RemoveEntityUrlRequest = match serde_json::from_value(body) {
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

    let entity_type = match resolve_video_entity_type(&req.entity_type) {
        Ok(t) => t,
        Err(resp) => return resp,
    };

    let response = crate::video::remove_entity_url(entity_type, &req.entity_id, &req.id).await;
    response.map(|_| JsonValue::Null)
}
