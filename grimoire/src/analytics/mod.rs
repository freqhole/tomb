//! Analytics domain module
//!
//! This module contains all analytics-related domain logic including
//! services, models, repositories, and CLI-specific types.

pub mod cli_service;
pub mod cli_types;
pub mod feed;
pub mod media_events;
pub mod models;
pub mod repository;
pub mod service;

// Re-export core analytics types
pub use models::{
    AnalyticsConfig, AnalyticsError, RequestAnalytics, RequestMetrics, TimeSeriesPoint,
};

// Re-export media events types
pub use media_events::{
    DomainType, GenreListeningPattern, ListeningTimePeriod, MediaAnalyticsError, MediaEvent,
    MediaEventBatchRequest, MediaEventBatchResponse, MediaEventData, MediaEventRequest,
    MediaEventResponse, MediaEventType, PlayAnalytics, PopularSong, TrendingSong,
    UserListeningHistory, UserListeningStreaks,
};
pub use repository::AnalyticsRepository;
pub use service::{AnalyticsService, RequestAnalyticsBuilder};

// Re-export CLI-specific types and service
pub use cli_service::AnalyticsCliService;
pub use cli_types::{
    ActivityRecord, AnalyticsQuery, AnalyticsResult, CleanupConfig, CleanupResult,
    PathMetric as CliPathMetric, UserActivityQuery, UserActivityResult,
};

// Re-export the core PathMetric as the default
pub use models::PathMetric;
