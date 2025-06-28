//! Blob API module
//!
//! This module provides HTTP API endpoints for serving media blobs with
//! proper authentication and permission controls. It complements the static
//! file serving system by providing authenticated access to blobs stored
//! in the database.
//!
//! ## Features
//!
//! - **Authenticated Access**: All blob access requires valid authentication
//! - **Efficient Streaming**: Supports efficient streaming of large files
//! - **Proper Headers**: Sets appropriate content-type, cache, and security headers
//! - **Metadata API**: Provides metadata access without downloading blob data
//! - **Security**: Includes security headers and audit logging
//!
//! ## Endpoints
//!
//! - `GET /api/blobs/health` - Health check endpoint
//! - `GET /api/blobs/{id}` - Download blob data
//! - `GET /api/blobs/{id}/metadata` - Get blob metadata
//!
//! ## Usage
//!
//! ```rust
//! use crate::blobs::build_blob_routes;
//! use grimoire::AppConfig;
//!
//! let config = AppConfig::default();
//! let blob_routes = build_blob_routes(&config);
//! ```
//!
//! ## Security Considerations
//!
//! - All endpoints (except health) require authentication
//! - TODO: Add granular permission checking
//! - TODO: Add rate limiting for large downloads
//! - Audit logging is included for blob access
//!
//! ## Performance
//!
//! - Uses efficient byte streaming for large files
//! - Includes appropriate cache headers
//! - Avoids loading entire files into memory

pub mod handlers;
pub mod routes;

// Re-export the main route builder for easy integration
pub use routes::build_blob_routes;

// Re-export handlers for testing or advanced usage
pub use handlers::{blob_api_health, get_blob, get_blob_metadata};
