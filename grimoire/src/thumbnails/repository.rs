use super::models::{
    CropStrategy, MediaBlobInfo, ThumbnailDimensions, ThumbnailError, ThumbnailJob,
    ThumbnailJobMetrics, ThumbnailJobPriority, ThumbnailJobStatus, ThumbnailJobType,
    ThumbnailResult,
};
use crate::DatabaseConnection;

use sha2::{Digest, Sha256};
use sqlx::types::BigDecimal;
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

        // Store only extensible metadata as JSONB (no core job data)
        let metadata = serde_json::json!({});

        sqlx::query!(
            r#"
            INSERT INTO thumbnail_jobs (
                id, media_blob_id, job_type, status, priority,
                target_width, target_height, scheduled_at, retry_count,
                max_retries, error_message, metadata, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            "#,
            job.id,
            job.media_blob_id,
            job.job_type.to_string(),
            status,
            priority,
            target_width,
            target_height,
            job.scheduled_at,
            job.retry_count,
            job.max_retries,
            job.error_message.clone(),
            metadata,
            job.created_at,
            job.updated_at
        )
        .execute(self.db.pool())
        .await?;

        Ok(())
    }

    /// Get a thumbnail job by ID
    /// Get a single job by ID
    pub async fn get_job(&self, job_id: Uuid) -> Result<Option<ThumbnailJob>, ThumbnailError> {
        let row = sqlx::query!(
            r#"
            SELECT id, media_blob_id, job_type, status, target_width, target_height,
                   retry_count, max_retries, error_message, worker_id, metadata,
                   created_at, updated_at, scheduled_at, started_at, completed_at
            FROM thumbnail_jobs
            WHERE id = $1
            "#,
            job_id
        )
        .fetch_optional(self.db.pool())
        .await?;

        if let Some(row) = row {
            // Parse status from string to enum
            let status = match row.status.as_str() {
                "pending" => ThumbnailJobStatus::Pending,
                "in_progress" => ThumbnailJobStatus::InProgress,
                "completed" => ThumbnailJobStatus::Completed,
                "failed" => ThumbnailJobStatus::Failed,
                "failed_permanently" => ThumbnailJobStatus::FailedPermanently,
                "cancelled" => ThumbnailJobStatus::Cancelled,
                _ => ThumbnailJobStatus::Pending, // Default fallback
            };

            // Construct ThumbnailJob from columns
            let job = ThumbnailJob {
                id: row.id,
                media_blob_id: row.media_blob_id,
                job_type: ThumbnailJobType::from_str(&row.job_type)?,
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
                status,
                priority: ThumbnailJobPriority::Normal, // Default priority for now
                created_at: row.created_at,
                updated_at: row.updated_at,
                scheduled_at: row.scheduled_at,
                retry_count: row.retry_count,
                max_retries: row.max_retries,
                error_message: row.error_message,
                worker_id: row.worker_id,
                metadata: row.metadata,
            };
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
        let status_str = match status {
            ThumbnailJobStatus::Pending => "pending",
            ThumbnailJobStatus::InProgress => "in_progress",
            ThumbnailJobStatus::Completed => "completed",
            ThumbnailJobStatus::Failed => "failed",
            ThumbnailJobStatus::FailedPermanently => "failed_permanently",
            ThumbnailJobStatus::Cancelled => "cancelled",
        };

        // Set completed_at if job is completing
        let completed_at = if matches!(
            status,
            ThumbnailJobStatus::Completed
                | ThumbnailJobStatus::Failed
                | ThumbnailJobStatus::FailedPermanently
                | ThumbnailJobStatus::Cancelled
        ) {
            Some(time::OffsetDateTime::now_utc())
        } else {
            None
        };

        let result = sqlx::query!(
            r#"
            UPDATE thumbnail_jobs
            SET status = $1,
                updated_at = $2,
                error_message = $3,
                worker_id = $4,
                completed_at = $5
            WHERE id = $6
            "#,
            status_str,
            time::OffsetDateTime::now_utc(),
            error_message,
            worker_id,
            completed_at,
            job_id
        )
        .execute(self.db.pool())
        .await?;

        if result.rows_affected() == 0 {
            Err(ThumbnailError::JobNotFound(job_id))
        } else {
            Ok(())
        }
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
                media_blob_id: row.media_blob_id.unwrap().to_string(),
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
        blob_id: &str,
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
    ) -> Result<String, ThumbnailError> {
        // Calculate SHA256 hash of the thumbnail file
        let sha256_hash = self.calculate_file_hash(&thumbnail.local_path)?;

        // Read the thumbnail file data
        let thumbnail_data =
            std::fs::read(&thumbnail.local_path).map_err(|e| ThumbnailError::Io(e))?;

        let row = sqlx::query!(
            r#"
            INSERT INTO media_blobs (
                data, parent_blob_id, blob_type, local_path, mime, size, sha256, source_client_id, metadata, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
            RETURNING id
            "#,
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
        .fetch_one(self.db.pool())
        .await?;

        Ok(row.id)
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
        blob_id: &str,
    ) -> Result<Vec<MediaBlobInfo>, ThumbnailError> {
        let rows = sqlx::query!(
            r#"
            SELECT DISTINCT
                mb.id,
                mb.local_path,
                mb.data,
                mb.mime,
                mb.size,
                mb.metadata,
                CASE mb.blob_type
                    WHEN 'thumbnail' THEN 1
                    WHEN 'preview' THEN 2
                    WHEN 'waveform' THEN 3
                    ELSE 4
                END as priority_order,
                mb.created_at
            FROM media_blobs mb
            WHERE (
                -- Direct children (old approach)
                (mb.parent_blob_id = $1 AND mb.deleted_at IS NULL AND mb.blob_type IN ('thumbnail', 'waveform', 'preview'))
                OR
                -- Songs' thumbnail_blob_ids array (new approach)
                (mb.id = ANY(
                    SELECT unnest(s.thumbnail_blob_ids)
                    FROM songs s
                    WHERE s.media_blob_id = $1 AND s.deleted_at IS NULL
                ))
            )
            ORDER BY priority_order, mb.created_at DESC
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
        blob_id: &str,
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
        // Use optimized database function for comprehensive metrics
        let metrics_row = sqlx::query!("SELECT * FROM get_thumbnail_job_metrics()")
            .fetch_one(self.db.pool())
            .await?;

        Ok(ThumbnailJobMetrics {
            total_jobs: metrics_row.total_jobs.unwrap_or(0),
            pending_jobs: metrics_row.pending_jobs.unwrap_or(0),
            in_progress_jobs: metrics_row.in_progress_jobs.unwrap_or(0),
            completed_jobs: metrics_row.completed_jobs.unwrap_or(0),
            failed_jobs: metrics_row.failed_jobs.unwrap_or(0),
            average_processing_time_ms: metrics_row
                .avg_processing_time_ms
                .map(|d: BigDecimal| d.to_string().parse().unwrap_or(0.0))
                .unwrap_or(0.0),
            success_rate: metrics_row
                .success_rate_percent
                .map(|d: BigDecimal| d.to_string().parse().unwrap_or(0.0))
                .unwrap_or(0.0),
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
        let rows = sqlx::query!(
            r#"
            SELECT id, media_blob_id, job_type, status, target_width, target_height,
                   retry_count, max_retries, error_message, worker_id, metadata,
                   created_at, updated_at, scheduled_at, started_at, completed_at
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
            // Construct ThumbnailJob from columns instead of metadata
            let job = ThumbnailJob {
                id: row.id,
                media_blob_id: row.media_blob_id,
                job_type: ThumbnailJobType::from_str(&row.job_type)?,
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
                status: status.clone(),
                priority: ThumbnailJobPriority::Normal, // Default priority for now
                created_at: row.created_at,
                updated_at: row.updated_at,
                scheduled_at: row.scheduled_at,
                retry_count: row.retry_count,
                max_retries: row.max_retries,
                error_message: row.error_message,
                worker_id: row.worker_id,
                metadata: row.metadata,
            };
            jobs.push(job);
        }

        Ok(jobs)
    }

    /// Delete a thumbnail blob and its file
    pub async fn delete_thumbnail(&self, thumbnail_id: &str) -> Result<(), ThumbnailError> {
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
        // Use optimized database function for finding duplicates
        let rows = sqlx::query!("SELECT * FROM find_duplicate_thumbnails(100)")
            .fetch_all(self.db.pool())
            .await?;

        let duplicate_groups = rows
            .into_iter()
            .filter_map(|row| {
                if let (
                    Some(parent_blob_id),
                    Some(blob_type),
                    Some(duplicate_count),
                    Some(thumbnail_ids),
                ) = (
                    row.parent_blob_id,
                    row.blob_type,
                    row.duplicate_count,
                    row.thumbnail_ids,
                ) {
                    Some(DuplicateGroupRow {
                        parent_blob_id: parent_blob_id.to_string(),
                        blob_type,
                        duplicate_count: duplicate_count as usize,
                        thumbnail_ids: thumbnail_ids.into_iter().map(|id| id.to_string()).collect(),
                    })
                } else {
                    None
                }
            })
            .collect();

        Ok(duplicate_groups)
    }

    /// Delete thumbnails by their IDs
    pub async fn delete_thumbnails_by_ids(&self, ids: &[String]) -> Result<u64, ThumbnailError> {
        if ids.is_empty() {
            return Ok(0);
        }

        // Use safer batch delete function that validates thumbnail types
        let result = sqlx::query!("SELECT * FROM batch_delete_thumbnails($1)", ids)
            .fetch_one(self.db.pool())
            .await?;

        Ok(result.deleted_count.unwrap_or(0) as u64)
    }

    /// Get comprehensive health summary of the thumbnail system
    pub async fn get_system_health(&self) -> Result<SystemHealthSummary, ThumbnailError> {
        let health_row = sqlx::query!("SELECT * FROM get_job_health_summary()")
            .fetch_one(self.db.pool())
            .await?;

        Ok(SystemHealthSummary {
            status: health_row.system_status.unwrap_or("unknown".to_string()),
            pending_jobs_count: health_row.pending_jobs_count.unwrap_or(0),
            stuck_jobs_count: health_row.stuck_jobs_count.unwrap_or(0),
            recent_failures_count: health_row.recent_failures_count.unwrap_or(0),
            avg_queue_time_minutes: health_row
                .avg_queue_time_minutes
                .map(|d: BigDecimal| d.to_string().parse().unwrap_or(0.0))
                .unwrap_or(0.0),
            recommendations: health_row.recommendations.unwrap_or_default(),
        })
    }

    /// Cancel stale jobs that have been processing too long
    pub async fn cancel_stale_jobs(&self, timeout_minutes: i32) -> Result<u64, ThumbnailError> {
        let result = sqlx::query!(
            "SELECT cancel_stale_jobs($1) as cancelled_count",
            timeout_minutes
        )
        .fetch_one(self.db.pool())
        .await?;

        Ok(result.cancelled_count.unwrap_or(0) as u64)
    }
}

/// Health summary for the thumbnail system
#[derive(Debug, Clone)]
pub struct SystemHealthSummary {
    pub status: String,
    pub pending_jobs_count: i64,
    pub stuck_jobs_count: i64,
    pub recent_failures_count: i64,
    pub avg_queue_time_minutes: f64,
    pub recommendations: Vec<String>,
}

/// Raw data from duplicate thumbnails query
#[derive(Debug)]
pub struct DuplicateGroupRow {
    pub parent_blob_id: String,
    pub blob_type: String,
    pub duplicate_count: usize,
    pub thumbnail_ids: Vec<String>,
}
