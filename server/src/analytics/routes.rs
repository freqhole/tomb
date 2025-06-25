//! Analytics routes module
//!
//! This module contains all analytics and metrics related routes.

use axum::{middleware as axum_middleware, routing::get, Router};

use super::{get_metrics, get_prometheus_metrics};
use crate::auth::{require_admin, require_authentication};
use crate::health::health_check;
use grimoire::AppConfig;

/// Build analytics and metrics routes
pub fn build_analytics_routes(config: &AppConfig) -> Router {
    let mut analytics_routes = Router::new();

    // Admin-only metrics endpoint
    analytics_routes = analytics_routes
        .route("/api/admin/metrics", get(get_metrics))
        .layer(axum_middleware::from_fn(require_admin))
        .layer(axum_middleware::from_fn(require_authentication));

    // Public metrics endpoints (if enabled)
    if config.analytics.metrics.enabled {
        analytics_routes = analytics_routes
            .route(&config.analytics.metrics.health_endpoint, get(health_check))
            .route(
                &config.analytics.metrics.prometheus_endpoint,
                get(get_prometheus_metrics),
            )
            .route("/api/metrics", get(get_metrics));
    }

    analytics_routes
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_analytics_routes_enabled() {
        let mut config = AppConfig::default();
        config.analytics.metrics.enabled = true;

        let _router = build_analytics_routes(&config);
        // Basic test to ensure router builds without panicking
    }

    #[test]
    fn test_build_analytics_routes_disabled() {
        let mut config = AppConfig::default();
        config.analytics.metrics.enabled = false;

        let _router = build_analytics_routes(&config);
        // Basic test to ensure router builds without panicking
    }
}
