//! Server notification infrastructure
//!
//! This module provides the server-side implementation for real-time notifications,
//! integrating the grimoire notification domain layer with PostgreSQL NOTIFY/LISTEN,
//! WebSocket connections, and job queue infrastructure.

pub mod maintenance;
pub mod postgres_listener;
pub mod routes;
pub mod websocket_publisher;

pub use maintenance::{MaintenanceConfig, MaintenanceError, NotificationMaintenance};
pub use postgres_listener::{PostgresListenerError, PostgresNotificationListener};
pub use routes::build_notification_routes;
pub use websocket_publisher::{WebSocketNotificationPublisher, WebSocketPublisherError};

use legacylib::notifications::{
    NotificationChannel, NotificationConfig, NotificationService, Publisher,
};
use legacylib::DatabaseConnection;
use std::sync::Arc;
use tokio::sync::broadcast;
use tracing::{error, info};

/// Notification infrastructure manager
///
/// Coordinates PostgreSQL NOTIFY/LISTEN, WebSocket publishing, and job queue integration
pub struct NotificationInfrastructure {
    service: Arc<NotificationService>,
    postgres_listener: Option<PostgresNotificationListener>,
    shutdown_tx: Option<broadcast::Sender<()>>,
}

impl NotificationInfrastructure {
    /// Create new notification infrastructure
    pub fn new(config: NotificationConfig) -> Self {
        let service = Arc::new(NotificationService::new(config));

        Self {
            service,
            postgres_listener: None,
            shutdown_tx: None,
        }
    }

    /// Initialize and start all notification infrastructure components
    pub async fn start(
        &mut self,
        db: DatabaseConnection,
        websocket_tx: broadcast::Sender<String>, // For broadcasting to WebSocket connections
    ) -> Result<(), NotificationInfrastructureError> {
        info!("Starting notification infrastructure...");

        let (shutdown_tx, shutdown_rx) = broadcast::channel(1);
        self.shutdown_tx = Some(shutdown_tx);

        // Create a new service with the proper publishers
        let config = NotificationConfig::default();
        let mut new_service = NotificationService::new(config);

        // Add mock publishers for most channels
        new_service.add_publisher(NotificationChannel::MediaBlobs, Publisher::mock());
        new_service.add_publisher(NotificationChannel::ThumbnailJobs, Publisher::mock());
        new_service.add_publisher(NotificationChannel::System, Publisher::mock());
        info!("Added mock publishers for MediaBlobs, ThumbnailJobs, and System channels");

        // Add real PostgreSQL publisher for Music notifications
        let postgres_config = legacylib::notifications::publisher::PublishConfig::default();
        new_service.add_publisher(
            NotificationChannel::Music,
            Publisher::postgres(postgres_config, db.clone()),
        );
        info!("Added PostgreSQL publisher for Music channel");

        // Replace the service
        self.service = Arc::new(new_service);

        // Start PostgreSQL listener with direct WebSocket broadcasting
        let config = legacylib::notifications::config::NotificationConfig::production();
        let mut postgres_listener = PostgresNotificationListener::new_with_websocket_and_config(
            db,
            self.service.clone(),
            websocket_tx,
            config,
        );

        postgres_listener.start(shutdown_rx).await?;
        self.postgres_listener = Some(postgres_listener);

        info!("Notification infrastructure started successfully");
        Ok(())
    }

    /// Shutdown all notification infrastructure
    pub async fn shutdown(&mut self) -> Result<(), NotificationInfrastructureError> {
        info!("Shutting down notification infrastructure...");

        if let Some(shutdown_tx) = &self.shutdown_tx {
            let _ = shutdown_tx.send(());
        }

        if let Some(postgres_listener) = &mut self.postgres_listener {
            postgres_listener.shutdown().await?;
        }

        info!("Notification infrastructure shutdown complete");
        Ok(())
    }

    /// Get reference to notification service for external use
    pub fn service(&self) -> Arc<NotificationService> {
        Arc::clone(&self.service)
    }

    /// Get infrastructure stats
    pub async fn get_stats(&self) -> InfrastructureStats {
        let service_stats = self.service.get_stats().await;

        let postgres_stats = if let Some(listener) = &self.postgres_listener {
            Some(listener.get_stats().await)
        } else {
            None
        };

        InfrastructureStats {
            service_stats,
            postgres_stats,
            is_running: self.postgres_listener.is_some(),
        }
    }
}

/// Infrastructure statistics
#[derive(Debug, Clone)]
pub struct InfrastructureStats {
    pub service_stats: legacylib::notifications::EventStats,
    pub postgres_stats: Option<postgres_listener::PostgresListenerStats>,
    pub is_running: bool,
}

/// Errors that can occur in notification infrastructure
#[derive(Debug, thiserror::Error)]
pub enum NotificationInfrastructureError {
    #[error("PostgreSQL listener error: {0}")]
    PostgresListener(#[from] PostgresListenerError),

    #[error("WebSocket publisher error: {0}")]
    WebSocketPublisher(#[from] WebSocketPublisherError),

    #[error("Service error: {0}")]
    Service(#[from] legacylib::notifications::NotificationServiceError),

    #[error("Infrastructure not initialized")]
    NotInitialized,

    #[error("Already running")]
    AlreadyRunning,
}

#[cfg(test)]
mod tests {
    use super::*;
    use legacylib::notifications::NotificationConfig;

    #[test]
    fn test_notification_infrastructure_creation() {
        let config = NotificationConfig::default();
        let _infrastructure = NotificationInfrastructure::new(config);
    }

    #[tokio::test]
    async fn test_infrastructure_stats() {
        let config = NotificationConfig::default();
        let infrastructure = NotificationInfrastructure::new(config);

        let stats = infrastructure.get_stats().await;
        assert!(!stats.is_running);
        assert!(stats.postgres_stats.is_none());
    }
}
