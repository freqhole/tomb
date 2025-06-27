//! Configuration models for the notification system
//!
//! This module contains configuration structures for notification channels,
//! rate limiting, and notification service settings.

use crate::notifications::models::{NotificationChannel, NotificationPriority};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;

/// Main configuration for the notification system
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct NotificationConfig {
    /// Configuration for each notification channel
    pub channels: HashMap<NotificationChannel, NotificationChannelConfig>,
    /// Global rate limiting configuration
    pub rate_limiting: RateLimitConfig,
    /// PostgreSQL NOTIFY/LISTEN configuration
    pub postgres: PostgresNotificationConfig,
    /// WebSocket configuration
    pub websocket: WebSocketNotificationConfig,
    /// Queue configuration for reliable delivery
    pub queue: NotificationQueueConfig,
    /// General settings
    pub general: GeneralNotificationConfig,
}

impl Default for NotificationConfig {
    fn default() -> Self {
        let mut channels = HashMap::new();

        // Configure default settings for each channel
        for channel in NotificationChannel::all() {
            channels.insert(channel, NotificationChannelConfig::default());
        }

        Self {
            channels,
            rate_limiting: RateLimitConfig::default(),
            postgres: PostgresNotificationConfig::default(),
            websocket: WebSocketNotificationConfig::default(),
            queue: NotificationQueueConfig::default(),
            general: GeneralNotificationConfig::default(),
        }
    }
}

impl NotificationConfig {
    /// Create a configuration optimized for development
    pub fn development() -> Self {
        let mut config = Self::default();

        // Relaxed rate limits for development
        config.rate_limiting.global_events_per_minute = 10000;
        config.rate_limiting.per_channel_events_per_minute = 5000;

        // More verbose logging
        config.general.enable_debug_logging = true;

        // Shorter timeouts for faster feedback
        config.general.default_delivery_timeout = Duration::from_secs(3);

        config
    }

    /// Create a configuration optimized for production
    pub fn production() -> Self {
        let mut config = Self::default();

        // Conservative rate limits for production
        config.rate_limiting.global_events_per_minute = 1000;
        config.rate_limiting.per_channel_events_per_minute = 500;

        // Disable debug logging
        config.general.enable_debug_logging = false;

        // Longer timeouts for reliability
        config.general.default_delivery_timeout = Duration::from_secs(30);

        // Enable queue persistence
        config.queue.enable_persistence = true;
        config.queue.max_queue_size = 100000;

        config
    }

    /// Get configuration for a specific channel
    pub fn get_channel_config(
        &self,
        channel: NotificationChannel,
    ) -> Option<&NotificationChannelConfig> {
        self.channels.get(&channel)
    }

    /// Update configuration for a specific channel
    pub fn set_channel_config(
        &mut self,
        channel: NotificationChannel,
        config: NotificationChannelConfig,
    ) {
        self.channels.insert(channel, config);
    }

    /// Validate the configuration
    pub fn validate(&self) -> Result<(), String> {
        // Validate rate limiting
        if self.rate_limiting.global_events_per_minute == 0 {
            return Err("Global rate limit cannot be zero".to_string());
        }

        // Validate timeouts
        if self.general.default_delivery_timeout.as_secs() == 0 {
            return Err("Delivery timeout cannot be zero".to_string());
        }

        // Validate queue configuration
        if self.queue.max_queue_size == 0 {
            return Err("Queue size cannot be zero".to_string());
        }

        // Validate channel configurations
        for (channel, config) in &self.channels {
            if let Err(e) = config.validate() {
                return Err(format!("Invalid config for channel {:?}: {}", channel, e));
            }
        }

        Ok(())
    }
}

/// Configuration for a specific notification channel
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct NotificationChannelConfig {
    /// Whether this channel is enabled
    pub enabled: bool,
    /// Maximum events per minute for this channel
    pub events_per_minute: u32,
    /// Maximum payload size in bytes
    pub max_payload_size_bytes: usize,
    /// Minimum priority level for events in this channel
    pub min_priority: NotificationPriority,
    /// Whether to persist events for offline delivery
    pub enable_persistence: bool,
    /// Maximum number of subscribers for this channel
    pub max_subscribers: u32,
    /// Delivery timeout for this channel
    pub delivery_timeout: Duration,
    /// Whether to enable batch delivery for this channel
    pub enable_batching: bool,
    /// Batch size for delivery (if batching is enabled)
    pub batch_size: u32,
    /// Batch timeout - deliver partial batches after this time
    pub batch_timeout: Duration,
}

impl Default for NotificationChannelConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            events_per_minute: 1000,
            max_payload_size_bytes: 1024 * 1024, // 1MB
            min_priority: NotificationPriority::Low,
            enable_persistence: true,
            max_subscribers: 10000,
            delivery_timeout: Duration::from_secs(10),
            enable_batching: false,
            batch_size: 10,
            batch_timeout: Duration::from_secs(5),
        }
    }
}

impl NotificationChannelConfig {
    /// Create a configuration for high-priority channels
    pub fn high_priority() -> Self {
        Self {
            min_priority: NotificationPriority::High,
            delivery_timeout: Duration::from_secs(3),
            enable_batching: false,
            ..Default::default()
        }
    }

    /// Create a configuration for batch-optimized channels
    pub fn batch_optimized() -> Self {
        Self {
            enable_batching: true,
            batch_size: 50,
            batch_timeout: Duration::from_secs(10),
            ..Default::default()
        }
    }

    /// Validate the channel configuration
    pub fn validate(&self) -> Result<(), String> {
        if self.events_per_minute == 0 {
            return Err("Events per minute cannot be zero".to_string());
        }

        if self.max_payload_size_bytes == 0 {
            return Err("Max payload size cannot be zero".to_string());
        }

        if self.max_subscribers == 0 {
            return Err("Max subscribers cannot be zero".to_string());
        }

        if self.delivery_timeout.as_secs() == 0 {
            return Err("Delivery timeout cannot be zero".to_string());
        }

        if self.enable_batching && self.batch_size == 0 {
            return Err("Batch size cannot be zero when batching is enabled".to_string());
        }

        Ok(())
    }
}

/// Global rate limiting configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct RateLimitConfig {
    /// Enable rate limiting globally
    pub enabled: bool,
    /// Global maximum events per minute across all channels
    pub global_events_per_minute: u32,
    /// Per-channel maximum events per minute
    pub per_channel_events_per_minute: u32,
    /// Per-user maximum events per minute
    pub per_user_events_per_minute: u32,
    /// Time window for rate limiting in seconds
    pub time_window_seconds: u32,
    /// What to do when rate limit is exceeded
    pub overflow_strategy: RateLimitOverflowStrategy,
    /// Whether to apply rate limits to high priority events
    pub apply_to_high_priority: bool,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            global_events_per_minute: 5000,
            per_channel_events_per_minute: 1000,
            per_user_events_per_minute: 100,
            time_window_seconds: 60,
            overflow_strategy: RateLimitOverflowStrategy::Drop,
            apply_to_high_priority: false,
        }
    }
}

/// Strategy for handling rate limit overflow
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub enum RateLimitOverflowStrategy {
    /// Drop excess events
    Drop,
    /// Queue excess events for later delivery
    Queue,
    /// Return an error
    Error,
}

/// PostgreSQL NOTIFY/LISTEN configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct PostgresNotificationConfig {
    /// Enable PostgreSQL notifications
    pub enabled: bool,
    /// Number of database connections for listening
    pub listener_connections: u32,
    /// Timeout for PostgreSQL LISTEN operations
    pub listen_timeout: Duration,
    /// Reconnection attempt interval
    pub reconnect_interval: Duration,
    /// Maximum reconnection attempts (0 = unlimited)
    pub max_reconnect_attempts: u32,
    /// Buffer size for incoming notifications
    pub notification_buffer_size: usize,
}

impl Default for PostgresNotificationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            listener_connections: 2,
            listen_timeout: Duration::from_secs(30),
            reconnect_interval: Duration::from_secs(5),
            max_reconnect_attempts: 10,
            notification_buffer_size: 1000,
        }
    }
}

/// WebSocket notification configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct WebSocketNotificationConfig {
    /// Enable WebSocket notifications
    pub enabled: bool,
    /// Maximum number of concurrent WebSocket connections
    pub max_connections: u32,
    /// Heartbeat interval for WebSocket connections
    pub heartbeat_interval: Duration,
    /// Connection timeout
    pub connection_timeout: Duration,
    /// Maximum message size in bytes
    pub max_message_size_bytes: usize,
    /// Buffer size for outgoing messages per connection
    pub per_connection_buffer_size: usize,
}

impl Default for WebSocketNotificationConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_connections: 10000,
            heartbeat_interval: Duration::from_secs(30),
            connection_timeout: Duration::from_secs(60),
            max_message_size_bytes: 1024 * 1024, // 1MB
            per_connection_buffer_size: 100,
        }
    }
}

/// Notification queue configuration for reliable delivery
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct NotificationQueueConfig {
    /// Enable queue persistence
    pub enable_persistence: bool,
    /// Maximum queue size (events)
    pub max_queue_size: usize,
    /// Queue cleanup interval
    pub cleanup_interval: Duration,
    /// Maximum age for queued events
    pub max_event_age: Duration,
    /// Number of delivery retry attempts
    pub max_retry_attempts: u32,
    /// Retry backoff strategy
    pub retry_backoff: RetryBackoffStrategy,
    /// Dead letter queue configuration
    pub dead_letter_queue: bool,
}

impl Default for NotificationQueueConfig {
    fn default() -> Self {
        Self {
            enable_persistence: true,
            max_queue_size: 50000,
            cleanup_interval: Duration::from_secs(300), // 5 minutes
            max_event_age: Duration::from_secs(86400),  // 24 hours
            max_retry_attempts: 3,
            retry_backoff: RetryBackoffStrategy::Exponential,
            dead_letter_queue: true,
        }
    }
}

/// Retry backoff strategies
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub enum RetryBackoffStrategy {
    /// Fixed delay between retries
    Fixed(Duration),
    /// Exponential backoff (base delay doubles each time)
    Exponential,
    /// Linear backoff (base delay increases linearly)
    Linear,
}

/// General notification service configuration
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
pub struct GeneralNotificationConfig {
    /// Enable debug logging
    pub enable_debug_logging: bool,
    /// Default delivery timeout
    pub default_delivery_timeout: Duration,
    /// Enable metrics collection
    pub enable_metrics: bool,
    /// Metrics collection interval
    pub metrics_interval: Duration,
    /// Health check interval
    pub health_check_interval: Duration,
    /// Maximum number of concurrent event processors
    pub max_concurrent_processors: u32,
}

impl Default for GeneralNotificationConfig {
    fn default() -> Self {
        Self {
            enable_debug_logging: false,
            default_delivery_timeout: Duration::from_secs(10),
            enable_metrics: true,
            metrics_interval: Duration::from_secs(60),
            health_check_interval: Duration::from_secs(30),
            max_concurrent_processors: 100,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_notification_config_default() {
        let config = NotificationConfig::default();
        assert!(config.validate().is_ok());
        assert_eq!(config.channels.len(), NotificationChannel::all().len());
    }

    #[test]
    fn test_notification_config_development() {
        let config = NotificationConfig::development();
        assert!(config.validate().is_ok());
        assert_eq!(config.rate_limiting.global_events_per_minute, 10000);
        assert!(config.general.enable_debug_logging);
    }

    #[test]
    fn test_notification_config_production() {
        let config = NotificationConfig::production();
        assert!(config.validate().is_ok());
        assert_eq!(config.rate_limiting.global_events_per_minute, 1000);
        assert!(!config.general.enable_debug_logging);
    }

    #[test]
    fn test_channel_config_validation() {
        let mut config = NotificationChannelConfig::default();
        assert!(config.validate().is_ok());

        // Test invalid configuration
        config.events_per_minute = 0;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_notification_config_validation() {
        let mut config = NotificationConfig::default();
        assert!(config.validate().is_ok());

        // Test invalid rate limit
        config.rate_limiting.global_events_per_minute = 0;
        assert!(config.validate().is_err());
    }

    #[test]
    fn test_channel_config_high_priority() {
        let config = NotificationChannelConfig::high_priority();
        assert_eq!(config.min_priority, NotificationPriority::High);
        assert_eq!(config.delivery_timeout, Duration::from_secs(3));
        assert!(!config.enable_batching);
    }

    #[test]
    fn test_channel_config_batch_optimized() {
        let config = NotificationChannelConfig::batch_optimized();
        assert!(config.enable_batching);
        assert_eq!(config.batch_size, 50);
        assert_eq!(config.batch_timeout, Duration::from_secs(10));
    }
}
