use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// Analytics data for HTTP request tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RequestAnalytics {
    pub id: Uuid,
    pub request_id: String,
    pub timestamp: OffsetDateTime,
    pub user_id: Option<Uuid>,
    pub method: String,
    pub path: String,
    pub status_code: i32,
    pub duration_ms: Option<i32>,
    pub user_agent: Option<String>,
    pub ip_address: Option<String>,
    pub request_data: Option<serde_json::Value>,
    pub response_size: Option<i64>,
    pub error_message: Option<String>,
    pub trace_id: Option<String>,
    pub span_id: Option<String>,
}

/// Configuration for analytics collection
#[derive(Debug, Clone)]
pub struct AnalyticsConfig {
    pub enabled: bool,
    pub track_requests: bool,
    pub track_auth_events: bool,
    pub exclude_paths: Vec<String>,
    pub exclude_static_files: bool,
    pub max_request_body_size: usize,
}

impl Default for AnalyticsConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            track_requests: true,
            track_auth_events: true,
            exclude_paths: vec![
                "/health".to_string(),
                "/metrics".to_string(),
                "/favicon.ico".to_string(),
            ],
            exclude_static_files: true,
            max_request_body_size: 1024, // 1KB max for request data
        }
    }
}

/// Request metrics for dashboards
#[derive(Debug, Clone, Serialize)]
pub struct RequestMetrics {
    pub total_requests: i64,
    pub unique_users: i64,
    pub average_response_time: f64,
    pub error_rate: f64,
    pub most_active_paths: Vec<PathMetric>,
}

/// Metrics for individual paths
#[derive(Debug, Clone, Serialize)]
pub struct PathMetric {
    pub path: String,
    pub request_count: i64,
    pub average_response_time: f64,
    pub error_count: i64,
}

/// Time-series data for charts
#[derive(Debug, Clone, Serialize)]
pub struct TimeSeriesPoint {
    pub timestamp: OffsetDateTime,
    pub value: f64,
    pub label: Option<String>,
}

/// Analytics errors
#[derive(Debug, thiserror::Error)]
pub enum AnalyticsError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Analytics collection disabled")]
    Disabled,
    #[error("Invalid time range")]
    InvalidTimeRange,
}
