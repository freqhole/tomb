//! WebSocket notification publisher for broadcasting events to connected clients
//!
//! This module provides a WebSocket publisher that integrates with the notification system
//! to broadcast events to connected WebSocket clients in real-time.

use grimoire::notifications::publisher::PublisherError;
use grimoire::notifications::NotificationEvent;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use thiserror::Error;
use time::OffsetDateTime;
use tokio::sync::{broadcast, RwLock};
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Errors that can occur in WebSocket notification publisher
#[derive(Debug, Error)]
pub enum WebSocketPublisherError {
    #[error("Failed to serialize notification: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Broadcast channel error: {0}")]
    BroadcastChannel(String),

    #[error("No active connections")]
    NoActiveConnections,

    #[error("Connection not found: {connection_id}")]
    ConnectionNotFound { connection_id: String },

    #[error("Channel full, message dropped")]
    ChannelFull,

    #[error("Delivery failed: {reason}")]
    DeliveryFailed { reason: String },
}

/// Statistics for WebSocket publisher
#[derive(Debug, Clone)]
pub struct WebSocketPublisherStats {
    pub total_messages_sent: u64,
    pub total_messages_failed: u64,
    pub active_connections: u64,
    pub messages_by_channel: HashMap<String, u64>,
    pub last_message_at: Option<OffsetDateTime>,
}

impl Default for WebSocketPublisherStats {
    fn default() -> Self {
        Self {
            total_messages_sent: 0,
            total_messages_failed: 0,
            active_connections: 0,
            messages_by_channel: HashMap::new(),
            last_message_at: None,
        }
    }
}

/// Information about a WebSocket connection
#[derive(Debug, Clone)]
pub struct ConnectionInfo {
    pub user_id: Option<Uuid>,
    pub connected_at: OffsetDateTime,
    pub subscribed_channels: Vec<String>,
    pub last_activity: OffsetDateTime,
}

impl ConnectionInfo {
    pub fn new(user_id: Option<Uuid>) -> Self {
        let now = OffsetDateTime::now_utc();
        Self {
            user_id,
            connected_at: now,
            subscribed_channels: Vec::new(),
            last_activity: now,
        }
    }

    pub fn update_activity(&mut self) {
        self.last_activity = OffsetDateTime::now_utc();
    }

    pub fn subscribe_to_channel(&mut self, channel: String) {
        if !self.subscribed_channels.contains(&channel) {
            self.subscribed_channels.push(channel);
        }
    }

    pub fn unsubscribe_from_channel(&mut self, channel: &str) {
        self.subscribed_channels.retain(|c| c != channel);
    }
}

/// WebSocket notification publisher
#[derive(Debug, Clone)]
pub struct WebSocketNotificationPublisher {
    broadcast_tx: broadcast::Sender<String>,
    connections: Arc<RwLock<HashMap<String, ConnectionInfo>>>,
    stats: Arc<RwLock<WebSocketPublisherStats>>,
}

impl WebSocketNotificationPublisher {
    /// Create a new WebSocket notification publisher
    pub fn new(broadcast_tx: broadcast::Sender<String>) -> Self {
        Self {
            broadcast_tx,
            connections: Arc::new(RwLock::new(HashMap::new())),
            stats: Arc::new(RwLock::new(WebSocketPublisherStats::default())),
        }
    }

    /// Publish a notification event to WebSocket clients
    pub async fn publish_event(&self, event: &NotificationEvent) -> Result<(), PublisherError> {
        debug!(
            "Publishing WebSocket notification: {} on channel {:?}",
            event.event_type, event.channel
        );

        // Serialize the event to JSON
        let message = self
            .serialize_event(event)
            .map_err(|e| PublisherError::Internal(e.to_string()))?;

        // Broadcast to all connected clients
        match self.broadcast_tx.send(message.clone()) {
            Ok(receiver_count) => {
                debug!("Broadcast notification to {} receivers", receiver_count);

                // Update stats
                {
                    let mut stats = self.stats.write().await;
                    stats.total_messages_sent += 1;
                    stats.last_message_at = Some(OffsetDateTime::now_utc());

                    let channel_name = format!("{:?}", event.channel);
                    *stats.messages_by_channel.entry(channel_name).or_insert(0) += 1;
                }

                Ok(())
            }
            Err(broadcast::error::SendError(_)) => {
                warn!("No WebSocket receivers available for notification");

                // Update error stats
                {
                    let mut stats = self.stats.write().await;
                    stats.total_messages_failed += 1;
                }

                Err(PublisherError::Internal(
                    "No active WebSocket connections".to_string(),
                ))
            }
        }
    }

    /// Serialize notification event to JSON string for WebSocket transmission
    fn serialize_event(
        &self,
        event: &NotificationEvent,
    ) -> Result<String, WebSocketPublisherError> {
        let websocket_message = serde_json::json!({
            "type": "notification",
            "id": event.id,
            "channel": format!("{:?}", event.channel),
            "event_type": event.event_type,
            "payload": event.payload_value(),
            "priority": format!("{:?}", event.priority),
            "timestamp": event.timestamp(),
        });

        serde_json::to_string(&websocket_message).map_err(WebSocketPublisherError::from)
    }

    /// Add a new WebSocket connection
    pub async fn add_connection(&self, connection_id: String, user_id: Option<Uuid>) {
        let connection_info = ConnectionInfo::new(user_id);

        {
            let mut connections = self.connections.write().await;
            connections.insert(connection_id.clone(), connection_info);
        }

        {
            let mut stats = self.stats.write().await;
            stats.active_connections = self.get_connection_count().await;
        }

        info!("Added WebSocket connection: {}", connection_id);
    }

    /// Remove a WebSocket connection
    pub async fn remove_connection(&self, connection_id: &str) {
        {
            let mut connections = self.connections.write().await;
            connections.remove(connection_id);
        }

        {
            let mut stats = self.stats.write().await;
            stats.active_connections = self.get_connection_count().await;
        }

        info!("Removed WebSocket connection: {}", connection_id);
    }

    /// Subscribe a connection to a notification channel
    pub async fn subscribe_connection_to_channel(
        &self,
        connection_id: &str,
        channel: String,
    ) -> Result<(), WebSocketPublisherError> {
        let mut connections = self.connections.write().await;

        if let Some(connection) = connections.get_mut(connection_id) {
            connection.subscribe_to_channel(channel.clone());
            connection.update_activity();

            debug!(
                "Connection {} subscribed to channel {}",
                connection_id, channel
            );
            Ok(())
        } else {
            Err(WebSocketPublisherError::ConnectionNotFound {
                connection_id: connection_id.to_string(),
            })
        }
    }

    /// Unsubscribe a connection from a notification channel
    pub async fn unsubscribe_connection_from_channel(
        &self,
        connection_id: &str,
        channel: &str,
    ) -> Result<(), WebSocketPublisherError> {
        let mut connections = self.connections.write().await;

        if let Some(connection) = connections.get_mut(connection_id) {
            connection.unsubscribe_from_channel(channel);
            connection.update_activity();

            debug!(
                "Connection {} unsubscribed from channel {}",
                connection_id, channel
            );
            Ok(())
        } else {
            Err(WebSocketPublisherError::ConnectionNotFound {
                connection_id: connection_id.to_string(),
            })
        }
    }

    /// Get current connection count
    pub async fn get_connection_count(&self) -> u64 {
        let connections = self.connections.read().await;
        connections.len() as u64
    }

    /// Get connection information
    pub async fn get_connection_info(&self, connection_id: &str) -> Option<ConnectionInfo> {
        let connections = self.connections.read().await;
        connections.get(connection_id).cloned()
    }

    /// Get all active connections
    pub async fn get_all_connections(&self) -> HashMap<String, ConnectionInfo> {
        let connections = self.connections.read().await;
        connections.clone()
    }

    /// Get publisher statistics
    pub async fn get_stats(&self) -> WebSocketPublisherStats {
        let mut stats = self.stats.read().await.clone();
        stats.active_connections = self.get_connection_count().await;
        stats
    }

    /// Clean up inactive connections (connections that haven't sent activity in a while)
    pub async fn cleanup_inactive_connections(&self, max_idle_duration: std::time::Duration) {
        let cutoff_time = OffsetDateTime::now_utc()
            - time::Duration::try_from(max_idle_duration).unwrap_or(time::Duration::minutes(30));

        let mut connections_to_remove = Vec::new();

        {
            let connections = self.connections.read().await;
            for (connection_id, connection_info) in connections.iter() {
                if connection_info.last_activity < cutoff_time {
                    connections_to_remove.push(connection_id.clone());
                }
            }
        }

        for connection_id in connections_to_remove {
            self.remove_connection(&connection_id).await;
            warn!("Removed inactive WebSocket connection: {}", connection_id);
        }
    }

    /// Send a direct message to a specific connection
    pub async fn send_to_connection(
        &self,
        connection_id: &str,
        message: Value,
    ) -> Result<(), WebSocketPublisherError> {
        // Check if connection exists
        {
            let connections = self.connections.read().await;
            if !connections.contains_key(connection_id) {
                return Err(WebSocketPublisherError::ConnectionNotFound {
                    connection_id: connection_id.to_string(),
                });
            }
        }

        // For now, we broadcast to all connections since we don't have per-connection channels
        // In a more sophisticated implementation, we'd have per-connection broadcast channels
        let message_str = serde_json::to_string(&message)?;

        match self.broadcast_tx.send(message_str) {
            Ok(_) => {
                debug!("Sent direct message to connection: {}", connection_id);
                Ok(())
            }
            Err(_) => Err(WebSocketPublisherError::BroadcastChannel(
                "Failed to send message".to_string(),
            )),
        }
    }

    /// Get a broadcast receiver for WebSocket connections
    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.broadcast_tx.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use grimoire::notifications::NotificationChannel;
    use serde_json::json;
    use tokio::sync::broadcast;

    #[tokio::test]
    async fn test_websocket_publisher_creation() {
        let (tx, _rx) = broadcast::channel(100);
        let publisher = WebSocketNotificationPublisher::new(tx);

        let stats = publisher.get_stats().await;
        assert_eq!(stats.active_connections, 0);
        assert_eq!(stats.total_messages_sent, 0);
    }

    #[tokio::test]
    async fn test_connection_management() {
        let (tx, _rx) = broadcast::channel(100);
        let publisher = WebSocketNotificationPublisher::new(tx);

        let connection_id = "test-connection-1";
        let user_id = Some(Uuid::new_v4());

        // Add connection
        publisher
            .add_connection(connection_id.to_string(), user_id)
            .await;
        assert_eq!(publisher.get_connection_count().await, 1);

        // Get connection info
        let info = publisher.get_connection_info(connection_id).await;
        assert!(info.is_some());
        assert_eq!(info.unwrap().user_id, user_id);

        // Remove connection
        publisher.remove_connection(connection_id).await;
        assert_eq!(publisher.get_connection_count().await, 0);
    }

    #[tokio::test]
    async fn test_channel_subscription() {
        let (tx, _rx) = broadcast::channel(100);
        let publisher = WebSocketNotificationPublisher::new(tx);

        let connection_id = "test-connection-1";
        publisher
            .add_connection(connection_id.to_string(), None)
            .await;

        // Subscribe to channel
        let result = publisher
            .subscribe_connection_to_channel(connection_id, "media_blobs".to_string())
            .await;
        assert!(result.is_ok());

        // Check subscription
        let info = publisher.get_connection_info(connection_id).await.unwrap();
        assert!(info
            .subscribed_channels
            .contains(&"media_blobs".to_string()));

        // Unsubscribe from channel
        let result = publisher
            .unsubscribe_connection_from_channel(connection_id, "media_blobs")
            .await;
        assert!(result.is_ok());

        let info = publisher.get_connection_info(connection_id).await.unwrap();
        assert!(!info
            .subscribed_channels
            .contains(&"media_blobs".to_string()));
    }

    #[tokio::test]
    async fn test_event_serialization() {
        let (tx, _rx) = broadcast::channel(100);
        let publisher = WebSocketNotificationPublisher::new(tx);

        let event = NotificationEvent::new(
            NotificationChannel::MediaBlobs,
            "media_blob.created".to_string(),
            json!({
                "blob_id": "123e4567-e89b-12d3-a456-426614174000",
                "filename": "test.jpg"
            }),
        );

        let serialized = publisher.serialize_event(&event);
        assert!(serialized.is_ok());

        let message_str = serialized.unwrap();
        let parsed: Value = serde_json::from_str(&message_str).unwrap();

        assert_eq!(parsed["type"], "notification");
        assert_eq!(parsed["channel"], "MediaBlobs");
        assert_eq!(parsed["event_type"], "media_blob.created");
    }

    #[test]
    fn test_connection_info() {
        let user_id = Some(Uuid::new_v4());
        let mut info = ConnectionInfo::new(user_id);

        assert_eq!(info.user_id, user_id);
        assert!(info.subscribed_channels.is_empty());

        // Test channel subscription
        info.subscribe_to_channel("test_channel".to_string());
        assert!(info
            .subscribed_channels
            .contains(&"test_channel".to_string()));

        // Test duplicate subscription (should not add twice)
        info.subscribe_to_channel("test_channel".to_string());
        assert_eq!(info.subscribed_channels.len(), 1);

        // Test unsubscription
        info.unsubscribe_from_channel("test_channel");
        assert!(!info
            .subscribed_channels
            .contains(&"test_channel".to_string()));
    }
}
