//! Download job management for URL-based downloads using yt-dlp

use grimoire::DatabaseConnection;
use serde::{Deserialize, Serialize};
use sqlx::types::Uuid;
use std::process::Command;
use time::OffsetDateTime;
use tokio::fs;
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
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

/// Create a new download job
pub async fn create_download_job(db: &DatabaseConnection, url: &str) -> Result<String, AppError> {
    let job_id = Uuid::new_v4();

    sqlx::query!(
        r#"
        INSERT INTO download_jobs (
            id,
            url,
            status,
            retry_count,
            max_retries,
            created_at,
            updated_at
        ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        "#,
        job_id,
        url,
        DownloadJobStatus::Queued.to_string(),
        0,
        3
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
        SELECT id, url, status, download_path, error_message, retry_count, max_retries, created_at, updated_at
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

/// Process a download job
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

    // Download the files
    match download_with_ytdlp(job, download_dir, ytdlp_command).await {
        Ok(downloaded_files) => {
            // Update status to completed
            let download_path = if downloaded_files.len() == 1 {
                Some(downloaded_files[0].clone())
            } else {
                Some(format!("{} files downloaded", downloaded_files.len()))
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
                warn!("Failed to update job status to completed: {}", e);
            }

            Ok(downloaded_files)
        }
        Err(error_msg) => {
            // Update status to failed
            if let Err(e) = update_job_status(
                db,
                job.id,
                DownloadJobStatus::Failed,
                None,
                Some(error_msg.clone()),
            )
            .await
            {
                warn!("Failed to update job status to failed: {}", e);
            }

            Err(error_msg)
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
