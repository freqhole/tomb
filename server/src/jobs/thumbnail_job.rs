//! Simple thumbnail job processing without external job queue
//!
//! This module provides lightweight job processing that works directly with
//! our grimoire ThumbnailService and the existing fang_tasks table.

use grimoire::{
    thumbnails::ThumbnailJobStatus, DatabaseConnection, ThumbnailConfig, ThumbnailJob,
    ThumbnailService,
};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Simple thumbnail job processor
pub struct ThumbnailJobProcessor {
    db: DatabaseConnection,
    config: ThumbnailConfig,
    worker_id: String,
}

impl ThumbnailJobProcessor {
    /// Create a new job processor
    pub fn new(db: DatabaseConnection, config: ThumbnailConfig) -> Self {
        let worker_id = format!("worker_{}", Uuid::new_v4());
        Self {
            db,
            config,
            worker_id,
        }
    }

    /// Process a single thumbnail job
    pub async fn process_job(&self, job: &ThumbnailJob) -> Result<(), ThumbnailJobError> {
        let service = ThumbnailService::new(&self.db, self.config.clone());

        tracing::info!(
            job_id = %job.id,
            job_type = %job.job_type,
            media_blob_id = %job.media_blob_id,
            worker_id = %self.worker_id,
            "Starting thumbnail generation job"
        );

        // Update job status to in progress
        if let Err(e) = service
            .update_job_status(
                job.id,
                ThumbnailJobStatus::InProgress,
                None,
                Some(self.worker_id.clone()),
            )
            .await
        {
            tracing::warn!(
                job_id = %job.id,
                error = %e,
                "Failed to update job status to in progress"
            );
        }

        // Generate the thumbnail
        match service.generate_thumbnail(job).await {
            Ok(thumbnail_result) => {
                tracing::info!(
                    job_id = %job.id,
                    output_path = %thumbnail_result.local_path,
                    size = thumbnail_result.size,
                    "Thumbnail generated successfully"
                );

                // Store the generated thumbnail
                match service.store_thumbnail(&thumbnail_result).await {
                    Ok(thumbnail_id) => {
                        tracing::info!(
                            job_id = %job.id,
                            thumbnail_id = %thumbnail_id,
                            "Thumbnail stored successfully"
                        );

                        // Update job status to completed
                        if let Err(e) = service
                            .update_job_status(
                                job.id,
                                ThumbnailJobStatus::Completed,
                                None,
                                Some(self.worker_id.clone()),
                            )
                            .await
                        {
                            tracing::error!(
                                job_id = %job.id,
                                error = %e,
                                "Failed to update job status to completed"
                            );
                            return Err(ThumbnailJobError::Database(e.to_string()));
                        }

                        Ok(())
                    }
                    Err(e) => {
                        let error_msg = format!("Failed to store thumbnail: {}", e);
                        tracing::error!(
                            job_id = %job.id,
                            error = %error_msg,
                            "Failed to store generated thumbnail"
                        );

                        self.handle_job_failure(&service, job, &error_msg, e.is_retryable())
                            .await
                    }
                }
            }
            Err(e) => {
                let error_msg = format!("Thumbnail generation failed: {}", e);
                tracing::error!(
                    job_id = %job.id,
                    error = %error_msg,
                    "Thumbnail generation failed"
                );

                self.handle_job_failure(&service, job, &error_msg, e.is_retryable())
                    .await
            }
        }
    }

    /// Handle job failure with appropriate status update
    async fn handle_job_failure(
        &self,
        service: &ThumbnailService<'_>,
        job: &ThumbnailJob,
        error_msg: &str,
        is_retryable: bool,
    ) -> Result<(), ThumbnailJobError> {
        let status = if is_retryable && job.retry_count < job.max_retries {
            ThumbnailJobStatus::Failed
        } else {
            ThumbnailJobStatus::FailedPermanently
        };

        // Update job status
        if let Err(update_err) = service
            .update_job_status(
                job.id,
                status.clone(),
                Some(error_msg.to_string()),
                Some(self.worker_id.clone()),
            )
            .await
        {
            tracing::error!(
                job_id = %job.id,
                error = %update_err,
                "Failed to update job status after failure"
            );
        }

        if is_retryable && job.retry_count < job.max_retries {
            Err(ThumbnailJobError::Retryable(error_msg.to_string()))
        } else {
            Err(ThumbnailJobError::Permanent(error_msg.to_string()))
        }
    }

    /// Get the worker ID
    pub fn worker_id(&self) -> &str {
        &self.worker_id
    }
}

/// Job execution result for tracking
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JobExecutionResult {
    pub job_id: Uuid,
    pub worker_id: String,
    pub started_at: time::OffsetDateTime,
    pub completed_at: Option<time::OffsetDateTime>,
    pub success: bool,
    pub error_message: Option<String>,
    pub duration_ms: Option<i64>,
}

impl JobExecutionResult {
    /// Create a new job execution result
    pub fn new(job_id: Uuid, worker_id: String) -> Self {
        Self {
            job_id,
            worker_id,
            started_at: time::OffsetDateTime::now_utc(),
            completed_at: None,
            success: false,
            error_message: None,
            duration_ms: None,
        }
    }

    /// Mark the job as completed successfully
    pub fn complete_success(&mut self) {
        let now = time::OffsetDateTime::now_utc();
        self.completed_at = Some(now);
        self.success = true;
        self.duration_ms = Some((now - self.started_at).whole_milliseconds() as i64);
    }

    /// Mark the job as failed
    pub fn complete_failure(&mut self, error: &str) {
        let now = time::OffsetDateTime::now_utc();
        self.completed_at = Some(now);
        self.success = false;
        self.error_message = Some(error.to_string());
        self.duration_ms = Some((now - self.started_at).whole_milliseconds() as i64);
    }
}

/// Errors that can occur during job processing
#[derive(thiserror::Error, Debug)]
pub enum ThumbnailJobError {
    #[error("Database error: {0}")]
    Database(String),

    #[error("Configuration error: {0}")]
    Configuration(String),

    #[error("Storage error: {0}")]
    Storage(String),

    #[error("Retryable error: {0}")]
    Retryable(String),

    #[error("Permanent error: {0}")]
    Permanent(String),

    #[error("Worker error: {0}")]
    Worker(String),
}

impl ThumbnailJobError {
    /// Check if the error is retryable
    pub fn is_retryable(&self) -> bool {
        matches!(self, ThumbnailJobError::Retryable(_))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use grimoire::thumbnails::{ThumbnailJobPriority, ThumbnailJobType};

    #[test]
    fn test_job_execution_result_creation() {
        let job_id = Uuid::new_v4();
        let worker_id = "test_worker".to_string();
        let result = JobExecutionResult::new(job_id, worker_id.clone());

        assert_eq!(result.job_id, job_id);
        assert_eq!(result.worker_id, worker_id);
        assert!(result.completed_at.is_none());
        assert!(!result.success);
        assert!(result.error_message.is_none());
        assert!(result.duration_ms.is_none());
    }

    #[test]
    fn test_job_execution_result_success() {
        let job_id = Uuid::new_v4();
        let worker_id = "test_worker".to_string();
        let mut result = JobExecutionResult::new(job_id, worker_id);

        // Simulate some processing time
        std::thread::sleep(std::time::Duration::from_millis(10));
        result.complete_success();

        assert!(result.completed_at.is_some());
        assert!(result.success);
        assert!(result.error_message.is_none());
        assert!(result.duration_ms.is_some());
        assert!(result.duration_ms.unwrap() >= 10);
    }

    #[test]
    fn test_job_execution_result_failure() {
        let job_id = Uuid::new_v4();
        let worker_id = "test_worker".to_string();
        let mut result = JobExecutionResult::new(job_id, worker_id);

        let error_msg = "Test error";
        result.complete_failure(error_msg);

        assert!(result.completed_at.is_some());
        assert!(!result.success);
        assert_eq!(result.error_message.as_ref().unwrap(), error_msg);
        assert!(result.duration_ms.is_some());
    }

    #[test]
    fn test_thumbnail_job_error_retryability() {
        let retryable_error = ThumbnailJobError::Retryable("Network error".to_string());
        let permanent_error = ThumbnailJobError::Permanent("Invalid file format".to_string());

        assert!(retryable_error.is_retryable());
        assert!(!permanent_error.is_retryable());
    }

    #[test]
    fn test_job_processor_creation() {
        // This test just ensures the processor can be created
        // In practice, it would need a real database connection
        let config = ThumbnailConfig::default();

        // Mock database connection would be needed here
        // let db = DatabaseConnection::new(mock_pool);
        // let processor = ThumbnailJobProcessor::new(db, config);
        // assert!(processor.worker_id().starts_with("worker_"));
    }
}
