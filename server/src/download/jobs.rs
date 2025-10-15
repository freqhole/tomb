//! Download job management for URL-based downloads using yt-dlp

use grimoire::DatabaseConnection;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::types::Uuid;
use std::process::Command;
use time::OffsetDateTime;
use tokio::fs;
use tokio::process::Command as AsyncCommand;
use tracing::{error, info, warn};

use crate::error::AppError;

/// Download job status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DownloadJobStatus {
    Queued,
    InProgress,
    Completed,
    Failed,
    Cancelled,
}

impl std::fmt::Display for DownloadJobStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DownloadJobStatus::Queued => write!(f, "queued"),
            DownloadJobStatus::InProgress => write!(f, "in_progress"),
            DownloadJobStatus::Completed => write!(f, "completed"),
            DownloadJobStatus::Failed => write!(f, "failed"),
            DownloadJobStatus::Cancelled => write!(f, "cancelled"),
        }
    }
}

/// Download job record
#[derive(Debug, Clone)]
pub struct DownloadJob {
    pub id: Uuid,
    pub url: String,
    pub status: DownloadJobStatus,
    pub download_path: Option<String>,
    pub error_message: Option<String>,
    pub retry_count: i32,
    pub max_retries: i32,
    pub content_id: Option<String>,
    pub user_id: Option<Uuid>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

/// Create a new download job
pub async fn create_download_job(
    db: &DatabaseConnection,
    url: &str,
    user_id: Uuid,
) -> Result<String, AppError> {
    let job_id = Uuid::new_v4();

    sqlx::query!(
        r#"
        INSERT INTO download_jobs (
            id,
            url,
            status,
            retry_count,
            max_retries,
            user_id,
            created_at,
            updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        "#,
        job_id,
        url,
        DownloadJobStatus::Queued.to_string(),
        0,
        3,
        user_id
    )
    .execute(db.pool())
    .await
    .map_err(|e| {
        error!("Failed to create download job for {}: {}", url, e);
        AppError::InternalServerError("Failed to create download job".to_string())
    })?;

    info!("Created download job {} for URL: {}", job_id, url);
    Ok(job_id.to_string())
}

/// Get pending download jobs
pub async fn get_pending_jobs(
    db: &DatabaseConnection,
    limit: i64,
) -> Result<Vec<DownloadJob>, AppError> {
    let rows = sqlx::query!(
        r#"
        SELECT id, url, status, download_path, error_message, retry_count, max_retries, content_id, user_id, created_at, updated_at
        FROM download_jobs
        WHERE status = 'queued'
        ORDER BY created_at ASC
        LIMIT $1
        "#,
        limit
    )
    .fetch_all(db.pool())
    .await
    .map_err(|e| {
        error!("Failed to fetch pending download jobs: {}", e);
        AppError::InternalServerError("Failed to fetch download jobs".to_string())
    })?;

    let jobs = rows
        .into_iter()
        .map(|row| DownloadJob {
            id: row.id,
            url: row.url,
            status: match row.status.as_str() {
                "queued" => DownloadJobStatus::Queued,
                "in_progress" => DownloadJobStatus::InProgress,
                "completed" => DownloadJobStatus::Completed,
                "failed" => DownloadJobStatus::Failed,
                "cancelled" => DownloadJobStatus::Cancelled,
                _ => DownloadJobStatus::Queued,
            },
            download_path: row.download_path,
            error_message: row.error_message,
            retry_count: row.retry_count,
            max_retries: row.max_retries,
            content_id: row.content_id,
            user_id: row.user_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
        .collect();

    Ok(jobs)
}

/// Update download job status
pub async fn update_job_status(
    db: &DatabaseConnection,
    job_id: Uuid,
    status: DownloadJobStatus,
    download_path: Option<String>,
    error_message: Option<String>,
) -> Result<(), AppError> {
    sqlx::query!(
        r#"
        UPDATE download_jobs
        SET status = $2, download_path = $3, error_message = $4, updated_at = NOW()
        WHERE id = $1
        "#,
        job_id,
        status.to_string(),
        download_path,
        error_message
    )
    .execute(db.pool())
    .await
    .map_err(|e| {
        error!("Failed to update download job status: {}", e);
        AppError::InternalServerError("Failed to update job status".to_string())
    })?;

    Ok(())
}

/// Update download job with content_id
pub async fn update_job_content_id(
    db: &DatabaseConnection,
    job_id: Uuid,
    content_id: &str,
) -> Result<(), AppError> {
    sqlx::query!(
        "UPDATE download_jobs SET content_id = $1, updated_at = NOW() WHERE id = $2",
        content_id,
        job_id
    )
    .execute(db.pool())
    .await
    .map_err(|e| {
        error!("Failed to update job content_id: {}", e);
        AppError::InternalServerError("Failed to update job".to_string())
    })?;

    Ok(())
}

/// Check for conflicting jobs with same content_id
pub async fn check_content_conflicts(
    db: &DatabaseConnection,
    content_id: &str,
    current_job_id: Uuid,
) -> Result<Vec<Uuid>, AppError> {
    let rows = sqlx::query!(
        r#"
        SELECT id FROM download_jobs
        WHERE content_id = $1
        AND status IN ('queued', 'in_progress')
        AND id != $2
        ORDER BY created_at ASC
        "#,
        content_id,
        current_job_id
    )
    .fetch_all(db.pool())
    .await
    .map_err(|e| {
        error!("Failed to check content conflicts: {}", e);
        AppError::InternalServerError("Failed to check conflicts".to_string())
    })?;

    Ok(rows.into_iter().map(|row| row.id).collect())
}

/// Check if content already exists in media_blobs
pub async fn check_content_exists_in_media_blobs(
    db: &DatabaseConnection,
    content_id: &str,
) -> Result<Option<String>, AppError> {
    let row = sqlx::query!(
        "SELECT id FROM media_blobs WHERE content_id = $1 LIMIT 1",
        content_id
    )
    .fetch_optional(db.pool())
    .await
    .map_err(|e| {
        error!("Failed to check media blob content existence: {}", e);
        AppError::InternalServerError("Database error".to_string())
    })?;

    Ok(row.map(|r| r.id))
}

/// Content metadata extracted from yt-dlp
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContentMetadata {
    pub platform: String,
    pub content_id: String,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub uploader: Option<String>,
    pub duration_seconds: Option<i64>,
    pub url: String,
    pub raw_metadata: Value,
}

/// Extract metadata from URL without downloading
pub async fn extract_metadata_only(
    url: &str,
    ytdlp_command: &str,
) -> Result<ContentMetadata, String> {
    info!("Extracting metadata for URL: {}", url);

    // Use yt-dlp to extract metadata only
    let output = AsyncCommand::new(ytdlp_command)
        .arg("--print-json")
        .arg("--no-download")
        .arg("--no-playlist")
        .arg("--")
        .arg(url)
        .output()
        .await
        .map_err(|e| format!("Failed to execute yt-dlp for metadata: {}", e))?;

    if !output.status.success() {
        let error_msg = String::from_utf8_lossy(&output.stderr);
        return Err(format!("yt-dlp metadata extraction failed: {}", error_msg));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);

    // yt-dlp may return multiple JSON objects (one per line), we want the first one
    let first_line = stdout.lines().next().ok_or("No output from yt-dlp")?;

    let metadata: Value = serde_json::from_str(first_line)
        .map_err(|e| format!("Failed to parse yt-dlp metadata JSON: {}", e))?;

    // Extract platform from URL or extractor name
    let platform = metadata["extractor"]
        .as_str()
        .unwrap_or("unknown")
        .to_lowercase();

    // Get content ID
    let content_id = metadata["id"]
        .as_str()
        .ok_or("No content ID found in metadata")?
        .to_string();

    // Extract other fields
    let title = metadata["title"].as_str().map(String::from);
    let artist = metadata["artist"].as_str().map(String::from);
    let uploader = metadata["uploader"].as_str().map(String::from);
    let duration_seconds = metadata["duration"].as_i64();

    Ok(ContentMetadata {
        platform,
        content_id,
        title,
        artist,
        uploader,
        duration_seconds,
        url: url.to_string(),
        raw_metadata: metadata,
    })
}

/// Get a single download job by ID
pub async fn get_job_by_id(db: &DatabaseConnection, job_id: Uuid) -> Result<DownloadJob, AppError> {
    let row = sqlx::query!(
        r#"
        SELECT id, url, status, download_path, error_message, retry_count, max_retries, content_id, user_id, created_at, updated_at
        FROM download_jobs
        WHERE id = $1
        "#,
        job_id
    )
    .fetch_optional(db.pool())
    .await
    .map_err(|e| {
        error!("Failed to fetch download job by ID: {}", e);
        AppError::InternalServerError("Failed to fetch download job".to_string())
    })?;

    match row {
        Some(row) => Ok(DownloadJob {
            id: row.id,
            url: row.url,
            status: match row.status.as_str() {
                "queued" => DownloadJobStatus::Queued,
                "in_progress" => DownloadJobStatus::InProgress,
                "completed" => DownloadJobStatus::Completed,
                "failed" => DownloadJobStatus::Failed,
                "cancelled" => DownloadJobStatus::Cancelled,
                _ => DownloadJobStatus::Queued,
            },
            download_path: row.download_path,
            error_message: row.error_message,
            retry_count: row.retry_count,
            max_retries: row.max_retries,
            content_id: row.content_id,
            user_id: row.user_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }),
        None => Err(AppError::NotFound("Download job not found".to_string())),
    }
}

/// Download a file using yt-dlp
pub async fn download_with_ytdlp(
    job: &DownloadJob,
    download_dir: &str,
    ytdlp_command: &str,
) -> Result<Vec<String>, String> {
    info!(
        job_id = %job.id,
        url = %job.url,
        "Starting download with yt-dlp"
    );

    // Ensure download directory exists
    if let Err(e) = fs::create_dir_all(download_dir).await {
        let error_msg = format!("Failed to create download directory: {}", e);
        error!("{}", error_msg);
        return Err(error_msg);
    }

    // Build yt-dlp command
    let output = Command::new(ytdlp_command)
        .arg("--extract-audio")
        .arg("--audio-format")
        .arg("mp3")
        .arg("--audio-quality")
        .arg("0") // Best quality
        .arg("--add-metadata")
        .arg("--embed-thumbnail")
        .arg("--no-overwrites") // Prevent overwriting existing files
        .arg("--output")
        .arg(format!(
            "{}/%(uploader)s - %(title)s [%(id)s].%(ext)s",
            download_dir
        ))
        .arg("--print")
        .arg("after_move:filepath") // This will print the final file path
        .arg("--")
        .arg(&job.url)
        .output()
        .map_err(|e| format!("Failed to execute yt-dlp: {}", e))?;

    if !output.status.success() {
        let error_msg = String::from_utf8_lossy(&output.stderr);
        warn!(
            job_id = %job.id,
            url = %job.url,
            error = %error_msg,
            "yt-dlp download failed"
        );
        return Err(format!("yt-dlp failed: {}", error_msg));
    }

    // Parse output to get downloaded file paths
    let stdout = String::from_utf8_lossy(&output.stdout);
    let downloaded_files: Vec<String> = stdout
        .lines()
        .filter(|line| !line.is_empty())
        .map(|line| line.trim().to_string())
        .collect();

    if downloaded_files.is_empty() {
        return Err("No files were downloaded".to_string());
    }

    info!(
        job_id = %job.id,
        url = %job.url,
        file_count = downloaded_files.len(),
        "Download completed successfully"
    );

    Ok(downloaded_files)
}

/// Process a download job with metadata-first workflow
pub async fn process_download_job(
    db: &DatabaseConnection,
    job: &DownloadJob,
    download_dir: &str,
    ytdlp_command: &str,
) -> Result<Vec<String>, String> {
    // Update status to in progress
    if let Err(e) = update_job_status(db, job.id, DownloadJobStatus::InProgress, None, None).await {
        let error_msg = format!("Failed to update job status: {}", e);
        error!("{}", error_msg);
        return Err(error_msg);
    }

    // Step 1: Extract metadata first
    let metadata = match extract_metadata_only(&job.url, ytdlp_command).await {
        Ok(metadata) => metadata,
        Err(e) => {
            let error_msg = format!("Failed to extract metadata: {}", e);
            if let Err(update_err) = update_job_status(
                db,
                job.id,
                DownloadJobStatus::Failed,
                None,
                Some(error_msg.clone()),
            )
            .await
            {
                error!("Failed to update job status: {}", update_err);
            }
            return Err(error_msg);
        }
    };

    // Step 2: Update job with content_id
    let content_id = format!("{}:{}", metadata.platform, metadata.content_id);
    if let Err(e) = update_job_content_id(db, job.id, &content_id).await {
        let error_msg = format!("Failed to update job content_id: {}", e);
        if let Err(update_err) = update_job_status(
            db,
            job.id,
            DownloadJobStatus::Failed,
            None,
            Some(error_msg.clone()),
        )
        .await
        {
            error!("Failed to update job status: {}", update_err);
        }
        return Err(error_msg);
    }

    // Step 3: Check for conflicts with other jobs
    match check_content_conflicts(db, &content_id, job.id).await {
        Ok(conflicts) if !conflicts.is_empty() => {
            let msg = format!("Content already being processed by job: {:?}", conflicts[0]);
            info!(
                job_id = %job.id,
                content_id = %content_id,
                conflict_jobs = ?conflicts,
                "Skipping duplicate content - already being processed"
            );
            if let Err(e) =
                update_job_status(db, job.id, DownloadJobStatus::Completed, None, Some(msg)).await
            {
                error!("Failed to update job status: {}", e);
            }
            return Ok(vec![]);
        }
        Err(e) => {
            let error_msg = format!("Failed to check conflicts: {}", e);
            if let Err(update_err) = update_job_status(
                db,
                job.id,
                DownloadJobStatus::Failed,
                None,
                Some(error_msg.clone()),
            )
            .await
            {
                error!("Failed to update job status: {}", update_err);
            }
            return Err(error_msg);
        }
        _ => {} // No conflicts, continue
    }

    // Step 4: Check if content already exists in media blobs
    match check_content_exists_in_media_blobs(db, &content_id).await {
        Ok(Some(existing_blob_id)) => {
            let msg = format!("Content already exists as media blob: {}", existing_blob_id);
            info!(
                job_id = %job.id,
                content_id = %content_id,
                existing_blob_id = %existing_blob_id,
                "Skipping duplicate content - already exists in media blobs"
            );
            if let Err(e) =
                update_job_status(db, job.id, DownloadJobStatus::Completed, None, Some(msg)).await
            {
                error!("Failed to update job status: {}", e);
            }
            return Ok(vec![]);
        }
        Err(e) => {
            let error_msg = format!("Failed to check existing content: {}", e);
            if let Err(update_err) = update_job_status(
                db,
                job.id,
                DownloadJobStatus::Failed,
                None,
                Some(error_msg.clone()),
            )
            .await
            {
                error!("Failed to update job status: {}", update_err);
            }
            return Err(error_msg);
        }
        _ => {} // Content doesn't exist, continue with download
    }

    // Step 5: Proceed with actual download
    // Create updated job struct with content_id for passing to subsequent functions
    let mut updated_job = job.clone();
    updated_job.content_id = Some(content_id.clone());

    match download_with_ytdlp(&updated_job, download_dir, ytdlp_command).await {
        Ok(downloaded_files) => {
            let download_path = if downloaded_files.len() == 1 {
                Some(downloaded_files[0].clone())
            } else {
                None
            };

            if let Err(e) = update_job_status(
                db,
                job.id,
                DownloadJobStatus::Completed,
                download_path,
                None,
            )
            .await
            {
                error!("Failed to update job status to completed: {}", e);
            }

            info!(
                job_id = %job.id,
                content_id = %content_id,
                file_count = downloaded_files.len(),
                "Download completed successfully"
            );

            Ok(downloaded_files)
        }
        Err(error_msg) => {
            let full_error = format!("Download failed: {}", error_msg);
            if let Err(e) = update_job_status(
                db,
                job.id,
                DownloadJobStatus::Failed,
                None,
                Some(full_error.clone()),
            )
            .await
            {
                error!("Failed to update job status to failed: {}", e);
            }

            error!(
                job_id = %job.id,
                content_id = %content_id,
                error = %error_msg,
                "Download failed, job marked as failed"
            );

            Err(full_error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_download_job_status_display() {
        assert_eq!(DownloadJobStatus::Queued.to_string(), "queued");
        assert_eq!(DownloadJobStatus::InProgress.to_string(), "in_progress");
        assert_eq!(DownloadJobStatus::Completed.to_string(), "completed");
        assert_eq!(DownloadJobStatus::Failed.to_string(), "failed");
        assert_eq!(DownloadJobStatus::Cancelled.to_string(), "cancelled");
    }
}
