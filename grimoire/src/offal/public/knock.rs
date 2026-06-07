//! knock request handlers
//!
//! public endpoints for P2P access requests

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::federation::knock::{
    create_knock, get_knock_status, CreateKnockRequest as GrimoireCreateKnockRequest,
};
use crate::response::GrimoireResponse;
use serde::Deserialize;
use serde_json::Value as JsonValue;

/// route metadata for knock requests
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "create_knock_public",
        path: "/api/knock",
        method: Method::POST,
        domain: Domain::Admin,
        request_type: "CreateKnockRequest",
        response_type: "KnockRequest",
        auth: RouteAuth::Public,
    },
    RouteInfo {
        name: "get_knock_status_public",
        path: "/api/knock/status",
        method: Method::GET,
        domain: Domain::Admin,
        request_type: "String",
        response_type: "KnockStatusResponse",
        auth: RouteAuth::Public,
    },
];

/// create a knock request (public endpoint)
///
/// path: POST /api/knock
#[derive(Deserialize)]
struct CreateKnockRequest {
    /// node_id of the requesting peer
    node_id: String,
    /// desired username
    username: String,
    /// optional message
    message: Option<String>,
}

pub async fn create(body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: CreateKnockRequest = match serde_json::from_value(body) {
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

    let grimoire_req = GrimoireCreateKnockRequest {
        username: req.username,
        message: req.message.unwrap_or_default(),
    };

    let response = create_knock(&req.node_id, grimoire_req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// check knock status (public endpoint)
///
/// path: POST /api/knock/status
#[derive(Deserialize)]
struct StatusRequest {
    node_id: String,
}

pub async fn status(body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: StatusRequest = match serde_json::from_value(body) {
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

    let response = get_knock_status(&req.node_id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}
