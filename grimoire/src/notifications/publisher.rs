//! Publisher implementations for notification delivery
//!
//! This module defines publisher implementations for delivering notifications
//! to various destinations including PostgreSQL NOTIFY and WebSocket connections.
//! Uses enum pattern for consistency with the rest of the codebase.

use crate::notifications::models::{NotificationChannel, NotificationEvent};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::RwLock;

/// Errors that can occur during event publishing
#[derive(Debug, Error)]
pub enum PublisherError {
    #[error("Connection error: {0}")]
    Connection(String),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Channel not supported: {channel:?}")]
    UnsupportedChannel { channel: NotificationChannel },

    #[error("Rate limit exceeded for channel {channel:?}")]
    RateLimitExceeded { channel: NotificationChannel },

    #[error("Payload too large: {size_bytes} bytes (max: {max_bytes})")]
    PayloadTooLarge { size_bytes: usize, max_bytes: usize },

    #[error("Delivery timeout after {timeout_ms}ms")]
    DeliveryTimeout { timeout_ms: u64 },

    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for publisher operations
pub type PublisherResult<T> = Result<T, PublisherError>;

/// Statistics for publisher performance
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PublisherStats {
    /// Total events published
    pub total_published: u64,
    /// Total events that failed to publish
    pub total_failed: u64,
    /// Average publishing time in milliseconds
    pub avg_publish_time_ms: f64,
    /// Events published per channel
    pub events_by_channel: HashMap<NotificationChannel, u64>,
    /// Most recent error (if any)
    pub last_error: Option<String>,
}

impl Default for PublisherStats {
    fn default() -> Self {
        Self {
            total_published: 0,
            total_failed: 0,
            avg_publish_time_ms: 0.0,
            events_by_channel: HashMap::new(),
            last_error: None,
        }
    }
}

impl PublisherStats {
    /// Calculate success rate as a percentage
    pub fn success_rate(&self) -> f64 {
        let total = self.total_published + self.total_failed;
        if total == 0 {
            return 100.0;
        }
        (self.total_published as f64 / total as f64) * 100.0
    }
}

/// Configuration for event publishing
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublishConfig {
    /// Maximum payload size in bytes
    pub max_payload_size_bytes: usize,
    /// Timeout for delivery in milliseconds
    pub delivery_timeout_ms: u64,
    /// Whether to retry failed deliveries
    pub enable_retries: bool,
    /// Maximum number of retry attempts
    pub max_retry_attempts: u32,
    /// Rate limiting configuration
    pub rate_limit: Option<RateLimitConfig>,
}

impl Default for PublishConfig {
    fn default() -> Self {
        Self {
            max_payload_size_bytes: 1024 * 1024, // 1MB
            delivery_timeout_ms: 5000,           // 5 seconds
            enable_retries: true,
            max_retry_attempts: 3,
            rate_limit: None,
        }
    }
}

/// Rate limiting configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RateLimitConfig {
    /// Maximum events per minute per channel
    pub events_per_minute: u32,
    /// Whether to drop events when rate limit is exceeded
    pub drop_on_limit: bool,
}

/// Main publisher enum that handles different notification delivery methods
#[derive(Debug)]
pub enum Publisher {
    /// PostgreSQL NOTIFY publisher
    Postgres(PostgresNotificationPublisher),
    /// WebSocket publisher
    WebSocket(WebSocketNotificationPublisher),
    /// Mock publisher for testing
    Mock(MockNotificationPublisher),
}

impl Publisher {
    /// Create a PostgreSQL publisher
    pub fn postgres(config: PublishConfig) -> Self {
        Self::Postgres(PostgresNotificationPublisher::new(config))
    }

    /// Create a WebSocket publisher
    pub fn websocket(config: PublishConfig) -> Self {
        Self::WebSocket(WebSocketNotificationPublisher::new(config))
    }

    /// Create a mock publisher
    pub fn mock() -> Self {
        Self::Mock(MockNotificationPublisher::new())
    }

    /// Create a failing mock publisher
    pub fn mock_failing() -> Self {
        Self::Mock(MockNotificationPublisher::failing())
    }

    /// Publish a single event
    pub async fn publish_event(&self, event: &NotificationEvent) -> PublisherResult<()> {
        match self {
            Publisher::Postgres(p) => p.publish_event(event).await,
            Publisher::WebSocket(p) => p.publish_event(event).await,
            Publisher::Mock(p) => p.publish_event(event).await,
        }
    }

    /// Publish multiple events as a batch
    pub async fn publish_batch(&self, events: &[NotificationEvent]) -> PublisherResult<()> {
        match self {
            Publisher::Postgres(p) => p.publish_batch(events).await,
            Publisher::WebSocket(p) => p.publish_batch(events).await,
            Publisher::Mock(p) => p.publish_batch(events).await,
        }
    }

    /// Get publisher statistics
    pub async fn get_stats(&self) -> PublisherResult<PublisherStats> {
        match self {
            Publisher::Postgres(p) => p.get_stats().await,
            Publisher::WebSocket(p) => p.get_stats().await,
            Publisher::Mock(p) => p.get_stats().await,
        }
    }

    /// Check if the publisher is healthy/connected
    pub async fn health_check(&self) -> PublisherResult<()> {
        match self {
            Publisher::Postgres(p) => p.health_check().await,
            Publisher::WebSocket(p) => p.health_check().await,
            Publisher::Mock(p) => p.health_check().await,
        }
    }

    /// Get supported channels
    pub fn supported_channels(&self) -> Vec<NotificationChannel> {
        match self {
            Publisher::Postgres(p) => p.supported_channels(),
            Publisher::WebSocket(p) => p.supported_channels(),
            Publisher::Mock(p) => p.supported_channels(),
        }
    }

    /// Close the publisher and clean up resources
    pub async fn close(&self) -> PublisherResult<()> {
        match self {
            Publisher::Postgres(p) => p.close().await,
            Publisher::WebSocket(p) => p.close().await,
            Publisher::Mock(p) => p.close().await,
        }
    }
}

/// PostgreSQL NOTIFY publisher implementation
#[derive(Debug)]
pub struct PostgresNotificationPublisher {
    config: PublishConfig,
    stats: Arc<RwLock<PublisherStats>>,
}

impl PostgresNotificationPublisher {
    /// Create a new PostgreSQL publisher
    pub fn new(config: PublishConfig) -> Self {
        Self {
            config,
            stats: Arc::new(RwLock::new(PublisherStats::default())),
        }
    }

    /// Create with default configuration
    pub fn default() -> Self {
        Self::new(PublishConfig::default())
    }

    /// Publish a single event
    pub async fn publish_event(&self, event: &NotificationEvent) -> PublisherResult<()> {
        // Check payload size
        if event.payload.size_bytes > self.config.max_payload_size_bytes {
            return Err(PublisherError::PayloadTooLarge {
                size_bytes: event.payload.size_bytes,
                max_bytes: self.config.max_payload_size_bytes,
            });
        }

        // TODO: Implement actual PostgreSQL NOTIFY
        // For now, we'll simulate the behavior
        let _channel = event.channel.postgres_channel();
        let _payload = serde_json::to_string(&event)?;

        // Update stats
        let mut stats = self.stats.write().await;
        stats.total_published += 1;
        stats
            .events_by_channel
            .entry(event.channel)
            .and_modify(|e| *e += 1)
            .or_insert(1);

        Ok(())
    }

    /// Publish multiple events as a batch
    pub async fn publish_batch(&self, events: &[NotificationEvent]) -> PublisherResult<()> {
        for event in events {
            self.publish_event(event).await?;
        }
        Ok(())
    }

    /// Get publisher statistics
    pub async fn get_stats(&self) -> PublisherResult<PublisherStats> {
        Ok(self.stats.read().await.clone())
    }

    /// Check if the publisher is healthy/connected
    pub async fn health_check(&self) -> PublisherResult<()> {
        // TODO: Implement actual PostgreSQL connection check
        Ok(())
    }

    /// Get supported channels
    pub fn supported_channels(&self) -> Vec<NotificationChannel> {
        NotificationChannel::all()
    }

    /// Close the publisher and clean up resources
    pub async fn close(&self) -> PublisherResult<()> {
        Ok(())
    }
}

/// WebSocket publisher implementation
#[derive(Debug)]
pub struct WebSocketNotificationPublisher {
    config: PublishConfig,
    stats: Arc<RwLock<PublisherStats>>,
    // TODO: Add WebSocket connection pool/registry
}

impl WebSocketNotificationPublisher {
    /// Create a new WebSocket publisher
    pub fn new(config: PublishConfig) -> Self {
        Self {
            config,
            stats: Arc::new(RwLock::new(PublisherStats::default())),
        }
    }

    /// Create with default configuration
    pub fn default() -> Self {
        Self::new(PublishConfig::default())
    }

    /// Publish a single event
    pub async fn publish_event(&self, event: &NotificationEvent) -> PublisherResult<()> {
        // Check payload size
        if event.payload.size_bytes > self.config.max_payload_size_bytes {
            return Err(PublisherError::PayloadTooLarge {
                size_bytes: event.payload.size_bytes,
                max_bytes: self.config.max_payload_size_bytes,
            });
        }

        // TODO: Implement actual WebSocket broadcasting
        // For now, we'll simulate the behavior
        let _topic = event.channel.websocket_topic();
        let _payload = serde_json::to_string(&event)?;

        // Update stats
        let mut stats = self.stats.write().await;
        stats.total_published += 1;
        stats
            .events_by_channel
            .entry(event.channel)
            .and_modify(|e| *e += 1)
            .or_insert(1);

        Ok(())
    }

    /// Publish multiple events as a batch
    pub async fn publish_batch(&self, events: &[NotificationEvent]) -> PublisherResult<()> {
        for event in events {
            self.publish_event(event).await?;
        }
        Ok(())
    }

    /// Get publisher statistics
    pub async fn get_stats(&self) -> PublisherResult<PublisherStats> {
        Ok(self.stats.read().await.clone())
    }

    /// Check if the publisher is healthy/connected
    pub async fn health_check(&self) -> PublisherResult<()> {
        // TODO: Implement actual WebSocket health check
        Ok(())
    }

    /// Get supported channels
    pub fn supported_channels(&self) -> Vec<NotificationChannel> {
        NotificationChannel::all()
    }

    /// Close the publisher and clean up resources
    pub async fn close(&self) -> PublisherResult<()> {
        Ok(())
    }
}

/// Mock publisher for testing
#[derive(Debug)]
pub struct MockNotificationPublisher {
    published_events: Arc<RwLock<Vec<NotificationEvent>>>,
    should_fail: bool,
    stats: Arc<RwLock<PublisherStats>>,
}

impl MockNotificationPublisher {
    /// Create a new mock publisher
    pub fn new() -> Self {
        Self {
            published_events: Arc::new(RwLock::new(Vec::new())),
            should_fail: false,
            stats: Arc::new(RwLock::new(PublisherStats::default())),
        }
    }

    /// Create a mock publisher that always fails
    pub fn failing() -> Self {
        Self {
            published_events: Arc::new(RwLock::new(Vec::new())),
            should_fail: true,
            stats: Arc::new(RwLock::new(PublisherStats::default())),
        }
    }

    /// Get all published events
    pub async fn get_published_events(&self) -> Vec<NotificationEvent> {
        self.published_events.read().await.clone()
    }

    /// Clear published events
    pub async fn clear_published_events(&self) {
        self.published_events.write().await.clear();
    }

    /// Get the number of published events
    pub async fn published_count(&self) -> usize {
        self.published_events.read().await.len()
    }

    /// Publish a single event
    pub async fn publish_event(&self, event: &NotificationEvent) -> PublisherResult<()> {
        if self.should_fail {
            let mut stats = self.stats.write().await;
            stats.total_failed += 1;
            stats.last_error = Some("Mock failure".to_string());
            return Err(PublisherError::Internal("Mock failure".to_string()));
        }

        // Store the event
        self.published_events.write().await.push(event.clone());

        // Update stats
        let mut stats = self.stats.write().await;
        stats.total_published += 1;
        stats
            .events_by_channel
            .entry(event.channel)
            .and_modify(|e| *e += 1)
            .or_insert(1);

        Ok(())
    }

    /// Publish multiple events as a batch
    pub async fn publish_batch(&self, events: &[NotificationEvent]) -> PublisherResult<()> {
        for event in events {
            self.publish_event(event).await?;
        }
        Ok(())
    }

    /// Get publisher statistics
    pub async fn get_stats(&self) -> PublisherResult<PublisherStats> {
        Ok(self.stats.read().await.clone())
    }

    /// Check if the publisher is healthy/connected
    pub async fn health_check(&self) -> PublisherResult<()> {
        if self.should_fail {
            return Err(PublisherError::Internal("Mock unhealthy".to_string()));
        }
        Ok(())
    }

    /// Get supported channels
    pub fn supported_channels(&self) -> Vec<NotificationChannel> {
        NotificationChannel::all()
    }

    /// Close the publisher and clean up resources
    pub async fn close(&self) -> PublisherResult<()> {
        Ok(())
    }
}

impl Default for MockNotificationPublisher {
    fn default() -> Self {
        Self::new()
    }
}

/// Composite publisher that can route events to multiple publishers
#[derive(Debug)]
pub struct CompositePublisher {
    publishers: Vec<Publisher>,
    config: PublishConfig,
}

impl CompositePublisher {
    /// Create a new composite publisher
    pub fn new(publishers: Vec<Publisher>, config: PublishConfig) -> Self {
        Self { publishers, config }
    }

    /// Add a publisher to the composite
    pub fn add_publisher(&mut self, publisher: Publisher) {
        self.publishers.push(publisher);
    }

    /// Get the configuration for this composite publisher
    pub fn config(&self) -> &PublishConfig {
        &self.config
    }

    /// Publish a single event
    pub async fn publish_event(&self, event: &NotificationEvent) -> PublisherResult<()> {
        let mut errors = Vec::new();

        for publisher in &self.publishers {
            if let Err(e) = publisher.publish_event(event).await {
                errors.push(e);
            }
        }

        if errors.len() == self.publishers.len() {
            // All publishers failed
            return Err(PublisherError::Internal(format!(
                "All {} publishers failed",
                self.publishers.len()
            )));
        }

        Ok(())
    }

    /// Publish multiple events as a batch
    pub async fn publish_batch(&self, events: &[NotificationEvent]) -> PublisherResult<()> {
        for event in events {
            self.publish_event(event).await?;
        }
        Ok(())
    }

    /// Get publisher statistics
    pub async fn get_stats(&self) -> PublisherResult<PublisherStats> {
        let mut combined_stats = PublisherStats::default();

        for publisher in &self.publishers {
            if let Ok(stats) = publisher.get_stats().await {
                combined_stats.total_published += stats.total_published;
                combined_stats.total_failed += stats.total_failed;

                for (channel, count) in stats.events_by_channel {
                    combined_stats
                        .events_by_channel
                        .entry(channel)
                        .and_modify(|e| *e += count)
                        .or_insert(count);
                }
            }
        }

        Ok(combined_stats)
    }

    /// Check if the publisher is healthy/connected
    pub async fn health_check(&self) -> PublisherResult<()> {
        for publisher in &self.publishers {
            publisher.health_check().await?;
        }
        Ok(())
    }

    /// Get supported channels
    pub fn supported_channels(&self) -> Vec<NotificationChannel> {
        let mut channels = Vec::new();
        for publisher in &self.publishers {
            channels.extend(publisher.supported_channels());
        }
        channels.sort();
        channels.dedup();
        channels
    }

    /// Close the publisher and clean up resources
    pub async fn close(&self) -> PublisherResult<()> {
        for publisher in &self.publishers {
            publisher.close().await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notifications::models::NotificationChannel;
    use serde_json::json;

    #[tokio::test]
    async fn test_mock_publisher() {
        let publisher = Publisher::mock();

        let event = NotificationEvent::new(
            NotificationChannel::MediaBlobs,
            "test.event".to_string(),
            json!({"test": "data"}),
        );

        assert!(publisher.publish_event(&event).await.is_ok());

        if let Publisher::Mock(mock) = &publisher {
            assert_eq!(mock.published_count().await, 1);

            let published = mock.get_published_events().await;
            assert_eq!(published.len(), 1);
            assert_eq!(published[0].event_type, "test.event");
        }
    }

    #[tokio::test]
    async fn test_failing_mock_publisher() {
        let publisher = Publisher::mock_failing();

        let event = NotificationEvent::new(
            NotificationChannel::MediaBlobs,
            "test.event".to_string(),
            json!({"test": "data"}),
        );

        assert!(publisher.publish_event(&event).await.is_err());

        if let Publisher::Mock(mock) = &publisher {
            assert_eq!(mock.published_count().await, 0);
        }
    }

    #[tokio::test]
    async fn test_postgres_publisher_payload_size() {
        let config = PublishConfig {
            max_payload_size_bytes: 100,
            ..Default::default()
        };
        let publisher = Publisher::postgres(config);

        // Create an event with large payload
        let large_payload = json!({
            "data": "x".repeat(200)
        });
        let event = NotificationEvent::new(
            NotificationChannel::MediaBlobs,
            "test.event".to_string(),
            large_payload,
        );

        let result = publisher.publish_event(&event).await;
        assert!(matches!(
            result,
            Err(PublisherError::PayloadTooLarge { .. })
        ));
    }

    #[tokio::test]
    async fn test_composite_publisher() {
        let _mock1 = MockNotificationPublisher::new();
        let _mock2 = MockNotificationPublisher::new();

        let composite = CompositePublisher::new(
            vec![Publisher::mock(), Publisher::mock()],
            PublishConfig::default(),
        );

        let event = NotificationEvent::new(
            NotificationChannel::MediaBlobs,
            "test.event".to_string(),
            json!({"test": "data"}),
        );

        assert!(composite.publish_event(&event).await.is_ok());

        let stats = composite.get_stats().await.unwrap();
        assert_eq!(stats.total_published, 2); // Both publishers received the event
    }

    #[test]
    fn test_publisher_stats_success_rate() {
        let mut stats = PublisherStats::default();
        stats.total_published = 8;
        stats.total_failed = 2;

        assert_eq!(stats.success_rate(), 80.0);
    }

    #[test]
    fn test_supported_channels() {
        let publisher = Publisher::mock();
        let channels = publisher.supported_channels();
        assert_eq!(channels.len(), NotificationChannel::all().len());
    }
}
