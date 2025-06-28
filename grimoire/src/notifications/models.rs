//! Notification domain models
//!
//! This module contains the core domain models for the notification system,
//! including events, channels, filters, and metadata structures.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use time::OffsetDateTime;
use uuid::Uuid;

/// Represents a notification event in the system
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NotificationEvent {
    /// Unique identifier for this event
    pub id: Uuid,
    /// The channel this event belongs to
    pub channel: NotificationChannel,
    /// Type of event (e.g., "media_blob.created", "thumbnail_job.completed")
    pub event_type: String,
    /// JSON payload containing event-specific data
    pub payload: NotificationPayload,
    /// Event metadata
    pub metadata: EventMetadata,
    /// When this event was created
    pub created_at: OffsetDateTime,
    /// Priority level for delivery
    pub priority: NotificationPriority,
}

impl NotificationEvent {
    /// Create a new notification event
    pub fn new(
        channel: NotificationChannel,
        event_type: String,
        payload: serde_json::Value,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            channel,
            event_type,
            payload: NotificationPayload::new(payload),
            metadata: EventMetadata::default(),
            created_at: OffsetDateTime::now_utc(),
            priority: NotificationPriority::Normal,
        }
    }

    /// Create a high priority event
    pub fn high_priority(
        channel: NotificationChannel,
        event_type: String,
        payload: serde_json::Value,
    ) -> Self {
        let mut event = Self::new(channel, event_type, payload);
        event.priority = NotificationPriority::High;
        event
    }

    /// Add metadata to the event
    pub fn with_metadata(mut self, key: String, value: String) -> Self {
        self.metadata.add(key, value);
        self
    }

    /// Set the user that caused this event
    pub fn with_source_user(mut self, user_id: Uuid) -> Self {
        self.metadata.source_user_id = Some(user_id);
        self
    }

    /// Set the client that caused this event
    pub fn with_source_client(mut self, client_id: String) -> Self {
        self.metadata.source_client_id = Some(client_id);
        self
    }

    /// Get timestamp as alias for created_at (for compatibility)
    pub fn timestamp(&self) -> OffsetDateTime {
        self.created_at
    }

    /// Get payload as raw JSON value (for serialization)
    pub fn payload_value(&self) -> &serde_json::Value {
        &self.payload.data
    }
}

/// Notification channels that events can be published to
#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord, JsonSchema,
)]
pub enum NotificationChannel {
    /// Media blob related events (upload, delete, etc.)
    MediaBlobs,
    /// Thumbnail job events (started, completed, failed)
    ThumbnailJobs,
    /// User authentication events (login, logout, etc.)
    UserAuth,
    /// System events (maintenance, errors, etc.)
    System,
    /// Analytics events (stats updates, reports, etc.)
    Analytics,
    /// Music domain events (songs, playlists, scanning)
    Music,
}

impl NotificationChannel {
    /// Get the PostgreSQL channel name for NOTIFY/LISTEN
    pub fn postgres_channel(&self) -> &'static str {
        match self {
            Self::MediaBlobs => "media_blobs_notifications",
            Self::ThumbnailJobs => "thumbnail_jobs_notifications",
            Self::UserAuth => "user_auth_notifications",
            Self::System => "system_notifications",
            Self::Analytics => "analytics_notifications",
            Self::Music => "music_notifications",
        }
    }

    /// Get the WebSocket topic name
    pub fn websocket_topic(&self) -> &'static str {
        match self {
            Self::MediaBlobs => "media-blobs",
            Self::ThumbnailJobs => "thumbnail-jobs",
            Self::UserAuth => "user-auth",
            Self::System => "system",
            Self::Analytics => "analytics",
            Self::Music => "music",
        }
    }

    /// Get all available channels
    pub fn all() -> Vec<Self> {
        vec![
            Self::MediaBlobs,
            Self::ThumbnailJobs,
            Self::UserAuth,
            Self::System,
            Self::Analytics,
            Self::Music,
        ]
    }
}

/// Wrapper for notification payload data
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NotificationPayload {
    /// The actual payload data
    pub data: serde_json::Value,
    /// Size of the payload in bytes (for rate limiting)
    pub size_bytes: usize,
}

impl NotificationPayload {
    /// Create a new payload
    pub fn new(data: serde_json::Value) -> Self {
        let size_bytes = data.to_string().len();
        Self { data, size_bytes }
    }

    /// Check if payload exceeds size limit
    pub fn exceeds_size_limit(&self, limit_bytes: usize) -> bool {
        self.size_bytes > limit_bytes
    }
}

/// Event metadata for tracking and filtering
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventMetadata {
    /// User ID that triggered this event (if applicable)
    pub source_user_id: Option<Uuid>,
    /// Client ID that triggered this event (if applicable)
    pub source_client_id: Option<String>,
    /// Additional metadata key-value pairs
    pub additional: HashMap<String, String>,
    /// Event correlation ID for tracing
    pub correlation_id: Option<String>,
}

impl Default for EventMetadata {
    fn default() -> Self {
        Self {
            source_user_id: None,
            source_client_id: None,
            additional: HashMap::new(),
            correlation_id: None,
        }
    }
}

impl EventMetadata {
    /// Add additional metadata
    pub fn add(&mut self, key: String, value: String) {
        self.additional.insert(key, value);
    }

    /// Get additional metadata value
    pub fn get(&self, key: &str) -> Option<&String> {
        self.additional.get(key)
    }
}

/// Priority levels for notification delivery
#[derive(
    Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash, JsonSchema,
)]
pub enum NotificationPriority {
    /// Low priority - can be delayed or batched
    Low,
    /// Normal priority - standard delivery
    Normal,
    /// High priority - should be delivered immediately
    High,
    /// Critical priority - must be delivered immediately
    Critical,
}

impl NotificationPriority {
    /// Get the delivery timeout for this priority level
    pub fn delivery_timeout_ms(&self) -> u64 {
        match self {
            Self::Low => 30_000,     // 30 seconds
            Self::Normal => 10_000,  // 10 seconds
            Self::High => 3_000,     // 3 seconds
            Self::Critical => 1_000, // 1 second
        }
    }

    /// Check if this priority should bypass rate limiting
    pub fn bypasses_rate_limit(&self) -> bool {
        matches!(self, Self::High | Self::Critical)
    }
}

/// Subscription to a notification channel
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ChannelSubscription {
    /// Unique identifier for this subscription
    pub id: Uuid,
    /// User ID that owns this subscription
    pub user_id: Uuid,
    /// Channel to subscribe to
    pub channel: NotificationChannel,
    /// Optional filter for events
    pub filter: Option<NotificationFilter>,
    /// When this subscription was created
    pub created_at: OffsetDateTime,
    /// Whether this subscription is active
    pub active: bool,
}

impl ChannelSubscription {
    /// Create a new channel subscription
    pub fn new(
        user_id: Uuid,
        channel: NotificationChannel,
        filter: Option<NotificationFilter>,
    ) -> Self {
        Self {
            id: Uuid::new_v4(),
            user_id,
            channel,
            filter,
            created_at: OffsetDateTime::now_utc(),
            active: true,
        }
    }

    /// Check if this subscription should receive the given event
    pub fn should_receive_event(&self, event: &NotificationEvent) -> bool {
        if !self.active || event.channel != self.channel {
            return false;
        }

        if let Some(filter) = &self.filter {
            filter.matches_event(event, self.user_id)
        } else {
            true
        }
    }
}

/// Filter criteria for notification events
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NotificationFilter {
    /// Only events for content owned by the user
    pub user_owned_only: bool,
    /// Specific event types to include (empty = all types)
    pub event_types: Vec<String>,
    /// Specific event types to exclude
    pub excluded_event_types: Vec<String>,
    /// Priority threshold (only events >= this priority)
    pub min_priority: NotificationPriority,
    /// Maximum events per minute (0 = no limit)
    pub rate_limit_per_minute: u32,
}

impl Default for NotificationFilter {
    fn default() -> Self {
        Self {
            user_owned_only: false,
            event_types: vec![],
            excluded_event_types: vec![],
            min_priority: NotificationPriority::Low,
            rate_limit_per_minute: 0,
        }
    }
}

impl NotificationFilter {
    /// Create a filter that only shows user-owned content
    pub fn user_owned_only() -> Self {
        Self {
            user_owned_only: true,
            ..Default::default()
        }
    }

    /// Create a filter for specific event types
    pub fn event_types(types: Vec<String>) -> Self {
        Self {
            event_types: types,
            ..Default::default()
        }
    }

    /// Create a filter with minimum priority
    pub fn min_priority(priority: NotificationPriority) -> Self {
        Self {
            min_priority: priority,
            ..Default::default()
        }
    }

    /// Check if this filter matches the given event
    pub fn matches_event(&self, event: &NotificationEvent, user_id: Uuid) -> bool {
        // Check priority threshold
        if event.priority < self.min_priority {
            return false;
        }

        // Check excluded event types
        if self.excluded_event_types.contains(&event.event_type) {
            return false;
        }

        // Check included event types (if specified)
        if !self.event_types.is_empty() && !self.event_types.contains(&event.event_type) {
            return false;
        }

        // Check user ownership
        if self.user_owned_only {
            if let Some(source_user_id) = event.metadata.source_user_id {
                if source_user_id != user_id {
                    return false;
                }
            } else {
                // If user_owned_only is true but event has no source user, exclude it
                return false;
            }
        }

        true
    }
}

/// Statistics for event delivery
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct EventDeliveryStats {
    /// Total events published
    pub total_published: u64,
    /// Total events delivered successfully
    pub total_delivered: u64,
    /// Total events failed to deliver
    pub total_failed: u64,
    /// Average delivery time in milliseconds
    pub avg_delivery_time_ms: f64,
    /// Events per channel
    pub events_by_channel: HashMap<NotificationChannel, u64>,
    /// Events per priority
    pub events_by_priority: HashMap<NotificationPriority, u64>,
}

impl Default for EventDeliveryStats {
    fn default() -> Self {
        Self {
            total_published: 0,
            total_delivered: 0,
            total_failed: 0,
            avg_delivery_time_ms: 0.0,
            events_by_channel: HashMap::new(),
            events_by_priority: HashMap::new(),
        }
    }
}

impl EventDeliveryStats {
    /// Calculate success rate as a percentage
    pub fn success_rate(&self) -> f64 {
        if self.total_published == 0 {
            return 100.0;
        }
        (self.total_delivered as f64 / self.total_published as f64) * 100.0
    }

    /// Calculate failure rate as a percentage
    pub fn failure_rate(&self) -> f64 {
        if self.total_published == 0 {
            return 0.0;
        }
        (self.total_failed as f64 / self.total_published as f64) * 100.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_notification_event_creation() {
        let event = NotificationEvent::new(
            NotificationChannel::MediaBlobs,
            "media_blob.created".to_string(),
            json!({"blob_id": "123", "filename": "test.jpg"}),
        );

        assert_eq!(event.channel, NotificationChannel::MediaBlobs);
        assert_eq!(event.event_type, "media_blob.created");
        assert_eq!(event.priority, NotificationPriority::Normal);
        assert!(!event.id.is_nil());
    }

    #[test]
    fn test_notification_channel_postgres_names() {
        assert_eq!(
            NotificationChannel::MediaBlobs.postgres_channel(),
            "media_blobs_notifications"
        );
        assert_eq!(
            NotificationChannel::ThumbnailJobs.postgres_channel(),
            "thumbnail_jobs_notifications"
        );
        assert_eq!(
            NotificationChannel::Music.postgres_channel(),
            "music_notifications"
        );
    }

    #[test]
    fn test_notification_filter_user_owned() {
        let user_id = Uuid::new_v4();
        let other_user_id = Uuid::new_v4();

        let filter = NotificationFilter::user_owned_only();

        // Event with matching user should pass
        let event = NotificationEvent::new(
            NotificationChannel::MediaBlobs,
            "test".to_string(),
            json!({}),
        )
        .with_source_user(user_id);

        assert!(filter.matches_event(&event, user_id));

        // Event with different user should not pass
        let event = NotificationEvent::new(
            NotificationChannel::MediaBlobs,
            "test".to_string(),
            json!({}),
        )
        .with_source_user(other_user_id);

        assert!(!filter.matches_event(&event, user_id));

        // Event with no user should not pass
        let event = NotificationEvent::new(
            NotificationChannel::MediaBlobs,
            "test".to_string(),
            json!({}),
        );

        assert!(!filter.matches_event(&event, user_id));
    }

    #[test]
    fn test_channel_subscription_should_receive() {
        let user_id = Uuid::new_v4();
        let subscription = ChannelSubscription::new(
            user_id,
            NotificationChannel::MediaBlobs,
            Some(NotificationFilter::user_owned_only()),
        );

        // Matching event should be received
        let event = NotificationEvent::new(
            NotificationChannel::MediaBlobs,
            "test".to_string(),
            json!({}),
        )
        .with_source_user(user_id);

        assert!(subscription.should_receive_event(&event));

        // Different channel should not be received
        let event = NotificationEvent::new(
            NotificationChannel::ThumbnailJobs,
            "test".to_string(),
            json!({}),
        )
        .with_source_user(user_id);

        assert!(!subscription.should_receive_event(&event));
    }

    #[test]
    fn test_notification_priority_ordering() {
        assert!(NotificationPriority::Critical > NotificationPriority::High);
        assert!(NotificationPriority::High > NotificationPriority::Normal);
        assert!(NotificationPriority::Normal > NotificationPriority::Low);
    }

    #[test]
    fn test_music_channel_websocket_topics() {
        assert_eq!(NotificationChannel::Music.websocket_topic(), "music");
        assert_eq!(
            NotificationChannel::MediaBlobs.websocket_topic(),
            "media-blobs"
        );
    }

    #[test]
    fn test_music_channel_in_all_channels() {
        let all_channels = NotificationChannel::all();
        assert!(all_channels.contains(&NotificationChannel::Music));
        assert_eq!(all_channels.len(), 6); // MediaBlobs, ThumbnailJobs, UserAuth, System, Analytics, Music
    }

    #[test]
    fn test_event_delivery_stats() {
        let mut stats = EventDeliveryStats::default();
        stats.total_published = 100;
        stats.total_delivered = 95;
        stats.total_failed = 5;

        assert_eq!(stats.success_rate(), 95.0);
        assert_eq!(stats.failure_rate(), 5.0);
    }
}
