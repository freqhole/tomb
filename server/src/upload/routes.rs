//! Upload routes for large file operations
//!
//! This module defines the HTTP routes for handling large file uploads
//! that are restricted to admin users only.

use axum::{
    extract::DefaultBodyLimit,
    middleware,
    routing::{delete, get, post},
    Router,
};

use crate::auth::{require_admin, require_authentication};
use grimoire::AppConfig;

use super::handlers::{delete_upload, get_upload_info, list_uploads, upload_large_file};

/// Build upload routes for large file operations
pub fn build_upload_routes(_config: &AppConfig) -> Router {
    // Admin-only routes (POST, DELETE)
    let admin_routes = Router::new()
        // Upload a large file (POST /api/upload) - Admin only
        .route("/api/upload", post(upload_large_file))
        // Delete an uploaded file (DELETE /api/upload/{id}) - Admin only
        .route("/api/upload/{id}", delete(delete_upload))
        .layer(DefaultBodyLimit::max(1024 * 1024 * 1024)) // 1GB limit for uploads
        .layer(middleware::from_fn(require_admin))
        .layer(middleware::from_fn(require_authentication));

    // Authenticated user routes (GET)
    let user_routes = Router::new()
        // Get info about a specific upload (GET /api/upload/{id}) - Any authenticated user
        .route("/api/upload/{id}", get(get_upload_info))
        // List all uploads with pagination (GET /api/uploads) - Any authenticated user
        .route("/api/uploads", get(list_uploads))
        .layer(middleware::from_fn(require_authentication));

    // Merge both route groups
    Router::new().merge(admin_routes).merge(user_routes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_upload_routes() {
        let config = AppConfig::default();
        let _router = build_upload_routes(&config);
        // Basic test to ensure router builds without panicking
    }
}
