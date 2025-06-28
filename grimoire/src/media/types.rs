//! Media type detection and storage strategy utilities
//!
//! This module provides utilities for detecting media types, determining MIME types,
//! and deciding storage strategies based on file characteristics and configuration.

use std::path::Path;

use crate::config::AppConfig;

/// Errors that can occur during media type detection
#[derive(Debug, thiserror::Error)]
pub enum MediaTypeError {
    #[error("Unsupported file extension: {0}")]
    UnsupportedExtension(String),
    #[error("No file extension found")]
    NoExtension,
    #[error("Invalid file path")]
    InvalidPath,
}

/// Storage strategy for media files based on source and size
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StorageStrategy {
    /// Store as bytea in database (for small files, thumbnails, etc.)
    Bytea,
    /// Store on filesystem with local_path reference
    Filesystem,
}

/// Media type detector with configuration-driven format support
#[derive(Debug, Clone)]
pub struct MediaTypeDetector {
    supported_audio_formats: Vec<String>,
    max_blob_file_size: u64,
}

impl MediaTypeDetector {
    /// Create a new media type detector from application configuration
    pub fn from_config(config: &AppConfig) -> Self {
        Self {
            supported_audio_formats: config.media.supported_audio_formats.clone(),
            max_blob_file_size: config.media.max_blob_file_size,
        }
    }

    /// Check if a file extension is a supported audio format
    pub fn is_audio_file<P: AsRef<Path>>(&self, path: P) -> Result<bool, MediaTypeError> {
        let path = path.as_ref();
        let extension = path
            .extension()
            .ok_or(MediaTypeError::NoExtension)?
            .to_str()
            .ok_or(MediaTypeError::InvalidPath)?
            .to_lowercase();

        Ok(self.supported_audio_formats.contains(&extension))
    }

    /// Get MIME type for a file based on its extension
    pub fn get_mime_type<P: AsRef<Path>>(&self, path: P) -> Result<String, MediaTypeError> {
        let path = path.as_ref();
        let extension = path
            .extension()
            .ok_or(MediaTypeError::NoExtension)?
            .to_str()
            .ok_or(MediaTypeError::InvalidPath)?
            .to_lowercase();

        let mime_type = match extension.as_str() {
            // Audio formats
            "mp3" => "audio/mpeg",
            "ogg" => "audio/ogg",
            "wav" => "audio/wav",
            "flac" => "audio/flac",
            "m4a" => "audio/mp4",

            // Image formats (for thumbnails)
            "jpg" | "jpeg" => "image/jpeg",
            "png" => "image/png",
            "gif" => "image/gif",
            "webp" => "image/webp",

            // Video formats (for future use)
            "mp4" => "video/mp4",
            "avi" => "video/x-msvideo",
            "mov" => "video/quicktime",
            "webm" => "video/webm",

            _ => return Err(MediaTypeError::UnsupportedExtension(extension)),
        };

        Ok(mime_type.to_string())
    }

    /// Determine storage strategy based on file source and size
    pub fn get_storage_strategy(&self, file_size: u64, is_client_upload: bool) -> StorageStrategy {
        if is_client_upload && file_size <= self.max_blob_file_size {
            StorageStrategy::Bytea
        } else {
            StorageStrategy::Filesystem
        }
    }

    /// Get storage strategy specifically for generated content (always bytea)
    pub fn get_generated_content_strategy(&self) -> StorageStrategy {
        StorageStrategy::Bytea
    }

    /// Get list of supported audio formats
    pub fn supported_audio_formats(&self) -> &[String] {
        &self.supported_audio_formats
    }

    /// Check if a file should be stored as bytea based on size and upload source
    pub fn should_store_as_bytea(&self, file_size: u64, is_client_upload: bool) -> bool {
        matches!(
            self.get_storage_strategy(file_size, is_client_upload),
            StorageStrategy::Bytea
        )
    }

    /// Get the maximum blob file size from configuration
    pub fn max_blob_file_size(&self) -> u64 {
        self.max_blob_file_size
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{AppConfig, MediaConfig};

    fn create_test_detector() -> MediaTypeDetector {
        let config = AppConfig {
            media: MediaConfig {
                max_blob_file_size: 10 * 1024 * 1024, // 10MB
                max_fs_file_size: 1024 * 1024 * 1024, // 1GB
                supported_audio_formats: vec![
                    "mp3".to_string(),
                    "ogg".to_string(),
                    "wav".to_string(),
                    "flac".to_string(),
                    "m4a".to_string(),
                ],
                thumbnails: Default::default(),
            },
            ..Default::default()
        };

        MediaTypeDetector::from_config(&config)
    }

    #[test]
    fn test_audio_file_detection() {
        let detector = create_test_detector();

        assert!(detector.is_audio_file("song.mp3").unwrap());
        assert!(detector.is_audio_file("track.flac").unwrap());
        assert!(detector.is_audio_file("audio.m4a").unwrap());
        assert!(!detector.is_audio_file("document.txt").unwrap());
        assert!(!detector.is_audio_file("image.jpg").unwrap());
    }

    #[test]
    fn test_mime_type_detection() {
        let detector = create_test_detector();

        assert_eq!(detector.get_mime_type("song.mp3").unwrap(), "audio/mpeg");
        assert_eq!(detector.get_mime_type("track.flac").unwrap(), "audio/flac");
        assert_eq!(detector.get_mime_type("image.png").unwrap(), "image/png");
        assert!(detector.get_mime_type("unknown.xyz").is_err());
    }

    #[test]
    fn test_storage_strategy() {
        let detector = create_test_detector();

        // Small client upload -> bytea
        assert_eq!(
            detector.get_storage_strategy(5 * 1024 * 1024, true),
            StorageStrategy::Bytea
        );

        // Large client upload -> filesystem
        assert_eq!(
            detector.get_storage_strategy(15 * 1024 * 1024, true),
            StorageStrategy::Filesystem
        );

        // Any filesystem scan -> filesystem
        assert_eq!(
            detector.get_storage_strategy(1024, false),
            StorageStrategy::Filesystem
        );

        // Generated content always bytea
        assert_eq!(
            detector.get_generated_content_strategy(),
            StorageStrategy::Bytea
        );
    }

    #[test]
    fn test_file_without_extension() {
        let detector = create_test_detector();

        assert!(detector.is_audio_file("no_extension").is_err());
        assert!(detector.get_mime_type("no_extension").is_err());
    }

    #[test]
    fn test_case_insensitive_extensions() {
        let detector = create_test_detector();

        assert!(detector.is_audio_file("SONG.MP3").unwrap());
        assert!(detector.is_audio_file("Track.FLAC").unwrap());
        assert_eq!(detector.get_mime_type("AUDIO.M4A").unwrap(), "audio/mp4");
    }
}
