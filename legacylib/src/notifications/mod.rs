//! Notifications domain module
//!
//! This module provides the core domain logic for real-time notifications,
//! including PostgreSQL NOTIFY/LISTEN integration, WebSocket event publishing,
//! and notification filtering and routing.
//!
//! ## Key Features
//!
//! - **Event Publishing**: Abstract publisher traits for PostgreSQL and WebSocket
//! - **Notification Filtering**: User permission-based event filtering
//! - **Channel Management**: Subscription and routing management
//! - **Rate Limiting**: Event deduplication and rate limiting
//! - **Configuration**: Comprehensive notification system configuration
//!
//! ## Usage Examples
//!
//! ### Publishing a notification
//!
//! ```rust
//! use grimoire::notifications::{NotificationService, NotificationEvent, NotificationChannel};
//!
//! // Create a media blob change event
//! let event = NotificationEvent::new(
//!     NotificationChannel::MediaBlobs,
//!     "media_blob.created".to_string(),
//!     serde_json::json!({
//!         "blob_id": "123e4567-e89b-12d3-a456-426614174000",
//!         "filename": "photo.jpg",
//!         "size_bytes": 1024000
//!     })
//! );
//!
//! service.publish_event(event).await?;
//! ```
//!
//! ### Subscribing to notifications
//!
//! ```rust
//! use grimoire::notifications::{ChannelSubscription, NotificationFilter};
//!
//! // Subscribe to media blob events for specific user
//! let subscription = ChannelSubscription::new(
//!     user_id,
//!     NotificationChannel::MediaBlobs,
//!     Some(NotificationFilter::user_owned_only())
//! );
//!
//! service.add_subscription(subscription).await?;
//! ```

pub mod config;
pub mod models;
pub mod music_events;
pub mod publisher;
pub mod service;

pub use config::{NotificationChannelConfig, NotificationConfig, RateLimitConfig};
pub use models::{
    ChannelSubscription, EventMetadata, NotificationChannel, NotificationEvent, NotificationFilter,
    NotificationPayload, NotificationPriority,
};
pub use music_events::{
    LibraryStatsPayload, MusicEventType, PlaylistEventPayload, PlaylistSongEventPayload,
    ScanCompletedPayload, ScanFailedPayload, ScanProgressPayload, SongEventPayload,
};
pub use publisher::{
    MockNotificationPublisher, PostgresNotificationPublisher, Publisher, PublisherError,
    WebSocketNotificationPublisher,
};
pub use service::{EventStats, NotificationService, NotificationServiceError};

/// Re-exports for convenience
pub mod prelude {
    pub use super::{
        ChannelSubscription, MusicEventType, NotificationChannel, NotificationConfig,
        NotificationEvent, NotificationFilter, NotificationService, Publisher, SongEventPayload,
    };
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    #[test]
    fn test_notification_event_creation() {
        let event = NotificationEvent::new(
            NotificationChannel::MediaBlobs,
            "media_blob.created".to_string(),
            json!({"test": "data"}),
        );

        assert_eq!(event.channel, NotificationChannel::MediaBlobs);
        assert_eq!(event.event_type, "media_blob.created");
        assert!(!event.id.is_nil());
    }

    #[test]
    fn test_channel_subscription_creation() {
        let user_id = Uuid::new_v4();
        let subscription =
            ChannelSubscription::new(user_id, NotificationChannel::ThumbnailJobs, None);

        assert_eq!(subscription.user_id, user_id);
        assert_eq!(subscription.channel, NotificationChannel::ThumbnailJobs);
        assert!(subscription.filter.is_none());
    }

    #[test]
    fn test_notification_filter_user_owned() {
        let filter = NotificationFilter::user_owned_only();
        assert!(filter.user_owned_only);
        assert!(filter.event_types.is_empty());
    }
}
