//! PostgreSQL NOTIFY/LISTEN integration for real-time database events
//!
//! This module provides a PostgreSQL listener that subscribes to database notifications
//! and routes them through the NotificationService to WebSocket clients.

use grimoire::notifications::{
    config::NotificationConfig, NotificationChannel, NotificationEvent, NotificationService,
    NotificationServiceError,
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
use tracing::{debug, error, info, instrument, warn};

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

    #[error("Connection retry limit exceeded after {attempts} attempts")]
    RetryLimitExceeded { attempts: usize },

    #[error("Invalid payload format: {details}")]
    InvalidPayload { details: String },

    #[error("Channel subscription failed: {channel}")]
    SubscriptionFailed { channel: String },
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
    pub total_reconnections: u64,
    pub last_error: Option<String>,
    pub avg_processing_time_ms: f64,
    pub peak_processing_time_ms: u64,
    pub notification_rate_per_minute: f64,
    pub last_rate_calculation: Option<OffsetDateTime>,
    pub circuit_breaker_failures: u32,
    pub circuit_breaker_state: CircuitBreakerState,
    pub last_failure_time: Option<OffsetDateTime>,
}

#[derive(Debug, Clone)]
pub enum ConnectionStatus {
    Connected,
    Disconnected,
    Reconnecting,
    Error(String),
    HealthCheck,
}

#[derive(Debug, Clone)]
pub enum CircuitBreakerState {
    Closed,   // Normal operation
    Open,     // Failing fast
    HalfOpen, // Testing if service is back
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
            total_reconnections: 0,
            last_error: None,
            avg_processing_time_ms: 0.0,
            peak_processing_time_ms: 0,
            notification_rate_per_minute: 0.0,
            last_rate_calculation: None,
            circuit_breaker_failures: 0,
            circuit_breaker_state: CircuitBreakerState::Closed,
            last_failure_time: None,
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
    config: NotificationConfig,
}

impl PostgresNotificationListener {
    /// Create a new PostgreSQL notification listener
    pub fn new(db: DatabaseConnection, notification_service: Arc<NotificationService>) -> Self {
        Self::new_with_config(db, notification_service, NotificationConfig::default())
    }

    /// Create a new PostgreSQL notification listener with custom configuration
    pub fn new_with_config(
        db: DatabaseConnection,
        notification_service: Arc<NotificationService>,
        config: NotificationConfig,
    ) -> Self {
        Self {
            db,
            notification_service,
            websocket_tx: None,
            stats: Arc::new(RwLock::new(PostgresListenerStats::default())),
            start_time: None,
            listener: None,
            config,
        }
    }

    /// Create a new PostgreSQL notification listener with WebSocket broadcasting
    pub fn new_with_websocket(
        db: DatabaseConnection,
        notification_service: Arc<NotificationService>,
        websocket_tx: broadcast::Sender<String>,
    ) -> Self {
        Self::new_with_websocket_and_config(
            db,
            notification_service,
            websocket_tx,
            NotificationConfig::default(),
        )
    }

    /// Create a new PostgreSQL notification listener with WebSocket broadcasting and custom configuration
    pub fn new_with_websocket_and_config(
        db: DatabaseConnection,
        notification_service: Arc<NotificationService>,
        websocket_tx: broadcast::Sender<String>,
        config: NotificationConfig,
    ) -> Self {
        Self {
            db,
            notification_service,
            websocket_tx: Some(websocket_tx),
            stats: Arc::new(RwLock::new(PostgresListenerStats::default())),
            start_time: None,
            listener: None,
            config,
        }
    }

    /// Start listening for PostgreSQL notifications
    #[instrument(skip(self, shutdown_rx))]
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
                Ok(_) => info!("Successfully subscribed to PostgreSQL channel: {}", channel),
                Err(e) => {
                    error!(
                        "Failed to subscribe to PostgreSQL channel {}: {}",
                        channel, e
                    );
                    return Err(PostgresListenerError::SubscriptionFailed {
                        channel: channel.to_string(),
                    });
                }
            }
        }

        // Verify notification system works by sending a test notification
        info!("Testing PostgreSQL notification system...");
        let test_result = sqlx::query(
            "SELECT pg_notify('media_blobs', '{\"event_type\":\"system.startup\",\"message\":\"PostgreSQL listener initialized\",\"timestamp\":\"' || NOW() || '\"}')"
        )
        .execute(self.db.pool())
        .await;

        match test_result {
            Ok(_) => info!("Test notification sent successfully"),
            Err(e) => warn!("Could not send test notification: {}", e),
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
        let config = self.config.clone();

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
                        Ok(_) => info!("Worker thread subscribed to PostgreSQL channel: {}", channel),
                        Err(e) => error!("Worker thread failed to subscribe to PostgreSQL channel {}: {}", channel, e),
                    }
                }

                // Start the listening loop
                Self::listen_loop(
                    &mut listener_clone,
                    notification_service,
                    stats,
                    start_time,
                    shutdown_rx,
                    websocket_tx,
                    &config,
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
        config: &NotificationConfig,
    ) -> Result<(), PostgresListenerError> {
        let stats_interval = Duration::from_secs(30);
        let health_interval =
            Duration::from_secs(config.postgres.reconnect_interval_seconds as u64 * 6); // Health check every 6 reconnect intervals
        let max_consecutive_errors = config.postgres.max_reconnect_attempts as usize;

        let mut stats_update_interval = interval(stats_interval);
        let mut health_check_interval = interval(health_interval);
        let mut metrics_interval = interval(Duration::from_secs(60)); // Metrics every minute
        let mut consecutive_errors = 0;

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

                // Calculate metrics periodically
                _ = metrics_interval.tick() => {
                    Self::calculate_metrics(&stats, start_time).await;
                }

                // Periodic health check
                _ = health_check_interval.tick() => {
                    debug!("Performing PostgreSQL listener health check");
                    let mut stats_guard = stats.write().await;
                    if matches!(stats_guard.connection_status, ConnectionStatus::Connected) {
                        stats_guard.connection_status = ConnectionStatus::HealthCheck;
                        // Health check completed - set back to connected
                        stats_guard.connection_status = ConnectionStatus::Connected;
                    }
                }

                // Listen for PostgreSQL notifications
                notification_result = listener.recv() => {
                    match notification_result {
                        Ok(notification) => {
                            consecutive_errors = 0; // Reset error counter on success
                            let channel = notification.channel();

                            debug!("PostgreSQL notification received on channel '{}'", channel);

                            let process_start = std::time::Instant::now();

                            // Check circuit breaker before processing
                            let should_process = {
                                let stats_guard = stats.read().await;
                                Self::should_process_notification(&stats_guard.circuit_breaker_state)
                            };

                            if should_process {
                                match Self::handle_notification(
                                    notification,
                                    &notification_service,
                                    &stats,
                                    &websocket_tx,
                                ).await {
                                    Ok(()) => {
                                        let processing_time = process_start.elapsed().as_millis() as u64;

                                        // Update processing time statistics and reset circuit breaker on success
                                        let mut stats_guard = stats.write().await;
                                        if processing_time > stats_guard.peak_processing_time_ms {
                                            stats_guard.peak_processing_time_ms = processing_time;
                                        }

                                        // Update average processing time (simple moving average)
                                        let count = stats_guard.total_notifications_received as f64;
                                        stats_guard.avg_processing_time_ms =
                                            (stats_guard.avg_processing_time_ms * count + processing_time as f64) / (count + 1.0);

                                        // Reset circuit breaker on success
                                        stats_guard.circuit_breaker_failures = 0;
                                        stats_guard.circuit_breaker_state = CircuitBreakerState::Closed;
                                    }
                                    Err(e) => {
                                        error!("Error handling notification: {}", e);
                                        Self::handle_processing_failure(&stats, e.to_string()).await;
                                    }
                                }
                            } else {
                                debug!("Notification dropped due to circuit breaker open state");
                            }
                        }
                        Err(e) => {
                            consecutive_errors += 1;
                            error!("PostgreSQL listener connection error (#{} consecutive): {}", consecutive_errors, e);

                            let mut stats_guard = stats.write().await;
                            stats_guard.connection_status = ConnectionStatus::Error(e.to_string());
                            stats_guard.last_error = Some(e.to_string());

                            if max_consecutive_errors > 0 && consecutive_errors >= max_consecutive_errors {
                                error!("Too many consecutive errors ({}), stopping listener", consecutive_errors);
                                return Err(PostgresListenerError::RetryLimitExceeded {
                                    attempts: consecutive_errors
                                });
                            }

                            // Progressive backoff for reconnection
                            let base_interval = config.postgres.reconnect_interval_seconds as u64;
                            let backoff_duration = Duration::from_secs(
                                std::cmp::min(base_interval * consecutive_errors as u64, base_interval * 12)
                            );
                            warn!("Attempting reconnection in {:?}...", backoff_duration);
                            sleep(backoff_duration).await;

                            stats_guard.connection_status = ConnectionStatus::Reconnecting;
                            stats_guard.total_reconnections += 1;
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

        debug!(
            "Processing notification - Channel: '{}', Payload length: {} bytes",
            channel_name,
            payload.len()
        );

        // Validate payload size (prevent memory issues)
        let max_payload_size = 1024 * 1024; // 1MB default payload size limit

        if payload.len() > max_payload_size {
            return Err(PostgresListenerError::InvalidPayload {
                details: format!(
                    "Payload too large: {} bytes (max: {})",
                    payload.len(),
                    max_payload_size
                ),
            });
        }

        // Parse the JSON payload with better error handling
        let payload_json: Value =
            serde_json::from_str(payload).map_err(|e| PostgresListenerError::InvalidPayload {
                details: format!("JSON parse error: {}", e),
            })?;

        // Map database channel to notification channel
        let notification_channel = match channel_name {
            "media_blobs" => {
                debug!("Media blob notification received");
                NotificationChannel::MediaBlobs
            }
            "thumbnail_jobs" => {
                debug!("Thumbnail job notification received");
                NotificationChannel::ThumbnailJobs
            }
            "music_notifications" => {
                debug!("Music notification received: {}", payload);
                debug!("Routing music notification to MediaBlobs channel for client consumption");
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
                                "Successfully published notification - Channel: '{}', Event: '{}' to {} WebSocket clients",
                                channel_name, event_type_str, receiver_count
                            );
                    }
                    Err(_) => {
                        debug!(
                            "No WebSocket receivers for notification - Channel: '{}', Event: '{}'",
                            channel_name, event_type_str
                        );
                    }
                },
                Err(e) => {
                    error!(
                        "Failed to serialize notification for WebSocket - Channel: '{}', Event: '{}', Error: {}",
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
                    "Failed to publish notification - Channel: '{}', Event: '{}': {}",
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

    /// Calculate and update metrics
    async fn calculate_metrics(
        stats: &Arc<RwLock<PostgresListenerStats>>,
        _start_time: OffsetDateTime,
    ) {
        let mut stats_guard = stats.write().await;
        let now = OffsetDateTime::now_utc();

        // Calculate notification rate per minute
        if let Some(last_calc) = stats_guard.last_rate_calculation {
            let elapsed_minutes = (now - last_calc).whole_seconds() as f64 / 60.0;
            if elapsed_minutes > 0.0 {
                let notifications_since_last = stats_guard.total_notifications_received as f64;
                stats_guard.notification_rate_per_minute =
                    notifications_since_last / elapsed_minutes;
            }
        }

        stats_guard.last_rate_calculation = Some(now);

        // Log metrics for monitoring systems
        if stats_guard.notification_rate_per_minute > 0.0 {
            info!(
                "PostgreSQL listener metrics - Rate: {:.2} notifications/min, Avg processing: {:.2}ms, Peak processing: {}ms, Uptime: {}s, Circuit breaker: {:?}, Failures: {}",
                stats_guard.notification_rate_per_minute,
                stats_guard.avg_processing_time_ms,
                stats_guard.peak_processing_time_ms,
                stats_guard.uptime_seconds,
                stats_guard.circuit_breaker_state,
                stats_guard.circuit_breaker_failures
            );
        }
    }

    /// Check if notification should be processed based on circuit breaker state
    fn should_process_notification(circuit_state: &CircuitBreakerState) -> bool {
        match circuit_state {
            CircuitBreakerState::Closed => true,
            CircuitBreakerState::Open => false,
            CircuitBreakerState::HalfOpen => true, // Allow test requests in half-open state
        }
    }

    /// Handle processing failure and update circuit breaker
    async fn handle_processing_failure(
        stats: &Arc<RwLock<PostgresListenerStats>>,
        error_message: String,
    ) {
        let mut stats_guard = stats.write().await;
        stats_guard.total_processing_errors += 1;
        stats_guard.last_error = Some(error_message);
        stats_guard.circuit_breaker_failures += 1;
        stats_guard.last_failure_time = Some(OffsetDateTime::now_utc());

        // Circuit breaker logic
        const FAILURE_THRESHOLD: u32 = 5;
        const RECOVERY_TIMEOUT_SECONDS: i64 = 30;

        match stats_guard.circuit_breaker_state {
            CircuitBreakerState::Closed => {
                if stats_guard.circuit_breaker_failures >= FAILURE_THRESHOLD {
                    warn!(
                        "Circuit breaker opening due to {} consecutive failures",
                        stats_guard.circuit_breaker_failures
                    );
                    stats_guard.circuit_breaker_state = CircuitBreakerState::Open;
                }
            }
            CircuitBreakerState::Open => {
                // Check if enough time has passed to try half-open
                if let Some(last_failure) = stats_guard.last_failure_time {
                    let elapsed = (OffsetDateTime::now_utc() - last_failure).whole_seconds();
                    if elapsed > RECOVERY_TIMEOUT_SECONDS {
                        info!("Circuit breaker moving to half-open state for testing");
                        stats_guard.circuit_breaker_state = CircuitBreakerState::HalfOpen;
                        stats_guard.circuit_breaker_failures = 0; // Reset for testing
                    }
                }
            }
            CircuitBreakerState::HalfOpen => {
                warn!("Circuit breaker reopening due to failure during half-open test");
                stats_guard.circuit_breaker_state = CircuitBreakerState::Open;
            }
        }
    }

    /// Shutdown the listener
    #[instrument(skip(self))]
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
    #[instrument(skip(self))]
    pub async fn is_running(&self) -> bool {
        match self.stats.read().await.connection_status {
            ConnectionStatus::Connected
            | ConnectionStatus::Reconnecting
            | ConnectionStatus::HealthCheck => true,
            ConnectionStatus::Disconnected | ConnectionStatus::Error(_) => false,
        }
    }

    /// Manually test a notification (useful for development)
    #[instrument(skip(self, payload))]
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
