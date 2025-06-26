//! Maintenance module for background cleanup and optimization tasks
//!
//! This module provides maintenance jobs for cleaning up old thumbnail jobs,
//! orphaned files, and optimizing storage usage.

pub mod thumbnail_maintenance;

// Re-export main types
pub use thumbnail_maintenance::{
    ThumbnailMaintenanceJob, ThumbnailMaintenanceResult, ThumbnailMaintenanceTask,
};

/// Configuration for maintenance operations
#[derive(Debug, Clone)]
pub struct MaintenanceConfig {
    /// How often to run maintenance jobs (in seconds)
    pub interval_seconds: u64,
    /// Maximum age for completed jobs before cleanup (in days)
    pub max_completed_job_age_days: u32,
    /// Whether to clean up orphaned thumbnail files
    pub cleanup_orphaned_files: bool,
    /// Whether to run maintenance jobs automatically
    pub auto_run: bool,
    /// Maximum number of jobs to process in one maintenance cycle
    pub max_jobs_per_cycle: u32,
}

impl Default for MaintenanceConfig {
    fn default() -> Self {
        Self {
            interval_seconds: 3600, // Run every hour
            max_completed_job_age_days: 30,
            cleanup_orphaned_files: true,
            auto_run: false, // Disabled by default for safety
            max_jobs_per_cycle: 1000,
        }
    }
}

/// Maintenance scheduler that runs cleanup tasks periodically
pub struct MaintenanceScheduler {
    config: MaintenanceConfig,
    running: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl MaintenanceScheduler {
    /// Create a new maintenance scheduler
    pub fn new(config: MaintenanceConfig) -> Self {
        Self {
            config,
            running: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    /// Start the maintenance scheduler
    pub async fn start(
        &self,
        db: grimoire::DatabaseConnection,
        thumbnail_config: grimoire::thumbnails::ThumbnailConfig,
    ) -> Result<tokio::task::JoinHandle<()>, Box<dyn std::error::Error>> {
        if !self.config.auto_run {
            return Err("Maintenance scheduler is disabled in configuration".into());
        }

        if self.running.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("Maintenance scheduler is already running".into());
        }

        self.running
            .store(true, std::sync::atomic::Ordering::SeqCst);

        let config = self.config.clone();
        let running = self.running.clone();

        let handle = tokio::task::spawn(async move {
            tracing::info!("🧹 Starting thumbnail maintenance scheduler");
            tracing::info!("   Interval: {} seconds", config.interval_seconds);
            tracing::info!("   Max job age: {} days", config.max_completed_job_age_days);

            let mut interval =
                tokio::time::interval(std::time::Duration::from_secs(config.interval_seconds));

            while running.load(std::sync::atomic::Ordering::SeqCst) {
                interval.tick().await;

                tracing::debug!("🔄 Running thumbnail maintenance cycle");

                let maintenance_job =
                    ThumbnailMaintenanceJob::new(db.clone(), thumbnail_config.clone());

                // Run cleanup tasks
                let tasks = vec![ThumbnailMaintenanceTask::CleanupOldJobs {
                    max_age_days: config.max_completed_job_age_days,
                    max_jobs: config.max_jobs_per_cycle,
                }];

                if config.cleanup_orphaned_files {
                    // Note: Orphaned file cleanup would be implemented here
                    // For now, just log that it would run
                    tracing::debug!("🗑️  Orphaned file cleanup is enabled but not yet implemented");
                }

                for task in tasks {
                    match maintenance_job.run_task(&task).await {
                        Ok(result) => {
                            tracing::info!("✅ Maintenance task completed: {:?}", result);
                        }
                        Err(e) => {
                            tracing::error!("❌ Maintenance task failed: {}", e);
                        }
                    }
                }
            }

            tracing::info!("🛑 Thumbnail maintenance scheduler stopped");
        });

        Ok(handle)
    }

    /// Stop the maintenance scheduler
    pub fn stop(&self) {
        self.running
            .store(false, std::sync::atomic::Ordering::SeqCst);
        tracing::info!("🛑 Stopping thumbnail maintenance scheduler");
    }

    /// Check if the scheduler is running
    pub fn is_running(&self) -> bool {
        self.running.load(std::sync::atomic::Ordering::SeqCst)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_maintenance_config_default() {
        let config = MaintenanceConfig::default();
        assert_eq!(config.interval_seconds, 3600);
        assert_eq!(config.max_completed_job_age_days, 30);
        assert!(config.cleanup_orphaned_files);
        assert!(!config.auto_run);
        assert_eq!(config.max_jobs_per_cycle, 1000);
    }

    #[test]
    fn test_maintenance_scheduler_creation() {
        let config = MaintenanceConfig::default();
        let scheduler = MaintenanceScheduler::new(config);
        assert!(!scheduler.is_running());
    }
}
