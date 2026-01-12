//! Upload models for large file handling
//!
//! This module defines the data structures for handling large file uploads
//! that are stored to disk rather than in the database as BYTEA.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Request payload for large file upload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadRequest {
    /// Original filename from the client
    pub filename: String,
    /// MIME type of the file
    pub mime_type: Option<String>,
    /// SHA256 hash of the file content
    pub sha256: String,
    /// File size in bytes
    pub size: u64,
    /// Additional metadata as JSON
    #[serde(default)]
    pub metadata: serde_json::Value,
}

/// Response after successful file upload
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UploadResponse {
    /// Short hash ID of the created media blob record
    pub id: String,
    /// Relative path where the file was stored
    pub local_path: String,
    /// SHA256 hash for verification
    pub sha256: String,
    /// File size in bytes
    pub size: u64,
    /// MIME type
    pub mime_type: Option<String>,
    /// Upload timestamp
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: time::OffsetDateTime,
    /// Music processing job ID (for audio files)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub job_id: Option<String>,
}

/// Upload validation error types
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum UploadError {
    /// File size exceeds the minimum threshold for large uploads
    FileTooSmall { size: u64, min_size: u64 },
    /// File size exceeds maximum allowed size
    FileTooLarge { size: u64, max_size: u64 },
    /// Invalid filename
    InvalidFilename(String),
    /// Invalid SHA256 hash format
    InvalidHash(String),
    /// Unsupported MIME type
    UnsupportedMimeType(String),
    /// IO error during file operations
    IoError(String),
    /// Database error
    DatabaseError(String),
    /// File already exists with same hash
    DuplicateFile { existing_id: String },
}

impl std::fmt::Display for UploadError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            UploadError::FileTooSmall { size, min_size } => {
                write!(
                    f,
                    "File size {} bytes is below minimum of {} bytes for large uploads",
                    size, min_size
                )
            }
            UploadError::FileTooLarge { size, max_size } => {
                write!(
                    f,
                    "File size {} bytes exceeds maximum of {} bytes",
                    size, max_size
                )
            }
            UploadError::InvalidFilename(name) => {
                write!(f, "Invalid filename: {}", name)
            }
            UploadError::InvalidHash(hash) => {
                write!(f, "Invalid SHA256 hash: {}", hash)
            }
            UploadError::UnsupportedMimeType(mime) => {
                write!(f, "Unsupported MIME type: {}", mime)
            }
            UploadError::IoError(msg) => {
                write!(f, "IO error: {}", msg)
            }
            UploadError::DatabaseError(msg) => {
                write!(f, "Database error: {}", msg)
            }
            UploadError::DuplicateFile { existing_id } => {
                write!(f, "File already exists with ID: {}", existing_id)
            }
        }
    }
}

impl std::error::Error for UploadError {}

/// Upload configuration and constraints
#[derive(Debug, Clone)]
pub struct UploadConfig {
    /// Minimum file size for large uploads (10MB)
    pub min_file_size: u64,
    /// Maximum file size allowed (1GB)
    pub max_file_size: u64,
    /// Upload directory path
    pub upload_directory: PathBuf,
    /// Allowed MIME types (None = allow all)
    pub allowed_mime_types: Option<Vec<String>>,
    /// Whether to check for duplicate files by hash
    pub check_duplicates: bool,
}

impl Default for UploadConfig {
    fn default() -> Self {
        Self {
            min_file_size: 10 * 1024 * 1024,   // 10MB
            max_file_size: 1024 * 1024 * 1024, // 1GB
            upload_directory: PathBuf::from("assets/private/uploads"),
            allowed_mime_types: None, // Allow all MIME types
            check_duplicates: true,
        }
    }
}

impl UploadRequest {
    /// Validate the upload request
    pub fn validate(&self, config: &UploadConfig) -> Result<(), UploadError> {
        // Check file size constraints
        if self.size < config.min_file_size {
            return Err(UploadError::FileTooSmall {
                size: self.size,
                min_size: config.min_file_size,
            });
        }

        if self.size > config.max_file_size {
            return Err(UploadError::FileTooLarge {
                size: self.size,
                max_size: config.max_file_size,
            });
        }

        // Validate filename
        if self.filename.is_empty() {
            return Err(UploadError::InvalidFilename(
                "Filename cannot be empty".to_string(),
            ));
        }

        // Check for dangerous path components
        if self.filename.contains("..")
            || self.filename.contains('/')
            || self.filename.contains('\\')
        {
            return Err(UploadError::InvalidFilename(
                "Filename contains invalid path components".to_string(),
            ));
        }

        // Validate SHA256 hash
        if self.sha256.len() != 64 {
            return Err(UploadError::InvalidHash(
                "SHA256 hash must be 64 characters".to_string(),
            ));
        }

        if !self.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(UploadError::InvalidHash(
                "SHA256 hash must contain only hexadecimal characters".to_string(),
            ));
        }

        // Check MIME type if restrictions are configured
        if let Some(ref allowed_types) = config.allowed_mime_types {
            if let Some(ref mime) = self.mime_type {
                if !allowed_types.contains(mime) {
                    return Err(UploadError::UnsupportedMimeType(mime.clone()));
                }
            }
        }

        Ok(())
    }

    /// Generate a safe filename for storage
    pub fn generate_storage_filename(&self) -> String {
        // Use SHA256 hash as base filename to avoid conflicts
        // and append original extension if available
        let extension = self.get_file_extension();
        if let Some(ext) = extension {
            format!("{}.{}", self.sha256, ext)
        } else {
            self.sha256.clone()
        }
    }

    /// Extract file extension from filename
    pub fn get_file_extension(&self) -> Option<&str> {
        self.filename
            .split('.')
            .last()
            .filter(|ext| !ext.is_empty())
    }

    /// Get MIME type from extension if not provided
    pub fn infer_mime_type(&self) -> Option<String> {
        if self.mime_type.is_some() {
            return self.mime_type.clone();
        }

        match self.get_file_extension()?.to_lowercase().as_str() {
            "jpg" | "jpeg" => Some("image/jpeg".to_string()),
            "png" => Some("image/png".to_string()),
            "gif" => Some("image/gif".to_string()),
            "webp" => Some("image/webp".to_string()),
            "mp4" => Some("video/mp4".to_string()),
            "webm" => Some("video/webm".to_string()),
            "mov" => Some("video/quicktime".to_string()),
            "mp3" => Some("audio/mpeg".to_string()),
            "wav" => Some("audio/wav".to_string()),
            "ogg" => Some("audio/ogg".to_string()),
            "pdf" => Some("application/pdf".to_string()),
            "txt" => Some("text/plain".to_string()),
            "json" => Some("application/json".to_string()),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_upload_request_validation() {
        let config = UploadConfig::default();

        // Valid request
        let valid_request = UploadRequest {
            filename: "test.jpg".to_string(),
            mime_type: Some("image/jpeg".to_string()),
            sha256: "a".repeat(64),
            size: 20 * 1024 * 1024, // 20MB
            metadata: serde_json::Value::Null,
        };
        assert!(valid_request.validate(&config).is_ok());

        // File too small
        let small_request = UploadRequest {
            size: 5 * 1024 * 1024, // 5MB
            ..valid_request.clone()
        };
        assert!(matches!(
            small_request.validate(&config),
            Err(UploadError::FileTooSmall { .. })
        ));

        // File too large
        let large_request = UploadRequest {
            size: 2 * 1024 * 1024 * 1024, // 2GB
            ..valid_request.clone()
        };
        assert!(matches!(
            large_request.validate(&config),
            Err(UploadError::FileTooLarge { .. })
        ));

        // Invalid filename
        let invalid_filename = UploadRequest {
            filename: "../../../etc/passwd".to_string(),
            ..valid_request.clone()
        };
        assert!(matches!(
            invalid_filename.validate(&config),
            Err(UploadError::InvalidFilename(_))
        ));

        // Invalid hash
        let invalid_hash = UploadRequest {
            sha256: "not_a_valid_hash".to_string(),
            ..valid_request.clone()
        };
        assert!(matches!(
            invalid_hash.validate(&config),
            Err(UploadError::InvalidHash(_))
        ));
    }

    #[test]
    fn test_generate_storage_filename() {
        let request = UploadRequest {
            filename: "test.jpg".to_string(),
            mime_type: Some("image/jpeg".to_string()),
            sha256: "abcdef1234567890".repeat(4), // 64 chars
            size: 20 * 1024 * 1024,
            metadata: serde_json::Value::Null,
        };

        let storage_name = request.generate_storage_filename();
        assert!(storage_name.ends_with(".jpg"));
        assert!(storage_name.starts_with("abcdef1234567890"));
    }

    #[test]
    fn test_mime_type_inference() {
        let request = UploadRequest {
            filename: "test.png".to_string(),
            mime_type: None,
            sha256: "a".repeat(64),
            size: 20 * 1024 * 1024,
            metadata: serde_json::Value::Null,
        };

        assert_eq!(request.infer_mime_type(), Some("image/png".to_string()));
    }
}
