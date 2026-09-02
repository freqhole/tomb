//! generic entity <-> taxon link API handlers (`entity_taxonz`)

use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use zod_gen_derive::ZodSchema;

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;

use super::resolve_video_entity_type;

/// request for listing every taxon linked to an entity
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetEntityTaxonsRequest {
    pub entity_type: String,
    pub entity_id: String,
}

/// request for linking an entity to a taxon
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AddEntityTaxonRequest {
    pub entity_type: String,
    pub entity_id: String,
    pub taxon_id: String,
    pub origin: String,
    pub confidence: Option<f64>,
}

/// request for unlinking an entity from a taxon
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RemoveEntityTaxonRequest {
    pub entity_type: String,
    pub entity_id: String,
    pub taxon_id: String,
    pub origin: String,
}

/// route metadata for entity <-> taxon links
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "get_entity_taxons",
        path: "/api/entities/taxons/get",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "GetEntityTaxonsRequest",
        response_type: "Vec<EntityTaxonLink>",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "add_entity_taxon",
        path: "/api/entities/taxons/add",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "AddEntityTaxonRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "remove_entity_taxon",
        path: "/api/entities/taxons/remove",
        method: Method::POST,
        domain: Domain::Entities,
        request_type: "RemoveEntityTaxonRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
];

/// list every taxon linked to an entity
///
/// path: POST /api/entities/taxons/get
pub async fn get(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetEntityTaxonsRequest = match serde_json::from_value(body) {
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

    let response = crate::video::list_entity_taxons(entity_type, &req.entity_id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// link an entity to a taxon
///
/// path: POST /api/entities/taxons/add
pub async fn add(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = crate::acl_bridge::require_scope(caller, "add_entity_taxon").await {
        return resp;
    }

    let req: AddEntityTaxonRequest = match serde_json::from_value(body) {
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

    let response = crate::video::add_entity_taxon(
        entity_type,
        &req.entity_id,
        &req.taxon_id,
        &req.origin,
        req.confidence,
        Some(caller.user_id.clone()),
    )
    .await;
    response.map(|_| JsonValue::Null)
}

/// unlink an entity from a taxon
///
/// path: POST /api/entities/taxons/remove
pub async fn remove(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if let Err(resp) = crate::acl_bridge::require_scope(caller, "remove_entity_taxon").await {
        return resp;
    }

    let req: RemoveEntityTaxonRequest = match serde_json::from_value(body) {
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
        crate::video::remove_entity_taxon(entity_type, &req.entity_id, &req.taxon_id, &req.origin)
            .await;
    response.map(|_| JsonValue::Null)
}
