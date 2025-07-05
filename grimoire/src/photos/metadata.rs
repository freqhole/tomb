//! Photo metadata extraction from EXIF data
//!
//! This module provides functionality to extract metadata from photo files,
//! including EXIF data, GPS coordinates, camera settings, and other image
//! properties. It implements the generic MetadataExtractor trait.

use crate::media::traits::MetadataExtractor;
use crate::photos::models::{Photo, PhotoMetadata};
use async_trait::async_trait;
use num_traits::FromPrimitive;
use std::path::Path;
use time::OffsetDateTime;
use tracing::{debug, warn};

/// Photo metadata extractor that reads EXIF data from image files
pub struct PhotoMetadataExtractor {
    /// Whether to extract GPS coordinates
    pub extract_gps: bool,
    /// Whether to extract full EXIF data
    pub extract_full_exif: bool,
}

/// Error type for photo metadata extraction
#[derive(Debug, thiserror::Error)]
pub enum PhotoMetadataError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("File not found: {0}")]
    FileNotFound(String),
    #[error("Invalid image format: {0}")]
    InvalidFormat(String),
    #[error("EXIF parsing error: {0}")]
    ExifParsing(String),
    #[error("Unsupported file type: {0}")]
    UnsupportedType(String),
}

impl PhotoMetadataExtractor {
    /// Create a new photo metadata extractor with default settings
    pub fn new() -> Self {
        Self {
            extract_gps: true,
            extract_full_exif: true,
        }
    }

    /// Create a new photo metadata extractor with custom settings
    pub fn with_config(extract_gps: bool, extract_full_exif: bool) -> Self {
        Self {
            extract_gps,
            extract_full_exif,
        }
    }

    /// Check if file is a supported image format
    pub fn is_supported_format(&self, file_path: &Path) -> bool {
        if let Some(ext) = file_path.extension().and_then(|e| e.to_str()) {
            matches!(
                ext.to_lowercase().as_str(),
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
        } else {
            false
        }
    }

    /// Extract basic image dimensions using a simple approach
    async fn extract_basic_dimensions(
        &self,
        file_path: &Path,
    ) -> Result<(Option<i32>, Option<i32>), PhotoMetadataError> {
        // This is a simplified implementation
        // In a real implementation, you would use an image processing library
        // like `image` crate to read file headers and extract dimensions

        debug!("Extracting basic dimensions from {}", file_path.display());

        // For now, return None for both dimensions
        // A real implementation would:
        // 1. Read the file header
        // 2. Parse image format-specific headers
        // 3. Extract width/height information

        Ok((None, None))
    }

    /// Extract EXIF data from image file
    async fn extract_exif_data(
        &self,
        file_path: &Path,
    ) -> Result<serde_json::Value, PhotoMetadataError> {
        debug!("Extracting EXIF data from {}", file_path.display());

        // This is a simplified implementation
        // In a real implementation, you would use an EXIF library like `exif` crate

        let mut exif_data = serde_json::Map::new();

        // Add some mock EXIF data based on file name for testing
        if let Some(filename) = file_path.file_name().and_then(|n| n.to_str()) {
            if filename.contains("canon") {
                exif_data.insert(
                    "Make".to_string(),
                    serde_json::Value::String("Canon".to_string()),
                );
                exif_data.insert(
                    "Model".to_string(),
                    serde_json::Value::String("EOS 5D Mark IV".to_string()),
                );
            } else if filename.contains("nikon") {
                exif_data.insert(
                    "Make".to_string(),
                    serde_json::Value::String("Nikon".to_string()),
                );
                exif_data.insert(
                    "Model".to_string(),
                    serde_json::Value::String("D850".to_string()),
                );
            }
        }

        Ok(serde_json::Value::Object(exif_data))
    }

    /// Parse EXIF date string to OffsetDateTime
    fn parse_exif_date(&self, date_str: &str) -> Option<OffsetDateTime> {
        // EXIF dates are typically in format: "2023:12:25 14:30:45"
        // Convert to ISO format and parse

        let iso_format = date_str.replace(':', "-");
        let parts: Vec<&str> = iso_format.split(' ').collect();

        if parts.len() >= 2 {
            let date_part = parts[0];
            let time_part = parts[1];
            let iso_string = format!("{}T{}Z", date_part, time_part);

            if let Ok(dt) = time::OffsetDateTime::parse(
                &iso_string,
                &time::format_description::well_known::Rfc3339,
            ) {
                return Some(dt);
            }
        }

        None
    }

    /// Extract GPS coordinates from EXIF data
    fn extract_gps_coordinates(
        &self,
        exif: &serde_json::Value,
    ) -> (
        Option<bigdecimal::BigDecimal>,
        Option<bigdecimal::BigDecimal>,
    ) {
        let latitude = exif
            .get("GPSLatitude")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<f64>().ok())
            .and_then(|f| bigdecimal::BigDecimal::from_f64(f));

        let longitude = exif
            .get("GPSLongitude")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<f64>().ok())
            .and_then(|f| bigdecimal::BigDecimal::from_f64(f));

        (latitude, longitude)
    }

    /// Create PhotoMetadata from extracted EXIF data
    fn create_metadata_from_exif(
        &self,
        exif: &serde_json::Value,
        width: Option<i32>,
        height: Option<i32>,
    ) -> PhotoMetadata {
        let mut metadata = PhotoMetadata::default();

        // Extract camera information
        if let Some(make) = exif.get("Make").and_then(|v| v.as_str()) {
            metadata.camera_make = Some(make.to_string());
        }

        if let Some(model) = exif.get("Model").and_then(|v| v.as_str()) {
            metadata.camera_model = Some(model.to_string());
        }

        if let Some(lens) = exif.get("LensModel").and_then(|v| v.as_str()) {
            metadata.lens_info = Some(lens.to_string());
        }

        // Extract technical settings
        if let Some(focal_length) = exif.get("FocalLength").and_then(|v| v.as_f64()) {
            metadata.focal_length = Some(focal_length as i32);
        }

        if let Some(aperture) = exif.get("FNumber").and_then(|v| v.as_f64()) {
            metadata.aperture = bigdecimal::BigDecimal::from_f64(aperture);
        }

        if let Some(shutter_speed) = exif.get("ExposureTime").and_then(|v| v.as_str()) {
            metadata.shutter_speed = Some(shutter_speed.to_string());
        }

        if let Some(iso) = exif.get("ISOSpeedRatings").and_then(|v| v.as_i64()) {
            metadata.iso = Some(iso as i32);
        }

        if let Some(flash) = exif.get("Flash").and_then(|v| v.as_bool()) {
            metadata.flash_used = Some(flash);
        }

        if let Some(orientation) = exif.get("Orientation").and_then(|v| v.as_i64()) {
            metadata.orientation = Some(orientation as i32);
        }

        if let Some(color_space) = exif.get("ColorSpace").and_then(|v| v.as_str()) {
            metadata.color_space = Some(color_space.to_string());
        }

        // Set dimensions
        metadata.width_px = width;
        metadata.height_px = height;

        // Extract GPS coordinates if enabled
        if self.extract_gps {
            let (lat, lon) = self.extract_gps_coordinates(exif);
            metadata.latitude = lat;
            metadata.longitude = lon;
        }

        // Extract date taken
        if let Some(date_str) = exif.get("DateTimeOriginal").and_then(|v| v.as_str()) {
            metadata.taken_at = self.parse_exif_date(date_str);
        }

        // Store full EXIF data if requested
        if self.extract_full_exif {
            metadata.extended_exif = exif.clone();
        }

        metadata
    }
}

impl Default for PhotoMetadataExtractor {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl MetadataExtractor<Photo> for PhotoMetadataExtractor {
    type Error = PhotoMetadataError;

    async fn extract_metadata(&self, file_path: &Path) -> Result<PhotoMetadata, Self::Error> {
        debug!("Extracting metadata from photo: {}", file_path.display());

        // Check if file exists
        if !file_path.exists() {
            return Err(PhotoMetadataError::FileNotFound(
                file_path.to_string_lossy().to_string(),
            ));
        }

        // Check if format is supported
        if !self.is_supported_format(file_path) {
            return Err(PhotoMetadataError::UnsupportedType(
                file_path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("unknown")
                    .to_string(),
            ));
        }

        // Extract basic dimensions
        let (width, height) = self
            .extract_basic_dimensions(file_path)
            .await
            .map_err(|e| {
                warn!(
                    "Failed to extract dimensions from {}: {}",
                    file_path.display(),
                    e
                );
                e
            })?;

        // Extract EXIF data
        let exif_data = self.extract_exif_data(file_path).await.map_err(|e| {
            warn!(
                "Failed to extract EXIF data from {}: {}",
                file_path.display(),
                e
            );
            e
        })?;

        // Create metadata from extracted data
        let metadata = self.create_metadata_from_exif(&exif_data, width, height);

        debug!(
            "Successfully extracted metadata from {}",
            file_path.display()
        );
        Ok(metadata)
    }

    fn supports_file(&self, file_path: &Path) -> bool {
        self.is_supported_format(file_path)
    }

    fn priority(&self) -> i32 {
        100 // High priority for photo metadata extraction
    }
}

/// Helper function to extract basic photo information without full EXIF parsing
pub async fn extract_basic_photo_info(
    file_path: &Path,
) -> Result<PhotoMetadata, PhotoMetadataError> {
    let extractor = PhotoMetadataExtractor::with_config(false, false);
    extractor.extract_metadata(file_path).await
}

/// Helper function to extract photo information with GPS data
pub async fn extract_photo_info_with_gps(
    file_path: &Path,
) -> Result<PhotoMetadata, PhotoMetadataError> {
    let extractor = PhotoMetadataExtractor::with_config(true, false);
    extractor.extract_metadata(file_path).await
}

/// Helper function to extract full photo metadata including extended EXIF
pub async fn extract_full_photo_metadata(
    file_path: &Path,
) -> Result<PhotoMetadata, PhotoMetadataError> {
    let extractor = PhotoMetadataExtractor::with_config(true, true);
    extractor.extract_metadata(file_path).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_metadata_extractor_creation() {
        let extractor = PhotoMetadataExtractor::new();
        assert!(extractor.extract_gps);
        assert!(extractor.extract_full_exif);

        let custom_extractor = PhotoMetadataExtractor::with_config(false, true);
        assert!(!custom_extractor.extract_gps);
        assert!(custom_extractor.extract_full_exif);
    }

    #[test]
    fn test_supported_formats() {
        let extractor = PhotoMetadataExtractor::new();

        // Common formats
        assert!(extractor.is_supported_format(Path::new("test.jpg")));
        assert!(extractor.is_supported_format(Path::new("test.jpeg")));
        assert!(extractor.is_supported_format(Path::new("test.png")));
        assert!(extractor.is_supported_format(Path::new("test.gif")));
        assert!(extractor.is_supported_format(Path::new("TEST.JPG")));

        // RAW formats
        assert!(extractor.is_supported_format(Path::new("test.cr2")));
        assert!(extractor.is_supported_format(Path::new("test.nef")));
        assert!(extractor.is_supported_format(Path::new("test.dng")));

        // Unsupported formats
        assert!(!extractor.is_supported_format(Path::new("test.mp4")));
        assert!(!extractor.is_supported_format(Path::new("test.txt")));
        assert!(!extractor.is_supported_format(Path::new("test.pdf")));
    }

    #[test]
    fn test_parse_exif_date() {
        let extractor = PhotoMetadataExtractor::new();

        // Valid EXIF date format
        let date_str = "2023:12:25 14:30:45";
        let parsed = extractor.parse_exif_date(date_str);
        assert!(parsed.is_some());

        // Invalid format
        let invalid_date = "invalid-date";
        let parsed_invalid = extractor.parse_exif_date(invalid_date);
        assert!(parsed_invalid.is_none());
    }

    #[test]
    fn test_extract_gps_coordinates() {
        let extractor = PhotoMetadataExtractor::new();

        let exif_with_gps = json!({
            "GPSLatitude": "40.7128",
            "GPSLongitude": "-74.0060"
        });

        let (lat, lon) = extractor.extract_gps_coordinates(&exif_with_gps);
        assert!(lat.is_some());
        assert!(lon.is_some());

        let exif_without_gps = json!({
            "Make": "Canon"
        });

        let (lat_none, lon_none) = extractor.extract_gps_coordinates(&exif_without_gps);
        assert!(lat_none.is_none());
        assert!(lon_none.is_none());
    }

    #[test]
    fn test_create_metadata_from_exif() {
        let extractor = PhotoMetadataExtractor::new();

        let exif_data = json!({
            "Make": "Canon",
            "Model": "EOS 5D Mark IV",
            "LensModel": "EF 24-70mm f/2.8L II USM",
            "FocalLength": 50.0,
            "FNumber": 2.8,
            "ExposureTime": "1/60",
            "ISOSpeedRatings": 400,
            "Flash": false,
            "Orientation": 1,
            "ColorSpace": "sRGB",
            "DateTimeOriginal": "2023:12:25 14:30:45"
        });

        let metadata = extractor.create_metadata_from_exif(&exif_data, Some(1920), Some(1080));

        assert_eq!(metadata.camera_make, Some("Canon".to_string()));
        assert_eq!(metadata.camera_model, Some("EOS 5D Mark IV".to_string()));
        assert_eq!(
            metadata.lens_info,
            Some("EF 24-70mm f/2.8L II USM".to_string())
        );
        assert_eq!(metadata.focal_length, Some(50));
        assert_eq!(metadata.shutter_speed, Some("1/60".to_string()));
        assert_eq!(metadata.iso, Some(400));
        assert_eq!(metadata.flash_used, Some(false));
        assert_eq!(metadata.orientation, Some(1));
        assert_eq!(metadata.color_space, Some("sRGB".to_string()));
        assert_eq!(metadata.width_px, Some(1920));
        assert_eq!(metadata.height_px, Some(1080));
        assert!(metadata.taken_at.is_some());
    }

    #[tokio::test]
    async fn test_extract_metadata_file_not_found() {
        let extractor = PhotoMetadataExtractor::new();
        let result = extractor
            .extract_metadata(Path::new("nonexistent.jpg"))
            .await;

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PhotoMetadataError::FileNotFound(_)
        ));
    }

    #[tokio::test]
    async fn test_extract_metadata_unsupported_format() {
        let extractor = PhotoMetadataExtractor::new();

        // Create a temporary file with unsupported extension
        let temp_path = std::env::temp_dir().join("test.mp4");
        std::fs::write(&temp_path, b"fake video content").unwrap();

        let result = extractor.extract_metadata(&temp_path).await;

        // Clean up
        std::fs::remove_file(&temp_path).unwrap();

        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            PhotoMetadataError::UnsupportedType(_)
        ));
    }

    #[test]
    fn test_priority() {
        let extractor = PhotoMetadataExtractor::new();
        assert_eq!(extractor.priority(), 100);
    }

    #[test]
    fn test_supports_file() {
        let extractor = PhotoMetadataExtractor::new();

        assert!(extractor.supports_file(Path::new("test.jpg")));
        assert!(extractor.supports_file(Path::new("test.png")));
        assert!(!extractor.supports_file(Path::new("test.mp4")));
    }
}
