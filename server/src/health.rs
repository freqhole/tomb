//! health check handlers

use axum::Json;
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

/// server info endpoint - provides server identification and metadata
/// this is a public endpoint (no auth required) for remote clients to identify the server
pub async fn server_info() -> Result<Json<ServerInfoResponse>, ApiError> {
    let config = get_config();

    let server_config = config
        .server
        .as_ref()
        .ok_or_else(|| ApiError::Internal("server config missing".to_string()))?;

    // get server identification fields
    let name = server_config.name.clone();
    let description = server_config.description.clone();
    let version = server_config.version.clone();

    // construct image url if image_path is configured
    let image_url = server_config
        .image_path
        .as_ref()
        .map(|_| "/api/hello/image".to_string());

    // image_blob_id for P2P transport (stored in config after running update-server-image)
    let image_blob_id = server_config.image_blob_id.clone();

    // knocking_enabled from federation config (only include if federation is enabled)
    let knocking_enabled = config
        .federation
        .as_ref()
        .filter(|f| f.enabled)
        .map(|f| f.knocking_enabled);

    Ok(Json(ServerInfoResponse {
        name,
        description,
        version,
        image_url,
        image_blob_id,
        knocking_enabled,
    }))
}
