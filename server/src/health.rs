//! health check handlers

use axum::Json;
use grimoire::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use grimoire::config::get_config;
use grimoire::health::{HealthResponse, ServerInfoResponse};

use crate::error::ApiError;

/// health check endpoint - verifies server is running and database is accessible
pub async fn health_check() -> Result<Json<HealthResponse>, ApiError> {
    // try a simple database operation to verify it's accessible
    // we'll use get_database_info since it's a public grimoire API
    let db_status = match grimoire::get_database_info().await {
        Ok(_) => "ok".to_string(),
        Err(e) => {
            tracing::warn!("database health check failed: {}", e);
            "error".to_string()
        }
    };

    let overall_status = if db_status == "ok" {
        "healthy"
    } else {
        "degraded"
    };

    Ok(Json(HealthResponse {
        status: overall_status.to_string(),
        database: db_status,
    }))
}

inventory::submit! {
    RouteInfo {
        name: "health_check",
        path: "/health",
        method: Method::GET,
        domain: Domain::App,
        request_type: "String",
        response_type: "HealthResponse",
        auth: RouteAuth::Public,
    }
}

/// server info endpoint - provides server identification and metadata
/// this is a public endpoint (no auth required) for remote clients to identify the server
pub async fn server_info() -> Result<Json<ServerInfoResponse>, ApiError> {
    let config = get_config();

    let server_config = config
        .server
        .as_ref()
        .ok_or_else(|| ApiError::Internal("server config missing".to_string()))?;

    // get server identification fields
    let server_id = server_config.id.clone();
    let name = server_config.name.clone();
    let description = server_config.description.clone();
    let version = server_config.version.clone();

    // construct image url if image_path is configured
    let image_url = server_config
        .image_path
        .as_ref()
        .map(|_| "/api/hello/image".to_string());

    Ok(Json(ServerInfoResponse {
        server_id,
        name,
        description,
        version,
        image_url,
    }))
}

inventory::submit! {
    RouteInfo {
        name: "server_info",
        path: "/api/hello",
        method: Method::GET,
        domain: Domain::App,
        request_type: "String",
        response_type: "ServerInfoResponse",
        auth: RouteAuth::Public,
    }
}
