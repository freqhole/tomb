//! Notification service implementation
//!
//! This module contains the main NotificationService that orchestrates event publishing,
//! subscription management, and notification delivery across different channels.

use crate::notifications::{
    config::NotificationConfig,
    models::{
        ChannelSubscription, EventDeliveryStats, NotificationChannel, NotificationEvent,
        NotificationPriority,
    },
    publisher::{Publisher, PublisherError},
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use time::OffsetDateTime;
use tokio::sync::RwLock;
use uuid::Uuid;

/// Errors that can occur in the notification service
#[derive(Debug, Error)]
pub enum NotificationServiceError {
    #[error("Publishing error: {0}")]
    Publisher(#[from] PublisherError),

    #[error("Subscription not found: {subscription_id}")]
    SubscriptionNotFound { subscription_id: Uuid },

    #[error("Channel not supported: {channel:?}")]
    UnsupportedChannel { channel: NotificationChannel },

    #[error("Rate limit exceeded for user {user_id}")]
    RateLimitExceeded { user_id: Uuid },

    #[error("Configuration error: {0}")]
    Configuration(String),

    #[error("Service not initialized")]
    NotInitialized,

    #[error("Internal error: {0}")]
    Internal(String),
}

/// Result type for notification service operations
pub type NotificationServiceResult<T> = Result<T, NotificationServiceError>;

/// Statistics for event processing
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventStats {
    /// Total events published
    pub total_published: u64,
    /// Total events delivered successfully
    pub total_delivered: u64,
    /// Total events that failed delivery
    pub total_failed: u64,
    /// Total active subscriptions
    pub total_subscriptions: u64,
    /// Events published per channel
    pub events_by_channel: HashMap<NotificationChannel, u64>,
    /// Events published per priority
    pub events_by_priority: HashMap<NotificationPriority, u64>,
    /// Average processing time in milliseconds
    pub avg_processing_time_ms: f64,
    /// Last processing timestamp
    pub last_processed_at: Option<OffsetDateTime>,
}

impl Default for EventStats {
    fn default() -> Self {
        Self {
            total_published: 0,
            total_delivered: 0,
            total_failed: 0,
            total_subscriptions: 0,
            events_by_channel: HashMap::new(),
            events_by_priority: HashMap::new(),
            avg_processing_time_ms: 0.0,
            last_processed_at: None,
        }
    }
}

/// Main notification service
#[derive(Debug)]
pub struct NotificationService {
    config: NotificationConfig,
    publishers: HashMap<NotificationChannel, Publisher>,
    subscriptions: Arc<RwLock<HashMap<Uuid, ChannelSubscription>>>,
    user_subscriptions: Arc<RwLock<HashMap<Uuid, Vec<Uuid>>>>, // user_id -> subscription_ids
    stats: Arc<RwLock<EventStats>>,
    rate_limiter: Arc<RwLock<RateLimiter>>,
}

impl NotificationService {
    /// Create a new notification service
    pub fn new(config: NotificationConfig) -> Self {
        Self {
            config,
            publishers: HashMap::new(),
            subscriptions: Arc::new(RwLock::new(HashMap::new())),
            user_subscriptions: Arc::new(RwLock::new(HashMap::new())),
            stats: Arc::new(RwLock::new(EventStats::default())),
            rate_limiter: Arc::new(RwLock::new(RateLimiter::new())),
        }
    }

    /// Add a publisher for a specific channel
    pub fn add_publisher(&mut self, channel: NotificationChannel, publisher: Publisher) {
        self.publishers.insert(channel, publisher);
    }

    /// Publish a notification event
    pub async fn publish_event(&self, event: NotificationEvent) -> NotificationServiceResult<()> {
        let start_time = std::time::Instant::now();

        // Check if channel is supported
        let channel_config = self.config.get_channel_config(event.channel).ok_or(
            NotificationServiceError::UnsupportedChannel {
                channel: event.channel,
            },
        )?;

        // Check if channel is enabled
        if !channel_config.enabled {
            return Ok(()); // Silently ignore disabled channels
        }

        // Check minimum priority
        if event.priority < channel_config.min_priority {
            return Ok(()); // Silently ignore low priority events
        }

        // Apply rate limiting
        if self.config.rate_limiting.enabled {
            self.check_rate_limit(&event).await?;
        }

        // Find and publish to the appropriate publisher
        if let Some(publisher) = self.publishers.get(&event.channel) {
            match publisher.publish_event(&event).await {
                Ok(()) => {
                    self.update_success_stats(&event, start_time).await;
                }
                Err(e) => {
                    self.update_failure_stats(&event, start_time).await;
                    return Err(NotificationServiceError::Publisher(e));
                }
            }
        }

        // Deliver to subscribed users
        self.deliver_to_subscribers(&event).await?;

        Ok(())
    }

    /// Publish multiple events as a batch
    pub async fn publish_batch(
        &self,
        events: Vec<NotificationEvent>,
    ) -> NotificationServiceResult<()> {
        for event in events {
            self.publish_event(event).await?;
        }
        Ok(())
    }

    /// Add a subscription to a channel
    pub async fn add_subscription(
        &self,
        subscription: ChannelSubscription,
    ) -> NotificationServiceResult<()> {
        let subscription_id = subscription.id;
        let user_id = subscription.user_id;

        // Store the subscription
        self.subscriptions
            .write()
            .await
            .insert(subscription_id, subscription);

        // Update user subscription index
        let mut user_subs = self.user_subscriptions.write().await;
        user_subs
            .entry(user_id)
            .or_insert_with(Vec::new)
            .push(subscription_id);

        // Update stats
        let mut stats = self.stats.write().await;
        stats.total_subscriptions += 1;

        Ok(())
    }

    /// Remove a subscription
    pub async fn remove_subscription(
        &self,
        subscription_id: Uuid,
    ) -> NotificationServiceResult<()> {
        let mut subscriptions = self.subscriptions.write().await;

        if let Some(subscription) = subscriptions.remove(&subscription_id) {
            // Update user subscription index
            let mut user_subs = self.user_subscriptions.write().await;
            if let Some(user_subscription_ids) = user_subs.get_mut(&subscription.user_id) {
                user_subscription_ids.retain(|&id| id != subscription_id);
                if user_subscription_ids.is_empty() {
                    user_subs.remove(&subscription.user_id);
                }
            }

            // Update stats
            let mut stats = self.stats.write().await;
            stats.total_subscriptions = stats.total_subscriptions.saturating_sub(1);

            Ok(())
        } else {
            Err(NotificationServiceError::SubscriptionNotFound { subscription_id })
        }
    }

    /// Get all subscriptions for a user
    pub async fn get_user_subscriptions(&self, user_id: Uuid) -> Vec<ChannelSubscription> {
        let user_subs = self.user_subscriptions.read().await;
        let subscriptions = self.subscriptions.read().await;

        if let Some(subscription_ids) = user_subs.get(&user_id) {
            subscription_ids
                .iter()
                .filter_map(|&id| subscriptions.get(&id).cloned())
                .collect()
        } else {
            Vec::new()
        }
    }

    /// Get service statistics
    pub async fn get_stats(&self) -> EventStats {
        self.stats.read().await.clone()
    }

    /// Get publisher statistics for a channel
    pub async fn get_publisher_stats(
        &self,
        channel: NotificationChannel,
    ) -> NotificationServiceResult<EventDeliveryStats> {
        if let Some(publisher) = self.publishers.get(&channel) {
            let publisher_stats = publisher.get_stats().await?;

            // Convert to EventDeliveryStats
            let mut events_by_channel = HashMap::new();
            events_by_channel.insert(channel, publisher_stats.total_published);

            Ok(EventDeliveryStats {
                total_published: publisher_stats.total_published,
                total_delivered: publisher_stats.total_published - publisher_stats.total_failed,
                total_failed: publisher_stats.total_failed,
                avg_delivery_time_ms: publisher_stats.avg_publish_time_ms,
                events_by_channel,
                events_by_priority: HashMap::new(),
            })
        } else {
            Err(NotificationServiceError::UnsupportedChannel { channel })
        }
    }

    /// Health check for all publishers
    pub async fn health_check(
        &self,
    ) -> NotificationServiceResult<HashMap<NotificationChannel, bool>> {
        let mut health_status = HashMap::new();

        for (channel, publisher) in &self.publishers {
            let is_healthy = publisher.health_check().await.is_ok();
            health_status.insert(*channel, is_healthy);
        }

        Ok(health_status)
    }

    /// Deliver event to all subscribers
    async fn deliver_to_subscribers(
        &self,
        event: &NotificationEvent,
    ) -> NotificationServiceResult<()> {
        let subscriptions = self.subscriptions.read().await;

        for subscription in subscriptions.values() {
            if subscription.should_receive_event(event) {
                // TODO: Implement actual delivery to user
                // This would typically involve:
                // 1. Getting user's active connections
                // 2. Sending the event via WebSocket
                // 3. Queuing for offline delivery if needed

                // For now, we'll just update delivery stats
                let mut stats = self.stats.write().await;
                stats.total_delivered += 1;
            }
        }

        Ok(())
    }

    /// Check rate limits for an event
    async fn check_rate_limit(&self, event: &NotificationEvent) -> NotificationServiceResult<()> {
        if !event.priority.bypasses_rate_limit() {
            let mut rate_limiter = self.rate_limiter.write().await;

            if let Some(user_id) = event.metadata.source_user_id {
                if !rate_limiter.check_user_limit(user_id, &self.config.rate_limiting) {
                    return Err(NotificationServiceError::RateLimitExceeded { user_id });
                }
            }

            if !rate_limiter.check_channel_limit(event.channel, &self.config.rate_limiting) {
                return Err(NotificationServiceError::UnsupportedChannel {
                    channel: event.channel,
                });
            }
        }

        Ok(())
    }

    /// Update statistics for successful event processing
    async fn update_success_stats(
        &self,
        event: &NotificationEvent,
        start_time: std::time::Instant,
    ) {
        let mut stats = self.stats.write().await;

        stats.total_published += 1;
        stats.last_processed_at = Some(OffsetDateTime::now_utc());

        // Update channel stats
        stats
            .events_by_channel
            .entry(event.channel)
            .and_modify(|e| *e += 1)
            .or_insert(1);

        // Update priority stats
        stats
            .events_by_priority
            .entry(event.priority)
            .and_modify(|e| *e += 1)
            .or_insert(1);

        // Update processing time
        let processing_time_ms = start_time.elapsed().as_millis() as f64;
        if stats.total_published == 1 {
            stats.avg_processing_time_ms = processing_time_ms;
        } else {
            stats.avg_processing_time_ms = (stats.avg_processing_time_ms
                * (stats.total_published - 1) as f64
                + processing_time_ms)
                / stats.total_published as f64;
        }
    }

    /// Update statistics for failed event processing
    async fn update_failure_stats(
        &self,
        event: &NotificationEvent,
        _start_time: std::time::Instant,
    ) {
        let mut stats = self.stats.write().await;
        stats.total_failed += 1;
        stats.last_processed_at = Some(OffsetDateTime::now_utc());

        // Still update channel stats for failed events
        stats
            .events_by_channel
            .entry(event.channel)
            .and_modify(|e| *e += 1)
            .or_insert(1);
    }
}

/// Simple rate limiter implementation
#[derive(Debug)]
struct RateLimiter {
    user_counts: HashMap<Uuid, (u32, OffsetDateTime)>,
    channel_counts: HashMap<NotificationChannel, (u32, OffsetDateTime)>,
    global_count: (u32, OffsetDateTime),
}

impl RateLimiter {
    fn new() -> Self {
        Self {
            user_counts: HashMap::new(),
            channel_counts: HashMap::new(),
            global_count: (0, OffsetDateTime::now_utc()),
        }
    }

    fn check_user_limit(
        &mut self,
        user_id: Uuid,
        config: &crate::notifications::config::RateLimitConfig,
    ) -> bool {
        let now = OffsetDateTime::now_utc();
        let window_start = now - time::Duration::seconds(config.time_window_seconds as i64);

        // Clean up old entries and check user limit
        if let Some((count, timestamp)) = self.user_counts.get_mut(&user_id) {
            if *timestamp < window_start {
                *count = 1;
                *timestamp = now;
            } else {
                *count += 1;
                if *count > config.per_user_events_per_minute {
                    return false;
                }
            }
        } else {
            self.user_counts.insert(user_id, (1, now));
        }

        true
    }

    fn check_channel_limit(
        &mut self,
        channel: NotificationChannel,
        config: &crate::notifications::config::RateLimitConfig,
    ) -> bool {
        let now = OffsetDateTime::now_utc();
        let window_start = now - time::Duration::seconds(config.time_window_seconds as i64);

        // Check channel limit
        if let Some((count, timestamp)) = self.channel_counts.get_mut(&channel) {
            if *timestamp < window_start {
                *count = 1;
                *timestamp = now;
            } else {
                *count += 1;
                if *count > config.per_channel_events_per_minute {
                    return false;
                }
            }
        } else {
            self.channel_counts.insert(channel, (1, now));
        }

        // Check global limit
        if self.global_count.1 < window_start {
            self.global_count = (1, now);
        } else {
            self.global_count.0 += 1;
            if self.global_count.0 > config.global_events_per_minute {
                return false;
            }
        }

        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notifications::{config::NotificationConfig, models::NotificationChannel};
    use serde_json::json;

    #[tokio::test]
    async fn test_notification_service_creation() {
        let config = NotificationConfig::default();
        let service = NotificationService::new(config);

        let stats = service.get_stats().await;
        assert_eq!(stats.total_published, 0);
        assert_eq!(stats.total_subscriptions, 0);
    }

    #[tokio::test]
    async fn test_add_subscription() {
        let config = NotificationConfig::default();
        let service = NotificationService::new(config);

        let user_id = Uuid::new_v4();
        let subscription = ChannelSubscription::new(user_id, NotificationChannel::MediaBlobs, None);

        assert!(service.add_subscription(subscription.clone()).await.is_ok());

        let user_subscriptions = service.get_user_subscriptions(user_id).await;
        assert_eq!(user_subscriptions.len(), 1);
        assert_eq!(
            user_subscriptions[0].channel,
            NotificationChannel::MediaBlobs
        );

        let stats = service.get_stats().await;
        assert_eq!(stats.total_subscriptions, 1);
    }

    #[tokio::test]
    async fn test_remove_subscription() {
        let config = NotificationConfig::default();
        let service = NotificationService::new(config);

        let user_id = Uuid::new_v4();
        let subscription = ChannelSubscription::new(user_id, NotificationChannel::MediaBlobs, None);
        let subscription_id = subscription.id;

        // Add and then remove subscription
        assert!(service.add_subscription(subscription).await.is_ok());
        assert!(service.remove_subscription(subscription_id).await.is_ok());

        let user_subscriptions = service.get_user_subscriptions(user_id).await;
        assert_eq!(user_subscriptions.len(), 0);

        let stats = service.get_stats().await;
        assert_eq!(stats.total_subscriptions, 0);
    }

    #[tokio::test]
    async fn test_publish_event_with_mock_publisher() {
        let config = NotificationConfig::default();
        let mut service = NotificationService::new(config);

        // Add mock publisher
        let mock_publisher = Publisher::mock();
        service.add_publisher(NotificationChannel::MediaBlobs, mock_publisher);

        let event = NotificationEvent::new(
            NotificationChannel::MediaBlobs,
            "media_blob.created".to_string(),
            json!({"test": "data"}),
        );

        assert!(service.publish_event(event).await.is_ok());

        let stats = service.get_stats().await;
        assert_eq!(stats.total_published, 1);
        assert_eq!(
            stats
                .events_by_channel
                .get(&NotificationChannel::MediaBlobs),
            Some(&1)
        );
    }

    #[tokio::test]
    async fn test_health_check() {
        let config = NotificationConfig::default();
        let mut service = NotificationService::new(config);

        // Add mock publisher
        let mock_publisher = Publisher::mock();
        service.add_publisher(NotificationChannel::MediaBlobs, mock_publisher);

        let health_status = service.health_check().await.unwrap();
        assert_eq!(
            health_status.get(&NotificationChannel::MediaBlobs),
            Some(&true)
        );
    }

    #[test]
    fn test_rate_limiter() {
        let mut rate_limiter = RateLimiter::new();
        let config = crate::notifications::config::RateLimitConfig {
            per_user_events_per_minute: 2,
            per_channel_events_per_minute: 5,
            global_events_per_minute: 10,
            time_window_seconds: 60,
            ..Default::default()
        };

        let user_id = Uuid::new_v4();

        // First two events should pass
        assert!(rate_limiter.check_user_limit(user_id, &config));
        assert!(rate_limiter.check_user_limit(user_id, &config));

        // Third event should fail
        assert!(!rate_limiter.check_user_limit(user_id, &config));
    }
}
