//! Analytics service for the grimoire package
//!
//! This module provides high-level analytics services that handle business logic,
//! validation, and data operations for analytics functionality.

use super::media_events::{
    MediaAnalyticsError, MediaEvent, MediaEventRequest, PlayAnalytics, UserListeningHistory,
};
use super::models::{
    AnalyticsConfig, AnalyticsError, RequestAnalytics, RequestMetrics, TimeSeriesPoint,
};
use super::repository::AnalyticsRepository;
use crate::DatabaseConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// Analytics service that provides business logic for analytics operations
pub struct AnalyticsService<'a> {
    repo: AnalyticsRepository<'a>,
    config: AnalyticsConfig,
}

impl<'a> AnalyticsService<'a> {
    /// Create a new AnalyticsService
    pub fn new(db: &'a DatabaseConnection, config: AnalyticsConfig) -> Self {
        Self {
            repo: AnalyticsRepository::new(db),
            config,
        }
    }

    /// Create a new AnalyticsService with default configuration
    pub fn new_with_defaults(db: &'a DatabaseConnection) -> Self {
        Self::new(db, AnalyticsConfig::default())
    }

    /// Record a new request
    pub async fn record_request(&self, analytics: RequestAnalytics) -> Result<(), AnalyticsError> {
        if !self.config.enabled || !self.config.track_requests {
            return Ok(());
        }

        // Check if path should be excluded
        if self.config.exclude_paths.contains(&analytics.path) {
            return Ok(());
        }

        // Check if static files should be excluded
        if self.config.exclude_static_files && self.is_static_file_path(&analytics.path) {
            return Ok(());
        }

        self.repo.record_request(&analytics).await
    }

    /// Get request metrics for a time range
    pub async fn get_metrics(
        &self,
        from: OffsetDateTime,
        to: OffsetDateTime,
    ) -> Result<RequestMetrics, AnalyticsError> {
        if !self.config.enabled {
            return Err(AnalyticsError::Disabled);
        }

        self.repo.get_request_metrics(from, to).await
    }

    /// Get metrics for the last N hours
    pub async fn get_metrics_for_hours(
        &self,
        hours: u32,
    ) -> Result<RequestMetrics, AnalyticsError> {
        let to = OffsetDateTime::now_utc();
        let from = to - time::Duration::hours(hours as i64);
        self.get_metrics(from, to).await
    }

    /// Get user requests in a time range
    pub async fn get_user_requests(
        &self,
        user_id: Uuid,
        from: OffsetDateTime,
        to: OffsetDateTime,
    ) -> Result<Vec<RequestAnalytics>, AnalyticsError> {
        if !self.config.enabled {
            return Err(AnalyticsError::Disabled);
        }

        self.repo.get_user_requests(user_id, from, to).await
    }

    /// Get recent user requests (last N requests)
    pub async fn get_recent_user_requests(
        &self,
        user_id: Uuid,
        limit: u32,
    ) -> Result<Vec<RequestAnalytics>, AnalyticsError> {
        let to = OffsetDateTime::now_utc();
        let from = to - time::Duration::days(30); // Look back 30 days max

        let mut requests = self.repo.get_user_requests(user_id, from, to).await?;

        // Sort by timestamp descending and take only the requested number
        requests.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
        requests.truncate(limit as usize);

        Ok(requests)
    }

    /// Get request volume time series
    pub async fn get_request_volume_timeseries(
        &self,
        from: OffsetDateTime,
        to: OffsetDateTime,
        interval_minutes: i32,
    ) -> Result<Vec<TimeSeriesPoint>, AnalyticsError> {
        if !self.config.enabled {
            return Err(AnalyticsError::Disabled);
        }

        self.repo
            .get_request_volume_timeseries(from, to, interval_minutes)
            .await
    }

    /// Get error rate time series
    pub async fn get_error_rate_timeseries(
        &self,
        from: OffsetDateTime,
        to: OffsetDateTime,
        interval_minutes: i32,
    ) -> Result<Vec<TimeSeriesPoint>, AnalyticsError> {
        if !self.config.enabled {
            return Err(AnalyticsError::Disabled);
        }

        self.repo
            .get_error_rate_timeseries(from, to, interval_minutes)
            .await
    }

    /// Clean up old analytics data
    pub async fn cleanup_old_data(
        &self,
        older_than: OffsetDateTime,
    ) -> Result<u64, AnalyticsError> {
        self.repo.cleanup_old_data(older_than).await
    }

    /// Check if analytics is enabled
    pub fn is_enabled(&self) -> bool {
        self.config.enabled
    }

    /// Get the current configuration
    pub fn config(&self) -> &AnalyticsConfig {
        &self.config
    }

    /// Update the configuration
    pub fn update_config(&mut self, config: AnalyticsConfig) {
        self.config = config;
    }

    /// Parse user ID from string
    pub fn parse_user_id(user_id_str: &str) -> Result<Uuid, AnalyticsError> {
        Uuid::parse_str(user_id_str).map_err(|_| AnalyticsError::InvalidTimeRange)
    }

    /// Record a media event
    pub async fn record_media_event(&self, event: MediaEvent) -> Result<(), MediaAnalyticsError> {
        if !self.config.enabled {
            return Ok(()); // Silently ignore if analytics disabled
        }

        self.repo.record_media_event(&event).await
    }

    /// Record multiple media events in a batch
    pub async fn record_media_events_batch(
        &self,
        events: Vec<MediaEvent>,
    ) -> Result<usize, MediaAnalyticsError> {
        if !self.config.enabled {
            return Ok(0); // Silently ignore if analytics disabled
        }

        if events.is_empty() {
            return Ok(0);
        }

        self.repo.record_media_events_batch(&events).await
    }

    /// Create media event from request and user context
    pub fn create_media_event_from_request(
        &self,
        request: MediaEventRequest,
        user_id: Option<Uuid>,
        session_id: Option<Uuid>,
        user_agent: Option<String>,
    ) -> MediaEvent {
        let mut event = MediaEvent::new(request.media_blob_id, request.event_type, user_id);

        if let Some(data) = request.event_data {
            event.event_data = data;
        }

        event
            .with_session(session_id.or(request.session_id))
            .with_client_info(user_agent, None)
            .with_domain(
                request
                    .domain_type
                    .unwrap_or(super::media_events::DomainType::Song),
                request.domain_id,
            )
    }

    /// Get media events for a session
    pub async fn get_media_events_for_session(
        &self,
        session_id: Uuid,
    ) -> Result<Vec<MediaEvent>, MediaAnalyticsError> {
        if !self.config.enabled {
            return Err(MediaAnalyticsError::InvalidEventData(
                "Analytics disabled".to_string(),
            ));
        }

        self.repo.get_media_events_for_session(session_id).await
    }

    /// Get play analytics for a song
    pub async fn get_song_play_analytics(
        &self,
        media_blob_id: &str,
    ) -> Result<PlayAnalytics, MediaAnalyticsError> {
        if !self.config.enabled {
            return Err(MediaAnalyticsError::InvalidEventData(
                "Analytics disabled".to_string(),
            ));
        }

        self.repo.get_song_play_analytics(media_blob_id).await
    }

    /// Get user listening history
    pub async fn get_user_listening_history(
        &self,
        user_id: Uuid,
        limit: Option<i32>,
        offset: Option<i32>,
    ) -> Result<Vec<UserListeningHistory>, MediaAnalyticsError> {
        if !self.config.enabled {
            return Err(MediaAnalyticsError::InvalidEventData(
                "Analytics disabled".to_string(),
            ));
        }

        self.repo
            .get_user_listening_history(user_id, limit, offset)
            .await
    }

    /// Helper method to determine if a path represents a static file
    fn is_static_file_path(&self, path: &str) -> bool {
        // Common static file extensions
        let static_extensions = [
            ".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2",
            ".ttf", ".eot", ".map", ".webp", ".avif",
        ];

        static_extensions.iter().any(|ext| path.ends_with(ext))
    }
}

/// Builder for creating RequestAnalytics records
pub struct RequestAnalyticsBuilder {
    request_id: String,
    user_id: Option<Uuid>,
    method: String,
    path: String,
    status_code: i32,
    duration_ms: Option<i32>,
    user_agent: Option<String>,
    ip_address: Option<String>,
    request_data: Option<serde_json::Value>,
    response_size: Option<i64>,
    error_message: Option<String>,
    trace_id: Option<String>,
    span_id: Option<String>,
}

impl RequestAnalyticsBuilder {
    /// Create a new builder with required fields
    pub fn new(request_id: String, method: String, path: String, status_code: i32) -> Self {
        Self {
            request_id,
            method,
            path,
            status_code,
            user_id: None,
            duration_ms: None,
            user_agent: None,
            ip_address: None,
            request_data: None,
            response_size: None,
            error_message: None,
            trace_id: None,
            span_id: None,
        }
    }

    /// Set the user ID
    pub fn user_id(mut self, user_id: Option<Uuid>) -> Self {
        self.user_id = user_id;
        self
    }

    /// Set the request duration in milliseconds
    pub fn duration_ms(mut self, duration_ms: i32) -> Self {
        self.duration_ms = Some(duration_ms);
        self
    }

    /// Set the user agent
    pub fn user_agent(mut self, user_agent: Option<String>) -> Self {
        self.user_agent = user_agent;
        self
    }

    /// Set the IP address
    pub fn ip_address(mut self, ip_address: Option<String>) -> Self {
        self.ip_address = ip_address;
        self
    }

    /// Set request data
    pub fn request_data(mut self, request_data: Option<serde_json::Value>) -> Self {
        self.request_data = request_data;
        self
    }

    /// Set response size
    pub fn response_size(mut self, response_size: Option<i64>) -> Self {
        self.response_size = response_size;
        self
    }

    /// Set error message
    pub fn error_message(mut self, error_message: Option<String>) -> Self {
        self.error_message = error_message;
        self
    }

    /// Set trace ID
    pub fn trace_id(mut self, trace_id: Option<String>) -> Self {
        self.trace_id = trace_id;
        self
    }

    /// Set span ID
    pub fn span_id(mut self, span_id: Option<String>) -> Self {
        self.span_id = span_id;
        self
    }

    /// Build the RequestAnalytics record
    pub fn build(self) -> RequestAnalytics {
        RequestAnalytics {
            id: Uuid::new_v4(),
            request_id: self.request_id,
            timestamp: OffsetDateTime::now_utc(),
            user_id: self.user_id,
            method: self.method,
            path: self.path,
            status_code: self.status_code,
            duration_ms: self.duration_ms,
            user_agent: self.user_agent,
            ip_address: self.ip_address,
            request_data: self.request_data,
            response_size: self.response_size,
            error_message: self.error_message,
            trace_id: self.trace_id,
            span_id: self.span_id,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_request_analytics_builder() {
        let analytics = RequestAnalyticsBuilder::new(
            "test-123".to_string(),
            "GET".to_string(),
            "/api/test".to_string(),
            200,
        )
        .user_id(Some(Uuid::new_v4()))
        .duration_ms(150)
        .user_agent(Some("test-agent".to_string()))
        .build();

        assert_eq!(analytics.request_id, "test-123");
        assert_eq!(analytics.method, "GET");
        assert_eq!(analytics.path, "/api/test");
        assert_eq!(analytics.status_code, 200);
        assert_eq!(analytics.duration_ms, Some(150));
        assert!(analytics.user_id.is_some());
    }

    #[test]
    fn test_is_static_file_path() {
        // Test the static file detection logic
        let static_extensions = [
            ".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".woff", ".woff2",
            ".ttf", ".eot", ".map", ".webp", ".avif",
        ];

        assert!(static_extensions
            .iter()
            .any(|ext| "/assets/style.css".ends_with(ext)));
        assert!(static_extensions
            .iter()
            .any(|ext| "/js/app.js".ends_with(ext)));
        assert!(static_extensions
            .iter()
            .any(|ext| "/favicon.ico".ends_with(ext)));
        assert!(!static_extensions
            .iter()
            .any(|ext| "/api/users".ends_with(ext)));
        assert!(!static_extensions
            .iter()
            .any(|ext| "/auth/login".ends_with(ext)));
    }

    #[test]
    fn test_parse_user_id_valid() {
        let uuid_str = "550e8400-e29b-41d4-a716-446655440000";
        let result = AnalyticsService::parse_user_id(uuid_str);
        assert!(result.is_ok());
    }

    #[test]
    fn test_parse_user_id_invalid() {
        let invalid_uuid = "not-a-uuid";
        let result = AnalyticsService::parse_user_id(invalid_uuid);
        assert!(result.is_err());
    }
}
