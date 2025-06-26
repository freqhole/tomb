//! Upload handlers for large file operations
//!
//! This module contains HTTP handlers for uploading large files (>10MB)
//! that are stored to disk and referenced via local_path in the database.

use axum::{extract::Multipart, http::StatusCode, response::Json, Extension};
use sha2::{Digest, Sha256};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tracing::{error, info, warn};
use uuid::Uuid;

use crate::auth::AuthenticatedUser;
use crate::error::AppError;
use crate::media::models::{CreateMediaBlob, MediaBlob};
use crate::media::repository::MediaRepository;
use crate::startup::AppState;
use grimoire::auth::User;
use grimoire::AppConfig;
use grimoire::DatabaseConnection;

use super::models::{UploadConfig, UploadRequest, UploadResponse};

/// Upload a large file (admin only)
pub async fn upload_large_file(
    Extension(db): Extension<DatabaseConnection>,
    Extension(config): Extension<AppConfig>,
    Extension(app_state): Extension<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    mut multipart: Multipart,
) -> Result<Json<UploadResponse>, AppError> {
    let upload_config = UploadConfig {
        upload_directory: config.static_files.upload_directory.clone().into(),
        ..Default::default()
    };

    // Ensure upload directory exists
    if let Err(e) = fs::create_dir_all(&upload_config.upload_directory).await {
        error!("Failed to create upload directory: {}", e);
        return Err(AppError::InternalServerError(
            "Failed to prepare upload directory".to_string(),
        ));
    }

    let mut upload_request: Option<UploadRequest> = None;
    let mut file_data: Option<Vec<u8>> = None;

    // Process multipart form data
    info!("Starting multipart processing for upload");

    while let Some(field) = multipart.next_field().await.map_err(|e| {
        error!("Failed to read multipart field: {}", e);
        AppError::BadRequest(format!("Error parsing multipart request: {}", e))
    })? {
        let name = field.name().unwrap_or("").to_string();
        info!("Processing multipart field: {}", name);

        match name.as_str() {
            "metadata" => {
                let data = field.bytes().await.map_err(|e| {
                    error!("Failed to read metadata field: {}", e);
                    AppError::BadRequest(format!("Failed to read metadata: {}", e))
                })?;

                info!("Received metadata field, {} bytes", data.len());
                upload_request = Some(serde_json::from_slice(&data).map_err(|e| {
                    error!("Failed to parse metadata JSON: {}", e);
                    AppError::BadRequest(format!("Invalid metadata JSON: {}", e))
                })?);
            }
            "file" => {
                info!("Processing file field");
                let file_bytes = field.bytes().await.map_err(|e| {
                    error!("Failed to read file data: {}", e);
                    AppError::BadRequest(format!("Failed to read file data: {}", e))
                })?;

                info!("Received file data, {} bytes", file_bytes.len());
                file_data = Some(file_bytes.to_vec());
            }
            _ => {
                warn!("Unexpected multipart field: {}", name);
            }
        }
    }

    let upload_request = upload_request.ok_or_else(|| {
        AppError::BadRequest("Missing metadata field in multipart request".to_string())
    })?;

    let file_data = file_data.ok_or_else(|| {
        AppError::BadRequest("Missing file field in multipart request".to_string())
    })?;

    // Validate file size matches request
    if file_data.len() as u64 != upload_request.size {
        return Err(AppError::BadRequest(format!(
            "File size mismatch: expected {}, got {}",
            upload_request.size,
            file_data.len()
        )));
    }

    // Validate SHA256 hash
    let mut hasher = Sha256::new();
    hasher.update(&file_data);
    let computed_hash = format!("{:x}", hasher.finalize());

    if computed_hash != upload_request.sha256 {
        return Err(AppError::BadRequest(
            "SHA256 hash verification failed".to_string(),
        ));
    }

    // Validate upload request
    upload_request
        .validate(&upload_config)
        .map_err(|e| AppError::BadRequest(format!("Upload validation failed: {}", e)))?;

    info!(
        "Processing large file upload: {} ({} bytes) for user {}",
        upload_request.filename,
        upload_request.size,
        user.user().username
    );

    // Check for duplicate files if enabled
    if upload_config.check_duplicates {
        let repo = MediaRepository::new(&db);
        if let Ok(existing) = repo.get_by_sha256(&upload_request.sha256).await {
            info!("File with hash {} already exists", upload_request.sha256);
            return Err(AppError::Conflict(format!(
                "File already exists with ID: {}",
                existing.id
            )));
        }
    }

    // Generate storage filename and path
    let storage_filename = upload_request.generate_storage_filename();
    let file_path = upload_config.upload_directory.join(&storage_filename);

    println!(
        "ZOMG GOT AN UPLOAD!!! storage_filename:{}, and then file_path:{:?}",
        &storage_filename, &file_path
    );

    // Write file to disk
    let mut file = fs::File::create(&file_path).await.map_err(|e| {
        error!("Failed to create file {}: {}", file_path.display(), e);
        AppError::InternalServerError("Failed to save file".to_string())
    })?;

    file.write_all(&file_data).await.map_err(|e| {
        error!("Failed to write file data: {}", e);
        AppError::InternalServerError("Failed to write file data".to_string())
    })?;

    file.sync_all().await.map_err(|e| {
        error!("Failed to sync file: {}", e);
        AppError::InternalServerError("Failed to sync file to disk".to_string())
    })?;

    info!("File saved to: {}", file_path.display());

    // Create relative path for database storage
    let relative_path = format!(
        "{}/{}",
        config
            .static_files
            .upload_directory
            .trim_start_matches("assets/"),
        storage_filename
    );

    // Create media blob record in database
    let media_blob_params = CreateMediaBlob {
        data: None, // No binary data for large files
        sha256: upload_request.sha256.clone(),
        size: Some(upload_request.size as i64),
        mime: upload_request.infer_mime_type(),
        source_client_id: Some(format!("admin_upload_{}", user.user().id)),
        local_path: Some(relative_path.clone()),
        metadata: upload_request.metadata,
    };

    let repo = MediaRepository::new(&db);
    let media_blob = repo
        .create(media_blob_params, &config.media)
        .await
        .map_err(|e| {
            error!("Failed to create media blob record: {}", e);
            // Clean up the file if database insert fails
            if let Err(cleanup_err) = std::fs::remove_file(&file_path) {
                error!(
                    "Failed to cleanup file after database error: {}",
                    cleanup_err
                );
            }
            AppError::InternalServerError("Failed to create media record".to_string())
        })?;

    info!(
        "Successfully uploaded large file: {} (ID: {})",
        upload_request.filename, media_blob.id
    );

    // Auto-enqueue thumbnail jobs if enabled
    if config.media.thumbnails.enabled {
        info!(
            "Auto-enqueueing thumbnail jobs for media blob: {}",
            media_blob.id
        );

        let queue = app_state.thumbnail_queue.lock().await;
        match queue.auto_enqueue_for_media_blob(media_blob.id).await {
            Ok(job_ids) => {
                info!(
                    "Enqueued {} thumbnail job(s) for media blob {}: {:?}",
                    job_ids.len(),
                    media_blob.id,
                    job_ids
                );
            }
            Err(e) => {
                warn!(
                    "Failed to auto-enqueue thumbnail jobs for media blob {}: {}",
                    media_blob.id, e
                );
                // Don't fail the upload if thumbnail enqueueing fails
            }
        }
    }

    let response = UploadResponse {
        id: media_blob.id,
        local_path: relative_path,
        sha256: upload_request.sha256,
        size: upload_request.size,
        mime_type: media_blob.mime,
        created_at: media_blob.created_at,
    };

    Ok(Json(response))
}

/// Get upload status/info by media blob ID (authenticated users)
pub async fn get_upload_info(
    Extension(db): Extension<DatabaseConnection>,
    Extension(_user): Extension<User>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<Json<MediaBlob>, AppError> {
    let repo = MediaRepository::new(&db);
    let media_blob = repo.find_by_id(id).await.map_err(|e| {
        error!("Failed to find media blob {}: {}", id, e);
        AppError::NotFound("Upload not found".to_string())
    })?;

    // Only return blobs that have local_path (uploaded files)
    if media_blob.local_path.is_some() {
        Ok(Json(media_blob.without_data()))
    } else {
        Err(AppError::NotFound("Upload not found".to_string()))
    }
}

/// List all uploaded files (authenticated users)
pub async fn list_uploads(
    Extension(db): Extension<DatabaseConnection>,
    Extension(_user): Extension<User>,
    axum::extract::Query(params): axum::extract::Query<ListUploadsQuery>,
) -> Result<Json<ListUploadsResponse>, AppError> {
    let repo = MediaRepository::new(&db);

    // Query only blobs with local_path (uploaded files)
    let query = crate::media::models::MediaBlobQuery {
        limit: params.limit.map(|l| l.min(100)), // Cap at 100
        offset: params.offset,
        ..Default::default()
    };

    let blobs_result = repo.query(query).await.map_err(|e| {
        error!("Failed to list uploads: {}", e);
        AppError::InternalServerError("Failed to list uploads".to_string())
    })?;

    // Filter to only include blobs with local_path
    let upload_blobs: Vec<_> = blobs_result
        .items
        .into_iter()
        .filter(|b| b.local_path.is_some())
        .collect();
    let total_count = blobs_result
        .pagination
        .total_count
        .unwrap_or(upload_blobs.len() as i64);

    let response = ListUploadsResponse {
        uploads: upload_blobs.into_iter().map(|b| b.without_data()).collect(),
        total_count,
        limit: params.limit,
        offset: params.offset.unwrap_or(0),
    };

    Ok(Json(response))
}

/// Query parameters for listing uploads
#[derive(serde::Deserialize)]
pub struct ListUploadsQuery {
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

/// Response for listing uploads
#[derive(serde::Serialize)]
pub struct ListUploadsResponse {
    pub uploads: Vec<MediaBlob>,
    pub total_count: i64,
    pub limit: Option<i64>,
    pub offset: i64,
}

/// Delete an uploaded file (admin only)
pub async fn delete_upload(
    Extension(db): Extension<DatabaseConnection>,
    Extension(_config): Extension<AppConfig>,
    Extension(_user): Extension<AuthenticatedUser>,
    axum::extract::Path(id): axum::extract::Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let repo = MediaRepository::new(&db);
    let media_blob = repo.find_by_id(id).await.map_err(|e| {
        error!("Failed to find media blob {}: {}", id, e);
        AppError::NotFound("Upload not found".to_string())
    })?;

    // Only delete if it has a local_path (is an uploaded file)
    let local_path = media_blob
        .local_path
        .ok_or_else(|| AppError::BadRequest("Cannot delete non-uploaded media blob".to_string()))?;

    // Construct full file path
    let full_path = std::path::Path::new("assets").join(&local_path);

    // Delete file from disk
    if full_path.exists() {
        if let Err(e) = fs::remove_file(&full_path).await {
            warn!("Failed to delete file {}: {}", full_path.display(), e);
            // Continue with database deletion even if file deletion fails
        } else {
            info!("Deleted file: {}", full_path.display());
        }
    } else {
        warn!("File not found on disk: {}", full_path.display());
    }

    // Delete database record
    repo.delete(id).await.map_err(|e| {
        error!("Failed to delete media blob record {}: {}", id, e);
        AppError::InternalServerError("Failed to delete media record".to_string())
    })?;

    info!("Successfully deleted upload: {} (ID: {})", local_path, id);
    Ok(StatusCode::NO_CONTENT)
}
