//! Music Job Queue System
//!
//! This module provides a worker pool for processing music-related jobs such as
//! metadata extraction, song creation, thumbnail generation, and waveform creation.
//! It follows the same pattern as the thumbnail job queue system.

use grimoire::DatabaseConnection;
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tokio::task::JoinHandle;
use tokio::time::{sleep, Duration};
use tracing::{error, info, warn};
use uuid::Uuid;

/// Music job queue errors
#[derive(Debug, thiserror::Error)]
pub enum MusicJobQueueError {
    #[error("Workers are already running")]
    AlreadyRunning,
    #[error("Database error: {0}")]
    DatabaseError(String),
    #[error("Processing error: {0}")]
    ProcessingError(String),
}

/// Music job queue for processing music-related background tasks
pub struct MusicJobQueue {
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

    fn mark_success(&mut self, duration_ms: i64) {
        self.success = true;
        self.duration_ms = duration_ms;
    }

    fn mark_failure(&mut self, duration_ms: i64, error: String) {
        self.success = false;
        self.duration_ms = duration_ms;
        self.error_message = Some(error);
    }
}

/// Music job record from database
#[derive(Debug)]
struct MusicJob {
    id: Uuid,
    job_type: String,
    file_path: String,
    media_blob_id: String,
    parameters: serde_json::Value,
    retry_count: i32,
    max_retries: i32,
}

impl MusicJobQueue {
    /// Create a new music job queue
    pub fn new(db: DatabaseConnection) -> Self {
        Self {
            db,
            worker_handles: Arc::new(RwLock::new(Vec::new())),
            shutdown_tx: None,
            stats: Arc::new(RwLock::new(QueueStats::new())),
            notification_tx: None,
        }
    }

    /// Create a new music job queue with notification support
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

    /// Start worker pool to process jobs
    pub async fn start_workers(&mut self, worker_count: u32) -> Result<(), MusicJobQueueError> {
        let mut handles = self.worker_handles.write().await;

        if !handles.is_empty() {
            return Err(MusicJobQueueError::AlreadyRunning);
        }

        let (shutdown_tx, _) = broadcast::channel::<()>(1);
        self.shutdown_tx = Some(shutdown_tx.clone());

        // Spawn worker tasks
        for worker_id in 0..worker_count {
            let db = self.db.clone();
            let mut shutdown_rx = shutdown_tx.subscribe();
            let stats = self.stats.clone();
            let notification_tx = self.notification_tx.clone();
            let worker_id_str = format!("music_worker_{}", worker_id);

            let handle = tokio::spawn(async move {
                info!(
                    worker_id = worker_id,
                    worker_id_str = %worker_id_str,
                    "Starting music job worker"
                );

                loop {
                    // Check for shutdown signal
                    if shutdown_rx.try_recv().is_ok() {
                        info!(
                            worker_id = worker_id,
                            worker_id_str = %worker_id_str,
                            "Shutting down music job worker"
                        );
                        break;
                    }

                    // Try to claim and process a job
                    match Self::claim_and_process_job(&db, &worker_id_str, &notification_tx).await {
                        Ok(Some(result)) => {
                            // Update stats
                            let mut stats_guard = stats.write().await;
                            if result.success {
                                stats_guard.record_success(result.duration_ms);
                                info!(
                                    job_id = %result.job_id,
                                    worker_id = worker_id,
                                    duration_ms = result.duration_ms,
                                    "Music job completed successfully"
                                );
                            } else {
                                stats_guard.record_failure();
                                error!(
                                    job_id = %result.job_id,
                                    worker_id = worker_id,
                                    error = %result.error_message.as_deref().unwrap_or("Unknown error"),
                                    duration_ms = result.duration_ms,
                                    "Music job failed"
                                );
                            }
                        }
                        Ok(None) => {
                            // No jobs available, sleep before trying again
                            sleep(Duration::from_secs(2)).await;
                        }
                        Err(e) => {
                            error!(
                                worker_id = worker_id,
                                error = %e,
                                "Failed to process music jobs"
                            );
                            sleep(Duration::from_secs(5)).await;
                        }
                    }
                }
            });

            handles.push(handle);
        }

        info!(worker_count = worker_count, "Started music job workers");
        Ok(())
    }

    /// Stop all workers
    pub async fn stop_workers(&mut self) -> Result<(), MusicJobQueueError> {
        // Send shutdown signal
        if let Some(shutdown_tx) = self.shutdown_tx.take() {
            let _ = shutdown_tx.send(());
        }

        // Wait for all workers to finish
        let mut handles = self.worker_handles.write().await;
        for handle in handles.drain(..) {
            if let Err(e) = handle.await {
                error!(error = %e, "Music worker task panicked");
            }
        }

        info!("All music job workers stopped");
        Ok(())
    }

    /// Claim and process a single job
    async fn claim_and_process_job(
        db: &DatabaseConnection,
        worker_id: &str,
        notification_tx: &Option<broadcast::Sender<String>>,
    ) -> Result<Option<JobExecutionResult>, MusicJobQueueError> {
        let start_time = std::time::Instant::now();

        // Claim a job using the database function
        let claimed_jobs = sqlx::query!(
            r#"
            SELECT id, job_type, file_path, media_blob_id, parameters, retry_count, max_retries
            FROM claim_music_jobs($1, 1, NULL)
            "#,
            worker_id
        )
        .fetch_all(db.pool())
        .await
        .map_err(|e| MusicJobQueueError::DatabaseError(e.to_string()))?;

        if claimed_jobs.is_empty() {
            return Ok(None);
        }

        let job_row = &claimed_jobs[0];
        let job = MusicJob {
            id: job_row.id.expect("Job ID should not be null"),
            job_type: job_row
                .job_type
                .clone()
                .expect("Job type should not be null"),
            file_path: job_row
                .file_path
                .clone()
                .expect("File path should not be null"),
            media_blob_id: job_row
                .media_blob_id
                .clone()
                .expect("Media blob ID should not be null"),
            parameters: job_row
                .parameters
                .clone()
                .unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::new())),
            retry_count: job_row.retry_count.unwrap_or(0),
            max_retries: job_row.max_retries.unwrap_or(3),
        };

        let mut result = JobExecutionResult::new(job.id);

        // Process the job
        match Self::process_music_job(db, &job).await {
            Ok(song_id) => {
                let duration_ms = start_time.elapsed().as_millis() as i64;
                result.mark_success(duration_ms);

                // Mark job as completed in database
                if let Err(e) = sqlx::query!(
                    r#"
                    UPDATE music_jobs
                    SET status = 'completed',
                        completed_at = NOW(),
                        updated_at = NOW(),
                        song_id = $2
                    WHERE id = $1
                    "#,
                    job.id,
                    song_id
                )
                .execute(db.pool())
                .await
                {
                    warn!("Failed to mark job as completed: {}", e);
                }

                // Send notification if available
                if let Some(tx) = notification_tx {
                    let notification = serde_json::json!({
                        "event_type": "music_job_completed",
                        "job_id": job.id.to_string(),
                        "song_id": song_id.to_string(),
                        "file_path": job.file_path
                    });
                    let _ = tx.send(notification.to_string());
                }
            }
            Err(e) => {
                let duration_ms = start_time.elapsed().as_millis() as i64;
                result.mark_failure(duration_ms, e.to_string());

                // Determine if we should retry or mark as failed
                let should_retry = job.retry_count < job.max_retries;
                let error_message = e.to_string();

                // Update job status based on retry logic
                let update_result = if should_retry {
                    sqlx::query!(
                        r#"
                        UPDATE music_jobs
                        SET status = 'pending',
                            error_message = $2,
                            retry_count = retry_count + 1,
                            updated_at = NOW(),
                            scheduled_at = NOW() + INTERVAL '30 seconds'
                        WHERE id = $1
                        "#,
                        job.id,
                        error_message
                    )
                    .execute(db.pool())
                    .await
                } else {
                    sqlx::query!(
                        r#"
                        UPDATE music_jobs
                        SET status = 'failed',
                            error_message = $2,
                            retry_count = retry_count + 1,
                            updated_at = NOW()
                        WHERE id = $1
                        "#,
                        job.id,
                        error_message
                    )
                    .execute(db.pool())
                    .await
                };

                if let Err(db_err) = update_result {
                    warn!("Failed to update job status after error: {}", db_err);
                }
            }
        }

        Ok(Some(result))
    }

    /// Process a single music job
    async fn process_music_job(
        db: &DatabaseConnection,
        job: &MusicJob,
    ) -> Result<Uuid, Box<dyn std::error::Error + Send + Sync>> {
        use grimoire::music::{extract_standard_fields, CreateSong, MusicRepository};
        use std::path::Path;

        info!(
            job_id = %job.id,
            job_type = %job.job_type,
            file_path = %job.file_path,
            "Processing music job"
        );

        let file_path = Path::new(&job.file_path);

        // Extract metadata from the audio file using standard fields
        let metadata_result = extract_standard_fields(file_path).await?;

        // Get original filename from parameters
        let original_filename = job
            .parameters
            .get("original_filename")
            .and_then(|v| v.as_str());

        // Create song record
        let music_repo = MusicRepository::new(db.pool().clone());

        let song_params = CreateSong {
            media_blob_id: job.media_blob_id.clone(),
            thumbnail_blob_id: None,
            waveform_blob_id: None,
            title: metadata_result.title.unwrap_or_else(|| {
                original_filename
                    .and_then(|f| Path::new(f).file_stem())
                    .and_then(|s| s.to_str())
                    .unwrap_or("Unknown Title")
                    .to_string()
            }),
            artist: metadata_result.artist,
            album: metadata_result.album,
            album_artist: metadata_result.album_artist,
            track_number: metadata_result.track_number.map(|n| n as i32),
            disc_number: metadata_result.disc_number.map(|n| n as i32),
            duration: metadata_result.duration_seconds.map(|d| {
                // Convert seconds to PgInterval
                sqlx::postgres::types::PgInterval {
                    months: 0,
                    days: 0,
                    microseconds: (d as i64) * 1_000_000,
                }
            }),
            genre: metadata_result.genre,
            year: metadata_result.year.map(|y| y as i32),
            bpm: None,
            key_signature: None,
            rating: None,
            is_favorite: Some(false),
            tags: None,
            metadata: Some(serde_json::json!({
                "file_size_bytes": metadata_result.file_size_bytes,
                "original_filename": original_filename,
                "file_path": job.file_path
            })),
        };

        let song = music_repo.create_song(song_params).await?;

        info!(
            job_id = %job.id,
            song_id = %song.id,
            title = %song.title,
            "Successfully created song from music job"
        );

        Ok(song.id)
    }

    /// Get queue statistics
    pub async fn get_queue_stats(&self) -> Result<QueueStats, MusicJobQueueError> {
        // Get database stats
        let db_stats = sqlx::query!(
            r#"
            SELECT
                COUNT(*) as total_jobs,
                COUNT(*) FILTER (WHERE status = 'pending') as pending_jobs,
                COUNT(*) FILTER (WHERE status = 'in_progress') as in_progress_jobs,
                COUNT(*) FILTER (WHERE status = 'completed') as completed_jobs,
                COUNT(*) FILTER (WHERE status = 'failed') as failed_jobs,
                CASE
                    WHEN COUNT(*) > 0 THEN
                        COUNT(*) FILTER (WHERE status = 'completed')::float / COUNT(*)::float * 100.0
                    ELSE 0.0
                END as success_rate
            FROM music_jobs
            WHERE created_at > NOW() - INTERVAL '24 hours'
            "#
        )
        .fetch_one(self.db.pool())
        .await
        .map_err(|e| MusicJobQueueError::DatabaseError(e.to_string()))?;

        let worker_stats = self.stats.read().await.clone();

        Ok(QueueStats {
            total_jobs: db_stats.total_jobs.unwrap_or(0),
            pending_jobs: db_stats.pending_jobs.unwrap_or(0),
            in_progress_jobs: db_stats.in_progress_jobs.unwrap_or(0),
            completed_jobs: db_stats.completed_jobs.unwrap_or(0),
            failed_jobs: db_stats.failed_jobs.unwrap_or(0),
            success_rate: db_stats.success_rate.unwrap_or(0.0),
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
}

impl Drop for MusicJobQueue {
    fn drop(&mut self) {
        // Send shutdown signal if workers are running
        if let Some(shutdown_tx) = &self.shutdown_tx {
            let _ = shutdown_tx.send(());
        }
    }
}
