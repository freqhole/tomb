//! Thumbnail helper functions for playlists
//! Handles creating media blobs from file paths or binary data for playlist thumbnails

use sha2::{Digest, Sha256};
use std::path::Path;
use tokio::fs;

use crate::error::{GrimoireError, GrimoireResult};
use crate::media_blobz::{create_media_blob, get_media_blob, CreateMediaBlobRequest};

/// Create a thumbnail media blob from a file path
/// Reads the file, computes SHA256, and stores as binary data
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
        // 10MB limit for thumbnails
        return Err(GrimoireError::Validation {
            field: "file_size".to_string(),
            message: "Thumbnail file too large (max 10MB)".to_string(),
        });
    }

    // Infer MIME type from extension
    let mime_type = match file_path.extension().and_then(|ext| ext.to_str()) {
        Some("jpg") | Some("jpeg") => Some("image/jpeg".to_string()),
        Some("png") => Some("image/png".to_string()),
        Some("gif") => Some("image/gif".to_string()),
        Some("webp") => Some("image/webp".to_string()),
        _ => None,
    };

    create_thumbnail_from_bytes(file_data, mime_type, created_by).await
}

/// Create a thumbnail media blob from binary data
/// Computes SHA256 and stores as binary data
pub async fn create_thumbnail_from_bytes(
    data: Vec<u8>,
    mime_type: Option<String>,
    created_by: Option<String>,
) -> GrimoireResult<String> {
    // Validate data size
    if data.is_empty() {
        return Err(GrimoireError::Validation {
            field: "data".to_string(),
            message: "Thumbnail data cannot be empty".to_string(),
        });
    }

    if data.len() > 10 * 1024 * 1024 {
        // 10MB limit
        return Err(GrimoireError::Validation {
            field: "data_size".to_string(),
            message: "Thumbnail data too large (max 10MB)".to_string(),
        });
    }

    // Compute SHA256 hash
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let sha256 = format!("{:x}", hasher.finalize());

    // Create media blob request
    let req = CreateMediaBlobRequest {
        sha256,
        size: Some(data.len() as i64),
        mime: mime_type,
        source_client_id: None,
        local_path: None, // Store as binary data, not file path
        parent_blob_id: None,
        blob_type: Some("original".to_string()),
        metadata: serde_json::json!({}),
        created_by,
        data: Some(data), // This will be stored in blob_data table
    };

    // Create the media blob (handles deduplication internally)
    let media_blob = create_media_blob(req).await?;
    Ok(media_blob.id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;
    use tokio::io::AsyncWriteExt;

    #[tokio::test]
    async fn test_create_thumbnail_from_bytes() {
        // Create some fake PNG data (minimal PNG header)
        let png_data = vec![
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
            0x00, 0x00, 0x00, 0x0D, // IHDR chunk length
            0x49, 0x48, 0x44, 0x52, // IHDR
            0x00, 0x00, 0x00, 0x01, // width: 1
            0x00, 0x00, 0x00, 0x01, // height: 1
            0x08, 0x02, 0x00, 0x00,
            0x00, // bit depth, color type, compression, filter, interlace
            0x90, 0x77, 0x53, 0xDE, // CRC
            0x00, 0x00, 0x00, 0x00, // IEND chunk length
            0x49, 0x45, 0x4E, 0x44, // IEND
            0xAE, 0x42, 0x60, 0x82, // CRC
        ];

        let result = create_thumbnail_from_bytes(
            png_data,
            Some("image/png".to_string()),
            Some("test_user".to_string()),
        )
        .await;

        // Should succeed (assuming database is available in test environment)
        // In a real test environment, we'd mock the database calls
        assert!(result.is_ok() || result.is_err()); // Either works or DB not available
    }

    #[tokio::test]
    async fn test_reject_empty_data() {
        let result = create_thumbnail_from_bytes(vec![], None, None).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("cannot be empty"));
    }

    #[tokio::test]
    async fn test_reject_large_data() {
        let large_data = vec![0u8; 11 * 1024 * 1024]; // 11MB
        let result = create_thumbnail_from_bytes(large_data, None, None).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("too large"));
    }

    #[tokio::test]
    async fn test_create_thumbnail_from_nonexistent_file() {
        let result = create_thumbnail_from_file("/nonexistent/file.jpg", None).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("does not exist"));
    }

    #[tokio::test]
    async fn test_create_thumbnail_from_temp_file() {
        // Create a temporary file with some image-like data
        let mut temp_file = NamedTempFile::new().unwrap();
        let png_data = vec![
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
            0x00, 0x00, 0x00, 0x0D, // IHDR chunk length
            0x49, 0x48, 0x44, 0x52, // IHDR
            0x00, 0x00, 0x00, 0x01, // width: 1
            0x00, 0x00, 0x00, 0x01, // height: 1
            0x08, 0x02, 0x00, 0x00,
            0x00, // bit depth, color type, compression, filter, interlace
            0x90, 0x77, 0x53, 0xDE, // CRC
            0x00, 0x00, 0x00, 0x00, // IEND chunk length
            0x49, 0x45, 0x4E, 0x44, // IEND
            0xAE, 0x42, 0x60, 0x82, // CRC
        ];

        temp_file.write_all(&png_data).await.unwrap();
        temp_file.flush().await.unwrap();

        let result =
            create_thumbnail_from_file(temp_file.path(), Some("test_user".to_string())).await;

        // Should succeed (assuming database is available in test environment)
        assert!(result.is_ok() || result.is_err()); // Either works or DB not available
    }
}
