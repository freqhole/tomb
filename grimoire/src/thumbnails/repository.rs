use super::models::{
    CropStrategy, MediaBlobInfo, ThumbnailDimensions, ThumbnailError, ThumbnailJob,
    ThumbnailJobMetrics, ThumbnailJobPriority, ThumbnailJobStatus, ThumbnailJobType,
    ThumbnailResult,
};
use crate::DatabaseConnection;

use sha2::{Digest, Sha256};
use sqlx::Row;
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
        // Map ThumbnailJobStatus to the status column
        let status = match job.status {
            ThumbnailJobStatus::Pending => "pending",
            ThumbnailJobStatus::InProgress => "in_progress",
            ThumbnailJobStatus::Completed => "completed",
            ThumbnailJobStatus::Failed => "failed",
            ThumbnailJobStatus::FailedPermanently => "failed_permanently",
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
        let (target_width, target_height) = if let Some(ref dims) = job.target_dimensions {
            (Some(dims.width as i32), Some(dims.height as i32))
        } else {
            (None, None)
        };

        // Store any additional metadata as JSONB for extensibility
        let metadata = if let Some(ref error_msg) = job.error_message {
            serde_json::json!({
                "error_message": error_msg,
                "original_job": serde_json::to_value(job)?
            })
        } else {
            serde_json::json!({
                "original_job": serde_json::to_value(job)?
            })
        };

        sqlx::query(
            r#"
            INSERT INTO thumbnail_jobs (
                id, media_blob_id, job_type, status, priority,
                target_width, target_height, scheduled_at, retry_count,
                max_retries, error_message, metadata, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            "#,
        )
        .bind(job.id)
        .bind(job.media_blob_id)
        .bind(job.job_type.to_string())
        .bind(status)
        .bind(priority)
        .bind(target_width)
        .bind(target_height)
        .bind(job.scheduled_at)
        .bind(job.retry_count)
        .bind(job.max_retries)
        .bind(job.error_message.clone())
        .bind(metadata)
        .bind(job.created_at)
        .bind(job.updated_at)
        .execute(self.db.pool())
        .await?;

        Ok(())
    }

    /// Get a thumbnail job by ID
    pub async fn get_job(&self, job_id: Uuid) -> Result<Option<ThumbnailJob>, ThumbnailError> {
        let row = sqlx::query!(
            r#"
            SELECT id, metadata, status, job_type, scheduled_at, retry_count, created_at, updated_at
            FROM thumbnail_jobs
            WHERE id = $1
            "#,
            job_id
        )
        .fetch_optional(self.db.pool())
        .await?;

        if let Some(row) = row {
            // For now, try to deserialize from metadata, but could be enhanced to use columns
            let job: ThumbnailJob = serde_json::from_value(row.metadata.unwrap_or_default())?;
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
            job.error_message = error_message.clone();
            job.worker_id = worker_id.clone();
            job.updated_at = OffsetDateTime::now_utc();

            let metadata = serde_json::to_value(job)?;
            let status_str = match status {
                ThumbnailJobStatus::Pending => "pending",
                ThumbnailJobStatus::InProgress => "in_progress",
                ThumbnailJobStatus::Completed => "completed",
                ThumbnailJobStatus::Failed => "failed",
                ThumbnailJobStatus::FailedPermanently => "failed_permanently",
                ThumbnailJobStatus::Cancelled => "cancelled",
            };

            sqlx::query!(
                r#"
                UPDATE thumbnail_jobs
                SET metadata = $1, status = $2, updated_at = $3, error_message = $4, worker_id = $5
                WHERE id = $6
                "#,
                metadata,
                status_str,
                time::OffsetDateTime::now_utc(),
                error_message,
                worker_id,
                job_id
            )
            .execute(self.db.pool())
            .await?;
        }

        Ok(())
    }

    /// Get pending jobs ready for processing using atomic claiming
    pub async fn get_pending_jobs(&self, limit: i32) -> Result<Vec<ThumbnailJob>, ThumbnailError> {
        // Generate a worker ID for atomic claiming
        let worker_id = format!("worker_{}", uuid::Uuid::new_v4());

        let rows = sqlx::query!(
            r#"
            SELECT id, media_blob_id, job_type, target_width, target_height, retry_count, max_retries, metadata, created_at, scheduled_at
            FROM claim_thumbnail_jobs($1, $2)
            "#,
            worker_id,
            limit
        )
        .fetch_all(self.db.pool())
        .await?;

        let mut jobs = Vec::new();
        for row in rows {
            let job = ThumbnailJob {
                id: row.id.unwrap(),
                media_blob_id: row.media_blob_id.unwrap(),
                job_type: ThumbnailJobType::from_str(&row.job_type.unwrap())?,
                target_dimensions: if let (Some(width), Some(height)) =
                    (row.target_width, row.target_height)
                {
                    Some(ThumbnailDimensions {
                        width: width as u32,
                        height: height as u32,
                        crop_strategy: CropStrategy::Fit,
                        maintain_aspect_ratio: true,
                    })
                } else {
                    None
                },
                status: ThumbnailJobStatus::InProgress, // Already claimed as in_progress
                priority: ThumbnailJobPriority::Normal, // Will be enhanced in future
                created_at: row.created_at.unwrap(),
                updated_at: time::OffsetDateTime::now_utc(),
                scheduled_at: row.scheduled_at.unwrap(),
                retry_count: row.retry_count.unwrap(),
                max_retries: row.max_retries.unwrap(),
                error_message: None,
                worker_id: Some(worker_id.clone()),
                metadata: row.metadata,
            };
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
            SELECT job_exists_for_blob($1, $2)
            "#,
            blob_id,
            job_type.to_string()
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
                COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_jobs,
                COUNT(CASE WHEN status = 'in_progress' THEN 1 END) as in_progress_jobs,
                COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_jobs,
                COUNT(CASE WHEN status = 'failed' OR status = 'failed_permanently' THEN 1 END) as failed_jobs
            FROM thumbnail_jobs
            WHERE job_type LIKE '%thumbnail%' OR job_type LIKE '%waveform%'
            "#
        )
        .fetch_one(self.db.pool())
        .await?;

        // Get performance metrics from job execution log
        let perf_row = sqlx::query!(
            r#"
            SELECT
                AVG(jel.duration_ms)::FLOAT as avg_processing_time_ms,
                COUNT(jel.id) as total_executions
            FROM thumbnail_jobs tj
            LEFT JOIN job_execution_log jel ON tj.id = jel.job_id
            WHERE jel.completed_at IS NOT NULL
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
            average_processing_time_ms: perf_row.avg_processing_time_ms.unwrap_or(0.0),
            success_rate: 0.0, // Will be calculated from total_executions if needed
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
            WHERE (job_type LIKE '%thumbnail%' OR job_type LIKE '%waveform%')
            AND status IN ('completed', 'failed_permanently', 'cancelled')
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
                status = 'pending',
                retry_count = retry_count + 1,
                scheduled_at = NOW(),
                updated_at = NOW(),
                worker_id = NULL,
                started_at = NULL,
                error_message = NULL
            WHERE (job_type LIKE '%thumbnail%' OR job_type LIKE '%waveform%')
            AND status = 'failed'
            AND retry_count < $1
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
        let _state = match status {
            ThumbnailJobStatus::Pending => "new",
            ThumbnailJobStatus::InProgress => "in_progress",
            ThumbnailJobStatus::Completed => "finished",
            ThumbnailJobStatus::Failed => "failed",
            ThumbnailJobStatus::FailedPermanently => "failed",
            ThumbnailJobStatus::Cancelled => "failed",
        };

        let rows = sqlx::query!(
            r#"
            SELECT id, metadata, status, job_type, scheduled_at, retry_count, created_at, updated_at
            FROM thumbnail_jobs
            WHERE status = $1
            AND (job_type LIKE '%thumbnail%' OR job_type LIKE '%waveform%')
            ORDER BY scheduled_at ASC
            LIMIT $2
            "#,
            status.to_string(),
            limit as i64
        )
        .fetch_all(self.db.pool())
        .await?;

        let mut jobs = Vec::new();
        for row in rows {
            let job: ThumbnailJob = serde_json::from_value(row.metadata.unwrap_or_default())?;
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

    /// Find duplicate thumbnails grouped by parent blob and type
    pub async fn find_duplicate_thumbnails(
        &self,
    ) -> Result<Vec<DuplicateGroupRow>, ThumbnailError> {
        let rows = sqlx::query(
            r#"
            SELECT
                parent_blob_id,
                blob_type,
                COUNT(*) as duplicate_count,
                ARRAY_AGG(id ORDER BY created_at ASC) as thumbnail_ids
            FROM media_blobs
            WHERE blob_type IN ('thumbnail', 'preview', 'waveform')
            AND parent_blob_id IS NOT NULL
            GROUP BY parent_blob_id, blob_type
            HAVING COUNT(*) > 1
            ORDER BY duplicate_count DESC
            "#,
        )
        .fetch_all(self.db.pool())
        .await?;

        let mut duplicate_groups = Vec::new();
        for row in rows {
            let parent_blob_id: Option<Uuid> = row.get("parent_blob_id");
            let blob_type: String = row.get("blob_type");
            let duplicate_count: Option<i64> = row.get("duplicate_count");
            let thumbnail_ids: Option<Vec<Uuid>> = row.get("thumbnail_ids");

            if let (Some(parent_blob_id), Some(duplicate_count), Some(thumbnail_ids)) =
                (parent_blob_id, duplicate_count, thumbnail_ids)
            {
                duplicate_groups.push(DuplicateGroupRow {
                    parent_blob_id,
                    blob_type,
                    duplicate_count: duplicate_count as usize,
                    thumbnail_ids,
                });
            }
        }

        Ok(duplicate_groups)
    }

    /// Delete thumbnails by their IDs
    pub async fn delete_thumbnails_by_ids(&self, ids: &[Uuid]) -> Result<u64, ThumbnailError> {
        if ids.is_empty() {
            return Ok(0);
        }

        let delete_result = sqlx::query("DELETE FROM media_blobs WHERE id = ANY($1)")
            .bind(ids)
            .execute(self.db.pool())
            .await?;

        Ok(delete_result.rows_affected())
    }
}

/// Raw data from duplicate thumbnails query
#[derive(Debug)]
pub struct DuplicateGroupRow {
    pub parent_blob_id: Uuid,
    pub blob_type: String,
    pub duplicate_count: usize,
    pub thumbnail_ids: Vec<Uuid>,
}
