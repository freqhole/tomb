//! Thumbnails HTTP API module
//!
//! This module provides HTTP endpoints for thumbnail generation management,
//! job status monitoring, and administrative operations.

pub mod handlers;
pub mod routes;

// Re-export main types for convenience
pub use handlers::{
    OperationResponse, ThumbnailJobResponse, ThumbnailMetricsResponse, TriggerResponse,
    TriggerThumbnailRequest,
};
pub use routes::{build_dev_routes, build_routes};
