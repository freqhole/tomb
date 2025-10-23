//! Health check module
//!
//! Provides simple health check endpoints for monitoring and load balancers

use crate::error::WebauthnError;
use axum::response::{IntoResponse, Json};
use grimoire::AppConfig;

/// Simple health check endpoint
/// Returns basic status information and timestamp
pub async fn health_check() -> Result<impl IntoResponse, WebauthnError> {
    let health_response = serde_json::json!({
        "status": "healthy",
        "timestamp": time::OffsetDateTime::now_utc(),
        "message": "WebAuthn server is running"
    });

    Ok(Json(health_response))
}

/// API hello endpoint - returns server information
/// Provides server info similar to what freqhole expects from music servers
pub async fn api_hello(
    config: axum::extract::State<AppConfig>,
) -> Result<impl IntoResponse, WebauthnError> {
    let hello_response = serde_json::json!({
        "id": config.app.id,
        "name": config.app.name,
        "version": config.app.version,
        "features": config.app.features,
        "auth": {
            "required": true,
            "methods": ["passkey"]
        },
        "endpoints": {
            "base": config.server.normalized_base()
        }
    });

    Ok(Json(hello_response))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_health_check() {
        let result = health_check().await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_api_hello() {
        let config = AppConfig::default();
        let state = axum::extract::State(config);
        let result = api_hello(state).await;
        assert!(result.is_ok());
    }
}
