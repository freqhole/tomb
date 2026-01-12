//! HTTP handlers for thumbnail management endpoints
//!
//! This module provides REST API endpoints for managing thumbnail generation,
//! monitoring job status, and triggering thumbnail operations manually.

use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use legacylib::{
    thumbnails::{ThumbnailJobPriority, ThumbnailJobType},
    ThumbnailService,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::startup::AppState;

/// Response for thumbnail job status
#[derive(Debug, Serialize)]
pub struct ThumbnailJobResponse {
    pub id: Uuid,
    pub media_blob_id: String,
    pub job_type: String,
    pub status: String,
    pub priority: String,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub scheduled_at: OffsetDateTime,
    pub retry_count: i32,
    pub max_retries: i32,
    pub error_message: Option<String>,
    pub worker_id: Option<String>,
}

/// Response for thumbnail job metrics
#[derive(Debug, Serialize)]
pub struct ThumbnailMetricsResponse {
    pub total_jobs: i64,
    pub pending_jobs: i64,
    pub in_progress_jobs: i64,
    pub completed_jobs: i64,
    pub failed_jobs: i64,
    pub success_rate: f64,
    pub average_processing_time_ms: f64,
    pub workers_running: bool,
    pub worker_success_count: u64,
    pub worker_failure_count: u64,
    pub worker_avg_duration_ms: f64,
    pub completion_rate: f64,
    pub failure_rate: f64,
    pub is_healthy: bool,
    pub worker_success_rate: f64,
}

/// Request for manual thumbnail generation
#[derive(Debug, Deserialize)]
pub struct TriggerThumbnailRequest {
    pub media_blob_id: String,
    pub job_type: Option<String>,
    pub priority: Option<String>,
    pub dimensions: Option<ThumbnailDimensionsRequest>,
}

/// Request for thumbnail dimensions
#[derive(Debug, Deserialize)]
pub struct ThumbnailDimensionsRequest {
    pub width: u32,
    pub height: u32,
    pub maintain_aspect_ratio: Option<bool>,
    pub crop_strategy: Option<String>,
}

/// Query parameters for job listing
#[derive(Debug, Deserialize)]
pub struct JobListQuery {
    pub status: Option<String>,
    pub limit: Option<i32>,
    pub media_blob_id: Option<String>,
}

/// Response for job triggering
#[derive(Debug, Serialize)]
pub struct TriggerResponse {
    pub message: String,
    pub job_ids: Vec<Uuid>,
}

/// Response for operation results
#[derive(Debug, Serialize)]
pub struct OperationResponse {
    pub success: bool,
    pub message: String,
    pub affected_count: Option<u64>,
}

/// Get thumbnail job metrics and queue status
#[tracing::instrument(skip(state))]
pub async fn get_thumbnail_metrics(
    State(state): State<AppState>,
) -> Result<Json<ThumbnailMetricsResponse>, StatusCode> {
    let queue = state.thumbnail_queue.lock().await;

    match queue.get_queue_stats().await {
        Ok(stats) => {
            let response = ThumbnailMetricsResponse {
                total_jobs: stats.total_jobs,
                pending_jobs: stats.pending_jobs,
                in_progress_jobs: stats.in_progress_jobs,
                completed_jobs: stats.completed_jobs,
                failed_jobs: stats.failed_jobs,
                success_rate: stats.success_rate,
                average_processing_time_ms: stats.average_processing_time_ms,
                workers_running: stats.workers_running,
                worker_success_count: stats.worker_success_count,
                worker_failure_count: stats.worker_failure_count,
                worker_avg_duration_ms: stats.worker_avg_duration_ms,
                completion_rate: stats.completion_rate(),
                failure_rate: stats.failure_rate(),
                is_healthy: stats.is_healthy(),
                worker_success_rate: stats.worker_success_rate(),
            };
            Ok(Json(response))
        }
        Err(e) => {
            tracing::error!("Failed to get thumbnail metrics: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// Get thumbnail jobs with optional filtering
#[tracing::instrument(skip(state))]
pub async fn get_thumbnail_jobs(
    State(state): State<AppState>,
    Query(query): Query<JobListQuery>,
) -> Result<Json<Vec<ThumbnailJobResponse>>, StatusCode> {
    let service = ThumbnailService::new_with_defaults(&state.database);
    let limit = query.limit.unwrap_or(50).min(100); // Cap at 100

    let jobs = if let Some(status_str) = query.status {
        // Parse status and get jobs by status
        let status = match status_str.as_str() {
            "pending" => legacylib::thumbnails::ThumbnailJobStatus::Pending,
            "in_progress" => legacylib::thumbnails::ThumbnailJobStatus::InProgress,
            "completed" => legacylib::thumbnails::ThumbnailJobStatus::Completed,
            "failed" => legacylib::thumbnails::ThumbnailJobStatus::Failed,
            "failed_permanently" => legacylib::thumbnails::ThumbnailJobStatus::FailedPermanently,
            "cancelled" => legacylib::thumbnails::ThumbnailJobStatus::Cancelled,
            _ => return Err(StatusCode::BAD_REQUEST),
        };

        match service.get_jobs_by_status(status, limit).await {
            Ok(jobs) => jobs,
            Err(e) => {
                tracing::error!("Failed to get jobs by status: {}", e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    } else {
        // Get pending jobs by default
        match service.get_pending_jobs(limit).await {
            Ok(jobs) => jobs,
            Err(e) => {
                tracing::error!("Failed to get pending jobs: {}", e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    };

    // Filter by media_blob_id if provided
    let filtered_jobs = if let Some(media_blob_id) = query.media_blob_id {
        jobs.into_iter()
            .filter(|job| job.media_blob_id == media_blob_id)
            .collect()
    } else {
        jobs
    };

    let response: Vec<ThumbnailJobResponse> = filtered_jobs
        .into_iter()
        .map(|job| ThumbnailJobResponse {
            id: job.id,
            media_blob_id: job.media_blob_id,
            job_type: job.job_type.to_string(),
            status: job.status.to_string(),
            priority: format!("{:?}", job.priority),
            created_at: job.created_at,
            updated_at: job.updated_at,
            scheduled_at: job.scheduled_at,
            retry_count: job.retry_count,
            max_retries: job.max_retries,
            error_message: job.error_message,
            worker_id: job.worker_id,
        })
        .collect();

    Ok(Json(response))
}

/// Get specific thumbnail job by ID
#[tracing::instrument(skip(state))]
pub async fn get_thumbnail_job(
    State(state): State<AppState>,
    Path(job_id): Path<Uuid>,
) -> Result<Json<ThumbnailJobResponse>, StatusCode> {
    let service = ThumbnailService::new_with_defaults(&state.database);

    // Try to get the job from pending jobs first
    match service.get_pending_jobs(1000).await {
        Ok(jobs) => {
            if let Some(job) = jobs.into_iter().find(|j| j.id == job_id) {
                let response = ThumbnailJobResponse {
                    id: job.id,
                    media_blob_id: job.media_blob_id,
                    job_type: job.job_type.to_string(),
                    status: job.status.to_string(),
                    priority: format!("{:?}", job.priority),
                    created_at: job.created_at,
                    updated_at: job.updated_at,
                    scheduled_at: job.scheduled_at,
                    retry_count: job.retry_count,
                    max_retries: job.max_retries,
                    error_message: job.error_message,
                    worker_id: job.worker_id,
                };
                return Ok(Json(response));
            }
        }
        Err(e) => {
            tracing::error!("Failed to search for job {}: {}", job_id, e);
        }
    }

    Err(StatusCode::NOT_FOUND)
}

/// Manually trigger thumbnail generation for a media blob
#[tracing::instrument(skip(state))]
pub async fn trigger_thumbnail_generation(
    State(state): State<AppState>,
    Json(request): Json<TriggerThumbnailRequest>,
) -> Result<Json<TriggerResponse>, StatusCode> {
    if !state.config.media.thumbnails.enabled {
        return Err(StatusCode::SERVICE_UNAVAILABLE);
    }

    let queue = state.thumbnail_queue.lock().await;

    let job_ids = if let Some(job_type_str) = request.job_type {
        // Parse specific job type
        let job_type = match job_type_str.as_str() {
            "image_thumbnail" => ThumbnailJobType::ImageThumbnail,
            "video_thumbnail" => ThumbnailJobType::VideoThumbnail,
            "audio_waveform" => ThumbnailJobType::AudioWaveform,
            "video_preview" => ThumbnailJobType::VideoPreview,
            _ => return Err(StatusCode::BAD_REQUEST),
        };

        // Parse priority
        let priority = if let Some(priority_str) = request.priority {
            match priority_str.as_str() {
                "low" => Some(ThumbnailJobPriority::Low),
                "normal" => Some(ThumbnailJobPriority::Normal),
                "high" => Some(ThumbnailJobPriority::High),
                "critical" => Some(ThumbnailJobPriority::Critical),
                _ => return Err(StatusCode::BAD_REQUEST),
            }
        } else {
            None
        };

        // Parse dimensions if provided
        let dimensions = if let Some(dims_req) = request.dimensions {
            use legacylib::thumbnails::{CropStrategy, ThumbnailDimensions};

            let crop_strategy = if let Some(strategy_str) = dims_req.crop_strategy {
                match strategy_str.as_str() {
                    "center" => CropStrategy::Center,
                    "top" => CropStrategy::Top,
                    "bottom" => CropStrategy::Bottom,
                    "left" => CropStrategy::Left,
                    "right" => CropStrategy::Right,
                    "fit" => CropStrategy::Fit,
                    "fill" => CropStrategy::Fill,
                    _ => return Err(StatusCode::BAD_REQUEST),
                }
            } else {
                CropStrategy::Center
            };

            Some(ThumbnailDimensions {
                width: dims_req.width,
                height: dims_req.height,
                maintain_aspect_ratio: dims_req.maintain_aspect_ratio.unwrap_or(true),
                crop_strategy,
            })
        } else {
            None
        };

        // Enqueue specific job type
        match queue
            .enqueue_thumbnail_job(&request.media_blob_id, job_type, priority, dimensions)
            .await
        {
            Ok(job_id) => vec![job_id],
            Err(e) => {
                tracing::error!("Failed to enqueue thumbnail job: {}", e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    } else {
        // Auto-enqueue appropriate jobs for the media blob
        match queue
            .auto_enqueue_for_media_blob(&request.media_blob_id)
            .await
        {
            Ok(job_ids) => job_ids,
            Err(e) => {
                tracing::error!("Failed to auto-enqueue thumbnail jobs: {}", e);
                return Err(StatusCode::INTERNAL_SERVER_ERROR);
            }
        }
    };

    let response = TriggerResponse {
        message: format!("Enqueued {} thumbnail job(s)", job_ids.len()),
        job_ids,
    };

    Ok(Json(response))
}

/// Retry failed thumbnail jobs
#[tracing::instrument(skip(state))]
pub async fn retry_failed_jobs(
    State(state): State<AppState>,
) -> Result<Json<OperationResponse>, StatusCode> {
    let queue = state.thumbnail_queue.lock().await;

    match queue.retry_failed_jobs().await {
        Ok(retried_count) => {
            let response = OperationResponse {
                success: true,
                message: format!("Retried {} failed job(s)", retried_count),
                affected_count: Some(retried_count),
            };
            Ok(Json(response))
        }
        Err(e) => {
            tracing::error!("Failed to retry failed jobs: {}", e);
            let response = OperationResponse {
                success: false,
                message: format!("Failed to retry jobs: {}", e),
                affected_count: None,
            };
            Ok(Json(response))
        }
    }
}

/// Clean up old completed thumbnail jobs
#[tracing::instrument(skip(state))]
pub async fn cleanup_old_jobs(
    State(state): State<AppState>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Json<OperationResponse>, StatusCode> {
    let days = params
        .get("days")
        .and_then(|d| d.parse::<u32>().ok())
        .unwrap_or(30); // Default to 30 days

    let queue = state.thumbnail_queue.lock().await;

    match queue.cleanup_old_jobs(days).await {
        Ok(cleaned_count) => {
            let response = OperationResponse {
                success: true,
                message: format!(
                    "Cleaned up {} job(s) older than {} days",
                    cleaned_count, days
                ),
                affected_count: Some(cleaned_count),
            };
            Ok(Json(response))
        }
        Err(e) => {
            tracing::error!("Failed to cleanup old jobs: {}", e);
            let response = OperationResponse {
                success: false,
                message: format!("Failed to cleanup jobs: {}", e),
                affected_count: None,
            };
            Ok(Json(response))
        }
    }
}

/// Build thumbnail management routes
pub fn build_thumbnail_routes() -> Router<AppState> {
    Router::new()
        .route("/metrics", get(get_thumbnail_metrics))
        .route("/jobs", get(get_thumbnail_jobs))
        .route("/jobs/{job_id}", get(get_thumbnail_job))
        .route("/generate", post(trigger_thumbnail_generation))
        .route("/retry", post(retry_failed_jobs))
        .route("/cleanup", post(cleanup_old_jobs))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_trigger_request_deserialize() {
        let json = r#"
        {
            "media_blob_id": "550e8400-e29b-41d4-a716-446655440000",
            "job_type": "image_thumbnail",
            "priority": "high",
            "dimensions": {
                "width": 300,
                "height": 300,
                "maintain_aspect_ratio": true,
                "crop_strategy": "center"
            }
        }
        "#;

        let request: TriggerThumbnailRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.job_type, Some("image_thumbnail".to_string()));
        assert_eq!(request.priority, Some("high".to_string()));
        assert!(request.dimensions.is_some());
    }

    #[test]
    fn test_minimal_trigger_request() {
        let json = r#"
        {
            "media_blob_id": "550e8400-e29b-41d4-a716-446655440000"
        }
        "#;

        let request: TriggerThumbnailRequest = serde_json::from_str(json).unwrap();
        assert!(request.job_type.is_none());
        assert!(request.priority.is_none());
        assert!(request.dimensions.is_none());
    }

    #[test]
    fn test_job_list_query_deserialize() {
        let query = JobListQuery {
            status: Some("pending".to_string()),
            limit: Some(25),
            media_blob_id: None,
        };

        assert_eq!(query.status, Some("pending".to_string()));
        assert_eq!(query.limit, Some(25));
    }
}
