//! public domain handlers
//!
//! routes that don't require authentication - discovery, health checks, knock requests

pub mod health;
pub mod knock;
pub mod radio;

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

/// internal P2P callback routes (no auth; peer identity is verified by iroh)
const INTERNAL_ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "device_linked_callback",
        path: "/api/internal/device-linked",
        method: Method::POST,
        domain: Domain::Admin,
        request_type: "DeviceLinkedCallbackRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Public,
    },
    RouteInfo {
        name: "knock_accepted_callback",
        path: "/api/internal/knock-accepted",
        method: Method::POST,
        domain: Domain::Admin,
        request_type: "KnockAcceptedCallbackRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Public,
    },
];

/// collect all route metadata from public domain
pub fn routes() -> Vec<RouteInfo> {
    let mut all = Vec::new();
    all.extend_from_slice(health::ROUTES);
    all.extend_from_slice(knock::ROUTES);
    all.extend_from_slice(radio::ROUTES);
    all.extend_from_slice(INTERNAL_ROUTES);
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

        // internal peer-to-peer callbacks (no auth; called by trusted federation peers)
        "/api/internal/device-linked" => {
            // the remote server calls this on charnel after link_node succeeds.
            // emit a grimoire event so the tauri bridge can show the "browse remote" toast.
            #[derive(serde::Deserialize)]
            struct DeviceLinkedBody {
                peer_addr: String,
                server_name: String,
            }
            if let Ok(parsed) = serde_json::from_value::<DeviceLinkedBody>(body.clone()) {
                crate::events::emit(crate::events::GrimoireEvent::DeviceLinked {
                    peer_addr: parsed.peer_addr,
                    server_name: parsed.server_name,
                });
            }
            Some(crate::response::GrimoireResponse::success(
                "ok",
                serde_json::json!({}),
            ))
        }
        "/api/internal/knock-accepted" => {
            // the remote server calls this when a knock request is accepted.
            // emit a grimoire event so the tauri/rathole app can complete the
            // add-remote flow automatically.
            #[derive(serde::Deserialize)]
            struct KnockAcceptedBody {
                peer_addr: String,
                server_name: String,
            }
            if let Ok(parsed) = serde_json::from_value::<KnockAcceptedBody>(body.clone()) {
                crate::events::emit(crate::events::GrimoireEvent::KnockAccepted {
                    peer_addr: parsed.peer_addr,
                    server_name: parsed.server_name,
                });
            }
            Some(crate::response::GrimoireResponse::success(
                "ok",
                serde_json::json!({}),
            ))
        }

        // radio discovery
        "/api/radio/info" => Some(radio::info().await),
        "/api/radio/stations" => Some(radio::stations().await),

        _ => None,
    }
}
