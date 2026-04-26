//! public domain handlers
//!
//! routes that don't require authentication - discovery, health checks, knock requests

pub mod health;
pub mod knock;
pub mod radio;

use crate::api_registry::RouteInfo;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

/// collect all route metadata from public domain
pub fn routes() -> Vec<RouteInfo> {
    let mut all = Vec::new();
    all.extend_from_slice(health::ROUTES);
    all.extend_from_slice(knock::ROUTES);
    all.extend_from_slice(radio::ROUTES);
    all
}

/// dispatch public domain routes
pub async fn dispatch(
    path: &str,
    _caller: &Caller,
    body: &JsonValue,
) -> Option<GrimoireResponse<JsonValue>> {
    if let Some(resp) = radio::dispatch(path).await {
        return Some(resp);
    }

    match path {
        // health and discovery
        "/api/hello" => Some(health::server_info().await),
        "/api/hello/image" => Some(health::server_image_info().await),
        "/health" => Some(health::health_check().await),

        // knock system (P2P access requests)
        "/api/knock" => Some(knock::create(body.clone()).await),
        "/api/knock/status" => Some(knock::status(body.clone()).await),

        // radio discovery
        "/api/radio/info" => Some(radio::info().await),
        "/api/radio/stations" => Some(radio::stations().await),

        _ => None,
    }
}
