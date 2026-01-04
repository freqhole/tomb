//! Blob API routes
//!
//! This module defines the HTTP routes for the blob API, including
//! authentication middleware and route organization.

use axum::{
    middleware,
    routing::{get, Router},
};

use crate::auth::require_authentication;
use legacylib::AppConfig;

use super::handlers::{blob_api_health, get_blob, get_blob_metadata};

/// Build blob API routes
///
/// Creates a router with all blob-related endpoints, including proper
/// authentication middleware for protected routes.
///
/// # Routes
/// - `GET /api/blobs/health` - Health check (no auth required)
/// - `GET /api/blobs/{id}` - Get blob data (auth required)
/// - `GET /api/blobs/{id}/metadata` - Get blob metadata (auth required)
///
/// # Authentication
/// All routes except health check require valid authentication.
/// Authentication is handled by the `require_authentication` middleware.
///
/// # Rate Limiting
/// TODO: Add rate limiting middleware for blob downloads to prevent abuse
///
/// # Permissions
/// TODO: Add granular permission checking middleware
pub fn build_blob_routes(_config: &AppConfig) -> Router {
    // Public routes (no authentication required)
    let public_routes = Router::new().route("/api/blobs/health", get(blob_api_health));

    // Protected routes (authentication required)
    let protected_routes = Router::new()
        .route("/api/blobs/{id}", get(get_blob))
        .route("/api/blobs/{id}/metadata", get(get_blob_metadata))
        .layer(middleware::from_fn(require_authentication));

    // Combine all routes
    Router::new().merge(public_routes).merge(protected_routes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_blob_routes() {
        let config = AppConfig::default();
        let _router = build_blob_routes(&config);
        // Basic test to ensure router builds without panicking
    }

    // Integration tests would go here
    // They would test actual HTTP requests against the routes
}
