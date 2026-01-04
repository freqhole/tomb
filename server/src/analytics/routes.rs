//! Analytics routes module
//!
//! This module contains all analytics and metrics related routes.

use axum::{
    middleware as axum_middleware,
    routing::{get, post},
    Router,
};

use super::media_handlers::{
    admin_analytics_query, get_song_plays, get_user_history, record_events, social_feed_handler,
};
use super::{get_metrics, get_prometheus_metrics};
use crate::auth::{require_admin, require_authentication};
use crate::health::health_check;
use legacylib::AppConfig;

/// Build analytics and metrics routes
pub fn build_analytics_routes(config: &AppConfig) -> Router {
    let mut analytics_routes = Router::new();

    // Protected routes (require authentication)
    let protected_routes = Router::new()
        .route("/api/analytics/events", post(record_events))
        .route("/api/analytics/songs/{song_id}/plays", get(get_song_plays))
        .route("/api/analytics/history", get(get_user_history))
        .route("/api/feed", get(social_feed_handler))
        .layer(axum_middleware::from_fn(require_authentication));

    // Admin routes (require admin role)
    let admin_routes = Router::new()
        .route("/api/admin/analytics/query", post(admin_analytics_query))
        .route("/api/admin/metrics", get(get_metrics))
        .layer(axum_middleware::from_fn(require_admin))
        .layer(axum_middleware::from_fn(require_authentication));

    analytics_routes = analytics_routes.merge(protected_routes).merge(admin_routes);

    // Public metrics endpoints (if enabled)
    if config.analytics.metrics.enabled {
        analytics_routes = analytics_routes
            .route(&config.analytics.metrics.health_endpoint, get(health_check))
            .route(
                &config.analytics.metrics.prometheus_endpoint,
                get(get_prometheus_metrics),
            );
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
