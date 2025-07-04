//! Video scanner implementation
//!
//! This module provides a video scanner that implements the DomainScanner trait
//! for detecting and processing video files in the unified media scanning system.

use crate::media::scanner::{DomainScanner, ScanError, ScanResult};
use crate::media::traits::ScannedFile;
use crate::videos::metadata::VideoMetadataExtractor;
use crate::videos::models::VideoMetadata;
use async_trait::async_trait;

use tracing::{debug, warn};

/// Video scanner that handles video files
pub struct VideoScanner {
    metadata_extractor: VideoMetadataExtractor,
    priority: i32,
}

impl VideoScanner {
    /// Create a new video scanner
    pub fn new() -> Self {
        Self {
            metadata_extractor: VideoMetadataExtractor::new(),
            priority: 80, // Lower priority than photos but higher than music
        }
    }

    /// Create a new video scanner with custom priority
    pub fn with_priority(priority: i32) -> Self {
        Self {
            metadata_extractor: VideoMetadataExtractor::new(),
            priority,
        }
    }

    /// Check if a file extension is supported
    fn is_supported_extension(&self, extension: &str) -> bool {
        matches!(
            extension.to_lowercase().as_str(),
            "mp4"
                | "mov"
                | "avi"
                | "mkv"
                | "webm"
                | "flv"
                | "wmv"
                | "m4v"
                | "3gp"
                | "ogv"
                | "mpg"
                | "mpeg"
                | "m2v"
                | "asf"
                | "rm"
                | "rmvb"
                | "divx"
                | "xvid"
                | "ts"
                | "mts"
                | "m2ts"
                | "vob"
                | "f4v"
                | "swf"
                | "qt"
                | "dv"
                | "amv"
                | "mp2"
                | "mpe"
                | "mpv"
        )
    }

    /// Check if a MIME type is supported
    pub fn is_supported_mime_type(&self, mime_type: &str) -> bool {
        mime_type.starts_with("video/")
    }

    /// Extract basic file information
    async fn extract_basic_info(&self, file: &ScannedFile) -> Result<VideoMetadata, ScanError> {
        debug!("Extracting metadata from video: {}", file.path.display());

        // Try to extract video metadata using FFprobe
        match self.metadata_extractor.extract_metadata(&file.path).await {
            Ok(metadata) => {
                debug!("Successfully extracted video metadata");
                Ok(metadata)
            }
            Err(e) => {
                warn!("Failed to extract video metadata: {}", e);
                Err(ScanError::MetadataExtraction(e.to_string()))
            }
        }
    }

    /// Check if FFprobe is available
    pub fn is_ffprobe_available(&self) -> bool {
        self.metadata_extractor.is_available()
    }

    /// Get supported video extensions
    pub fn supported_extensions() -> Vec<&'static str> {
        vec![
            "mp4", "mov", "avi", "mkv", "webm", "flv", "wmv", "m4v", "3gp", "ogv", "mpg", "mpeg",
            "m2v", "asf", "rm", "rmvb", "divx", "xvid", "ts", "mts", "m2ts", "vob", "f4v", "swf",
            "qt", "dv", "amv", "mp2", "mpe", "mpv",
        ]
    }

    /// Get supported MIME types
    pub fn supported_mime_types() -> Vec<&'static str> {
        vec![
            "video/mp4",
            "video/quicktime",
            "video/x-msvideo",
            "video/x-matroska",
            "video/webm",
            "video/x-flv",
            "video/x-ms-wmv",
            "video/x-m4v",
            "video/3gpp",
            "video/ogg",
            "video/mpeg",
            "video/x-ms-asf",
            "video/x-ms-wmv",
            "video/x-pn-realvideo",
            "video/x-msvideo",
            "video/mp2t",
            "video/x-f4v",
            "video/x-dv",
        ]
    }
}

impl Default for VideoScanner {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl DomainScanner for VideoScanner {
    fn media_type(&self) -> &'static str {
        "video"
    }

    fn should_handle(&self, file_path: &std::path::Path) -> bool {
        // Check file extension
        if let Some(extension) = file_path.extension().and_then(|ext| ext.to_str()) {
            if self.is_supported_extension(extension) {
                return true;
            }
        }

        // For path-based checking, we only check extension
        // MIME type checking would be done later in process_file

        false
    }

    fn priority(&self) -> i32 {
        self.priority
    }

    async fn process_file(&self, file: &ScannedFile) -> Result<ScanResult, ScanError> {
        debug!("Processing video file: {}", file.path.display());

        // Check if FFprobe is available
        if !self.is_ffprobe_available() {
            warn!("FFprobe not available, skipping video processing");
            return Err(ScanError::DomainScanner(
                "FFprobe not available for video processing".to_string(),
            ));
        }

        // Extract metadata
        let metadata = self.extract_basic_info(file).await?;

        // Create successful scan result
        let result = ScanResult {
            file: file.clone(),
            media_type: self.media_type().to_string(),
            success: true,
            error: None,
            metadata: serde_json::to_value(&metadata).unwrap_or_else(|_| {
                serde_json::json!({
                    "error": "Failed to serialize video metadata"
                })
            }),
        };

        debug!("Successfully processed video file: {}", file.path.display());
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_supported_extensions() {
        let scanner = VideoScanner::new();

        assert!(scanner.is_supported_extension("mp4"));
        assert!(scanner.is_supported_extension("MP4"));
        assert!(scanner.is_supported_extension("mov"));
        assert!(scanner.is_supported_extension("avi"));
        assert!(scanner.is_supported_extension("mkv"));
        assert!(scanner.is_supported_extension("webm"));

        assert!(!scanner.is_supported_extension("txt"));
        assert!(!scanner.is_supported_extension("jpg"));
        assert!(!scanner.is_supported_extension("mp3"));
    }

    #[test]
    fn test_supported_mime_types() {
        let scanner = VideoScanner::new();

        assert!(scanner.is_supported_mime_type("video/mp4"));
        assert!(scanner.is_supported_mime_type("video/quicktime"));
        assert!(scanner.is_supported_mime_type("video/x-msvideo"));
        assert!(scanner.is_supported_mime_type("video/webm"));

        assert!(!scanner.is_supported_mime_type("audio/mp3"));
        assert!(!scanner.is_supported_mime_type("image/jpeg"));
        assert!(!scanner.is_supported_mime_type("text/plain"));
    }

    #[test]
    fn test_scanner_priority() {
        let scanner = VideoScanner::new();
        assert_eq!(scanner.priority(), 80);

        let custom_scanner = VideoScanner::with_priority(50);
        assert_eq!(custom_scanner.priority(), 50);
    }

    #[test]
    fn test_media_type() {
        let scanner = VideoScanner::new();
        assert_eq!(scanner.media_type(), "video");
    }

    #[test]
    fn test_should_handle() {
        let scanner = VideoScanner::new();

        // Test with supported extension
        let video_path = PathBuf::from("test.mp4");
        assert!(scanner.should_handle(&video_path));

        // Test with supported MIME type
        // MIME type checking not available in should_handle for path-based trait

        // Test with unsupported file
        let text_path = PathBuf::from("test.txt");
        assert!(!scanner.should_handle(&text_path));
    }

    #[test]
    fn test_static_methods() {
        let extensions = VideoScanner::supported_extensions();
        assert!(extensions.contains(&"mp4"));
        assert!(extensions.contains(&"mov"));
        assert!(extensions.contains(&"avi"));

        let mime_types = VideoScanner::supported_mime_types();
        assert!(mime_types.contains(&"video/mp4"));
        assert!(mime_types.contains(&"video/quicktime"));
        assert!(mime_types.contains(&"video/x-msvideo"));
    }

    #[tokio::test]
    async fn test_process_file_without_ffprobe() {
        let scanner = VideoScanner::new();

        let video_file = ScannedFile {
            path: PathBuf::from("test.mp4"),
            size: 1024,
            mime_type: Some("video/mp4".to_string()),
            hash: None,
        };

        // If FFprobe is not available, this should return an error
        if !scanner.is_ffprobe_available() {
            let result = scanner.process_file(&video_file).await;
            assert!(result.is_err());
        }
    }
}
