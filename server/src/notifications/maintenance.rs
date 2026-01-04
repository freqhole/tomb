//! Notification maintenance system
//!
//! This module provides maintenance operations for the notification system,
//! including cleanup of old data, connection monitoring, performance metrics,
//! and health checks.

use crate::notifications::NotificationInfrastructure;
use legacylib::notifications::EventStats;
use legacylib::DatabaseConnection;
use serde::{Deserialize, Serialize};

use std::sync::Arc;
use std::time::Duration;
use thiserror::Error;
use time::OffsetDateTime;
use tokio::sync::RwLock;
use tokio::time::interval;
use tracing::{debug, error, info, warn};

/// Errors that can occur during maintenance operations
#[derive(Debug, Error)]
pub enum MaintenanceError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("Maintenance task failed: {0}")]
    TaskFailed(String),

    #[error("Configuration error: {0}")]
    Configuration(String),

    #[error("Maintenance not running")]
    NotRunning,
}

/// Configuration for notification maintenance
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MaintenanceConfig {
    /// How often to run maintenance tasks (in seconds)
    pub interval_seconds: u64,
    /// Maximum age for notification logs (in hours)
    pub max_log_age_hours: u64,
    /// Maximum age for failed delivery records (in hours)
    pub max_failed_delivery_age_hours: u64,
    /// Maximum age for rate limiting data (in hours)
    pub max_rate_limit_age_hours: u64,
    /// Maximum idle time for connections before cleanup (in minutes)
    pub max_connection_idle_minutes: u64,
    /// Whether to perform automatic cleanup
    pub auto_cleanup_enabled: bool,
    /// Whether to collect performance metrics
    pub metrics_enabled: bool,
    /// Whether to send health check notifications
    pub health_check_enabled: bool,
}

impl Default for MaintenanceConfig {
    fn default() -> Self {
        Self {
            interval_seconds: 300,             // 5 minutes
            max_log_age_hours: 168,            // 7 days
            max_failed_delivery_age_hours: 24, // 1 day
            max_rate_limit_age_hours: 1,       // 1 hour
            max_connection_idle_minutes: 30,   // 30 minutes
            auto_cleanup_enabled: true,
            metrics_enabled: true,
            health_check_enabled: true,
        }
    }
}

/// Statistics from maintenance operations
#[derive(Debug, Clone, Serialize)]
pub struct MaintenanceStats {
    pub last_run_at: Option<OffsetDateTime>,
    pub total_runs: u64,
    pub total_errors: u64,
    pub cleanup_stats: CleanupStats,
    pub performance_stats: PerformanceStats,
    pub health_stats: HealthStats,
}

#[derive(Debug, Clone, Serialize)]
pub struct CleanupStats {
    pub logs_cleaned: u64,
    pub failed_deliveries_cleaned: u64,
    pub rate_limit_entries_cleaned: u64,
    pub connections_cleaned: u64,
    pub last_cleanup_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PerformanceStats {
    pub avg_notification_latency_ms: f64,
    pub notifications_per_minute: f64,
    pub connection_count: u64,
    pub memory_usage_estimate_mb: f64,
    pub last_measured_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HealthStats {
    pub postgres_listener_healthy: bool,
    pub websocket_publisher_healthy: bool,
    pub notification_service_healthy: bool,
    pub database_healthy: bool,
    pub last_health_check_at: Option<OffsetDateTime>,
}

impl Default for MaintenanceStats {
    fn default() -> Self {
        Self {
            last_run_at: None,
            total_runs: 0,
            total_errors: 0,
            cleanup_stats: CleanupStats {
                logs_cleaned: 0,
                failed_deliveries_cleaned: 0,
                rate_limit_entries_cleaned: 0,
                connections_cleaned: 0,
                last_cleanup_at: None,
            },
            performance_stats: PerformanceStats {
                avg_notification_latency_ms: 0.0,
                notifications_per_minute: 0.0,
                connection_count: 0,
                memory_usage_estimate_mb: 0.0,
                last_measured_at: None,
            },
            health_stats: HealthStats {
                postgres_listener_healthy: false,
                websocket_publisher_healthy: false,
                notification_service_healthy: false,
                database_healthy: false,
                last_health_check_at: None,
            },
        }
    }
}

/// Notification maintenance manager
pub struct NotificationMaintenance {
    config: MaintenanceConfig,
    db: DatabaseConnection,
    infrastructure: Arc<NotificationInfrastructure>,
    stats: Arc<RwLock<MaintenanceStats>>,
    is_running: Arc<RwLock<bool>>,
}

impl NotificationMaintenance {
    /// Create a new notification maintenance manager
    pub fn new(
        config: MaintenanceConfig,
        db: DatabaseConnection,
        infrastructure: Arc<NotificationInfrastructure>,
    ) -> Self {
        Self {
            config,
            db,
            infrastructure,
            stats: Arc::new(RwLock::new(MaintenanceStats::default())),
            is_running: Arc::new(RwLock::new(false)),
        }
    }

    /// Start the maintenance loop
    pub async fn start(&self) -> Result<(), MaintenanceError> {
        {
            let mut running = self.is_running.write().await;
            if *running {
                return Err(MaintenanceError::TaskFailed(
                    "Maintenance already running".to_string(),
                ));
            }
            *running = true;
        }

        info!(
            "Starting notification maintenance with interval: {}s",
            self.config.interval_seconds
        );

        let config = self.config.clone();
        let db = self.db.clone();
        let infrastructure = Arc::clone(&self.infrastructure);
        let stats = Arc::clone(&self.stats);
        let is_running = Arc::clone(&self.is_running);

        tokio::spawn(async move {
            let mut interval_timer = interval(Duration::from_secs(config.interval_seconds));

            loop {
                // Check if maintenance should stop
                {
                    let running = is_running.read().await;
                    if !*running {
                        break;
                    }
                }

                interval_timer.tick().await;

                let start_time = std::time::Instant::now();

                match Self::run_maintenance_cycle(&config, &db, &infrastructure, &stats).await {
                    Ok(()) => {
                        debug!("Maintenance cycle completed in {:?}", start_time.elapsed());
                    }
                    Err(e) => {
                        error!("Maintenance cycle failed: {}", e);
                        let mut stats_guard = stats.write().await;
                        stats_guard.total_errors += 1;
                    }
                }
            }

            info!("Notification maintenance stopped");
        });

        Ok(())
    }

    /// Stop the maintenance loop
    pub async fn stop(&self) {
        info!("Stopping notification maintenance...");
        let mut running = self.is_running.write().await;
        *running = false;
    }

    /// Check if maintenance is currently running
    pub async fn is_running(&self) -> bool {
        *self.is_running.read().await
    }

    /// Get current maintenance statistics
    pub async fn get_stats(&self) -> MaintenanceStats {
        self.stats.read().await.clone()
    }

    /// Run a single maintenance cycle
    async fn run_maintenance_cycle(
        config: &MaintenanceConfig,
        db: &DatabaseConnection,
        infrastructure: &NotificationInfrastructure,
        stats: &Arc<RwLock<MaintenanceStats>>,
    ) -> Result<(), MaintenanceError> {
        debug!("Starting maintenance cycle");

        let now = OffsetDateTime::now_utc();

        // Update run statistics
        {
            let mut stats_guard = stats.write().await;
            stats_guard.last_run_at = Some(now);
            stats_guard.total_runs += 1;
        }

        // Perform cleanup if enabled
        if config.auto_cleanup_enabled {
            Self::perform_cleanup(config, db, stats).await?;
        }

        // Collect performance metrics if enabled
        if config.metrics_enabled {
            Self::collect_performance_metrics(infrastructure, stats).await?;
        }

        // Perform health checks if enabled
        if config.health_check_enabled {
            Self::perform_health_checks(db, infrastructure, stats).await?;
        }

        debug!("Maintenance cycle completed successfully");
        Ok(())
    }

    /// Perform cleanup operations
    async fn perform_cleanup(
        config: &MaintenanceConfig,
        _db: &DatabaseConnection,
        stats: &Arc<RwLock<MaintenanceStats>>,
    ) -> Result<(), MaintenanceError> {
        debug!("Performing maintenance cleanup");

        let now = OffsetDateTime::now_utc();
        let cleanup_stats = CleanupStats {
            logs_cleaned: 0,
            failed_deliveries_cleaned: 0,
            rate_limit_entries_cleaned: 0,
            connections_cleaned: 0,
            last_cleanup_at: Some(now),
        };

        // Clean up old notification logs (simulated - would need actual log table)
        let log_cutoff = now - time::Duration::hours(config.max_log_age_hours as i64);
        debug!("Cleaning notification logs older than {}", log_cutoff);
        // In a real implementation:
        // cleanup_stats.logs_cleaned = Self::cleanup_notification_logs(db, log_cutoff).await?;

        // Clean up old failed delivery records (simulated)
        let failed_delivery_cutoff =
            now - time::Duration::hours(config.max_failed_delivery_age_hours as i64);
        debug!(
            "Cleaning failed deliveries older than {}",
            failed_delivery_cutoff
        );
        // In a real implementation:
        // cleanup_stats.failed_deliveries_cleaned = Self::cleanup_failed_deliveries(db, failed_delivery_cutoff).await?;

        // Clean up old rate limiting data (simulated)
        let rate_limit_cutoff = now - time::Duration::hours(config.max_rate_limit_age_hours as i64);
        debug!("Cleaning rate limit data older than {}", rate_limit_cutoff);
        // In a real implementation:
        // cleanup_stats.rate_limit_entries_cleaned = Self::cleanup_rate_limit_data(db, rate_limit_cutoff).await?;

        // Update cleanup statistics
        {
            let mut stats_guard = stats.write().await;
            stats_guard.cleanup_stats = cleanup_stats;
        }

        info!(
            "Cleanup completed: {} logs, {} failed deliveries, {} rate limit entries",
            0, 0, 0
        ); // Using 0s since this is simulated

        Ok(())
    }

    /// Collect performance metrics
    async fn collect_performance_metrics(
        infrastructure: &NotificationInfrastructure,
        stats: &Arc<RwLock<MaintenanceStats>>,
    ) -> Result<(), MaintenanceError> {
        debug!("Collecting performance metrics");

        let now = OffsetDateTime::now_utc();
        let infra_stats = infrastructure.get_stats().await;

        let performance_stats = PerformanceStats {
            avg_notification_latency_ms: infra_stats.service_stats.avg_processing_time_ms,
            notifications_per_minute: 0.0, // Would calculate from recent notification count
            connection_count: infra_stats.service_stats.total_subscriptions,
            memory_usage_estimate_mb: Self::estimate_memory_usage(&infra_stats.service_stats),
            last_measured_at: Some(now),
        };

        {
            let mut stats_guard = stats.write().await;
            stats_guard.performance_stats = performance_stats;
        }

        debug!("Performance metrics collected");
        Ok(())
    }

    /// Perform health checks
    async fn perform_health_checks(
        db: &DatabaseConnection,
        infrastructure: &NotificationInfrastructure,
        stats: &Arc<RwLock<MaintenanceStats>>,
    ) -> Result<(), MaintenanceError> {
        debug!("Performing health checks");

        let now = OffsetDateTime::now_utc();

        // Check database health
        let database_healthy = Self::check_database_health(db).await;

        // Check infrastructure health
        let infra_stats = infrastructure.get_stats().await;
        let postgres_listener_healthy = infra_stats.postgres_stats.is_some()
            && matches!(
                infra_stats
                    .postgres_stats
                    .as_ref()
                    .unwrap()
                    .connection_status,
                crate::notifications::postgres_listener::ConnectionStatus::Connected
            );

        let notification_service_healthy = infra_stats.is_running;
        let websocket_publisher_healthy = infra_stats.is_running; // Simplified check

        let health_stats = HealthStats {
            postgres_listener_healthy,
            websocket_publisher_healthy,
            notification_service_healthy,
            database_healthy,
            last_health_check_at: Some(now),
        };

        // Log health status
        if !database_healthy {
            warn!("Database health check failed");
        }
        if !postgres_listener_healthy {
            warn!("PostgreSQL listener health check failed");
        }
        if !notification_service_healthy {
            warn!("Notification service health check failed");
        }
        if !websocket_publisher_healthy {
            warn!("WebSocket publisher health check failed");
        }

        {
            let mut stats_guard = stats.write().await;
            stats_guard.health_stats = health_stats;
        }

        debug!("Health checks completed");
        Ok(())
    }

    /// Check database connectivity and health
    async fn check_database_health(db: &DatabaseConnection) -> bool {
        match sqlx::query("SELECT 1").execute(db.pool()).await {
            Ok(_) => true,
            Err(e) => {
                warn!("Database health check failed: {}", e);
                false
            }
        }
    }

    /// Estimate memory usage based on service statistics
    fn estimate_memory_usage(service_stats: &EventStats) -> f64 {
        // Simple estimation based on active subscriptions and event counts
        // In a real implementation, this would be more sophisticated
        let base_memory = 10.0; // Base memory in MB
        let subscription_memory = service_stats.total_subscriptions as f64 * 0.1; // 0.1 MB per subscription
        let event_memory = (service_stats.total_published as f64) * 0.001; // 0.001 MB per event

        base_memory + subscription_memory + event_memory
    }

    /// Manually trigger a maintenance cycle
    pub async fn run_manual_maintenance(&self) -> Result<(), MaintenanceError> {
        info!("Running manual maintenance cycle");

        Self::run_maintenance_cycle(&self.config, &self.db, &self.infrastructure, &self.stats)
            .await?;

        info!("Manual maintenance cycle completed");
        Ok(())
    }

    /// Get maintenance configuration
    pub fn get_config(&self) -> &MaintenanceConfig {
        &self.config
    }

    /// Update maintenance configuration
    pub async fn update_config(&mut self, new_config: MaintenanceConfig) {
        info!("Updating maintenance configuration");
        self.config = new_config;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_maintenance_config_default() {
        let config = MaintenanceConfig::default();
        assert_eq!(config.interval_seconds, 300);
        assert_eq!(config.max_log_age_hours, 168);
        assert!(config.auto_cleanup_enabled);
        assert!(config.metrics_enabled);
        assert!(config.health_check_enabled);
    }

    #[test]
    fn test_maintenance_stats_default() {
        let stats = MaintenanceStats::default();
        assert_eq!(stats.total_runs, 0);
        assert_eq!(stats.total_errors, 0);
        assert!(stats.last_run_at.is_none());
        assert_eq!(stats.cleanup_stats.logs_cleaned, 0);
        assert!(!stats.health_stats.database_healthy);
    }

    #[test]
    fn test_memory_usage_estimation() {
        let service_stats = EventStats {
            total_published: 1000,
            total_delivered: 950,
            total_failed: 50,
            total_subscriptions: 10,
            events_by_channel: std::collections::HashMap::new(),
            events_by_priority: std::collections::HashMap::new(),
            avg_processing_time_ms: 5.0,
            last_processed_at: Some(OffsetDateTime::now_utc()),
        };

        let memory_usage = NotificationMaintenance::estimate_memory_usage(&service_stats);
        assert!(memory_usage > 10.0); // Should be more than base memory
    }

    #[tokio::test]
    async fn test_maintenance_stats_serialization() {
        let stats = MaintenanceStats::default();
        let json = serde_json::to_string(&stats).unwrap();
        assert!(json.contains("total_runs"));
        assert!(json.contains("cleanup_stats"));
        assert!(json.contains("health_stats"));
    }
}
