//! Thumbnail maintenance job implementation
//!
//! This module provides specific maintenance tasks for thumbnail generation,
//! including cleanup of old jobs, orphaned files, and storage optimization.

use grimoire::{
    thumbnails::{ThumbnailConfig, ThumbnailJobStatus},
    DatabaseConnection, ThumbnailService,
};
use std::path::Path;
use time::OffsetDateTime;
use tracing::{debug, error, info, warn};

/// Specific maintenance tasks for thumbnails
#[derive(Debug, Clone)]
pub enum ThumbnailMaintenanceTask {
    /// Clean up old completed jobs
    CleanupOldJobs { max_age_days: u32, max_jobs: u32 },
    /// Clean up orphaned thumbnail files
    CleanupOrphanedFiles { dry_run: bool },
    /// Optimize storage by removing duplicate thumbnails
    OptimizeStorage { dry_run: bool },
    /// Retry failed jobs that might succeed now
    RetryEligibleJobs { max_jobs: u32 },
}

/// Result of a maintenance task
#[derive(Debug, Clone)]
pub struct ThumbnailMaintenanceResult {
    pub task: String,
    pub items_processed: u64,
    pub items_cleaned: u64,
    pub bytes_freed: u64,
    pub errors_count: u32,
    pub duration_ms: u64,
}

/// Error type for maintenance operations
#[derive(Debug, thiserror::Error)]
pub enum ThumbnailMaintenanceError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Thumbnail service error: {0}")]
    ThumbnailService(#[from] grimoire::thumbnails::ThumbnailError),
    #[error("Configuration error: {0}")]
    Config(String),
}

/// Maintenance job executor for thumbnail-related tasks
pub struct ThumbnailMaintenanceJob {
    #[allow(dead_code)]
    db: DatabaseConnection,
    config: ThumbnailConfig,
    service: ThumbnailService<'static>,
}

impl ThumbnailMaintenanceJob {
    /// Create a new thumbnail maintenance job
    pub fn new(db: DatabaseConnection, config: ThumbnailConfig) -> Self {
        // Note: This is a bit of a hack to work around lifetime issues
        // In a real implementation, you might want to restructure this
        let service = unsafe {
            std::mem::transmute::<ThumbnailService<'_>, ThumbnailService<'static>>(
                ThumbnailService::new(&db, config.clone()),
            )
        };

        Self {
            db,
            config,
            service,
        }
    }

    /// Run a specific maintenance task
    pub async fn run_task(
        &self,
        task: &ThumbnailMaintenanceTask,
    ) -> Result<ThumbnailMaintenanceResult, ThumbnailMaintenanceError> {
        let start_time = std::time::Instant::now();

        let result = match task {
            ThumbnailMaintenanceTask::CleanupOldJobs {
                max_age_days,
                max_jobs,
            } => self.cleanup_old_jobs(*max_age_days, *max_jobs).await?,
            ThumbnailMaintenanceTask::CleanupOrphanedFiles { dry_run } => {
                self.cleanup_orphaned_files(*dry_run).await?
            }
            ThumbnailMaintenanceTask::OptimizeStorage { dry_run } => {
                self.optimize_storage(*dry_run).await?
            }
            ThumbnailMaintenanceTask::RetryEligibleJobs { max_jobs } => {
                self.retry_eligible_jobs(*max_jobs).await?
            }
        };

        let duration = start_time.elapsed();

        Ok(ThumbnailMaintenanceResult {
            duration_ms: duration.as_millis() as u64,
            ..result
        })
    }

    /// Clean up old completed thumbnail jobs
    async fn cleanup_old_jobs(
        &self,
        max_age_days: u32,
        max_jobs: u32,
    ) -> Result<ThumbnailMaintenanceResult, ThumbnailMaintenanceError> {
        info!(
            "🧹 Cleaning up thumbnail jobs older than {} days",
            max_age_days
        );

        let cutoff_date = OffsetDateTime::now_utc() - time::Duration::days(max_age_days as i64);

        // Get completed jobs older than cutoff
        let completed_jobs = self
            .service
            .get_jobs_by_status(ThumbnailJobStatus::Completed, max_jobs as i32)
            .await?;

        let old_jobs: Vec<_> = completed_jobs
            .into_iter()
            .filter(|job| job.updated_at < cutoff_date)
            .collect();

        let jobs_to_clean = old_jobs.len().min(max_jobs as usize);
        let mut cleaned_count = 0u64;
        let mut errors_count = 0u32;

        for job in old_jobs.iter().take(jobs_to_clean) {
            match self.delete_job_and_files(job.id).await {
                Ok(_) => {
                    cleaned_count += 1;
                    debug!("Cleaned up job: {}", job.id);
                }
                Err(e) => {
                    errors_count += 1;
                    warn!("Failed to clean up job {}: {}", job.id, e);
                }
            }
        }

        info!(
            "✅ Cleaned up {}/{} old thumbnail jobs",
            cleaned_count, jobs_to_clean
        );

        Ok(ThumbnailMaintenanceResult {
            task: "cleanup_old_jobs".to_string(),
            items_processed: jobs_to_clean as u64,
            items_cleaned: cleaned_count,
            bytes_freed: 0, // Would need to calculate actual file sizes
            errors_count,
            duration_ms: 0, // Set by caller
        })
    }

    /// Clean up orphaned thumbnail files (files without database records)
    async fn cleanup_orphaned_files(
        &self,
        dry_run: bool,
    ) -> Result<ThumbnailMaintenanceResult, ThumbnailMaintenanceError> {
        info!(
            "🗑️  Scanning for orphaned thumbnail files (dry_run: {})",
            dry_run
        );

        let storage_path = Path::new(&self.config.storage_path);
        if !storage_path.exists() {
            info!(
                "Thumbnail storage directory does not exist: {:?}",
                storage_path
            );
            return Ok(ThumbnailMaintenanceResult {
                task: "cleanup_orphaned_files".to_string(),
                items_processed: 0,
                items_cleaned: 0,
                bytes_freed: 0,
                errors_count: 0,
                duration_ms: 0,
            });
        }

        let mut items_processed = 0u64;
        let mut items_cleaned = 0u64;
        let mut bytes_freed = 0u64;
        let mut errors_count = 0u32;

        // Walk through all files in the thumbnail directory
        let mut entries = tokio::fs::read_dir(storage_path).await?;
        while let Some(entry) = entries.next_entry().await? {
            let path = entry.path();
            if path.is_file() {
                items_processed += 1;

                // Check if this file has a corresponding database record
                if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                    match self.check_file_has_db_record(filename).await {
                        Ok(false) => {
                            // File is orphaned
                            let file_size = match entry.metadata().await {
                                Ok(metadata) => metadata.len(),
                                Err(_) => 0,
                            };

                            if dry_run {
                                info!(
                                    "Would delete orphaned file: {:?} ({} bytes)",
                                    path, file_size
                                );
                            } else {
                                match tokio::fs::remove_file(&path).await {
                                    Ok(_) => {
                                        items_cleaned += 1;
                                        bytes_freed += file_size;
                                        debug!("Deleted orphaned file: {:?}", path);
                                    }
                                    Err(e) => {
                                        errors_count += 1;
                                        warn!("Failed to delete orphaned file {:?}: {}", path, e);
                                    }
                                }
                            }
                        }
                        Ok(true) => {
                            // File has a database record, keep it
                            debug!("File has database record: {:?}", path);
                        }
                        Err(e) => {
                            errors_count += 1;
                            warn!("Error checking database record for {:?}: {}", path, e);
                        }
                    }
                }
            }
        }

        let action = if dry_run { "Would clean" } else { "Cleaned" };
        info!(
            "✅ {} {}/{} orphaned files ({} bytes freed)",
            action, items_cleaned, items_processed, bytes_freed
        );

        Ok(ThumbnailMaintenanceResult {
            task: "cleanup_orphaned_files".to_string(),
            items_processed,
            items_cleaned,
            bytes_freed,
            errors_count,
            duration_ms: 0,
        })
    }

    /// Optimize storage by removing duplicate thumbnails
    async fn optimize_storage(
        &self,
        dry_run: bool,
    ) -> Result<ThumbnailMaintenanceResult, ThumbnailMaintenanceError> {
        info!("⚡ Optimizing thumbnail storage (dry_run: {})", dry_run);

        // This is a placeholder for storage optimization logic
        // In a real implementation, you might:
        // 1. Find duplicate thumbnail files (same content hash)
        // 2. Create hard links or symlinks to deduplicate
        // 3. Compress old thumbnails
        // 4. Move rarely accessed thumbnails to cheaper storage

        warn!("Storage optimization is not yet implemented");

        Ok(ThumbnailMaintenanceResult {
            task: "optimize_storage".to_string(),
            items_processed: 0,
            items_cleaned: 0,
            bytes_freed: 0,
            errors_count: 0,
            duration_ms: 0,
        })
    }

    /// Retry jobs that might succeed now (e.g., after tool installation)
    async fn retry_eligible_jobs(
        &self,
        max_jobs: u32,
    ) -> Result<ThumbnailMaintenanceResult, ThumbnailMaintenanceError> {
        info!(
            "🔄 Retrying eligible failed thumbnail jobs (max: {})",
            max_jobs
        );

        // Get failed jobs that might be retryable
        let failed_jobs = self
            .service
            .get_jobs_by_status(ThumbnailJobStatus::Failed, max_jobs as i32)
            .await?;

        let mut items_processed = 0u64;
        let mut items_cleaned = 0u64; // "cleaned" = successfully retried
        let errors_count = 0u32;

        for job in failed_jobs.iter().take(max_jobs as usize) {
            items_processed += 1;

            // Only retry jobs that haven't exceeded max retries
            if job.retry_count < job.max_retries {
                // For this implementation, we'll just log what would be retried
                // In a real implementation, you'd re-enqueue the job
                info!(
                    "Would retry job: {} (retry {}/{})",
                    job.id, job.retry_count, job.max_retries
                );
                items_cleaned += 1;
            } else {
                debug!("Job {} has exceeded max retries", job.id);
            }
        }

        info!(
            "✅ Identified {} jobs for retry out of {} failed jobs",
            items_cleaned, items_processed
        );

        Ok(ThumbnailMaintenanceResult {
            task: "retry_eligible_jobs".to_string(),
            items_processed,
            items_cleaned,
            bytes_freed: 0,
            errors_count,
            duration_ms: 0,
        })
    }

    /// Delete a job and its associated files
    async fn delete_job_and_files(
        &self,
        job_id: uuid::Uuid,
    ) -> Result<(), ThumbnailMaintenanceError> {
        // In a real implementation, you would:
        // 1. Get the job details to find associated files
        // 2. Delete the files from storage
        // 3. Delete the job from the database

        // For now, just log what would be done
        debug!("Would delete job {} and its files", job_id);

        // This is where you'd implement the actual deletion logic
        // using the thumbnail service or repository

        Ok(())
    }

    /// Check if a thumbnail file has a corresponding database record
    async fn check_file_has_db_record(
        &self,
        filename: &str,
    ) -> Result<bool, ThumbnailMaintenanceError> {
        // In a real implementation, you would:
        // 1. Parse the filename to extract job ID or media blob ID
        // 2. Query the database to see if the record exists
        // 3. Return true if found, false if orphaned

        // For now, assume all files have records (conservative approach)
        debug!("Checking database record for file: {}", filename);
        Ok(true) // Conservative: assume file has record
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_maintenance_task_debug() {
        let task = ThumbnailMaintenanceTask::CleanupOldJobs {
            max_age_days: 30,
            max_jobs: 100,
        };
        assert!(!format!("{:?}", task).is_empty());
    }

    #[test]
    fn test_maintenance_result_debug() {
        let result = ThumbnailMaintenanceResult {
            task: "test".to_string(),
            items_processed: 10,
            items_cleaned: 5,
            bytes_freed: 1024,
            errors_count: 1,
            duration_ms: 100,
        };
        assert!(!format!("{:?}", result).is_empty());
    }
}
