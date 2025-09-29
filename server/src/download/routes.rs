//! Download routes for URL-based music downloads using yt-dlp

use crate::auth::AuthenticatedUser;
use axum::{
    extract::{Extension, Json, Path},
    response::Json as ResponseJson,
    routing::{get, post},
    Router,
};
use grimoire::DatabaseConnection;
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

/// Response for download job status request
#[derive(Debug, Serialize)]
pub struct DownloadJobStatusResponse {
    pub job_id: String,
    pub url: String,
    pub status: String,
    pub download_path: Option<String>,
    pub error_message: Option<String>,
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
    for url in request.urls {
        // Basic URL validation
        if !is_valid_url(&url) {
            return Err(AppError::BadRequest(format!("Invalid URL: {}", url)));
        }

        // Create download job
        match super::jobs::create_download_job(&db, &url).await {
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

/// Basic URL validation
fn is_valid_url(url: &str) -> bool {
    url.starts_with("http://") || url.starts_with("https://")
}

/// Get download job status by job ID
pub async fn get_download_job_status(
    Extension(db): Extension<DatabaseConnection>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(job_id): Path<String>,
) -> Result<ResponseJson<DownloadJobStatusResponse>, AppError> {
    use uuid::Uuid;

    let job_uuid = Uuid::parse_str(&job_id)
        .map_err(|_| AppError::BadRequest("Invalid job ID format".to_string()))?;

    // Query download job from database
    let job_result = sqlx::query!(
        r#"
        SELECT id, url, status, download_path, error_message, created_at, updated_at
        FROM download_jobs
        WHERE id = $1
        "#,
        job_uuid
    )
    .fetch_optional(db.pool())
    .await
    .map_err(|e| {
        tracing::error!("Failed to fetch download job: {}", e);
        AppError::InternalServerError("Failed to fetch job status".to_string())
    })?;

    match job_result {
        Some(job) => Ok(ResponseJson(DownloadJobStatusResponse {
            job_id: job.id.to_string(),
            url: job.url,
            status: job.status,
            download_path: job.download_path,
            error_message: job.error_message,
            created_at: job.created_at.to_string(),
            updated_at: job.updated_at.to_string(),
        })),
        None => Err(AppError::NotFound("Download job not found".to_string())),
    }
}

/// Build download routes
pub fn create_routes() -> Router {
    Router::new()
        .route("/download-urls", post(download_urls))
        .route(
            "/download-job-status/{job_id}",
            get(get_download_job_status),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_url_validation() {
        assert!(is_valid_url("https://www.youtube.com/watch?v=123"));
        assert!(is_valid_url("http://example.com"));
        assert!(!is_valid_url("ftp://example.com"));
        assert!(!is_valid_url("not-a-url"));
        assert!(!is_valid_url(""));
    }
}
