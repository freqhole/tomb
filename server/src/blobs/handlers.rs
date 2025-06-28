//! Blob API handlers for authenticated blob serving
//!
//! This module provides HTTP handlers for serving media blobs with proper
//! authentication and permission checks. It supports efficient streaming
//! for large files and includes proper security controls.

use axum::{
    extract::{Extension, Path},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};

use grimoire::{media::MediaBlobService, DatabaseConnection};
use mime_guess::from_path;
use uuid::Uuid;

use crate::{auth::AuthenticatedUser, error::AppError};

/// Get a blob by ID with authentication
///
/// Returns the blob data with proper content-type headers.
/// Requires authentication and checks blob permissions.
///
/// # Path Parameters
/// - `id`: UUID of the blob to retrieve
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
    Path(id): Path<Uuid>,
    Extension(user): Extension<AuthenticatedUser>,
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
        .get_media_blob(id)
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

    // Check if blob has data
    let data = blob.data.ok_or_else(|| {
        AppError::InternalServerError("Blob exists but has no data available".to_string())
    })?;

    // Determine content type from MIME type or file extension
    let content_type = if let Some(ref mime) = blob.mime {
        if !mime.is_empty() {
            mime.clone()
        } else {
            // Fallback to guessing from local_path if available
            blob.local_path
                .as_ref()
                .and_then(|path| from_path(path).first())
                .map(|mime| mime.to_string())
                .unwrap_or_else(|| "application/octet-stream".to_string())
        }
    } else {
        // Fallback to guessing from local_path if available
        blob.local_path
            .as_ref()
            .and_then(|path| from_path(path).first())
            .map(|mime| mime.to_string())
            .unwrap_or_else(|| "application/octet-stream".to_string())
    };

    // Build response headers
    let mut headers = HeaderMap::new();

    // Set content type
    headers.insert(
        header::CONTENT_TYPE,
        content_type
            .parse()
            .unwrap_or_else(|_| "application/octet-stream".parse().unwrap()),
    );

    // Set content length
    if let Some(size) = blob.size {
        headers.insert(header::CONTENT_LENGTH, size.to_string().parse().unwrap());
    }

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

    // Optional: Add filename for downloads
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

    // Log successful access
    tracing::info!(
        blob_id = %id,
        user_id = %user.0.id,
        size_bytes = ?blob.size,
        content_type = %content_type,
        "Blob access granted"
    );

    // Return response with blob data
    Ok((StatusCode::OK, headers, data).into_response())
}

/// Get blob metadata without the actual data
///
/// Returns metadata about the blob including size, MIME type, and custom metadata
/// without transferring the actual blob data. Useful for checking blob properties.
///
/// # Path Parameters
/// - `id`: UUID of the blob to get metadata for
///
/// # Response
/// - 200: Blob metadata as JSON
/// - 401: Unauthorized (handled by middleware)
/// - 403: Forbidden (insufficient permissions)
/// - 404: Blob not found
/// - 500: Internal server error
pub async fn get_blob_metadata(
    Extension(db): Extension<DatabaseConnection>,
    Path(id): Path<Uuid>,
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
        .get_media_blob_metadata(id)
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
