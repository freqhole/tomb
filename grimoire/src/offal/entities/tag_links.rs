//! generic entity <-> tag link API handlers (`entity_tagz`)
//!
//! bulk-shaped throughout (`entity_ids: Vec<String>`) so a single-entity
//! call (e.g. a context menu action) and a multi-select bulk edit bar
//! call go through the exact same routes - a single-entity request is
//! just a one-element `entity_ids`.

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use zod_gen_derive::ZodSchema;

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;

use super::resolve_video_entity_type;

/// request for listing every tag used by any of the given entities
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetEntitiesTagsRequest {
    pub entity_type: String,
    pub entity_ids: Vec<String>,
}

/// request for listing every tag used by at least one entity of a given type
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ListEntityTypeTagsRequest {
    pub entity_type: String,
}

/// request for tagging one or more entities
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AddEntitiesTagsRequest {
    pub entity_type: String,
    pub entity_ids: Vec<String>,
    pub tag_names: Vec<String>,
}

/// request for untagging one or more entities
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RemoveEntitiesTagsRequest {
    pub entity_type: String,
    pub entity_ids: Vec<String>,
    pub tag_ids: Vec<String>,
}

/// route metadata for entity <-> tag links
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "get_entities_tags",
        path: "/api/entities/tags/get",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "GetEntitiesTagsRequest",
        response_type: "Vec<EntityTagCount>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "list_entity_type_tags",
        path: "/api/entities/tags/list-by-type",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "ListEntityTypeTagsRequest",
        response_type: "Vec<EntityTagCount>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "add_entities_tags",
        path: "/api/entities/tags/add",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "AddEntitiesTagsRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "remove_entities_tags",
        path: "/api/entities/tags/remove",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "RemoveEntitiesTagsRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
];

/// list every tag used by any of the given entities, with per-tag counts
///
/// path: POST /api/entities/tags/get
pub async fn get(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetEntitiesTagsRequest = match serde_json::from_value(body) {
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

    let response = crate::video::get_entities_tags(entity_type, &req.entity_ids).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// list every tag used by at least one entity of the given type, with
/// per-tag counts
///
/// path: POST /api/entities/tags/list-by-type
pub async fn list_by_type(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ListEntityTypeTagsRequest = match serde_json::from_value(body) {
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

    let response = crate::video::list_entity_type_tags(entity_type).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// tag one or more entities (tags are found-or-created by name)
///
/// path: POST /api/entities/tags/add
pub async fn add(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = crate::acl_bridge::require_scope(caller, "add_entities_tags").await {
        return resp;
    }

    let req: AddEntitiesTagsRequest = match serde_json::from_value(body) {
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

    let response = crate::video::add_entities_tags(
        entity_type,
        &req.entity_ids,
        &req.tag_names,
        Some(caller.user_id.clone()),
    )
    .await;
    response.map(|_| JsonValue::Null)
}

/// untag one or more entities
///
/// path: POST /api/entities/tags/remove
pub async fn remove(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = crate::acl_bridge::require_scope(caller, "remove_entities_tags").await {
        return resp;
    }

    let req: RemoveEntitiesTagsRequest = match serde_json::from_value(body) {
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

    let response =
        crate::video::remove_entities_tags(entity_type, &req.entity_ids, &req.tag_ids).await;
    response.map(|_| JsonValue::Null)
}
