//! Music job processing API handlers
//!
//! This module provides REST API endpoints for managing music processing jobs,
//! including status tracking and job cancellation for uploaded audio files.

use axum::{
    extract::{Extension, Path},
    response::Json,
};
use grimoire::DatabaseConnection;
use num_traits::ToPrimitive;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use tracing::{error, info};
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;

/// Music job status response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MusicJobStatusResponse {
    pub job_id: String,
    pub status: String,
    pub progress_percentage: Option<f32>,
    pub processing_step: Option<String>,
    pub song_id: Option<String>,
    pub error_message: Option<String>,
    pub error_type: Option<String>,
    pub can_retry: bool,
    pub file_path: String,
    pub original_filename: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

/// Cancel job response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CancelJobResponse {
    pub job_id: String,
    pub cancelled: bool,
    pub message: String,
}

/// Duplicate file check response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DuplicateCheckResponse {
    pub exists: bool,
    pub existing_song_id: Option<String>,
    pub existing_blob_id: Option<String>,
    pub original_filename: Option<String>,
}

/// Get music job status by job ID (authenticated users)
pub async fn get_music_job_status(
    Extension(db): Extension<DatabaseConnection>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(job_id): Path<String>,
) -> Result<Json<MusicJobStatusResponse>, AppError> {
    let job_uuid = Uuid::parse_str(&job_id)
        .map_err(|_| AppError::BadRequest("Invalid job ID format".to_string()))?;

    // Query music job from database
    let job_result = sqlx::query!(
        r#"
        SELECT
            id,
            job_type,
            status,
            file_path,
            song_id,
            progress_percentage,
            error_message,
            retry_count,
            max_retries,
            parameters,
            created_at,
            updated_at
        FROM music_jobs
        WHERE id = $1
        "#,
        job_uuid
    )
    .fetch_optional(db.pool())
    .await
    .map_err(|e| {
        error!("Failed to query music job {}: {}", job_id, e);
        AppError::InternalServerError("Failed to query job status".to_string())
    })?;

    let job = job_result.ok_or_else(|| AppError::NotFound("Music job not found".to_string()))?;

    // Extract original filename from parameters if available
    let original_filename = job
        .parameters
        .as_ref()
        .and_then(|p| p.get("original_filename"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    // Determine processing step based on job status and type
    let processing_step = match (job.status.as_str(), job.job_type.as_str()) {
        ("in_progress", "extract_metadata") => Some("metadata".to_string()),
        ("in_progress", "generate_thumbnail") => Some("thumbnail".to_string()),
        ("in_progress", "generate_waveform") => Some("waveform".to_string()),
        ("in_progress", "process_song") => Some("song_creation".to_string()),
        _ => None,
    };

    // Determine error type from error message patterns
    let error_type = job.error_message.as_ref().and_then(|msg| {
        let msg_lower = msg.to_lowercase();
        if msg_lower.contains("unsupported") || msg_lower.contains("format") {
            Some("unsupported_format".to_string())
        } else if msg_lower.contains("corrupt") || msg_lower.contains("invalid") {
            Some("corrupted_file".to_string())
        } else if msg_lower.contains("metadata") {
            Some("metadata_extraction_failed".to_string())
        } else if msg_lower.contains("size") || msg_lower.contains("large") {
            Some("size_limit".to_string())
        } else {
            None
        }
    });

    // Job can be retried if it failed and hasn't exceeded max retries
    let can_retry = job.status == "failed" && job.retry_count < job.max_retries;

    let response = MusicJobStatusResponse {
        job_id: job.id.to_string(),
        status: job.status,
        progress_percentage: job.progress_percentage.map(|p| p.to_f32().unwrap_or(0.0)),
        processing_step,
        song_id: job.song_id.map(|id| id.to_string()),
        error_message: job.error_message,
        error_type,
        can_retry,
        file_path: job.file_path,
        original_filename,
        created_at: job.created_at,
        updated_at: job.updated_at,
    };

    Ok(Json(response))
}

/// Cancel a music processing job (authenticated users)
pub async fn cancel_music_job(
    Extension(db): Extension<DatabaseConnection>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(job_id): Path<String>,
) -> Result<Json<CancelJobResponse>, AppError> {
    let job_uuid = Uuid::parse_str(&job_id)
        .map_err(|_| AppError::BadRequest("Invalid job ID format".to_string()))?;

    // Update job status to cancelled if it's still pending or in progress
    let result = sqlx::query!(
        r#"
        UPDATE music_jobs
        SET
            status = 'cancelled',
            updated_at = NOW()
        WHERE id = $1
        AND status IN ('pending', 'in_progress')
        "#,
        job_uuid
    )
    .execute(db.pool())
    .await
    .map_err(|e| {
        error!("Failed to cancel music job {}: {}", job_id, e);
        AppError::InternalServerError("Failed to cancel job".to_string())
    })?;

    let cancelled = result.rows_affected() > 0;
    let message = if cancelled {
        "job cancelled successfully".to_string()
    } else {
        "job cannot be cancelled (already completed or failed)".to_string()
    };

    info!("Music job {} cancellation attempt: {}", job_id, message);

    let response = CancelJobResponse {
        job_id: job_id.clone(),
        cancelled,
        message,
    };

    Ok(Json(response))
}

/// Check for duplicate files by SHA256 hash (authenticated users)
pub async fn check_duplicate_file(
    Extension(db): Extension<DatabaseConnection>,
    Extension(_user): Extension<AuthenticatedUser>,
    Path(sha256): Path<String>,
) -> Result<Json<DuplicateCheckResponse>, AppError> {
    // Validate SHA256 format
    if sha256.len() != 64 || !sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(AppError::BadRequest(
            "Invalid SHA256 hash format".to_string(),
        ));
    }

    // Check if a media blob with this hash already exists
    let existing_blob = sqlx::query!(
        r#"
        SELECT
            mb.id as blob_id,
            s.id as "song_id?",
            mb.metadata
        FROM media_blobs mb
        LEFT JOIN songs s ON s.media_blob_id = mb.id
        WHERE mb.sha256 = $1
        LIMIT 1
        "#,
        sha256
    )
    .fetch_optional(db.pool())
    .await
    .map_err(|e| {
        error!("Failed to check for duplicate file {}: {}", sha256, e);
        AppError::InternalServerError("Failed to check for duplicates".to_string())
    })?;

    let (exists, existing_song_id, existing_blob_id, original_filename) =
        if let Some(blob) = existing_blob {
            let original_filename = blob
                .metadata
                .as_ref()
                .and_then(|m| m.get("original_filename"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            (
                true,
                blob.song_id.map(|id| id.to_string()),
                Some(blob.blob_id),
                original_filename,
            )
        } else {
            (false, None, None, None)
        };

    let response = DuplicateCheckResponse {
        exists,
        existing_song_id,
        existing_blob_id,
        original_filename,
    };

    Ok(Json(response))
}

/// Create a music processing job for an uploaded audio file
pub async fn create_music_job(
    db: &DatabaseConnection,
    media_blob_id: &str,
    file_path: &str,
    original_filename: Option<&str>,
    upload_metadata: Option<&serde_json::Value>,
) -> Result<String, AppError> {
    let job_id = Uuid::new_v4();

    // Build parameters JSON
    let mut parameters = serde_json::Map::new();
    if let Some(filename) = original_filename {
        parameters.insert(
            "original_filename".to_string(),
            serde_json::Value::String(filename.to_string()),
        );
    }

    // Check if this upload came from the web modal and should have defaults applied
    if let Some(metadata) = upload_metadata {
        if metadata
            .get("process_music")
            .and_then(|v| v.as_bool())
            .unwrap_or(false)
        {
            parameters.insert("web_upload".to_string(), serde_json::Value::Bool(true));
        }
    }

    let params_json = serde_json::Value::Object(parameters);

    // Insert music job record
    sqlx::query!(
        r#"
        INSERT INTO music_jobs (
            id,
            job_type,
            file_path,
            media_blob_id,
            status,
            priority,
            parameters,
            scheduled_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        "#,
        job_id,
        "process_song", // Job type for full song processing
        file_path,
        media_blob_id,
        "pending",
        "normal",
        params_json
    )
    .execute(db.pool())
    .await
    .map_err(|e| {
        error!(
            "Failed to create music job for blob {}: {}",
            media_blob_id, e
        );
        AppError::InternalServerError("Failed to create music processing job".to_string())
    })?;

    info!("Created music job {} for file: {}", job_id, file_path);
    Ok(job_id.to_string())
}

/// Process a music file immediately (synchronous processing)
pub async fn process_music_file_directly(
    db: &DatabaseConnection,
    media_blob_id: &str,
    file_path: &str,
    original_filename: Option<&str>,
) -> Result<String, AppError> {
    use grimoire::music::{extract_standard_fields, CreateSong, MusicRepository};
    use std::path::Path;

    let file_path_obj = Path::new(file_path);

    // Extract metadata from the audio file
    let metadata_result = match extract_standard_fields(file_path_obj).await {
        Ok(metadata) => metadata,
        Err(e) => {
            error!("Failed to extract metadata from {}: {}", file_path, e);
            return Err(AppError::InternalServerError(
                "Failed to extract audio metadata".to_string(),
            ));
        }
    };

    // Create song record
    let music_repo = MusicRepository::new(db.pool().clone());

    let song_params = CreateSong {
        media_blob_id: media_blob_id.to_string(),
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
        sub_genres: None, // no sub_genres from metadata extraction
        year: metadata_result.year.map(|y| y as i32),
        bpm: None,
        key_signature: None,
        rating: None,
        is_favorite: Some(false),
        tags: None,
        metadata: Some(serde_json::json!({
            "file_size_bytes": metadata_result.file_size_bytes,
            "original_filename": original_filename,
            "file_path": file_path
        })),
    };

    match music_repo.create_song(song_params).await {
        Ok(song) => {
            info!(
                "Successfully created song {} for file: {}",
                song.id, file_path
            );
            Ok(song.id.to_string())
        }
        Err(e) => {
            error!("Failed to create song record for {}: {}", file_path, e);
            Err(AppError::InternalServerError(
                "Failed to create song record".to_string(),
            ))
        }
    }
}
