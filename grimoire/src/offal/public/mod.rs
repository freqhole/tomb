//! public domain handlers
//!
//! routes that don't require authentication - discovery, health checks, knock requests

pub mod health;
pub mod knock;

use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

/// dispatch public domain routes
pub async fn dispatch(
    path: &str,
    _caller: &Caller,
    body: &JsonValue,
) -> Option<GrimoireResponse<JsonValue>> {
    match path {
        // health and discovery
        "/api/hello" => Some(health::server_info().await),
        "/api/hello/image" => Some(health::server_image_info().await),
        "/health" => Some(health::health_check().await),

        // knock system (P2P access requests)
        "/api/knock" => Some(knock::create(body.clone()).await),
        "/api/knock/status" => Some(knock::status(body.clone()).await),

        _ => None,
    }
}
