//! Simple job queue manager for thumbnail processing
//!
//! This module provides a lightweight worker pool that polls the database
//! directly for jobs, avoiding complex external job queue dependencies.

use crate::jobs::thumbnail_job::{JobExecutionResult, ThumbnailJobProcessor};
use grimoire::{
    thumbnails::{ThumbnailDimensions, ThumbnailJobPriority},
    DatabaseConnection, ThumbnailConfig, ThumbnailService,
};
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tokio::task::JoinHandle;
use uuid::Uuid;

/// Simple thumbnail job queue that polls the database
pub struct ThumbnailJobQueue {
    db: DatabaseConnection,
    config: ThumbnailConfig,
    worker_handles: Arc<RwLock<Vec<JoinHandle<()>>>>,
    shutdown_tx: Option<broadcast::Sender<()>>,
    stats: Arc<RwLock<QueueStats>>,
    notification_tx: Option<broadcast::Sender<String>>,
}

impl ThumbnailJobQueue {
    /// Create a new job queue manager
    pub fn new(db: DatabaseConnection, config: ThumbnailConfig) -> Self {
        Self {
            db,
            config,
            worker_handles: Arc::new(RwLock::new(Vec::new())),
            shutdown_tx: None,
            stats: Arc::new(RwLock::new(QueueStats::new())),
            notification_tx: None,
        }
    }

    /// Create a new job queue manager with notification support
    pub fn new_with_notifications(
        db: DatabaseConnection,
        config: ThumbnailConfig,
        notification_tx: broadcast::Sender<String>,
    ) -> Self {
        Self {
            db,
            config,
            worker_handles: Arc::new(RwLock::new(Vec::new())),
            shutdown_tx: None,
            stats: Arc::new(RwLock::new(QueueStats::new())),
            notification_tx: Some(notification_tx),
        }
    }

    /// Start worker pool to process jobs
    pub async fn start_workers(&mut self, worker_count: u32) -> Result<(), ThumbnailJobQueueError> {
        let mut handles = self.worker_handles.write().await;

        if !handles.is_empty() {
            return Err(ThumbnailJobQueueError::AlreadyRunning);
        }

        let (shutdown_tx, _) = broadcast::channel::<()>(1);
        self.shutdown_tx = Some(shutdown_tx.clone());

        // Spawn worker tasks
        for worker_id in 0..worker_count {
            let db = self.db.clone();
            let config = self.config.clone();
            let stats = Arc::clone(&self.stats);
            let mut local_shutdown_rx = shutdown_tx.subscribe();

            let notification_tx = self.notification_tx.clone();
            let handle = tokio::spawn(async move {
                let processor = if let Some(notification_tx) = notification_tx {
                    ThumbnailJobProcessor::new_with_notifications(
                        db.clone(),
                        config.clone(),
                        notification_tx,
                    )
                } else {
                    ThumbnailJobProcessor::new(db.clone(), config.clone())
                };

                tracing::info!(
                    worker_id = worker_id,
                    processor_id = %processor.worker_id(),
                    "Starting thumbnail job worker"
                );

                loop {
                    // Check for shutdown signal
                    match local_shutdown_rx.try_recv() {
                        Ok(_) => {
                            tracing::info!(
                                worker_id = worker_id,
                                processor_id = %processor.worker_id(),
                                "Shutting down thumbnail job worker"
                            );
                            break;
                        }
                        Err(broadcast::error::TryRecvError::Empty) => {}
                        Err(broadcast::error::TryRecvError::Closed) => break,
                        Err(broadcast::error::TryRecvError::Lagged(_)) => {}
                    }

                    // Get pending jobs
                    let service = ThumbnailService::new(&db, config.clone());
                    match service.get_pending_jobs(1).await {
                        Ok(jobs) => {
                            if let Some(job) = jobs.first() {
                                let mut execution_result = JobExecutionResult::new(
                                    job.id,
                                    processor.worker_id().to_string(),
                                );

                                // Process the job
                                match processor.process_job(job).await {
                                    Ok(_) => {
                                        execution_result.complete_success();
                                        tracing::info!(
                                            job_id = %job.id,
                                            worker_id = worker_id,
                                            duration_ms = execution_result.duration_ms,
                                            "Job completed successfully"
                                        );

                                        // Update stats
                                        stats.write().await.record_success(
                                            execution_result.duration_ms.unwrap_or(0),
                                        );
                                    }
                                    Err(e) => {
                                        execution_result.complete_failure(&e.to_string());
                                        tracing::error!(
                                            job_id = %job.id,
                                            worker_id = worker_id,
                                            error = %e,
                                            duration_ms = execution_result.duration_ms,
                                            "Job failed"
                                        );

                                        // Update stats
                                        stats.write().await.record_failure();
                                    }
                                }

                                // Log execution result (could be stored in database if needed)
                                tracing::debug!(
                                    job_id = %execution_result.job_id,
                                    worker_id = %execution_result.worker_id,
                                    success = execution_result.success,
                                    duration_ms = execution_result.duration_ms,
                                    "Job execution completed"
                                );
                            } else {
                                // No jobs available, sleep for a bit
                                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                            }
                        }
                        Err(e) => {
                            tracing::error!(
                                worker_id = worker_id,
                                error = %e,
                                "Failed to get pending jobs"
                            );
                            tokio::time::sleep(std::time::Duration::from_secs(10)).await;
                        }
                    }
                }
            });

            handles.push(handle);
        }

        tracing::info!(worker_count = worker_count, "Started thumbnail job workers");
        Ok(())
    }

    /// Stop all workers
    pub async fn stop_workers(&mut self) -> Result<(), ThumbnailJobQueueError> {
        // Send shutdown signal
        if let Some(shutdown_tx) = self.shutdown_tx.take() {
            let _ = shutdown_tx.send(());
        }

        // Wait for all workers to finish
        let mut handles = self.worker_handles.write().await;
        for handle in handles.drain(..) {
            if let Err(e) = handle.await {
                tracing::error!(error = %e, "Worker task panicked");
            }
        }

        tracing::info!("All thumbnail job workers stopped");
        Ok(())
    }

    /// Enqueue a thumbnail job (delegate to grimoire service)
    pub async fn enqueue_thumbnail_job(
        &self,
        media_blob_id: Uuid,
        job_type: grimoire::ThumbnailJobType,
        priority: Option<ThumbnailJobPriority>,
        dimensions: Option<ThumbnailDimensions>,
    ) -> Result<Uuid, ThumbnailJobQueueError> {
        let service = ThumbnailService::new(&self.db, self.config.clone());

        let job_id = service
            .enqueue_thumbnail_job(media_blob_id, job_type, priority, dimensions)
            .await
            .map_err(|e| ThumbnailJobQueueError::ServiceError(e.to_string()))?;

        tracing::info!(
            job_id = %job_id,
            media_blob_id = %media_blob_id,
            "Enqueued thumbnail job"
        );

        Ok(job_id)
    }

    /// Auto-enqueue thumbnail jobs for a media blob
    pub async fn auto_enqueue_for_media_blob(
        &self,
        media_blob_id: Uuid,
    ) -> Result<Vec<Uuid>, ThumbnailJobQueueError> {
        let service = ThumbnailService::new(&self.db, self.config.clone());

        let job_ids = service
            .auto_enqueue_for_media_blob(media_blob_id)
            .await
            .map_err(|e| ThumbnailJobQueueError::ServiceError(e.to_string()))?;

        tracing::info!(
            media_blob_id = %media_blob_id,
            job_count = job_ids.len(),
            "Auto-enqueued thumbnail jobs for media blob"
        );

        Ok(job_ids)
    }

    /// Get job queue statistics
    pub async fn get_queue_stats(&self) -> Result<QueueStats, ThumbnailJobQueueError> {
        let service = ThumbnailService::new(&self.db, self.config.clone());

        let metrics = service
            .get_job_metrics()
            .await
            .map_err(|e| ThumbnailJobQueueError::ServiceError(e.to_string()))?;

        let worker_stats = self.stats.read().await.clone();

        Ok(QueueStats {
            total_jobs: metrics.total_jobs,
            pending_jobs: metrics.pending_jobs,
            in_progress_jobs: metrics.in_progress_jobs,
            completed_jobs: metrics.completed_jobs,
            failed_jobs: metrics.failed_jobs,
            success_rate: metrics.success_rate,
            average_processing_time_ms: metrics.average_processing_time_ms,
            workers_running: self.is_running().await,
            worker_success_count: worker_stats.worker_success_count,
            worker_failure_count: worker_stats.worker_failure_count,
            worker_avg_duration_ms: worker_stats.worker_avg_duration_ms,
        })
    }

    /// Check if workers are currently running
    pub async fn is_running(&self) -> bool {
        let handles = self.worker_handles.read().await;
        !handles.is_empty()
    }

    /// Retry failed jobs
    pub async fn retry_failed_jobs(&self) -> Result<u64, ThumbnailJobQueueError> {
        let service = ThumbnailService::new(&self.db, self.config.clone());

        let retried_count = service
            .retry_failed_jobs()
            .await
            .map_err(|e| ThumbnailJobQueueError::ServiceError(e.to_string()))?;

        tracing::info!(
            retried_count = retried_count,
            "Retried failed thumbnail jobs"
        );

        Ok(retried_count)
    }

    /// Clean up old completed jobs
    pub async fn cleanup_old_jobs(
        &self,
        older_than_days: u32,
    ) -> Result<u64, ThumbnailJobQueueError> {
        let service = ThumbnailService::new(&self.db, self.config.clone());

        let cutoff_time =
            time::OffsetDateTime::now_utc() - time::Duration::days(older_than_days as i64);

        let cleaned_count = service
            .cleanup_old_jobs(cutoff_time)
            .await
            .map_err(|e| ThumbnailJobQueueError::ServiceError(e.to_string()))?;

        tracing::info!(
            cleaned_count = cleaned_count,
            older_than_days = older_than_days,
            "Cleaned up old thumbnail jobs"
        );

        Ok(cleaned_count)
    }

    /// Validate external tools are available
    pub async fn validate_tools(&self) -> Result<(), ThumbnailJobQueueError> {
        let service = ThumbnailService::new(&self.db, self.config.clone());

        service
            .validate_tools()
            .await
            .map_err(|e| ThumbnailJobQueueError::ToolValidation(e.to_string()))?;

        tracing::info!("External tools validated successfully");
        Ok(())
    }

    /// Get the thumbnail configuration
    pub fn config(&self) -> &ThumbnailConfig {
        &self.config
    }

    /// Update the thumbnail configuration
    pub fn update_config(&mut self, config: ThumbnailConfig) {
        self.config = config;
    }
}

impl Drop for ThumbnailJobQueue {
    fn drop(&mut self) {
        // Attempt graceful shutdown
        if let Some(shutdown_tx) = self.shutdown_tx.take() {
            let _ = shutdown_tx.send(());
        }
    }
}

/// Queue statistics for monitoring
#[derive(Debug, Clone)]
pub struct QueueStats {
    // Database-level stats
    pub total_jobs: i64,
    pub pending_jobs: i64,
    pub in_progress_jobs: i64,
    pub completed_jobs: i64,
    pub failed_jobs: i64,
    pub success_rate: f64,
    pub average_processing_time_ms: f64,
    pub workers_running: bool,

    // Worker-level stats
    pub worker_success_count: u64,
    pub worker_failure_count: u64,
    pub worker_avg_duration_ms: f64,
}

impl QueueStats {
    fn new() -> Self {
        Self {
            total_jobs: 0,
            pending_jobs: 0,
            in_progress_jobs: 0,
            completed_jobs: 0,
            failed_jobs: 0,
            success_rate: 0.0,
            average_processing_time_ms: 0.0,
            workers_running: false,
            worker_success_count: 0,
            worker_failure_count: 0,
            worker_avg_duration_ms: 0.0,
        }
    }

    /// Record a successful job execution
    fn record_success(&mut self, duration_ms: i64) {
        self.worker_success_count += 1;
        self.update_avg_duration(duration_ms as f64);
    }

    /// Record a failed job execution
    fn record_failure(&mut self) {
        self.worker_failure_count += 1;
    }

    /// Update the average duration
    fn update_avg_duration(&mut self, duration_ms: f64) {
        let total_jobs = self.worker_success_count + self.worker_failure_count;
        if total_jobs > 0 {
            self.worker_avg_duration_ms = (self.worker_avg_duration_ms * (total_jobs - 1) as f64
                + duration_ms)
                / total_jobs as f64;
        }
    }

    /// Get the completion rate (completed / total)
    pub fn completion_rate(&self) -> f64 {
        if self.total_jobs == 0 {
            0.0
        } else {
            self.completed_jobs as f64 / self.total_jobs as f64
        }
    }

    /// Get the failure rate (failed / total)
    pub fn failure_rate(&self) -> f64 {
        if self.total_jobs == 0 {
            0.0
        } else {
            self.failed_jobs as f64 / self.total_jobs as f64
        }
    }

    /// Check if the queue is healthy (low failure rate, workers running)
    pub fn is_healthy(&self) -> bool {
        self.workers_running && self.failure_rate() < 0.1 // Less than 10% failure rate
    }

    /// Get worker success rate
    pub fn worker_success_rate(&self) -> f64 {
        let total = self.worker_success_count + self.worker_failure_count;
        if total == 0 {
            0.0
        } else {
            self.worker_success_count as f64 / total as f64
        }
    }
}

/// Errors that can occur in job queue operations
#[derive(thiserror::Error, Debug)]
pub enum ThumbnailJobQueueError {
    #[error("Failed to start workers: {0}")]
    WorkerStart(String),

    #[error("Failed to stop workers: {0}")]
    WorkerStop(String),

    #[error("Workers are already running")]
    AlreadyRunning,

    #[error("Service error: {0}")]
    ServiceError(String),

    #[error("Tool validation failed: {0}")]
    ToolValidation(String),

    #[error("Configuration error: {0}")]
    Configuration(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_queue_stats_calculation() {
        let stats = QueueStats {
            total_jobs: 100,
            pending_jobs: 10,
            in_progress_jobs: 5,
            completed_jobs: 80,
            failed_jobs: 5,
            success_rate: 0.94,
            average_processing_time_ms: 1500.0,
            workers_running: true,
            worker_success_count: 50,
            worker_failure_count: 5,
            worker_avg_duration_ms: 1200.0,
        };

        assert_eq!(stats.completion_rate(), 0.8);
        assert_eq!(stats.failure_rate(), 0.05);
        assert!(stats.is_healthy());
        assert!((stats.worker_success_rate() - 0.909).abs() < 0.01); // 50/55 ≈ 0.909
    }

    #[test]
    fn test_queue_stats_empty() {
        let stats = QueueStats::new();

        assert_eq!(stats.completion_rate(), 0.0);
        assert_eq!(stats.failure_rate(), 0.0);
        assert_eq!(stats.worker_success_rate(), 0.0);
        assert!(!stats.is_healthy()); // Not healthy because workers not running
    }

    #[test]
    fn test_queue_stats_record_operations() {
        let mut stats = QueueStats::new();

        stats.record_success(1000);
        assert_eq!(stats.worker_success_count, 1);
        assert_eq!(stats.worker_avg_duration_ms, 1000.0);

        stats.record_success(2000);
        assert_eq!(stats.worker_success_count, 2);
        assert_eq!(stats.worker_avg_duration_ms, 1500.0); // (1000 + 2000) / 2

        stats.record_failure();
        assert_eq!(stats.worker_failure_count, 1);
        assert_eq!(stats.worker_success_rate(), 2.0 / 3.0); // 2 success out of 3 total
    }

    #[test]
    fn test_queue_stats_unhealthy_high_failure_rate() {
        let stats = QueueStats {
            total_jobs: 100,
            pending_jobs: 5,
            in_progress_jobs: 5,
            completed_jobs: 75,
            failed_jobs: 15,
            success_rate: 0.83,
            average_processing_time_ms: 2000.0,
            workers_running: true,
            worker_success_count: 40,
            worker_failure_count: 10,
            worker_avg_duration_ms: 1800.0,
        };

        assert_eq!(stats.completion_rate(), 0.75);
        assert_eq!(stats.failure_rate(), 0.15);
        assert!(!stats.is_healthy()); // Not healthy due to high failure rate (15% > 10%)
    }
}
