//! Media blob data models
//!
//! This module re-exports media blob types from grimoire with compatibility extensions
//! for the WebSocket system and HTTP API.

pub use legacylib::media::{
    CreateMediaBlob, MediaBlob, MediaBlobCursor, MediaBlobQuery, MediaBlobStats, MimeTypeCount,
    PaginatedResult, PaginationDirection, PaginationMetadata,
};

/// Common validation for media blob data (legacy compatibility)
fn validate_media_blob_common(
    sha256: &str,
    data: Option<&Vec<u8>>,
    size: Option<i64>,
    local_path: Option<&String>,
    max_blob_size: u64,
    max_fs_size: u64,
) -> Result<(), String> {
    if sha256.is_empty() {
        return Err("SHA256 hash is required".to_string());
    }

    if sha256.len() != 64 {
        return Err("SHA256 hash must be 64 characters".to_string());
    }

    // Check that we have either data or local_path
    let has_data = data.is_some() && !data.unwrap().is_empty();
    if !has_data && local_path.is_none() {
        return Err("Either data or local_path must be provided".to_string());
    }

    // Determine which limit to use based on storage type
    let max_file_size = if local_path.is_some() {
        max_fs_size
    } else {
        max_blob_size
    };

    if let Some(data_vec) = data {
        if data_vec.len() > max_file_size as usize {
            return Err(format!(
                "File size {} bytes exceeds maximum allowed size of {} bytes",
                data_vec.len(),
                max_file_size
            ));
        }
    }

    // Also check the size field if provided
    if let Some(size_val) = size {
        if size_val > max_file_size as i64 {
            return Err(format!(
                "File size {} bytes exceeds maximum allowed size of {} bytes",
                size_val, max_file_size
            ));
        }
    }

    Ok(())
}

/// Trait for server-specific MediaBlob extensions
pub trait MediaBlobExt {
    /// Get the full URL for accessing this blob if it has a local_path
    fn get_full_url(&self, base_url: &str) -> Option<String>;

    /// Get the file extension from MIME type
    fn file_extension(&self) -> Option<&str>;

    /// Validate that required fields are present with file size limits (legacy compatibility)
    fn validate(&self, max_blob_size: u64, max_fs_size: u64) -> Result<(), String>;
}

impl MediaBlobExt for MediaBlob {
    fn get_full_url(&self, base_url: &str) -> Option<String> {
        if let Some(ref local_path) = self.local_path {
            // local_path is stored as relative path like "private/uploads/abc123.jpg"
            // Convert to full URL like "http://localhost:8080/private/uploads/abc123.jpg"
            let clean_base = base_url.trim_end_matches('/');
            let clean_path = local_path.trim_start_matches('/');
            Some(format!("{}/{}", clean_base, clean_path))
        } else {
            None
        }
    }

    fn file_extension(&self) -> Option<&str> {
        match self.mime.as_deref() {
            Some("image/jpeg") => Some("jpg"),
            Some("image/png") => Some("png"),
            Some("image/gif") => Some("gif"),
            Some("image/webp") => Some("webp"),
            Some("video/mp4") => Some("mp4"),
            Some("video/webm") => Some("webm"),
            Some("video/quicktime") => Some("mov"),
            Some("audio/mpeg") => Some("mp3"),
            Some("audio/mp3") => Some("mp3"),
            Some("audio/wav") => Some("wav"),
            Some("audio/wave") => Some("wav"),
            Some("audio/ogg") => Some("ogg"),
            Some("audio/aac") => Some("aac"),
            Some("audio/flac") => Some("flac"),
            Some("audio/m4a") => Some("m4a"),
            Some("audio/webm") => Some("webm"),
            Some("application/pdf") => Some("pdf"),
            Some("text/plain") => Some("txt"),
            Some("application/json") => Some("json"),
            _ => None,
        }
    }

    fn validate(&self, max_blob_size: u64, max_fs_size: u64) -> Result<(), String> {
        validate_media_blob_common(
            &self.sha256,
            self.data.as_ref(),
            self.size,
            self.local_path.as_ref(),
            max_blob_size,
            max_fs_size,
        )
    }
}

/// Trait for server-specific CreateMediaBlob extensions
pub trait CreateMediaBlobExt {
    /// Validate creation parameters with file size limits (legacy compatibility)
    fn validate(&self, max_blob_size: u64, max_fs_size: u64) -> Result<(), String>;
}

impl CreateMediaBlobExt for CreateMediaBlob {
    fn validate(&self, max_blob_size: u64, max_fs_size: u64) -> Result<(), String> {
        validate_media_blob_common(
            &self.sha256,
            self.data.as_ref(),
            self.size,
            self.local_path.as_ref(),
            max_blob_size,
            max_fs_size,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_file_extension() {
        let blob = MediaBlob {
            id: "abc1234".to_string(),
            data: None,
            sha256: "a".repeat(64),
            size: None,
            mime: Some("image/png".to_string()),
            source_client_id: None,
            local_path: Some("/path/to/file".to_string()),
            metadata: serde_json::Value::Null,
            created_at: time::OffsetDateTime::now_utc(),
            updated_at: time::OffsetDateTime::now_utc(),
            parent_blob_id: None,
            blob_type: "original".to_string(),
        };

        assert_eq!(blob.file_extension(), Some("png"));
    }

    #[test]
    fn test_get_full_url() {
        use MediaBlobExt;

        let blob = MediaBlob {
            id: "def5678".to_string(),
            data: None,
            sha256: "a".repeat(64),
            size: None,
            mime: Some("image/png".to_string()),
            source_client_id: None,
            local_path: Some("private/uploads/test.png".to_string()),
            metadata: serde_json::Value::Null,
            created_at: time::OffsetDateTime::now_utc(),
            updated_at: time::OffsetDateTime::now_utc(),
            parent_blob_id: None,
            blob_type: "original".to_string(),
        };

        let url = blob.get_full_url("http://localhost:8080");
        assert_eq!(
            url,
            Some("http://localhost:8080/private/uploads/test.png".to_string())
        );
    }

    #[test]
    fn test_offset_query_constructor() {
        let query = MediaBlobQuery::with_offset(Some(10), Some(5));

        assert_eq!(query.limit, Some(10));
        assert_eq!(query.offset, Some(5));
        assert!(query.cursor.is_none());
        assert!(query.is_offset_based());
        assert!(!query.is_cursor_based());
    }

    #[test]
    fn test_validation() {
        use CreateMediaBlobExt;

        // Valid blob
        let valid_blob = CreateMediaBlob {
            data: Some(vec![1, 2, 3]),
            sha256: "a".repeat(64),
            size: Some(3),
            mime: Some("image/png".to_string()),
            source_client_id: None,
            local_path: None,
            parent_blob_id: None,
            blob_type: Some("original".to_string()),
            metadata: serde_json::Value::Null,
        };
        assert!(valid_blob
            .validate(10 * 1024 * 1024, 1024 * 1024 * 1024)
            .is_ok());

        // Invalid SHA256
        let invalid_blob = CreateMediaBlob {
            data: Some(vec![1, 2, 3]),
            sha256: "short".to_string(),
            size: Some(3),
            mime: Some("image/png".to_string()),
            source_client_id: None,
            local_path: None,
            parent_blob_id: None,
            blob_type: Some("original".to_string()),
            metadata: serde_json::Value::Null,
        };
        assert!(invalid_blob
            .validate(10 * 1024 * 1024, 1024 * 1024 * 1024)
            .is_err());

        // No data or path
        let no_data_blob = CreateMediaBlob {
            data: None,
            sha256: "a".repeat(64),
            size: None,
            mime: Some("image/png".to_string()),
            source_client_id: None,
            local_path: None,
            parent_blob_id: None,
            blob_type: Some("original".to_string()),
            metadata: serde_json::Value::Null,
        };
        assert!(no_data_blob
            .validate(10 * 1024 * 1024, 1024 * 1024 * 1024)
            .is_err());
    }
}
