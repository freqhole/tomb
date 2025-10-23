//! Health routes module
//!
//! This module contains health check and monitoring related routes.

use axum::{routing::get, Router};
use grimoire::AppConfig;

use super::{api_hello, health_check};

/// Build health check routes
pub fn build_health_routes(config: &AppConfig) -> Router {
    Router::new()
        .route("/health", get(health_check))
        .route("/api/hello", get(api_hello))
        .with_state(config.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_health_routes() {
        let config = AppConfig::default();
        let _router = build_health_routes(&config);
        // Basic test to ensure router builds without panicking
    }
}
