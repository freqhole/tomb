//! health check handlers

use axum::Json;
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::health::HealthResponse;

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
    }
}
