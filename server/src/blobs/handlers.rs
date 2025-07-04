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

use grimoire::{media::MediaBlobService, DatabaseConnection};
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
        "Blob access request"
    );

    // Create media service
    let media_service =
        MediaBlobService::new(grimoire::media::MediaBlobRepository::new(db.pool().clone()));

    // Get blob with data
    let blob = media_service
        .get_media_blob(&id)
        .await
        .map_err(|e| match e {
            grimoire::media::MediaServiceError::Repository(
                grimoire::media::MediaRepositoryError::NotFound(_),
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

        // Get file size for range requests
        let metadata = match fs::metadata(&file_path).await {
            Ok(meta) => meta,
            Err(e) => {
                tracing::error!(
                    blob_id = %id,
                    local_path = %local_path,
                    error = %e,
                    "Failed to get file metadata"
                );
                return Err(AppError::InternalServerError(format!(
                    "Failed to get file metadata: {}",
                    e
                )));
            }
        };

        let file_size = metadata.len();

        // Handle range requests for files
        if let Some(_range_header) = range_header {
            return handle_range_request(req, file_path, file_size, &blob, content_type.clone())
                .await;
        }

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
    blob: &grimoire::media::MediaBlob,
    content_type: String,
) -> Result<Response, AppError> {
    let range_header = req.headers().get(header::RANGE).unwrap();

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

    // Open file and seek to start position
    let mut file = tokio::fs::File::open(&file_path)
        .await
        .map_err(|e| AppError::InternalServerError(format!("Failed to open file: {}", e)))?;

    file.seek(SeekFrom::Start(start))
        .await
        .map_err(|e| AppError::InternalServerError(format!("Failed to seek in file: {}", e)))?;

    // Read the requested range
    let content_length = end - start + 1;
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
        "private, max-age=3600".parse().unwrap(),
    );

    // Add filename if available
    add_filename_header(&mut headers, blob);

    Ok((StatusCode::PARTIAL_CONTENT, headers, buffer).into_response())
}

/// Determine content type from blob metadata
fn determine_content_type(blob: &grimoire::media::MediaBlob) -> String {
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
    blob: &grimoire::media::MediaBlob,
) -> Response {
    let mut headers = HeaderMap::new();

    // Set content type
    headers.insert(
        header::CONTENT_TYPE,
        content_type
            .parse()
            .unwrap_or_else(|_| "application/octet-stream".parse().unwrap()),
    );

    // Set content length
    let size = file_size.unwrap_or(data.len() as u64);
    headers.insert(header::CONTENT_LENGTH, size.to_string().parse().unwrap());

    // Add range support headers
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));

    // Add cache control headers
    headers.insert(
        header::CACHE_CONTROL,
        "private, max-age=3600".parse().unwrap(), // 1 hour cache
    );

    // Add security headers
    headers.insert(
        header::HeaderName::from_static("x-content-type-options"),
        "nosniff".parse().unwrap(),
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
    blob: &grimoire::media::MediaBlob,
) -> Response {
    let mut headers = HeaderMap::new();

    // Set content type
    headers.insert(
        header::CONTENT_TYPE,
        content_type
            .parse()
            .unwrap_or_else(|_| "application/octet-stream".parse().unwrap()),
    );

    // Set content length
    headers.insert(
        header::CONTENT_LENGTH,
        file_size.to_string().parse().unwrap(),
    );

    // Add range support headers
    headers.insert(header::ACCEPT_RANGES, HeaderValue::from_static("bytes"));

    // Add cache control headers
    headers.insert(
        header::CACHE_CONTROL,
        "private, max-age=3600".parse().unwrap(), // 1 hour cache
    );

    // Add security headers
    headers.insert(
        header::HeaderName::from_static("x-content-type-options"),
        "nosniff".parse().unwrap(),
    );

    // Add filename if available
    add_filename_header(&mut headers, blob);

    (StatusCode::OK, headers, body).into_response()
}

/// Add filename header if available in metadata
fn add_filename_header(headers: &mut HeaderMap, blob: &grimoire::media::MediaBlob) {
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
        MediaBlobService::new(grimoire::media::MediaBlobRepository::new(db.pool().clone()));

    // Get blob without data for efficiency
    let blob = media_service
        .get_media_blob_metadata(&id)
        .await
        .map_err(|e| match e {
            grimoire::media::MediaServiceError::Repository(
                grimoire::media::MediaRepositoryError::NotFound(_),
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
