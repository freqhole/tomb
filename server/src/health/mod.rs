//! Health module
//!
//! This module handles health check and monitoring functionality including:
//! - Basic health status endpoints
//! - System status monitoring
//! - Load balancer health checks

pub mod handlers;
pub mod routes;

// Re-export commonly used types
pub use handlers::{api_hello, health_check};
pub use routes::build_health_routes;
