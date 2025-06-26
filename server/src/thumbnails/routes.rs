//! Routes configuration for thumbnail management API
//!
//! This module defines the HTTP routes for thumbnail operations including
//! job status monitoring, manual triggering, and administrative operations.

use axum::{middleware, routing::Router};

use crate::{
    auth::middleware::require_role,
    startup::AppState,
    thumbnails::handlers::{
        build_thumbnail_routes, cleanup_old_jobs, get_thumbnail_job, get_thumbnail_jobs,
        get_thumbnail_metrics, retry_failed_jobs, trigger_thumbnail_generation,
    },
};
use grimoire::UserRole;

/// Build all thumbnail-related routes with appropriate middleware
pub fn build_routes() -> Router<AppState> {
    // Public routes (require authentication but no specific role)
    let public_routes = Router::new()
        .route("/metrics", axum::routing::get(get_thumbnail_metrics))
        .route("/jobs", axum::routing::get(get_thumbnail_jobs))
        .route("/jobs/{job_id}", axum::routing::get(get_thumbnail_job))
        .layer(middleware::from_fn_with_state(
            (),
            require_role(UserRole::Member),
        ));

    // User routes (require Member role or higher)
    let user_routes = Router::new()
        .route(
            "/generate",
            axum::routing::post(trigger_thumbnail_generation),
        )
        .layer(middleware::from_fn_with_state(
            (),
            require_role(UserRole::Member),
        ));

    // Admin routes (require Admin role)
    let admin_routes = Router::new()
        .route("/retry", axum::routing::post(retry_failed_jobs))
        .route("/cleanup", axum::routing::post(cleanup_old_jobs))
        .layer(middleware::from_fn_with_state(
            (),
            require_role(UserRole::Admin),
        ));

    // Combine all routes under /api/thumbnails
    Router::new()
        .merge(public_routes)
        .merge(user_routes)
        .merge(admin_routes)
}

/// Build thumbnail routes for development/testing (no auth required)
pub fn build_dev_routes() -> Router<AppState> {
    build_thumbnail_routes()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_routes() {
        let routes = build_routes();
        // Just ensure routes can be built without panicking
        assert!(!format!("{:?}", routes).is_empty());
    }

    #[test]
    fn test_build_dev_routes() {
        let dev_routes = build_dev_routes();
        // Just ensure dev routes can be built without panicking
        assert!(!format!("{:?}", dev_routes).is_empty());
    }
}
