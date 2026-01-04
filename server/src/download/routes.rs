//! Download routes for URL-based music downloads using yt-dlp

use crate::auth::AuthenticatedUser;
use axum::{
    extract::{Extension, Json, Path},
    response::Json as ResponseJson,
    routing::{get, post},
    Router,
};
use legacylib::DatabaseConnection;
use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// Request to download music from URLs
#[derive(Debug, Deserialize)]
pub struct DownloadUrlsRequest {
    pub urls: Vec<String>,
}

/// Response for URL download request
#[derive(Debug, Serialize)]
pub struct DownloadUrlsResponse {
    pub message: String,
    pub download_jobs: Vec<DownloadJobInfo>,
}

/// Information about a created download job
#[derive(Debug, Serialize)]
pub struct DownloadJobInfo {
    pub job_id: String,
    pub url: String,
    pub status: String,
}

/// Job status response
#[derive(Debug, Serialize)]
pub struct JobStatusResponse {
    pub job_id: String,
    pub url: String,
    pub status: String,
    pub download_path: Option<String>,
    pub error_message: Option<String>,
    pub retry_count: i32,
    pub max_retries: i32,
    pub content_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Submit URLs for download processing
pub async fn download_urls(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(request): Json<DownloadUrlsRequest>,
) -> Result<ResponseJson<DownloadUrlsResponse>, AppError> {
    // Check if user is admin
    if !user.is_admin() {
        return Err(AppError::Forbidden(
            "Admin access required for URL downloads".to_string(),
        ));
    }

    // Validate URLs
    if request.urls.is_empty() {
        return Err(AppError::BadRequest("No URLs provided".to_string()));
    }

    if request.urls.len() > 10 {
        return Err(AppError::BadRequest(
            "Too many URLs (max 10 per request)".to_string(),
        ));
    }

    let mut download_jobs = Vec::new();

    // Create download jobs for each URL
    // Jobs will handle duplicate detection internally
    for url in request.urls {
        // Basic URL validation
        if !is_valid_url(&url) {
            return Err(AppError::BadRequest(format!("Invalid URL: {}", url)));
        }

        // Create download job - duplicates will be handled by the job itself
        match super::jobs::create_download_job(&db, &url, user.user().id).await {
            Ok(job_id) => {
                download_jobs.push(DownloadJobInfo {
                    job_id,
                    url,
                    status: "queued".to_string(),
                });
            }
            Err(e) => {
                tracing::error!("Failed to create download job for {}: {}", url, e);
                return Err(AppError::InternalServerError(
                    "Failed to create download job".to_string(),
                ));
            }
        }
    }

    Ok(ResponseJson(DownloadUrlsResponse {
        message: format!("Created {} download jobs", download_jobs.len()),
        download_jobs,
    }))
}

/// Get download job status
pub async fn get_job_status(
    Extension(db): Extension<DatabaseConnection>,
    Extension(user): Extension<AuthenticatedUser>,
    Path(job_id): Path<String>,
) -> Result<ResponseJson<JobStatusResponse>, AppError> {
    // Check if user is admin
    if !user.is_admin() {
        return Err(AppError::Forbidden(
            "Admin access required for download status".to_string(),
        ));
    }

    // Parse job ID
    let job_uuid = job_id
        .parse::<uuid::Uuid>()
        .map_err(|_| AppError::BadRequest("Invalid job ID format".to_string()))?;

    // Get job status
    let job = sqlx::query!(
        r#"
        SELECT id, url, status, download_path, error_message, retry_count, max_retries, content_id, created_at, updated_at
        FROM download_jobs
        WHERE id = $1
        "#,
        job_uuid
    )
    .fetch_optional(db.pool())
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch job status: {}", e);
        AppError::InternalServerError("Failed to fetch job status".to_string())
    })?;

    match job {
        Some(job_row) => Ok(ResponseJson(JobStatusResponse {
            job_id: job_row.id.to_string(),
            url: job_row.url,
            status: job_row.status,
            download_path: job_row.download_path,
            error_message: job_row.error_message,
            retry_count: job_row.retry_count,
            max_retries: job_row.max_retries,
            content_id: job_row.content_id,
            created_at: job_row
                .created_at
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap(),
            updated_at: job_row
                .updated_at
                .format(&time::format_description::well_known::Rfc3339)
                .unwrap(),
        })),
        None => Err(AppError::NotFound("Download job not found".to_string())),
    }
}

/// Basic URL validation
fn is_valid_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

/// Create download routes
pub fn create_routes() -> Router {
    Router::new()
        .route("/download-urls", post(download_urls))
        .route("/download-jobs/:job_id", get(get_job_status))
}
