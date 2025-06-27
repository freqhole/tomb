use super::models::{
    MediaBlobInfo, ThumbnailError, ThumbnailJob, ThumbnailJobMetrics, ThumbnailJobPriority,
    ThumbnailJobStatus, ThumbnailJobType, ThumbnailResult,
};
use crate::DatabaseConnection;

use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;
use time::OffsetDateTime;
use uuid::Uuid;

/// Repository for thumbnail-related database operations
pub struct ThumbnailRepository<'a> {
    db: &'a DatabaseConnection,
}

impl<'a> ThumbnailRepository<'a> {
    /// Create a new ThumbnailRepository
    pub fn new(db: &'a DatabaseConnection) -> Self {
        Self { db }
    }

    /// Create a new thumbnail job in the job queue
    pub async fn enqueue_job(&self, job: &ThumbnailJob) -> Result<(), ThumbnailError> {
        // Insert into thumbnail_jobs table for job queue processing
        let metadata = serde_json::to_value(job)?;

        // Map ThumbnailJobStatus to the status column
        let status = match job.status {
            ThumbnailJobStatus::Pending => "pending",
            ThumbnailJobStatus::InProgress => "processing",
            ThumbnailJobStatus::Completed => "completed",
            ThumbnailJobStatus::Failed => "failed",
            ThumbnailJobStatus::FailedPermanently => "failed",
            ThumbnailJobStatus::Cancelled => "cancelled",
        };

        // Map ThumbnailJobPriority to the priority column
        let priority = match job.priority {
            ThumbnailJobPriority::Low => "low",
            ThumbnailJobPriority::Normal => "normal",
            ThumbnailJobPriority::High => "high",
            ThumbnailJobPriority::Critical => "critical",
        };

        // Extract dimensions if available
        let (width, height) = if let Some(ref dims) = job.target_dimensions {
            (Some(dims.width as i32), Some(dims.height as i32))
        } else {
            (None, None)
        };

        sqlx::query(
            r#"
            INSERT INTO thumbnail_jobs (
                id, media_blob_id, status, priority, width, height,
                metadata, state, task_type, scheduled_at, retries,
                created_at, updated_at, error_message
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            "#,
        )
        .bind(job.id)
        .bind(job.media_blob_id)
        .bind(status)
        .bind(priority)
        .bind(width)
        .bind(height)
        .bind(metadata)
        .bind("new")
        .bind(job.job_type.to_string())
        .bind(job.scheduled_at)
        .bind(job.retry_count)
        .bind(job.created_at)
        .bind(job.updated_at)
        .bind(job.error_message.clone())
        .execute(self.db.pool())
        .await?;

        Ok(())
    }

    /// Get a thumbnail job by ID
    pub async fn get_job(&self, job_id: Uuid) -> Result<Option<ThumbnailJob>, ThumbnailError> {
        let row = sqlx::query!(
            r#"
            SELECT id, metadata, state, task_type, scheduled_at, retries, created_at, updated_at
            FROM thumbnail_jobs
            WHERE id = $1 AND task_type LIKE '%thumbnail%' OR task_type LIKE '%waveform%'
            "#,
            job_id
        )
        .fetch_optional(self.db.pool())
        .await?;

        if let Some(row) = row {
            let job: ThumbnailJob = serde_json::from_value(row.metadata)?;
            Ok(Some(job))
        } else {
            Ok(None)
        }
    }

    /// Update job status and metadata
    pub async fn update_job_status(
        &self,
        job_id: Uuid,
        status: ThumbnailJobStatus,
        error_message: Option<String>,
        worker_id: Option<String>,
    ) -> Result<(), ThumbnailError> {
        // First get the current job to update the metadata
        if let Some(mut job) = self.get_job(job_id).await? {
            job.status = status.clone();
            job.error_message = error_message;
            job.worker_id = worker_id;
            job.updated_at = OffsetDateTime::now_utc();

            let metadata = serde_json::to_value(job)?;
            let state = match status {
                ThumbnailJobStatus::Pending => "new",
                ThumbnailJobStatus::InProgress => "running",
                ThumbnailJobStatus::Completed => "finished",
                ThumbnailJobStatus::Failed => "failed",
                ThumbnailJobStatus::FailedPermanently => "failed",
                ThumbnailJobStatus::Cancelled => "cancelled",
            };

            sqlx::query!(
                r#"
                UPDATE thumbnail_jobs
                SET metadata = $1, state = $2, updated_at = $3
                WHERE id = $4
                "#,
                metadata,
                state,
                OffsetDateTime::now_utc(),
                job_id
            )
            .execute(self.db.pool())
            .await?;
        }

        Ok(())
    }

    /// Get pending jobs ready for processing
    pub async fn get_pending_jobs(&self, limit: i32) -> Result<Vec<ThumbnailJob>, ThumbnailError> {
        let rows = sqlx::query!(
            r#"
            SELECT id, metadata, state, task_type, scheduled_at, retries, created_at, updated_at
            FROM thumbnail_jobs
            WHERE state = 'new' OR state = 'retried'
            AND (task_type LIKE '%thumbnail%' OR task_type LIKE '%waveform%')
            AND scheduled_at <= NOW()
            ORDER BY scheduled_at ASC
            LIMIT $1
            "#,
            limit as i64
        )
        .fetch_all(self.db.pool())
        .await?;

        let mut jobs = Vec::new();
        for row in rows {
            let job: ThumbnailJob = serde_json::from_value(row.metadata)?;
            jobs.push(job);
        }

        Ok(jobs)
    }

    /// Get media blob information for thumbnail generation
    pub async fn get_media_blob_info(
        &self,
        blob_id: Uuid,
    ) -> Result<Option<MediaBlobInfo>, ThumbnailError> {
        let row = sqlx::query!(
            r#"
            SELECT id, local_path, data, mime, size, metadata
            FROM media_blobs
            WHERE id = $1 AND deleted_at IS NULL AND blob_type = 'original'
            "#,
            blob_id
        )
        .fetch_optional(self.db.pool())
        .await?;

        if let Some(row) = row {
            Ok(Some(MediaBlobInfo {
                id: row.id,
                local_path: row.local_path,
                data: row.data,
                mime_type: row.mime.unwrap_or_default(),
                size: row.size.unwrap_or(0),
                metadata: row.metadata,
            }))
        } else {
            Ok(None)
        }
    }

    /// Store generated thumbnail as a new media blob
    pub async fn store_thumbnail(
        &self,
        thumbnail: &ThumbnailResult,
    ) -> Result<Uuid, ThumbnailError> {
        let thumbnail_id = Uuid::new_v4();

        // Calculate SHA256 hash of the thumbnail file
        let sha256_hash = self.calculate_file_hash(&thumbnail.local_path)?;

        // Read the thumbnail file data
        let thumbnail_data =
            std::fs::read(&thumbnail.local_path).map_err(|e| ThumbnailError::Io(e))?;

        sqlx::query!(
            r#"
            INSERT INTO media_blobs (
                id, data, parent_blob_id, blob_type, local_path, mime, size, sha256, source_client_id, metadata, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
            "#,
            thumbnail_id,
            thumbnail_data,
            thumbnail.media_blob_id,
            thumbnail.blob_type,
            thumbnail.local_path,
            thumbnail.mime_type,
            thumbnail.size,
            sha256_hash,
            "thumbnail-generator",
            thumbnail.metadata
        )
        .execute(self.db.pool())
        .await?;

        Ok(thumbnail_id)
    }

    /// Calculate SHA256 hash of a file
    fn calculate_file_hash(&self, file_path: &str) -> Result<String, ThumbnailError> {
        let mut file = File::open(file_path).map_err(|e| ThumbnailError::Io(e))?;

        let mut hasher = Sha256::new();
        let mut buffer = [0; 8192];

        loop {
            let bytes_read = file.read(&mut buffer).map_err(|e| ThumbnailError::Io(e))?;

            if bytes_read == 0 {
                break;
            }

            hasher.update(&buffer[..bytes_read]);
        }

        Ok(format!("{:x}", hasher.finalize()))
    }

    /// Get existing thumbnails for a media blob
    pub async fn get_thumbnails_for_blob(
        &self,
        blob_id: Uuid,
    ) -> Result<Vec<MediaBlobInfo>, ThumbnailError> {
        let rows = sqlx::query!(
            r#"
            SELECT id, local_path, data, mime, size, metadata
            FROM media_blobs
            WHERE parent_blob_id = $1 AND deleted_at IS NULL
            AND blob_type IN ('thumbnail', 'waveform', 'preview')
            ORDER BY created_at DESC
            "#,
            blob_id
        )
        .fetch_all(self.db.pool())
        .await?;

        let mut thumbnails = Vec::new();
        for row in rows {
            thumbnails.push(MediaBlobInfo {
                id: row.id,
                local_path: row.local_path,
                data: row.data,
                mime_type: row.mime.unwrap_or_default(),
                size: row.size.unwrap_or(0),
                metadata: row.metadata,
            });
        }

        Ok(thumbnails)
    }

    /// Check if thumbnail generation job already exists for a media blob
    pub async fn job_exists_for_blob(
        &self,
        blob_id: Uuid,
        job_type: &ThumbnailJobType,
    ) -> Result<bool, ThumbnailError> {
        let exists = sqlx::query_scalar!(
            r#"
            SELECT EXISTS(
                SELECT 1 FROM thumbnail_jobs
                WHERE task_type = $1
                AND state IN ('new', 'in_progress', 'retried', 'finished')
                AND media_blob_id = $2
            )
            "#,
            job_type.to_string(),
            blob_id
        )
        .fetch_one(self.db.pool())
        .await?;

        Ok(exists.unwrap_or(false))
    }

    /// Get job metrics for monitoring
    pub async fn get_job_metrics(&self) -> Result<ThumbnailJobMetrics, ThumbnailError> {
        // Get overall metrics
        let summary_row = sqlx::query!(
            r#"
            SELECT
                COUNT(*) as total_jobs,
                COUNT(CASE WHEN state = 'new' OR state = 'retried' THEN 1 END) as pending_jobs,
                COUNT(CASE WHEN state = 'in_progress' THEN 1 END) as in_progress_jobs,
                COUNT(CASE WHEN state = 'finished' THEN 1 END) as completed_jobs,
                COUNT(CASE WHEN state = 'failed' THEN 1 END) as failed_jobs
            FROM thumbnail_jobs
            WHERE task_type LIKE '%thumbnail%' OR task_type LIKE '%waveform%'
            "#
        )
        .fetch_one(self.db.pool())
        .await?;

        // Get performance metrics from job execution log
        let perf_row = sqlx::query!(
            r#"
            SELECT
                AVG(jel.duration_ms)::FLOAT as avg_processing_time,
                (COUNT(*) FILTER (WHERE jel.success = true) * 100.0 / COUNT(*))::FLOAT as success_rate
            FROM thumbnail_jobs ft
            LEFT JOIN job_execution_log jel ON ft.id = jel.task_id
            WHERE (ft.task_type LIKE '%thumbnail%' OR ft.task_type LIKE '%waveform%')
            AND jel.completed_at IS NOT NULL
            "#
        )
        .fetch_one(self.db.pool())
        .await?;

        Ok(ThumbnailJobMetrics {
            total_jobs: summary_row.total_jobs.unwrap_or(0),
            pending_jobs: summary_row.pending_jobs.unwrap_or(0),
            in_progress_jobs: summary_row.in_progress_jobs.unwrap_or(0),
            completed_jobs: summary_row.completed_jobs.unwrap_or(0),
            failed_jobs: summary_row.failed_jobs.unwrap_or(0),
            average_processing_time_ms: perf_row.avg_processing_time.unwrap_or(0.0),
            success_rate: perf_row.success_rate.unwrap_or(0.0),
            jobs_by_type: Vec::new(), // TODO: Implement detailed type metrics
        })
    }

    /// Clean up old completed jobs
    pub async fn cleanup_old_jobs(
        &self,
        older_than: OffsetDateTime,
    ) -> Result<u64, ThumbnailError> {
        let result = sqlx::query!(
            r#"
            DELETE FROM thumbnail_jobs
            WHERE (task_type LIKE '%thumbnail%' OR task_type LIKE '%waveform%')
            AND state IN ('finished', 'failed')
            AND updated_at < $1
            "#,
            older_than
        )
        .execute(self.db.pool())
        .await?;

        Ok(result.rows_affected())
    }

    /// Retry failed jobs
    pub async fn retry_failed_jobs(&self, max_retries: i32) -> Result<u64, ThumbnailError> {
        let result = sqlx::query!(
            r#"
            UPDATE thumbnail_jobs
            SET
                state = 'retried',
                retries = retries + 1,
                scheduled_at = NOW(),
                updated_at = NOW()
            WHERE (task_type LIKE '%thumbnail%' OR task_type LIKE '%waveform%')
            AND state = 'failed'
            AND retries < $1
            "#,
            max_retries
        )
        .execute(self.db.pool())
        .await?;

        Ok(result.rows_affected())
    }

    /// Get jobs by status
    pub async fn get_jobs_by_status(
        &self,
        status: ThumbnailJobStatus,
        limit: i32,
    ) -> Result<Vec<ThumbnailJob>, ThumbnailError> {
        let state = match status {
            ThumbnailJobStatus::Pending => "new",
            ThumbnailJobStatus::InProgress => "in_progress",
            ThumbnailJobStatus::Completed => "finished",
            ThumbnailJobStatus::Failed => "failed",
            ThumbnailJobStatus::FailedPermanently => "failed",
            ThumbnailJobStatus::Cancelled => "failed",
        };

        let rows = sqlx::query!(
            r#"
            SELECT id, metadata, state, task_type, scheduled_at, retries, created_at, updated_at
            FROM thumbnail_jobs
            WHERE state = $1
            AND (task_type LIKE '%thumbnail%' OR task_type LIKE '%waveform%')
            ORDER BY updated_at DESC
            LIMIT $2
            "#,
            state,
            limit as i64
        )
        .fetch_all(self.db.pool())
        .await?;

        let mut jobs = Vec::new();
        for row in rows {
            let job: ThumbnailJob = serde_json::from_value(row.metadata)?;
            jobs.push(job);
        }

        Ok(jobs)
    }

    /// Delete a thumbnail blob and its file
    pub async fn delete_thumbnail(&self, thumbnail_id: Uuid) -> Result<(), ThumbnailError> {
        sqlx::query!(
            r#"
            UPDATE media_blobs
            SET deleted_at = NOW(), updated_at = NOW()
            WHERE id = $1 AND blob_type IN ('thumbnail', 'waveform', 'preview')
            "#,
            thumbnail_id
        )
        .execute(self.db.pool())
        .await?;

        Ok(())
    }
}
