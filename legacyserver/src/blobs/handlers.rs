//! Blob API handlers for authenticated blob serving
//!
//! This module provides HTTP handlers for serving media blobs with proper
//! authentication and permission checks. It supports efficient streaming
//! for large files and includes proper security controls.

use axum::{
    body::Body,
    extract::{Extension, Path, Request},
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};

use legacylib::{media::MediaBlobService, DatabaseConnection};
use mime_guess::from_path;
use std::io::SeekFrom;
use tokio::{
    fs,
    io::{AsyncReadExt, AsyncSeekExt},
};
use tokio_util::io::ReaderStream;

use crate::{auth::AuthenticatedUser, error::AppError};

// Size threshold for streaming vs. loading into memory (10MB)
const STREAMING_THRESHOLD: u64 = 10 * 1024 * 1024;

/// Get a blob by ID with authentication
///
/// Returns the blob data with proper content-type headers.
/// Requires authentication and checks blob permissions.
///
/// # Path Parameters
/// - `id`: Short hash ID of the blob to retrieve
///
/// # Security
/// - Requires valid authentication
/// - TODO: Add permission checks for blob access
/// - Includes audit logging for sensitive blobs
///
/// # Response
/// - 200: Blob data with appropriate content-type
/// - 401: Unauthorized (handled by middleware)
/// - 403: Forbidden (insufficient permissions)
/// - 404: Blob not found
/// - 500: Internal server error
pub async fn get_blob(
    Extension(db): Extension<DatabaseConnection>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthenticatedUser>,
    req: Request,
) -> Result<Response, AppError> {
    tracing::info!(
        blob_id = %id,
        user_id = %user.0.id,
        has_range_header = req.headers().contains_key(header::RANGE),
        "Blob access request"
    );

    // Create media service
    let media_service =
        MediaBlobService::new(legacylib::media::MediaBlobRepository::new(db.pool().clone()));

    // Get blob with data
    let blob = media_service
        .get_media_blob(&id)
        .await
        .map_err(|e| match e {
            legacylib::media::MediaServiceError::Repository(
                legacylib::media::MediaRepositoryError::NotFound(_),
            ) => AppError::NotFound(format!("Blob {} not found", id)),
            _ => AppError::InternalServerError(format!("Failed to retrieve blob: {}", e)),
        })?;

    // TODO: Add permission checks here
    // For now, any authenticated user can access any blob
    // In a production system, you would check:
    // - Blob ownership (blob.source_client_id vs user permissions)
    // - Blob visibility settings
    // - User roles and permissions
    // - Organization/team access controls

    // Check if this is a range request
    let range_header = req.headers().get(header::RANGE);

    // Determine content type from MIME type or file extension
    let content_type = determine_content_type(&blob);

    // Handle different data sources
    if let Some(ref data) = blob.data {
        // Small file: data is stored in database
        let response = build_blob_response(data.clone(), None, content_type.clone(), &blob).await;

        // Log successful access
        tracing::info!(
            blob_id = %id,
            user_id = %user.0.id,
            size_bytes = ?blob.size,
            content_type = %content_type,
            "Blob access granted (from database)"
        );

        return Ok(response);
    } else if let Some(ref local_path) = blob.local_path {
        // Large file: read from filesystem
        let file_path = std::path::Path::new("assets").join(local_path);

        tracing::info!(
            blob_id = %id,
            local_path = %local_path,
            constructed_path = %file_path.display(),
            "Attempting to access file"
        );

        // Get file size for range requests
        let metadata = match fs::metadata(&file_path).await {
            Ok(meta) => {
                tracing::info!(
                    blob_id = %id,
                    file_size = meta.len(),
                    "File metadata retrieved successfully"
                );
                meta
            }
            Err(e) => {
                tracing::error!(
                    blob_id = %id,
                    local_path = %local_path,
                    constructed_path = %file_path.display(),
                    error = %e,
                    "Failed to get file metadata - file may not exist"
                );
                return Err(AppError::InternalServerError(format!(
                    "Failed to get file metadata: {}",
                    e
                )));
            }
        };

        let file_size = metadata.len();

        // Handle range requests for ALL files (both large and small)
        if let Some(range_header_value) = range_header {
            tracing::info!(
                blob_id = %id,
                range_header = ?range_header_value,
                file_size = file_size,
                "Processing range request"
            );

            // Check if this is a large range request that should use streaming instead
            if let Ok(range_str) = range_header_value.to_str() {
                if range_str.starts_with("bytes=") {
                    let ranges_str = &range_str[6..]; // Remove "bytes="
                    let range_part = ranges_str.split(',').next().unwrap().trim();

                    // Calculate range size to decide between range handling vs streaming
                    let range_size = if range_part == "0-" {
                        file_size // Entire file
                    } else if range_part.ends_with('-') {
                        // Start range: "32768-" means from 32768 to end
                        let start = range_part[..range_part.len() - 1]
                            .parse::<u64>()
                            .unwrap_or(0);
                        file_size.saturating_sub(start)
                    } else if range_part.starts_with('-') {
                        // Suffix range: "-1000" means last 1000 bytes
                        range_part[1..].parse::<u64>().unwrap_or(0)
                    } else {
                        // Full range: "100-200"
                        let parts: Vec<&str> = range_part.split('-').collect();
                        if parts.len() == 2 {
                            let start = parts[0].parse::<u64>().unwrap_or(0);
                            let end = parts[1].parse::<u64>().unwrap_or(file_size);
                            end.saturating_sub(start) + 1
                        } else {
                            0
                        }
                    };

                    const MAX_RANGE_SIZE: u64 = 50 * 1024 * 1024; // 50MB max for range handling

                    if range_size > MAX_RANGE_SIZE {
                        tracing::info!(
                            blob_id = %id,
                            range_size = range_size,
                            "Large range request, using streaming instead of range handling"
                        );
                        // Fall through to streaming logic below
                    } else {
                        return handle_range_request(
                            req,
                            file_path,
                            file_size,
                            &blob,
                            content_type.clone(),
                        )
                        .await;
                    }
                }
            }
        }

        tracing::info!(
            blob_id = %id,
            file_size = file_size,
            threshold = STREAMING_THRESHOLD,
            will_stream = file_size > STREAMING_THRESHOLD,
            "Deciding between streaming vs memory loading"
        );

        // Use streaming for large files, memory loading for small files
        if file_size > STREAMING_THRESHOLD {
            // Stream large files to avoid memory issues
            let file = match tokio::fs::File::open(&file_path).await {
                Ok(file) => file,
                Err(e) => {
                    tracing::error!(
                        blob_id = %id,
                        local_path = %local_path,
                        error = %e,
                        "Failed to open file for streaming"
                    );
                    return Err(AppError::InternalServerError(format!(
                        "Failed to open file for streaming: {}",
                        e
                    )));
                }
            };

            let stream = ReaderStream::new(file);
            let body = Body::from_stream(stream);

            let response = build_streaming_response(body, file_size, content_type.clone(), &blob);

            // Log successful access
            tracing::info!(
                blob_id = %id,
                user_id = %user.0.id,
                size_bytes = ?blob.size,
                content_type = %content_type,
                "Blob access granted (streaming from file)"
            );

            return Ok(response);
        } else {
            // Read small files into memory for better performance
            let file_data = match fs::read(&file_path).await {
                Ok(file_data) => file_data,
                Err(e) => {
                    tracing::error!(
                        blob_id = %id,
                        local_path = %local_path,
                        error = %e,
                        "Failed to read file from disk"
                    );
                    return Err(AppError::InternalServerError(format!(
                        "Failed to read file from disk: {}",
                        e
                    )));
                }
            };

            // Build response with file data
            let response =
                build_blob_response(file_data, Some(file_size), content_type.clone(), &blob).await;

            // Log successful access
            tracing::info!(
                blob_id = %id,
                user_id = %user.0.id,
                size_bytes = ?blob.size,
                content_type = %content_type,
                "Blob access granted (from file)"
            );

            return Ok(response);
        }
    } else {
        return Err(AppError::InternalServerError(
            "Blob exists but has no data or file path available".to_string(),
        ));
    }
}

/// Handle range requests for file-based blobs
async fn handle_range_request(
    req: Request,
    file_path: std::path::PathBuf,
    file_size: u64,
    blob: &legacylib::media::MediaBlob,
    content_type: String,
) -> Result<Response, AppError> {
    let range_header = req.headers().get(header::RANGE).unwrap();

    tracing::debug!(
        "Range request details: file_size={}, range_header={:?}",
        file_size,
        range_header
    );

    // Parse range header
    let range_str = range_header
        .to_str()
        .map_err(|_| AppError::BadRequest("Invalid range header".to_string()))?;

    if !range_str.starts_with("bytes=") {
        return Err(AppError::BadRequest(
            "Invalid range header format".to_string(),
        ));
    }

    let ranges_str = &range_str[6..]; // Remove "bytes="
    let range_part = ranges_str.split(',').next().unwrap().trim();

    // Parse range (start-end, start-, -suffix)
    let (start, end) = if range_part.starts_with('-') {
        // Suffix range: -500 (last 500 bytes)
        let suffix = range_part[1..]
            .parse::<u64>()
            .map_err(|_| AppError::BadRequest("Invalid range format".to_string()))?;
        let start = if suffix >= file_size {
            0
        } else {
            file_size - suffix
        };
        (start, file_size - 1)
    } else if range_part.ends_with('-') {
        // Start range: 500- (from byte 500 to end)
        let start = range_part[..range_part.len() - 1]
            .parse::<u64>()
            .map_err(|_| AppError::BadRequest("Invalid range format".to_string()))?;
        (start, file_size - 1)
    } else {
        // Full range: 500-999
        let parts: Vec<&str> = range_part.split('-').collect();
        if parts.len() != 2 {
            return Err(AppError::BadRequest("Invalid range format".to_string()));
        }
        let start = parts[0]
            .parse::<u64>()
            .map_err(|_| AppError::BadRequest("Invalid range start".to_string()))?;
        let end = parts[1]
            .parse::<u64>()
            .map_err(|_| AppError::BadRequest("Invalid range end".to_string()))?;
        (start, end)
    };

    // Validate range
    if start >= file_size || end >= file_size || start > end {
        return Err(AppError::BadRequest("Range not satisfiable".to_string()));
    }

    // Don't try to read huge ranges into memory - limit to reasonable size
    let content_length = end - start + 1;
    const MAX_RANGE_SIZE: u64 = 50 * 1024 * 1024; // 50MB max range

    if content_length > MAX_RANGE_SIZE {
        return Err(AppError::BadRequest(format!(
            "Range too large: {} bytes requested, max {} bytes allowed",
            content_length, MAX_RANGE_SIZE
        )));
    }

    // Open file and seek to start position
    let mut file = tokio::fs::File::open(&file_path)
        .await
        .map_err(|e| AppError::InternalServerError(format!("Failed to open file: {}", e)))?;

    file.seek(SeekFrom::Start(start))
        .await
        .map_err(|e| AppError::InternalServerError(format!("Failed to seek in file: {}", e)))?;

    // Read the requested range
    let mut buffer = vec![0; content_length as usize];
    file.read_exact(&mut buffer)
        .await
        .map_err(|e| AppError::InternalServerError(format!("Failed to read file range: {}", e)))?;

    // Build response headers
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        content_type
            .parse()
            .unwrap_or_else(|_| "application/octet-stream".parse().unwrap()),
    );
    headers.insert(
        header::CONTENT_LENGTH,
        content_length.to_string().parse().unwrap(),
    );
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(
        header::CONTENT_RANGE,
        format!("bytes {}-{}/{}", start, end, file_size)
            .parse()
            .unwrap(),
    );
    headers.insert(
        header::CACHE_CONTROL,
        "public, max-age=3600".parse().unwrap(),
    );

    // Add filename if available
    add_filename_header(&mut headers, blob);

    Ok((StatusCode::PARTIAL_CONTENT, headers, buffer).into_response())
}

/// Determine content type from blob metadata
fn determine_content_type(blob: &legacylib::media::MediaBlob) -> String {
    if let Some(ref mime) = blob.mime {
        if !mime.is_empty() {
            return mime.clone();
        }
    }

    // Fallback to guessing from local_path if available
    blob.local_path
        .as_ref()
        .and_then(|path| from_path(path).first())
        .map(|mime| mime.to_string())
        .unwrap_or_else(|| "application/octet-stream".to_string())
}

/// Build response for blob data
async fn build_blob_response(
    data: Vec<u8>,
    file_size: Option<u64>,
    content_type: String,
    blob: &legacylib::media::MediaBlob,
) -> Response {
    let mut headers = HeaderMap::new();

    // Set content type - ensure video/mp4 for MP4 files
    let final_content_type =
        if content_type == "video/mp4" || blob.mime.as_ref() == Some(&"video/mp4".to_string()) {
            "video/mp4"
        } else {
            &content_type
        };

    headers.insert(
        header::CONTENT_TYPE,
        final_content_type
            .parse()
            .unwrap_or_else(|_| "application/octet-stream".parse().unwrap()),
    );

    // Set content length
    let size = file_size.unwrap_or(data.len() as u64);
    headers.insert(header::CONTENT_LENGTH, size.to_string().parse().unwrap());

    // Add range support headers
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));

    // Browser-friendly cache headers for video
    headers.insert(
        header::CACHE_CONTROL,
        "public, max-age=3600, immutable".parse().unwrap(),
    );

    // Add filename if available
    add_filename_header(&mut headers, blob);

    (StatusCode::OK, headers, data).into_response()
}

/// Build streaming response for large blob data
fn build_streaming_response(
    body: Body,
    file_size: u64,
    content_type: String,
    blob: &legacylib::media::MediaBlob,
) -> Response {
    let mut headers = HeaderMap::new();

    // Set content type - ensure video/mp4 for MP4 files
    let final_content_type =
        if content_type == "video/mp4" || blob.mime.as_ref() == Some(&"video/mp4".to_string()) {
            "video/mp4"
        } else {
            &content_type
        };

    headers.insert(
        header::CONTENT_TYPE,
        final_content_type
            .parse()
            .unwrap_or_else(|_| "application/octet-stream".parse().unwrap()),
    );

    // Set content length
    headers.insert(
        header::CONTENT_LENGTH,
        file_size.to_string().parse().unwrap(),
    );

    // Add range support headers - critical for video streaming
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));

    // Browser-friendly cache headers for video
    headers.insert(
        header::CACHE_CONTROL,
        "public, max-age=3600, immutable".parse().unwrap(),
    );

    // Remove security headers that might interfere with video playback
    // Add content disposition for better browser handling
    if let Some(ref local_path) = blob.local_path {
        if let Some(filename) = std::path::Path::new(local_path).file_name() {
            if let Some(filename_str) = filename.to_str() {
                let disposition = format!("inline; filename=\"{}\"", filename_str);
                if let Ok(header_value) = disposition.parse() {
                    headers.insert(header::CONTENT_DISPOSITION, header_value);
                }
            }
        }
    }

    (StatusCode::OK, headers, body).into_response()
}

/// Add filename header if available in metadata
fn add_filename_header(headers: &mut HeaderMap, blob: &legacylib::media::MediaBlob) {
    if let Ok(meta_obj) =
        serde_json::from_value::<serde_json::Map<String, serde_json::Value>>(blob.metadata.clone())
    {
        if let Some(filename) = meta_obj.get("filename") {
            if let Some(filename_str) = filename.as_str() {
                let disposition = format!("inline; filename=\"{}\"", filename_str);
                if let Ok(header_value) = disposition.parse() {
                    headers.insert(header::CONTENT_DISPOSITION, header_value);
                }
            }
        }
    }
}

/// Get blob metadata without the actual data
///
/// Returns metadata about the blob including size, MIME type, and custom metadata
/// without transferring the actual blob data. Useful for checking blob properties.
///
/// # Path Parameters
/// - `id`: Short hash ID of the blob to get metadata for
///
/// # Response
/// - 200: Blob metadata as JSON
/// - 401: Unauthorized (handled by middleware)
/// - 403: Forbidden (insufficient permissions)
/// - 404: Blob not found
/// - 500: Internal server error
pub async fn get_blob_metadata(
    Extension(db): Extension<DatabaseConnection>,
    Path(id): Path<String>,
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Response, AppError> {
    tracing::debug!(
        blob_id = %id,
        user_id = %user.0.id,
        "Blob metadata request"
    );

    // Create media service
    let media_service =
        MediaBlobService::new(legacylib::media::MediaBlobRepository::new(db.pool().clone()));

    // Get blob without data for efficiency
    let blob = media_service
        .get_media_blob_metadata(&id)
        .await
        .map_err(|e| match e {
            legacylib::media::MediaServiceError::Repository(
                legacylib::media::MediaRepositoryError::NotFound(_),
            ) => AppError::NotFound(format!("Blob {} not found", id)),
            _ => AppError::InternalServerError(format!("Failed to retrieve blob metadata: {}", e)),
        })?;

    // TODO: Add the same permission checks as get_blob

    // Create response with metadata
    let metadata_response = serde_json::json!({
        "id": blob.id,
        "sha256": blob.sha256,
        "size": blob.size,
        "mime_type": blob.mime,
        "source_client_id": blob.source_client_id,
        "local_path": blob.local_path,
        "metadata": blob.metadata,
        "created_at": blob.created_at,
        "updated_at": blob.updated_at,
    });

    let mut headers = HeaderMap::new();
    headers.insert(header::CONTENT_TYPE, "application/json".parse().unwrap());

    tracing::debug!(
        blob_id = %id,
        user_id = %user.0.id,
        "Blob metadata access granted"
    );

    Ok((StatusCode::OK, headers, metadata_response.to_string()).into_response())
}

/// Health check for blob API
///
/// Simple endpoint to verify the blob API is operational.
/// Can be used by monitoring systems or load balancers.
pub async fn blob_api_health() -> impl IntoResponse {
    use axum::Json;

    let health_response = serde_json::json!({
        "status": "healthy",
        "service": "blob-api",
        "timestamp": time::OffsetDateTime::now_utc(),
    });

    Json(health_response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_blob_api_health() {
        let response = blob_api_health().await.into_response();
        assert_eq!(response.status(), axum::http::StatusCode::OK);

        // For a more thorough test, we could extract and parse the JSON body
        // but for now, just verifying the status code is sufficient
    }

    // Integration tests would go here
    // They would require setting up a test database and test blobs
    // Example:
    // #[tokio::test]
    // async fn test_get_blob_authenticated() {
    //     // Setup test database
    //     // Create test blob
    //     // Make authenticated request to GET /api/blobs/{id}
    //     // Verify response
    // }
}
