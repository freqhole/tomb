//! Thumbnail helper functions for playlists
//! Reuses existing WebP conversion and blob creation infrastructure

use crate::blob_data::{convert_to_webp, create_image_blob_from_webp_data};
use crate::error::{GrimoireError, GrimoireResult};
use crate::media_blobz::BlobType;
use std::path::Path;
use tokio::fs;

/// Create a playlist thumbnail media blob from a file path
/// Reads the file, converts to WebP, and stores as binary data
pub async fn create_thumbnail_from_file<P: AsRef<Path>>(
    file_path: P,
    created_by: Option<String>,
) -> GrimoireResult<String> {
    let file_path = file_path.as_ref();

    // Validate file exists
    if !file_path.exists() {
        return Err(GrimoireError::Validation {
            field: "file_path".to_string(),
            message: format!("File does not exist: {}", file_path.display()),
        });
    }

    // Read file data
    let file_data = fs::read(file_path)
        .await
        .map_err(|e| GrimoireError::Validation {
            field: "file_path".to_string(),
            message: format!("Failed to read file {}: {}", file_path.display(), e),
        })?;

    // Validate file size (thumbnails should be reasonable size)
    if file_data.len() > 10 * 1024 * 1024 {
        // 10MB limit for input files
        return Err(GrimoireError::Validation {
            field: "file_size".to_string(),
            message: "Image file too large (max 10MB)".to_string(),
        });
    }

    create_thumbnail_from_bytes(file_data, created_by).await
}

/// Create a playlist thumbnail media blob from binary data
/// Converts to WebP, computes SHA256, and stores as binary data
pub async fn create_thumbnail_from_bytes(
    data: Vec<u8>,
    created_by: Option<String>,
) -> GrimoireResult<String> {
    // Validate data size
    if data.is_empty() {
        return Err(GrimoireError::Validation {
            field: "data".to_string(),
            message: "Image data cannot be empty".to_string(),
        });
    }

    if data.len() > 10 * 1024 * 1024 {
        // 10MB limit for input
        return Err(GrimoireError::Validation {
            field: "data_size".to_string(),
            message: "Image data too large (max 10MB)".to_string(),
        });
    }

    // Convert to WebP using existing infrastructure
    let webp_data = convert_to_webp(&data)?;

    // Create metadata for playlist thumbnail
    let metadata = serde_json::json!({
        "type": "playlist_thumbnail",
        "format": "webp",
        "generated_with": "grimoire",
        "source": "user_upload"
    });

    // Use shared function for creating image blob
    match create_image_blob_from_webp_data(
        webp_data,
        BlobType::Thumbnail, // playlist images should always be thumbnails
        None,                // no parent blob
        metadata,
        created_by,
    )
    .await
    {
        response if response.success => match response.data {
            Some(id) => Ok(id),
            None => Err(GrimoireError::ProcessingFailed {
                message: "Failed to create image blob: no data returned".to_string(),
            }),
        },
        response => {
            let error_msg = if !response.errors.is_empty() {
                response.errors[0].detail.clone()
            } else {
                response.message
            };
            Err(GrimoireError::ProcessingFailed {
                message: format!("Failed to create image blob: {}", error_msg),
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_reject_empty_data() {
        let result = create_thumbnail_from_bytes(vec![], None).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("cannot be empty"));
    }

    #[tokio::test]
    async fn test_reject_large_data() {
        let large_data = vec![0u8; 11 * 1024 * 1024]; // 11MB
        let result = create_thumbnail_from_bytes(large_data, None).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("too large"));
    }

    #[tokio::test]
    async fn test_create_thumbnail_from_nonexistent_file() {
        let result = create_thumbnail_from_file("/nonexistent/file.jpg", None).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("does not exist"));
    }
}
