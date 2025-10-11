//! Analytics module
//!
//! This module handles all analytics and monitoring functionality including:
//! - HTTP request tracking
//! - Performance monitoring
//! - User behavior analytics
//! - Request metrics and reporting
//! - Time-series data collection
//!
//! The core analytics logic is now housed in the grimoire crate.
//! This module provides HTTP-specific handlers, middleware, and routes.

pub mod handlers;
pub mod media_handlers;
pub mod middleware;
pub mod routes;

// Re-export HTTP-specific types
pub use handlers::{get_metrics, get_prometheus_metrics};
pub use media_handlers::{admin_analytics_query, get_song_plays, get_user_history, record_events};
pub use middleware::{analytics_middleware, security_logging};
pub use routes::build_analytics_routes;

// Re-export core analytics types from grimoire
pub use grimoire::analytics::{
    AnalyticsConfig, AnalyticsError, AnalyticsRepository, AnalyticsService, PathMetric,
    RequestAnalytics, RequestAnalyticsBuilder, RequestMetrics, TimeSeriesPoint,
};
