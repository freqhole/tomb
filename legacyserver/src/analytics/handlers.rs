//! Analytics handlers module
//!
//! HTTP handlers for analytics and metrics endpoints

use crate::error::WebauthnError;
use axum::{
    http::StatusCode,
    response::{IntoResponse, Json},
};

/// Simple metrics endpoint
/// Returns basic system information and status
pub async fn get_metrics() -> Result<impl IntoResponse, WebauthnError> {
    let metrics = serde_json::json!({
        "system": {
            "name": "WebAuthn Demo",
            "version": "1.0.0",
            "status": "running"
        },
        "note": "Detailed metrics will be available after analytics migration is complete"
    });

    Ok(Json(metrics))
}

/// Prometheus-style metrics endpoint (simplified)
/// Returns metrics in Prometheus text format
pub async fn get_prometheus_metrics() -> Result<impl IntoResponse, WebauthnError> {
    let metrics = r#"# HELP webauthn_status Server status
# TYPE webauthn_status gauge
webauthn_status{service="webauthn"} 1

# Note: Detailed metrics will be available after analytics migration
"#;

    Ok((
        StatusCode::OK,
        [("content-type", "text/plain; charset=utf-8")],
        metrics,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_get_metrics() {
        let result = get_metrics().await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_get_prometheus_metrics() {
        let result = get_prometheus_metrics().await;
        assert!(result.is_ok());
    }
}
