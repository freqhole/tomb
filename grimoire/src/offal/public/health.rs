//! health and discovery handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::config::get_config;
use crate::error::ErrorDetail;
use crate::health::{HealthResponse, ServerInfoResponse};
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

/// route metadata for health/discovery
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "health_check",
        path: "/health",
        method: Method::GET,
        domain: Domain::App,
        request_type: "String",
        response_type: "HealthResponse",
        auth: RouteAuth::Public,
    },
    RouteInfo {
        name: "server_info",
        path: "/api/hello",
        method: Method::GET,
        domain: Domain::App,
        request_type: "String",
        response_type: "ServerInfoResponse",
        auth: RouteAuth::Public,
    },
];

/// server info endpoint
///
/// path: POST /api/hello
pub async fn server_info() -> GrimoireResponse<JsonValue> {
    let config = get_config();

    let Some(server_config) = config.server.as_ref() else {
        return GrimoireResponse::failure(
            "server config missing",
            vec![ErrorDetail::new(
                "config_error",
                "configuration error",
                "server config not found",
            )],
        );
    };

    let name = server_config.name.clone();
    let description = server_config.description.clone();
    let version = server_config.version.clone();

    // image url for HTTP clients. include the image_blob_id as a cache
    // buster so the url changes whenever the image is replaced — otherwise
    // browsers keep serving the cached bytes for the static `/api/hello/image`
    // path, even though the file on disk has changed.
    let image_blob_id = server_config.image_blob_id.clone();
    let image_url = server_config
        .image_path
        .as_ref()
        .map(|_| match &image_blob_id {
            Some(id) => format!("/api/hello/image?v={}", id),
            None => "/api/hello/image".to_string(),
        });

    // knocking enabled from federation config
    let knocking_enabled = config
        .federation
        .as_ref()
        .filter(|f| f.enabled)
        .map(|f| f.knocking_enabled);

    let response = ServerInfoResponse {
        name,
        description,
        version,
        image_url,
        image_blob_id,
        knocking_enabled,
    };

    GrimoireResponse::success("ok", serde_json::to_value(response).unwrap())
}

/// server image info endpoint (returns blob_id for P2P streaming)
///
/// path: GET /api/hello/image
pub async fn server_image_info() -> GrimoireResponse<JsonValue> {
    let config = get_config();

    let blob_id = config.server.as_ref().and_then(|s| s.image_blob_id.clone());

    match blob_id {
        Some(id) => GrimoireResponse::success("ok", serde_json::json!({ "blob_id": id })),
        None => GrimoireResponse::failure(
            "server image not configured",
            vec![ErrorDetail::new(
                "not_found",
                "not found",
                "server image blob_id not configured",
            )],
        ),
    }
}

/// health check endpoint
///
/// path: GET /health
pub async fn health_check() -> GrimoireResponse<JsonValue> {
    // check database connectivity
    let db_status = match crate::database::connect().await {
        Ok(pool) => match sqlx::query("SELECT 1").fetch_one(&pool).await {
            Ok(_) => "ok".to_string(),
            Err(e) => format!("error: {}", e),
        },
        Err(e) => format!("error: {}", e),
    };

    let response = HealthResponse {
        status: "ok".to_string(),
        database: db_status,
    };

    GrimoireResponse::success("ok", serde_json::to_value(response).unwrap())
}
