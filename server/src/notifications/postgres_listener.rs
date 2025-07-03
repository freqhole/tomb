//! PostgreSQL NOTIFY/LISTEN integration for real-time database events
//!
//! This module provides a PostgreSQL listener that subscribes to database notifications
//! and routes them through the NotificationService to WebSocket clients.

use grimoire::notifications::{
    NotificationChannel, NotificationEvent, NotificationService, NotificationServiceError,
};
use grimoire::DatabaseConnection;
use serde_json::Value;
use sqlx::postgres::{PgListener, PgNotification};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use time::OffsetDateTime;
use tokio::sync::{broadcast, RwLock};
use tokio::time::{interval, sleep};
use tracing::{debug, error, info, warn};

/// Errors that can occur in PostgreSQL notification listener
#[derive(Debug, Error)]
pub enum PostgresListenerError {
    #[error("Database connection error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("JSON parsing error: {0}")]
    JsonParsing(#[from] serde_json::Error),

    #[error("Notification service error: {0}")]
    NotificationService(#[from] NotificationServiceError),

    #[error("Listener not running")]
    NotRunning,

    #[error("Already listening on channel: {channel}")]
    AlreadyListening { channel: String },

    #[error("Unknown notification channel: {channel}")]
    UnknownChannel { channel: String },

    #[error("Shutdown signal received")]
    Shutdown,
}

/// Statistics for PostgreSQL listener
#[derive(Debug, Clone)]
pub struct PostgresListenerStats {
    pub total_notifications_received: u64,
    pub notifications_by_channel: HashMap<String, u64>,
    pub total_processing_errors: u64,
    pub last_notification_at: Option<OffsetDateTime>,
    pub connection_status: ConnectionStatus,
    pub uptime_seconds: u64,
}

#[derive(Debug, Clone)]
pub enum ConnectionStatus {
    Connected,
    Disconnected,
    Reconnecting,
    Error(String),
}

impl Default for PostgresListenerStats {
    fn default() -> Self {
        Self {
            total_notifications_received: 0,
            notifications_by_channel: HashMap::new(),
            total_processing_errors: 0,
            last_notification_at: None,
            connection_status: ConnectionStatus::Disconnected,
            uptime_seconds: 0,
        }
    }
}

/// PostgreSQL NOTIFY/LISTEN notification listener
pub struct PostgresNotificationListener {
    db: DatabaseConnection,
    notification_service: Arc<NotificationService>,
    websocket_tx: Option<broadcast::Sender<String>>,
    stats: Arc<RwLock<PostgresListenerStats>>,
    start_time: Option<OffsetDateTime>,
    listener: Option<PgListener>,
}

impl PostgresNotificationListener {
    /// Create a new PostgreSQL notification listener
    pub fn new(db: DatabaseConnection, notification_service: Arc<NotificationService>) -> Self {
        Self {
            db,
            notification_service,
            websocket_tx: None,
            stats: Arc::new(RwLock::new(PostgresListenerStats::default())),
            start_time: None,
            listener: None,
        }
    }

    /// Create a new PostgreSQL notification listener with WebSocket broadcasting
    pub fn new_with_websocket(
        db: DatabaseConnection,
        notification_service: Arc<NotificationService>,
        websocket_tx: broadcast::Sender<String>,
    ) -> Self {
        Self {
            db,
            notification_service,
            websocket_tx: Some(websocket_tx),
            stats: Arc::new(RwLock::new(PostgresListenerStats::default())),
            start_time: None,
            listener: None,
        }
    }

    /// Start listening for PostgreSQL notifications
    pub async fn start(
        &mut self,
        shutdown_rx: broadcast::Receiver<()>,
    ) -> Result<(), PostgresListenerError> {
        info!("Starting PostgreSQL notification listener...");

        self.start_time = Some(OffsetDateTime::now_utc());

        // Create PgListener using the database connection pool
        let mut listener = PgListener::connect_with(&self.db.pool()).await?;

        // Listen to notification channels and verify
        for channel in &["media_blobs", "thumbnail_jobs", "music_notifications"] {
            match listener.listen(channel).await {
                Ok(_) => info!(
                    "✅ Successfully subscribed to PostgreSQL channel: {}",
                    channel
                ),
                Err(e) => {
                    error!(
                        "❌ Failed to subscribe to PostgreSQL channel {}: {}",
                        channel, e
                    );
                    return Err(PostgresListenerError::Database(e));
                }
            }
        }

        // Verify notification system works by sending a test notification
        info!("🧪 Testing PostgreSQL notification system...");
        let test_result = sqlx::query(
            "SELECT pg_notify('media_blobs', '{\"event_type\":\"system.startup\",\"message\":\"PostgreSQL listener initialized\",\"timestamp\":\"' || NOW() || '\"}')"
        )
        .execute(self.db.pool())
        .await;

        match test_result {
            Ok(_) => info!("✅ Test notification sent successfully"),
            Err(e) => warn!("⚠️ Could not send test notification: {}", e),
        }

        info!("PostgreSQL listener subscribed to channels: media_blobs, thumbnail_jobs, music_notifications");

        {
            let mut stats = self.stats.write().await;
            stats.connection_status = ConnectionStatus::Connected;
        }

        // Start the listening loop in a background task
        let _db = self.db.clone();
        let notification_service = Arc::clone(&self.notification_service);
        let stats = Arc::clone(&self.stats);
        let start_time = self.start_time.unwrap();
        let websocket_tx = self.websocket_tx.clone();

        tokio::spawn(async move {
            let result = async {
                let mut listener_clone = PgListener::connect_with(&_db.pool()).await?;

                // Listen to all required notification channels
                info!("Subscribing to PostgreSQL notification channels in worker thread...");

                // Test direct notification capability
                let _ = sqlx::query(
                    "SELECT pg_notify('music_notifications', '{\"event_type\":\"listener.started\",\"message\":\"Worker thread started\"}')"
                )
                .execute(_db.pool())
                .await;

                for channel in ["media_blobs", "thumbnail_jobs", "music_notifications"] {
                    match listener_clone.listen(channel).await {
                        Ok(_) => info!(
                            "✅ Worker thread subscribed to PostgreSQL channel: {}",
                            channel
                        ),
                        Err(e) => error!(
                            "❌ Worker thread failed to subscribe to PostgreSQL channel {}: {}",
                            channel, e
                        ),
                    }
                }

                Self::listen_loop(
                    &mut listener_clone,
                    notification_service,
                    stats,
                    start_time,
                    shutdown_rx,
                    websocket_tx,
                )
                .await
            }
            .await;

            if let Err(e) = result {
                error!("PostgreSQL listener loop ended with error: {}", e);
            } else {
                info!("PostgreSQL listener loop ended gracefully");
            }
        });

        self.listener = Some(listener);
        Ok(())
    }

    /// Main listening loop
    /// Main listening loop for PostgreSQL notifications
    async fn listen_loop(
        listener: &mut PgListener,
        notification_service: Arc<NotificationService>,
        stats: Arc<RwLock<PostgresListenerStats>>,
        start_time: OffsetDateTime,
        mut shutdown_rx: broadcast::Receiver<()>,
        websocket_tx: Option<broadcast::Sender<String>>,
    ) -> Result<(), PostgresListenerError> {
        let mut stats_update_interval = interval(Duration::from_secs(30));

        loop {
            tokio::select! {
                // Check for shutdown signal
                _ = shutdown_rx.recv() => {
                    info!("Shutdown signal received, stopping PostgreSQL listener");
                    return Err(PostgresListenerError::Shutdown);
                }

                // Update stats periodically
                _ = stats_update_interval.tick() => {
                    let mut stats_guard = stats.write().await;
                    stats_guard.uptime_seconds = (OffsetDateTime::now_utc() - start_time).whole_seconds() as u64;
                }

                // Listen for PostgreSQL notifications
                notification_result = listener.recv() => {
                    match notification_result {
                        Ok(notification) => {
                            let channel = notification.channel();
                            let payload = notification.payload();

                            info!("📢 NOTIFICATION RECEIVED: Channel '{}' with payload: '{}'",
                                channel, payload);

                            if let Err(e) = Self::handle_notification(
                                notification,
                                &notification_service,
                                &stats,
                                &websocket_tx,
                            ).await {
                                error!("Error handling notification: {}", e);
                                let mut stats_guard = stats.write().await;
                                stats_guard.total_processing_errors += 1;
                                stats_guard.connection_status = ConnectionStatus::Error(e.to_string());
                            }
                        }
                        Err(e) => {
                            error!("PostgreSQL listener connection error: {}", e);
                            let mut stats_guard = stats.write().await;
                            stats_guard.connection_status = ConnectionStatus::Error(e.to_string());

                            // Attempt to reconnect after a delay
                            sleep(Duration::from_secs(5)).await;
                            stats_guard.connection_status = ConnectionStatus::Reconnecting;
                        }
                    }
                }
            }
        }
    }

    /// Handle a single PostgreSQL notification
    async fn handle_notification(
        notification: PgNotification,
        notification_service: &NotificationService,
        stats: &Arc<RwLock<PostgresListenerStats>>,
        websocket_tx: &Option<broadcast::Sender<String>>,
    ) -> Result<(), PostgresListenerError> {
        let channel_name = notification.channel();
        let payload = notification.payload();

        info!(
            "🔍 Processing notification - Channel: '{}', Payload: {}",
            channel_name, payload
        );

        // Debug full payload for troubleshooting
        debug!(
            "Full notification payload on channel '{}':\n{}\n",
            channel_name, payload
        );

        // Parse the JSON payload
        let payload_json: Value = serde_json::from_str(payload)?;

        // Map database channel to notification channel
        let notification_channel = match channel_name {
            "media_blobs" => {
                info!("📄 Media blob notification received");
                NotificationChannel::MediaBlobs
            }
            "thumbnail_jobs" => {
                info!("🖼️ Thumbnail job notification received");
                NotificationChannel::ThumbnailJobs
            }
            "music_notifications" => {
                info!("🎵 Music notification received: {}", payload);
                info!("🎵 Routing music notification to MediaBlobs channel for client consumption");
                NotificationChannel::MediaBlobs // Route music notifications to MediaBlobs channel
            }
            _ => {
                warn!("Unknown PostgreSQL notification channel: {}", channel_name);
                return Err(PostgresListenerError::UnknownChannel {
                    channel: channel_name.to_string(),
                });
            }
        };

        // Extract event type from payload
        let event_type = payload_json
            .get("event_type")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string();

        // Create NotificationEvent
        let event = NotificationEvent::new(notification_channel, event_type, payload_json);

        // Extract more notification details for better logging
        let event_type_str = event.event_type.clone();

        // Broadcast directly to WebSocket clients if available
        if let Some(websocket_tx) = websocket_tx {
            let websocket_message = serde_json::json!({
                "type": "Notification",
                "data": {
                    "id": event.id,
                    "channel": format!("{:?}", event.channel),
                    "event_type": event.event_type,
                    "payload": event.payload_value(),
                    "priority": format!("{:?}", event.priority),
                    "timestamp": event.timestamp(),
                }
            });

            match serde_json::to_string(&websocket_message) {
                Ok(message_str) => match websocket_tx.send(message_str) {
                    Ok(receiver_count) => {
                        info!(
                                "✅ Successfully published notification - Channel: '{}', Event: '{}' to {} WebSocket clients",
                                channel_name, event_type_str, receiver_count
                            );
                    }
                    Err(_) => {
                        warn!(
                                "⚠️ No WebSocket receivers for notification - Channel: '{}', Event: '{}'",
                                channel_name, event_type_str
                            );
                    }
                },
                Err(e) => {
                    error!(
                        "❌ Failed to serialize notification for WebSocket - Channel: '{}', Event: '{}', Error: {}",
                        channel_name, event_type_str, e
                    );
                }
            }
        }

        // Also publish through the notification service for other publishers
        match notification_service.publish_event(event).await {
            Ok(_) => {
                // Already logged success above for WebSocket
            }
            Err(e) => {
                error!(
                    "❌ Failed to publish notification - Channel: '{}', Event: '{}': {}",
                    channel_name, event_type_str, e
                );
                return Err(e.into());
            }
        }

        // Update stats
        {
            let mut stats_guard = stats.write().await;
            stats_guard.total_notifications_received += 1;
            stats_guard.last_notification_at = Some(OffsetDateTime::now_utc());
            stats_guard.connection_status = ConnectionStatus::Connected;

            *stats_guard
                .notifications_by_channel
                .entry(channel_name.to_string())
                .or_insert(0) += 1;
        }

        debug!(
            "Successfully processed PostgreSQL notification for channel '{}'",
            channel_name
        );

        Ok(())
    }

    /// Shutdown the listener
    pub async fn shutdown(&mut self) -> Result<(), PostgresListenerError> {
        info!("Shutting down PostgreSQL notification listener...");

        if let Some(mut listener) = self.listener.take() {
            // Unlisten from all channels
            if let Err(e) = listener.unlisten("media_blobs").await {
                warn!("Error unlistening from media_blobs channel: {}", e);
            }
            if let Err(e) = listener.unlisten("thumbnail_jobs").await {
                warn!("Error unlistening from thumbnail_jobs channel: {}", e);
            }
        }

        {
            let mut stats = self.stats.write().await;
            stats.connection_status = ConnectionStatus::Disconnected;
        }

        info!("PostgreSQL notification listener shutdown complete");
        Ok(())
    }

    /// Get current statistics
    pub async fn get_stats(&self) -> PostgresListenerStats {
        let stats = self.stats.read().await;
        let mut stats_clone = stats.clone();

        // Update uptime if we have a start time
        if let Some(start_time) = self.start_time {
            stats_clone.uptime_seconds =
                (OffsetDateTime::now_utc() - start_time).whole_seconds() as u64;
        }

        stats_clone
    }

    /// Check if the listener is currently running
    pub async fn is_running(&self) -> bool {
        match self.stats.read().await.connection_status {
            ConnectionStatus::Connected | ConnectionStatus::Reconnecting => true,
            ConnectionStatus::Disconnected | ConnectionStatus::Error(_) => false,
        }
    }

    /// Manually test a notification (useful for development)
    pub async fn test_notification(
        &self,
        channel: &str,
        payload: Value,
    ) -> Result<(), PostgresListenerError> {
        if !self.is_running().await {
            return Err(PostgresListenerError::NotRunning);
        }

        // Execute test notification function in database
        sqlx::query!("SELECT test_notification($1, $2)", channel, payload)
            .execute(self.db.pool())
            .await?;

        info!(
            "Test notification sent to channel '{}': {}",
            channel, payload
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_postgres_listener_stats_default() {
        let stats = PostgresListenerStats::default();
        assert_eq!(stats.total_notifications_received, 0);
        assert!(stats.notifications_by_channel.is_empty());
        assert_eq!(stats.total_processing_errors, 0);
        assert!(stats.last_notification_at.is_none());
        matches!(stats.connection_status, ConnectionStatus::Disconnected);
    }

    #[test]
    fn test_notification_channel_mapping() {
        // This tests the channel mapping logic
        let test_cases = vec![
            ("media_blobs", Some(NotificationChannel::MediaBlobs)),
            ("thumbnail_jobs", Some(NotificationChannel::ThumbnailJobs)),
            ("unknown_channel", None),
        ];

        for (channel_name, expected) in test_cases {
            let result = match channel_name {
                "media_blobs" => Some(NotificationChannel::MediaBlobs),
                "thumbnail_jobs" => Some(NotificationChannel::ThumbnailJobs),
                _ => None,
            };
            assert_eq!(result, expected);
        }
    }

    #[tokio::test]
    async fn test_notification_event_creation() {
        let payload = json!({
            "event_type": "media_blob.created",
            "blob_id": "123e4567-e89b-12d3-a456-426614174000",
            "filename": "test.jpg"
        });

        let event = NotificationEvent::new(
            NotificationChannel::MediaBlobs,
            "media_blob.created".to_string(),
            payload.clone(),
        );

        assert_eq!(event.channel, NotificationChannel::MediaBlobs);
        assert_eq!(event.event_type, "media_blob.created");
        assert_eq!(event.payload_value(), &payload);
    }
}
