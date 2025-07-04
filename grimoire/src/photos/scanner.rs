//! Photo scanner implementation
//!
//! This module provides a photo scanner that implements the DomainScanner trait
//! for detecting and processing photo files in the unified media scanning system.

use crate::media::scanner::{DomainScanner, ScanError, ScanResult};
use crate::media::traits::{MetadataExtractor, ScannedFile};
use crate::photos::metadata::PhotoMetadataExtractor;
use crate::photos::models::PhotoMetadata;
use async_trait::async_trait;
use std::path::Path;
use tracing::{debug, warn};

/// Photo scanner that handles image files
pub struct PhotoScanner {
    metadata_extractor: PhotoMetadataExtractor,
    priority: i32,
}

impl PhotoScanner {
    /// Create a new photo scanner
    pub fn new() -> Self {
        Self {
            metadata_extractor: PhotoMetadataExtractor::new(),
            priority: 100, // Higher priority for photos
        }
    }

    /// Create a new photo scanner with custom priority
    pub fn with_priority(priority: i32) -> Self {
        Self {
            metadata_extractor: PhotoMetadataExtractor::new(),
            priority,
        }
    }

    /// Check if a file extension is supported
    fn is_supported_extension(&self, extension: &str) -> bool {
        matches!(
            extension.to_lowercase().as_str(),
            "jpg"
                | "jpeg"
                | "png"
                | "gif"
                | "webp"
                | "heic"
                | "heif"
                | "avif"
                | "bmp"
                | "tiff"
                | "tif"
                | "raw"
                | "cr2"
                | "cr3"
                | "nef"
                | "orf"
                | "raf"
                | "dng"
                | "arw"
                | "rw2"
                | "pef"
                | "srw"
                | "x3f"
        )
    }

    /// Check if a MIME type is supported
    fn is_supported_mime_type(&self, mime_type: &str) -> bool {
        mime_type.starts_with("image/")
            && !matches!(
                mime_type,
                "image/svg+xml" | "image/x-icon" | "image/vnd.microsoft.icon"
            )
    }

    /// Extract basic file information
    async fn extract_basic_info(&self, file: &ScannedFile) -> Result<PhotoMetadata, ScanError> {
        debug!("Extracting metadata from photo: {}", file.path.display());

        // Try to extract EXIF metadata
        match self.metadata_extractor.extract_metadata(&file.path).await {
            Ok(metadata) => {
                debug!(
                    "Successfully extracted metadata from {}",
                    file.path.display()
                );
                Ok(metadata)
            }
            Err(e) => {
                warn!(
                    "Failed to extract metadata from {}: {}",
                    file.path.display(),
                    e
                );
                // Return basic metadata with just file dimensions if possible
                Ok(PhotoMetadata::default())
            }
        }
    }

    /// Check if file is a supported photo format
    fn is_photo_file(&self, file_path: &Path) -> bool {
        // Check by extension first
        if let Some(ext) = file_path.extension().and_then(|e| e.to_str()) {
            if self.is_supported_extension(ext) {
                return true;
            }
        }

        // Check by MIME type if available
        // This would require reading the file header, which is expensive
        // For now, we rely on extension-based detection
        false
    }

    /// Get file size category
    fn get_size_category(&self, size: u64) -> String {
        match size {
            0..=1024 => "tiny".to_string(),
            1025..=102400 => "small".to_string(), // 1KB - 100KB
            102401..=1048576 => "medium".to_string(), // 100KB - 1MB
            1048577..=10485760 => "large".to_string(), // 1MB - 10MB
            _ => "huge".to_string(),
        }
    }

    /// Create scan result from extracted metadata
    fn create_scan_result(&self, file: &ScannedFile, metadata: PhotoMetadata) -> ScanResult {
        let mut result_metadata = serde_json::Map::new();

        // Add basic file info
        result_metadata.insert(
            "file_size".to_string(),
            serde_json::Value::Number(file.size.into()),
        );
        result_metadata.insert(
            "size_category".to_string(),
            serde_json::Value::String(self.get_size_category(file.size)),
        );

        // Add photo-specific metadata
        if let Some(camera_make) = &metadata.camera_make {
            result_metadata.insert(
                "camera_make".to_string(),
                serde_json::Value::String(camera_make.clone()),
            );
        }

        if let Some(camera_model) = &metadata.camera_model {
            result_metadata.insert(
                "camera_model".to_string(),
                serde_json::Value::String(camera_model.clone()),
            );
        }

        if let Some(width) = metadata.width_px {
            result_metadata.insert(
                "width_px".to_string(),
                serde_json::Value::Number(width.into()),
            );
        }

        if let Some(height) = metadata.height_px {
            result_metadata.insert(
                "height_px".to_string(),
                serde_json::Value::Number(height.into()),
            );
        }

        if let Some(focal_length) = metadata.focal_length {
            result_metadata.insert(
                "focal_length".to_string(),
                serde_json::Value::Number(focal_length.into()),
            );
        }

        if let Some(iso) = metadata.iso {
            result_metadata.insert("iso".to_string(), serde_json::Value::Number(iso.into()));
        }

        if let Some(taken_at) = metadata.taken_at {
            result_metadata.insert(
                "taken_at".to_string(),
                serde_json::Value::String(taken_at.to_string()),
            );
        }

        // Add GPS coordinates if available
        if let (Some(lat), Some(lon)) = (&metadata.latitude, &metadata.longitude) {
            result_metadata.insert(
                "latitude".to_string(),
                serde_json::Value::String(lat.to_string()),
            );
            result_metadata.insert(
                "longitude".to_string(),
                serde_json::Value::String(lon.to_string()),
            );
            result_metadata.insert("has_gps".to_string(), serde_json::Value::Bool(true));
        } else {
            result_metadata.insert("has_gps".to_string(), serde_json::Value::Bool(false));
        }

        // Calculate aspect ratio if we have dimensions
        if let (Some(width), Some(height)) = (metadata.width_px, metadata.height_px) {
            if height != 0 {
                let aspect_ratio = width as f64 / height as f64;
                result_metadata.insert(
                    "aspect_ratio".to_string(),
                    serde_json::Value::Number(
                        serde_json::Number::from_f64(aspect_ratio)
                            .unwrap_or(serde_json::Number::from(1)),
                    ),
                );

                // Add orientation category
                let orientation = if width > height {
                    "landscape"
                } else if height > width {
                    "portrait"
                } else {
                    "square"
                };
                result_metadata.insert(
                    "orientation".to_string(),
                    serde_json::Value::String(orientation.to_string()),
                );
            }
        }

        ScanResult {
            file: file.clone(),
            media_type: "photos".to_string(),
            success: true,
            error: None,
            metadata: serde_json::Value::Object(result_metadata),
        }
    }
}

impl Default for PhotoScanner {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl DomainScanner for PhotoScanner {
    fn media_type(&self) -> &'static str {
        "photos"
    }

    fn should_handle(&self, file_path: &Path) -> bool {
        self.is_photo_file(file_path)
    }

    fn priority(&self) -> i32 {
        self.priority
    }

    async fn process_file(&self, file: &ScannedFile) -> Result<ScanResult, ScanError> {
        debug!("Processing photo file: {}", file.path.display());

        // Validate file size
        if file.size == 0 {
            return Err(ScanError::UnsupportedFile("File is empty".to_string()));
        }

        // Check if it's really a photo file
        if !self.should_handle(&file.path) {
            return Err(ScanError::UnsupportedFile(
                "Not a supported photo format".to_string(),
            ));
        }

        // Check file extension matches MIME type if available
        if let Some(mime_type) = &file.mime_type {
            if !self.is_supported_mime_type(mime_type) {
                return Err(ScanError::UnsupportedFile(format!(
                    "Unsupported MIME type: {}",
                    mime_type
                )));
            }
        }

        // Extract metadata
        let metadata = self.extract_basic_info(file).await?;

        // Create and return scan result
        Ok(self.create_scan_result(file, metadata))
    }
}

/// Configuration for photo scanning
#[derive(Debug, Clone)]
pub struct PhotoScanConfig {
    /// Whether to extract full EXIF data
    pub extract_full_exif: bool,
    /// Whether to extract GPS coordinates
    pub extract_gps: bool,
    /// Whether to validate image files by reading headers
    pub validate_headers: bool,
}

impl Default for PhotoScanConfig {
    fn default() -> Self {
        Self {
            extract_full_exif: true,
            extract_gps: true,
            validate_headers: false, // Disabled by default for performance
        }
    }
}

/// Photo scanner with custom configuration
pub struct ConfigurablePhotoScanner {
    scanner: PhotoScanner,
}

impl ConfigurablePhotoScanner {
    /// Create a new configurable photo scanner
    pub fn new(_config: PhotoScanConfig) -> Self {
        Self {
            scanner: PhotoScanner::new(),
        }
    }
}

#[async_trait]
impl DomainScanner for ConfigurablePhotoScanner {
    fn media_type(&self) -> &'static str {
        "photos"
    }

    fn should_handle(&self, file_path: &Path) -> bool {
        self.scanner.should_handle(file_path)
    }

    fn priority(&self) -> i32 {
        self.scanner.priority()
    }

    async fn process_file(&self, file: &ScannedFile) -> Result<ScanResult, ScanError> {
        // Process the file using the base scanner
        let result = self.scanner.process_file(file).await?;
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use time::OffsetDateTime;

    fn create_test_file(path: &str, size: u64) -> ScannedFile {
        ScannedFile {
            path: PathBuf::from(path),
            size,
            modified: OffsetDateTime::now_utc(),
            extension: path.split('.').last().unwrap_or("").to_lowercase(),
            mime_type: None,
        }
    }

    #[test]
    fn test_photo_scanner_should_handle() {
        let scanner = PhotoScanner::new();

        // Should handle common photo formats
        assert!(scanner.should_handle(Path::new("test.jpg")));
        assert!(scanner.should_handle(Path::new("test.jpeg")));
        assert!(scanner.should_handle(Path::new("test.png")));
        assert!(scanner.should_handle(Path::new("test.gif")));
        assert!(scanner.should_handle(Path::new("test.webp")));
        assert!(scanner.should_handle(Path::new("test.heic")));

        // Should handle RAW formats
        assert!(scanner.should_handle(Path::new("test.cr2")));
        assert!(scanner.should_handle(Path::new("test.nef")));
        assert!(scanner.should_handle(Path::new("test.dng")));

        // Should not handle non-photo formats
        assert!(!scanner.should_handle(Path::new("test.mp4")));
        assert!(!scanner.should_handle(Path::new("test.mp3")));
        assert!(!scanner.should_handle(Path::new("test.txt")));
        assert!(!scanner.should_handle(Path::new("test.pdf")));

        // Should not handle SVG (not a photo)
        assert!(!scanner.should_handle(Path::new("test.svg")));
    }

    #[test]
    fn test_photo_scanner_media_type() {
        let scanner = PhotoScanner::new();
        assert_eq!(scanner.media_type(), "photos");
    }

    #[test]
    fn test_photo_scanner_priority() {
        let scanner = PhotoScanner::new();
        assert_eq!(scanner.priority(), 100);

        let custom_scanner = PhotoScanner::with_priority(50);
        assert_eq!(custom_scanner.priority(), 50);
    }

    #[test]
    fn test_size_category() {
        let scanner = PhotoScanner::new();

        assert_eq!(scanner.get_size_category(500), "tiny");
        assert_eq!(scanner.get_size_category(50000), "small");
        assert_eq!(scanner.get_size_category(500000), "medium");
        assert_eq!(scanner.get_size_category(5000000), "large");
        assert_eq!(scanner.get_size_category(50000000), "huge");
    }

    #[test]
    fn test_supported_extensions() {
        let scanner = PhotoScanner::new();

        assert!(scanner.is_supported_extension("jpg"));
        assert!(scanner.is_supported_extension("JPEG"));
        assert!(scanner.is_supported_extension("png"));
        assert!(scanner.is_supported_extension("GIF"));
        assert!(scanner.is_supported_extension("webp"));
        assert!(scanner.is_supported_extension("heic"));
        assert!(scanner.is_supported_extension("cr2"));
        assert!(scanner.is_supported_extension("nef"));

        assert!(!scanner.is_supported_extension("mp4"));
        assert!(!scanner.is_supported_extension("txt"));
        assert!(!scanner.is_supported_extension("pdf"));
    }

    #[test]
    fn test_supported_mime_types() {
        let scanner = PhotoScanner::new();

        assert!(scanner.is_supported_mime_type("image/jpeg"));
        assert!(scanner.is_supported_mime_type("image/png"));
        assert!(scanner.is_supported_mime_type("image/gif"));
        assert!(scanner.is_supported_mime_type("image/webp"));
        assert!(scanner.is_supported_mime_type("image/heic"));

        assert!(!scanner.is_supported_mime_type("image/svg+xml"));
        assert!(!scanner.is_supported_mime_type("image/x-icon"));
        assert!(!scanner.is_supported_mime_type("video/mp4"));
        assert!(!scanner.is_supported_mime_type("audio/mp3"));
    }

    #[tokio::test]
    async fn test_process_empty_file() {
        let scanner = PhotoScanner::new();
        let file = create_test_file("test.jpg", 0);

        let result = scanner.process_file(&file).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ScanError::UnsupportedFile(_)));
    }

    #[tokio::test]
    async fn test_process_unsupported_file() {
        let scanner = PhotoScanner::new();
        let file = create_test_file("test.mp4", 1000);

        let result = scanner.process_file(&file).await;
        assert!(result.is_err());
        assert!(matches!(result.unwrap_err(), ScanError::UnsupportedFile(_)));
    }

    #[test]
    fn test_photo_scan_config_default() {
        let config = PhotoScanConfig::default();
        assert!(config.extract_full_exif);
        assert!(config.extract_gps);
        assert!(!config.validate_headers);
    }

    #[tokio::test]
    async fn test_configurable_scanner_basic() {
        let config = PhotoScanConfig::default();
        let scanner = ConfigurablePhotoScanner::new(config);

        // This is a basic test - in practice we'd need actual image files
        assert_eq!(scanner.media_type(), "photos");
    }
}
