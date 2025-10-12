//! Analytics Job Queue System
//!
//! This module provides a worker pool for processing analytics-related background jobs such as
//! materialized view refreshes, daily rollups, trend analysis, and cleanup tasks.
//! It follows the same pattern as the existing job queue systems.

use grimoire::analytics::{AnalyticsService, MediaAnalyticsError};
use grimoire::DatabaseConnection;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use time::OffsetDateTime;
use tokio::sync::{broadcast, RwLock};
use tokio::task::JoinHandle;
use tokio::time::{sleep, Duration};
use tracing::{error, info, warn};
use uuid::Uuid;

/// Analytics job queue errors
#[derive(Debug, thiserror::Error)]
pub enum AnalyticsJobQueueError {
    #[error("Workers are already running")]
    AlreadyRunning,
    #[error("Database error: {0}")]
    DatabaseError(String),
    #[error("Processing error: {0}")]
    ProcessingError(String),
    #[error("Analytics service error: {0}")]
    AnalyticsError(#[from] MediaAnalyticsError),
}

/// Types of analytics jobs that can be processed
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AnalyticsJobType {
    /// Refresh all materialized views
    RefreshMaterializedViews,
    /// Daily rollup of play counts and user statistics
    DailyRollup,
    /// Weekly trend analysis and caching
    WeeklyTrendAnalysis,
    /// Cleanup old raw events (retain aggregated data)
    CleanupOldEvents { days_to_keep: i32 },
    /// Generate analytics milestones notifications
    AnalyticsMilestones,
}

impl AnalyticsJobType {
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "refresh_materialized_views" => Ok(AnalyticsJobType::RefreshMaterializedViews),
            "daily_rollup" => Ok(AnalyticsJobType::DailyRollup),
            "weekly_trend_analysis" => Ok(AnalyticsJobType::WeeklyTrendAnalysis),
            "cleanup_old_events" => Ok(AnalyticsJobType::CleanupOldEvents { days_to_keep: 90 }),
            "analytics_milestones" => Ok(AnalyticsJobType::AnalyticsMilestones),
            _ => Err(format!("Unknown job type: {}", s)),
        }
    }
}

/// Analytics job data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnalyticsJobData {
    pub metadata: serde_json::Value,
}

/// Analytics job queue for processing background analytics tasks
pub struct AnalyticsJobQueue {
    db: DatabaseConnection,
    worker_handles: Arc<RwLock<Vec<JoinHandle<()>>>>,
    shutdown_tx: Option<broadcast::Sender<()>>,
    stats: Arc<RwLock<QueueStats>>,
    notification_tx: Option<broadcast::Sender<String>>,
}

/// Queue statistics
#[derive(Debug, Clone)]
pub struct QueueStats {
    pub total_jobs: i64,
    pub pending_jobs: i64,
    pub in_progress_jobs: i64,
    pub completed_jobs: i64,
    pub failed_jobs: i64,
    pub success_rate: f64,
    pub workers_running: bool,
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
            workers_running: false,
            worker_success_count: 0,
            worker_failure_count: 0,
            worker_avg_duration_ms: 0.0,
        }
    }

    fn record_success(&mut self, duration_ms: i64) {
        self.worker_success_count += 1;
        self.update_avg_duration(duration_ms as f64);
    }

    fn record_failure(&mut self) {
        self.worker_failure_count += 1;
    }

    fn update_avg_duration(&mut self, duration_ms: f64) {
        let total_jobs = self.worker_success_count as f64;
        if total_jobs > 0.0 {
            self.worker_avg_duration_ms =
                (self.worker_avg_duration_ms * (total_jobs - 1.0) + duration_ms) / total_jobs;
        }
    }

    pub fn worker_success_rate(&self) -> f64 {
        let total_workers = self.worker_success_count + self.worker_failure_count;
        if total_workers > 0 {
            self.worker_success_count as f64 / total_workers as f64 * 100.0
        } else {
            0.0
        }
    }

    pub fn is_healthy(&self) -> bool {
        self.worker_success_rate() >= 80.0
    }
}

/// Job execution result for tracking
#[derive(Debug)]
struct JobExecutionResult {
    job_id: Uuid,
    success: bool,
    duration_ms: i64,
    error_message: Option<String>,
}

impl JobExecutionResult {
    fn new(job_id: Uuid) -> Self {
        Self {
            job_id,
            success: false,
            duration_ms: 0,
            error_message: None,
        }
    }

    fn success(mut self, duration_ms: i64) -> Self {
        self.success = true;
        self.duration_ms = duration_ms;
        self
    }

    fn failure(mut self, error: String, duration_ms: i64) -> Self {
        self.success = false;
        self.duration_ms = duration_ms;
        self.error_message = Some(error);
        self
    }
}

impl AnalyticsJobQueue {
    /// Create a new analytics job queue manager
    pub fn new(db: DatabaseConnection) -> Self {
        Self {
            db,
            worker_handles: Arc::new(RwLock::new(Vec::new())),
            shutdown_tx: None,
            stats: Arc::new(RwLock::new(QueueStats::new())),
            notification_tx: None,
        }
    }

    /// Create a new analytics job queue manager with notification support
    pub fn new_with_notifications(
        db: DatabaseConnection,
        notification_tx: broadcast::Sender<String>,
    ) -> Self {
        Self {
            db,
            worker_handles: Arc::new(RwLock::new(Vec::new())),
            shutdown_tx: None,
            stats: Arc::new(RwLock::new(QueueStats::new())),
            notification_tx: Some(notification_tx),
        }
    }

    /// Start worker pool to process analytics jobs
    pub async fn start_workers(&mut self, worker_count: u32) -> Result<(), AnalyticsJobQueueError> {
        let mut handles = self.worker_handles.write().await;

        if !handles.is_empty() {
            return Err(AnalyticsJobQueueError::AlreadyRunning);
        }

        let (shutdown_tx, _) = broadcast::channel::<()>(1);
        self.shutdown_tx = Some(shutdown_tx.clone());

        // Spawn worker tasks
        for worker_id in 0..worker_count {
            let db = self.db.clone();
            let stats = Arc::clone(&self.stats);
            let mut local_shutdown_rx = shutdown_tx.subscribe();
            let notification_tx = self.notification_tx.clone();

            let handle = tokio::spawn(async move {
                let processor = AnalyticsJobProcessor::new(db.clone(), notification_tx);

                info!("Analytics worker {} started", worker_id);

                loop {
                    // Check for shutdown signal
                    if let Ok(_) = local_shutdown_rx.try_recv() {
                        info!("Analytics worker {} shutting down", worker_id);
                        break;
                    }

                    // Process next job
                    match processor.process_next_job().await {
                        Ok(Some(result)) => {
                            let mut stats_lock = stats.write().await;
                            if result.success {
                                stats_lock.record_success(result.duration_ms);
                                info!(
                                    "Analytics worker {} completed job {} in {}ms",
                                    worker_id, result.job_id, result.duration_ms
                                );
                            } else {
                                stats_lock.record_failure();
                                warn!(
                                    "Analytics worker {} failed job {}: {:?}",
                                    worker_id, result.job_id, result.error_message
                                );
                            }
                        }
                        Ok(None) => {
                            // No jobs available, sleep briefly
                            sleep(Duration::from_secs(10)).await;
                        }
                        Err(e) => {
                            error!("Analytics worker {} error: {}", worker_id, e);
                            sleep(Duration::from_secs(30)).await;
                        }
                    }
                }
            });

            handles.push(handle);
        }

        // Update stats to reflect workers are running
        {
            let mut stats = self.stats.write().await;
            stats.workers_running = true;
        }

        info!("Started {} analytics workers", worker_count);
        Ok(())
    }

    /// Stop all worker tasks
    pub async fn stop_workers(&mut self) -> Result<(), AnalyticsJobQueueError> {
        if let Some(shutdown_tx) = &self.shutdown_tx {
            let _ = shutdown_tx.send(());
        }

        let mut handles = self.worker_handles.write().await;
        for handle in handles.drain(..) {
            let _ = handle.await;
        }

        // Update stats to reflect workers are stopped
        {
            let mut stats = self.stats.write().await;
            stats.workers_running = false;
        }

        self.shutdown_tx = None;
        info!("Analytics workers stopped");
        Ok(())
    }

    /// Enqueue an analytics job
    pub async fn enqueue_job(
        &self,
        job_type: AnalyticsJobType,
        priority: i32,
        job_data: AnalyticsJobData,
    ) -> Result<Uuid, AnalyticsJobQueueError> {
        let job_id = Uuid::new_v4();
        let created_at = OffsetDateTime::now_utc();
        let scheduled_for = created_at;

        let job_type_str = match &job_type {
            AnalyticsJobType::RefreshMaterializedViews => "refresh_materialized_views",
            AnalyticsJobType::DailyRollup => "daily_rollup",
            AnalyticsJobType::WeeklyTrendAnalysis => "weekly_trend_analysis",
            AnalyticsJobType::CleanupOldEvents { .. } => "cleanup_old_events",
            AnalyticsJobType::AnalyticsMilestones => "analytics_milestones",
        };

        sqlx::query!(
            r#"
            INSERT INTO analytics_jobs (
                id, job_type, priority, job_data, status,
                created_at, scheduled_for, updated_at
            )
            VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7)
            "#,
            job_id,
            job_type_str,
            priority,
            serde_json::to_value(&job_data).unwrap(),
            created_at,
            scheduled_for,
            created_at
        )
        .execute(self.db.pool())
        .await
        .map_err(|e| AnalyticsJobQueueError::DatabaseError(e.to_string()))?;

        info!("Enqueued analytics job {}: {:?}", job_id, job_type);
        Ok(job_id)
    }

    /// Schedule daily rollup job
    pub async fn schedule_daily_rollup(&self) -> Result<Uuid, AnalyticsJobQueueError> {
        let job_data = AnalyticsJobData {
            metadata: serde_json::json!({}),
        };
        self.enqueue_job(AnalyticsJobType::DailyRollup, 1, job_data)
            .await
    }

    /// Schedule weekly trend analysis
    pub async fn schedule_weekly_trend_analysis(&self) -> Result<Uuid, AnalyticsJobQueueError> {
        let job_data = AnalyticsJobData {
            metadata: serde_json::json!({}),
        };
        self.enqueue_job(AnalyticsJobType::WeeklyTrendAnalysis, 2, job_data)
            .await
    }

    /// Schedule materialized view refresh
    pub async fn schedule_materialized_view_refresh(&self) -> Result<Uuid, AnalyticsJobQueueError> {
        let job_data = AnalyticsJobData {
            metadata: serde_json::json!({}),
        };
        self.enqueue_job(AnalyticsJobType::RefreshMaterializedViews, 3, job_data)
            .await
    }

    /// Schedule cleanup of old events
    pub async fn schedule_cleanup_old_events(
        &self,
        days_to_keep: i32,
    ) -> Result<Uuid, AnalyticsJobQueueError> {
        let job_data = AnalyticsJobData {
            metadata: serde_json::json!({ "days_to_keep": days_to_keep }),
        };
        self.enqueue_job(
            AnalyticsJobType::CleanupOldEvents { days_to_keep },
            5,
            job_data,
        )
        .await
    }

    /// Get queue statistics
    pub async fn get_queue_stats(&self) -> Result<QueueStats, AnalyticsJobQueueError> {
        let mut stats = self.stats.read().await.clone();

        // Update job counts from database
        let row = sqlx::query!(
            r#"
            SELECT
                COUNT(*) as total_jobs,
                COUNT(*) FILTER (WHERE status = 'pending') as pending_jobs,
                COUNT(*) FILTER (WHERE status = 'processing') as in_progress_jobs,
                COUNT(*) FILTER (WHERE status = 'completed') as completed_jobs,
                COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs
            FROM analytics_jobs
            WHERE created_at >= NOW() - INTERVAL '24 hours'
            "#
        )
        .fetch_one(self.db.pool())
        .await
        .map_err(|e| AnalyticsJobQueueError::DatabaseError(e.to_string()))?;

        stats.total_jobs = row.total_jobs.unwrap_or(0);
        stats.pending_jobs = row.pending_jobs.unwrap_or(0);
        stats.in_progress_jobs = row.in_progress_jobs.unwrap_or(0);
        stats.completed_jobs = row.completed_jobs.unwrap_or(0);
        stats.failed_jobs = row.failed_jobs.unwrap_or(0);

        if stats.total_jobs > 0 {
            stats.success_rate = (stats.completed_jobs as f64 / stats.total_jobs as f64) * 100.0;
        }

        Ok(stats)
    }

    /// Check if workers are running
    pub async fn is_running(&self) -> bool {
        let handles = self.worker_handles.read().await;
        !handles.is_empty()
    }

    /// Retry failed jobs
    pub async fn retry_failed_jobs(&self) -> Result<u64, AnalyticsJobQueueError> {
        let result = sqlx::query!(
            r#"
            UPDATE analytics_jobs
            SET status = 'pending',
                updated_at = NOW(),
                error_message = NULL
            WHERE status = 'failed'
            AND created_at >= NOW() - INTERVAL '24 hours'
            "#
        )
        .execute(self.db.pool())
        .await
        .map_err(|e| AnalyticsJobQueueError::DatabaseError(e.to_string()))?;

        Ok(result.rows_affected())
    }

    /// Cleanup old completed jobs
    pub async fn cleanup_old_jobs(&self, days_to_keep: i32) -> Result<u64, AnalyticsJobQueueError> {
        let result = sqlx::query!(
            r#"
            DELETE FROM analytics_jobs
            WHERE status IN ('completed', 'failed')
            AND created_at < NOW() - INTERVAL '1 day' * $1
            "#,
            days_to_keep as f64
        )
        .execute(self.db.pool())
        .await
        .map_err(|e| AnalyticsJobQueueError::DatabaseError(e.to_string()))?;

        Ok(result.rows_affected())
    }
}

impl Drop for AnalyticsJobQueue {
    fn drop(&mut self) {
        // Stop workers when the queue is dropped
        if let Some(shutdown_tx) = &self.shutdown_tx {
            let _ = shutdown_tx.send(());
        }
    }
}

/// Analytics job processor that handles individual job execution
struct AnalyticsJobProcessor {
    db: DatabaseConnection,
    notification_tx: Option<broadcast::Sender<String>>,
}

impl AnalyticsJobProcessor {
    fn new(db: DatabaseConnection, notification_tx: Option<broadcast::Sender<String>>) -> Self {
        Self {
            db,
            notification_tx,
        }
    }

    async fn process_next_job(&self) -> Result<Option<JobExecutionResult>, AnalyticsJobQueueError> {
        // Get next pending job
        let job_row = sqlx::query!(
            r#"
            SELECT id, job_type, job_data
            FROM analytics_jobs
            WHERE status = 'pending'
            AND scheduled_for <= NOW()
            ORDER BY priority ASC, created_at ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            "#
        )
        .fetch_optional(self.db.pool())
        .await
        .map_err(|e| AnalyticsJobQueueError::DatabaseError(e.to_string()))?;

        let Some(job) = job_row else {
            return Ok(None);
        };

        let job_id = job.id;
        let start_time = std::time::Instant::now();

        // Mark job as processing
        sqlx::query!(
            r#"
            UPDATE analytics_jobs
            SET status = 'processing', started_at = NOW(), updated_at = NOW()
            WHERE id = $1
            "#,
            job_id
        )
        .execute(self.db.pool())
        .await
        .map_err(|e| AnalyticsJobQueueError::DatabaseError(e.to_string()))?;

        // Parse job type and job data
        let job_type = AnalyticsJobType::from_str(&job.job_type)
            .map_err(|e| AnalyticsJobQueueError::ProcessingError(e))?;

        let job_data: AnalyticsJobData = serde_json::from_value(job.job_data)
            .map_err(|e| AnalyticsJobQueueError::ProcessingError(e.to_string()))?;

        // Execute the job
        let result = self.execute_job(job_id, &job_type, &job_data).await;
        let duration_ms = start_time.elapsed().as_millis() as i64;

        // Update job status
        match &result {
            Ok(_) => {
                sqlx::query!(
                    r#"
                    UPDATE analytics_jobs
                    SET status = 'completed',
                        completed_at = NOW(),
                        updated_at = NOW(),
                        duration_ms = $2
                    WHERE id = $1
                    "#,
                    job_id,
                    duration_ms
                )
                .execute(self.db.pool())
                .await
                .map_err(|e| AnalyticsJobQueueError::DatabaseError(e.to_string()))?;

                Ok(Some(JobExecutionResult::new(job_id).success(duration_ms)))
            }
            Err(e) => {
                sqlx::query!(
                    r#"
                    UPDATE analytics_jobs
                    SET status = 'failed',
                        completed_at = NOW(),
                        updated_at = NOW(),
                        duration_ms = $2,
                        error_message = $3
                    WHERE id = $1
                    "#,
                    job_id,
                    duration_ms,
                    e.to_string()
                )
                .execute(self.db.pool())
                .await
                .map_err(|e| AnalyticsJobQueueError::DatabaseError(e.to_string()))?;

                Ok(Some(
                    JobExecutionResult::new(job_id).failure(e.to_string(), duration_ms),
                ))
            }
        }
    }

    async fn execute_job(
        &self,
        job_id: Uuid,
        job_type: &AnalyticsJobType,
        _job_data: &AnalyticsJobData,
    ) -> Result<(), AnalyticsJobQueueError> {
        info!("Executing analytics job {}: {:?}", job_id, job_type);

        let analytics_service = AnalyticsService::new_with_defaults(&self.db);

        match job_type {
            AnalyticsJobType::RefreshMaterializedViews => {
                let results = analytics_service
                    .refresh_analytics_materialized_views()
                    .await?;
                self.send_notification(&format!("materialized views refreshed: {}", results.len()));
                info!("Refreshed {} materialized views", results.len());
            }
            AnalyticsJobType::DailyRollup => {
                self.execute_daily_rollup().await?;
                self.send_notification("daily analytics rollup completed");
            }
            AnalyticsJobType::WeeklyTrendAnalysis => {
                self.execute_weekly_trend_analysis().await?;
                self.send_notification("weekly trend analysis completed");
            }
            AnalyticsJobType::CleanupOldEvents { days_to_keep } => {
                let deleted_count = self.execute_cleanup_old_events(*days_to_keep).await?;
                self.send_notification(&format!("cleaned up {} old events", deleted_count));
                info!("Cleaned up {} old analytics events", deleted_count);
            }
            AnalyticsJobType::AnalyticsMilestones => {
                self.execute_analytics_milestones().await?;
                self.send_notification("analytics milestones check completed");
            }
        }

        Ok(())
    }

    async fn execute_daily_rollup(&self) -> Result<(), AnalyticsJobQueueError> {
        let analytics_service = AnalyticsService::new_with_defaults(&self.db);

        // Refresh materialized views for daily data
        analytics_service
            .refresh_analytics_materialized_views()
            .await?;

        // Additional daily rollup logic could go here
        info!("Daily rollup completed");
        Ok(())
    }

    async fn execute_weekly_trend_analysis(&self) -> Result<(), AnalyticsJobQueueError> {
        let analytics_service = AnalyticsService::new_with_defaults(&self.db);

        // Get trending songs for the week
        let _trending = analytics_service
            .get_trending_songs(24 * 7, 50, Some("song"))
            .await?;

        // Additional trend analysis logic could go here
        info!("Weekly trend analysis completed");
        Ok(())
    }

    async fn execute_cleanup_old_events(
        &self,
        days_to_keep: i32,
    ) -> Result<u64, AnalyticsJobQueueError> {
        let result = sqlx::query!(
            r#"
            DELETE FROM media_events
            WHERE created_at < NOW() - INTERVAL '1 day' * $1
            "#,
            days_to_keep as f64
        )
        .execute(self.db.pool())
        .await
        .map_err(|e| AnalyticsJobQueueError::DatabaseError(e.to_string()))?;

        Ok(result.rows_affected())
    }

    async fn execute_analytics_milestones(&self) -> Result<(), AnalyticsJobQueueError> {
        // Check for analytics milestones (e.g., 1000th play, new user milestones)
        // This is a placeholder for future milestone detection logic
        info!("Analytics milestones check completed");
        Ok(())
    }

    fn send_notification(&self, message: &str) {
        if let Some(tx) = &self.notification_tx {
            let _ = tx.send(format!("analytics: {}", message));
        }
    }
}
