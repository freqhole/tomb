//! Music thumbnail extraction utilities
//!
//! This module provides functionality for extracting embedded album art from audio files
//! and storing it as bytea in the database. Supports various image formats (JPEG, PNG, etc.)

use lofty::{Probe, TaggedFileExt};
use serde::{Deserialize, Serialize};
use std::path::Path;
use thiserror::Error;
use uuid::Uuid;

/// Errors that can occur during thumbnail extraction
#[derive(Debug, Error)]
pub enum ThumbnailError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Audio file parsing error: {0}")]
    AudioParsingError(String),
    #[error("No embedded artwork found")]
    NoArtworkFound,
    #[error("Unsupported image format: {0}")]
    UnsupportedFormat(String),
    #[error("Image processing error: {0}")]
    ImageProcessingError(String),
    #[error("Database error: {0}")]
    DatabaseError(String),
}

/// Information about extracted thumbnail
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailInfo {
    /// ID of the media blob containing the thumbnail data
    pub blob_id: Uuid,
    /// Image width in pixels
    pub width: u32,
    /// Image height in pixels
    pub height: u32,
    /// Image format (JPEG, PNG, etc.)
    pub format: String,
    /// File size in bytes
    pub size_bytes: u32,
    /// Content type (MIME type)
    pub content_type: String,
}

/// Raw extracted image data
#[derive(Debug, Clone)]
pub struct ExtractedImage {
    /// Raw image data bytes
    pub data: Vec<u8>,
    /// Image format detected from data
    pub format: ImageFormat,
    /// Image dimensions (if determinable)
    pub dimensions: Option<(u32, u32)>,
}

/// Supported image formats for thumbnails
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ImageFormat {
    Jpeg,
    Png,
    Gif,
    Bmp,
    WebP,
    Unknown,
}

impl ImageFormat {
    /// Get the MIME content type for this format
    pub fn content_type(&self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::Gif => "image/gif",
            Self::Bmp => "image/bmp",
            Self::WebP => "image/webp",
            Self::Unknown => "application/octet-stream",
        }
    }

    /// Get the file extension for this format
    pub fn extension(&self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::Gif => "gif",
            Self::Bmp => "bmp",
            Self::WebP => "webp",
            Self::Unknown => "bin",
        }
    }

    /// Detect format from magic bytes
    pub fn from_bytes(data: &[u8]) -> Self {
        if data.len() < 4 {
            return Self::Unknown;
        }

        match &data[0..4] {
            [0xFF, 0xD8, 0xFF, _] => Self::Jpeg,
            [0x89, 0x50, 0x4E, 0x47] => Self::Png,
            [0x47, 0x49, 0x46, 0x38] => Self::Gif,
            [0x42, 0x4D, _, _] => Self::Bmp,
            _ => {
                // Check for WebP (RIFF...WEBP)
                if data.len() >= 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
                    Self::WebP
                } else {
                    Self::Unknown
                }
            }
        }
    }
}

/// Thumbnail extractor for audio files
pub struct ThumbnailExtractor {
    /// Whether to ignore errors and continue extraction
    pub ignore_errors: bool,
    /// Maximum image size to extract (bytes)
    pub max_size_bytes: usize,
    /// Supported formats to extract
    pub supported_formats: Vec<ImageFormat>,
}

impl ThumbnailExtractor {
    /// Create a new thumbnail extractor with default settings
    pub fn new() -> Self {
        Self {
            ignore_errors: true,
            max_size_bytes: 10 * 1024 * 1024, // 10MB max
            supported_formats: vec![
                ImageFormat::Jpeg,
                ImageFormat::Png,
                ImageFormat::Gif,
                ImageFormat::WebP,
            ],
        }
    }

    /// Create a thumbnail extractor with strict error handling
    pub fn strict() -> Self {
        Self {
            ignore_errors: false,
            max_size_bytes: 10 * 1024 * 1024,
            supported_formats: vec![
                ImageFormat::Jpeg,
                ImageFormat::Png,
                ImageFormat::Gif,
                ImageFormat::WebP,
            ],
        }
    }

    /// Extract thumbnail from an audio file
    pub async fn extract_thumbnail<P: AsRef<Path>>(
        &self,
        path: P,
    ) -> Result<Option<ExtractedImage>, ThumbnailError> {
        let path = path.as_ref();

        let tagged_file = match Probe::open(path).and_then(|p| p.read()) {
            Ok(file) => file,
            Err(e) => {
                if self.ignore_errors {
                    return Ok(None);
                } else {
                    return Err(ThumbnailError::AudioParsingError(format!(
                        "Could not read audio file {:?}: {}",
                        path, e
                    )));
                }
            }
        };

        // Get primary tag
        let tag = match tagged_file.primary_tag() {
            Some(tag) => tag,
            None => {
                if self.ignore_errors {
                    return Ok(None);
                } else {
                    return Err(ThumbnailError::NoArtworkFound);
                }
            }
        };

        // Look for embedded pictures
        let pictures = tag.pictures();
        if pictures.is_empty() {
            return Ok(None);
        }

        // Find the first supported picture
        for picture in pictures {
            let data = picture.data();

            // Check size limit
            if data.len() > self.max_size_bytes {
                continue;
            }

            // Detect format
            let format = ImageFormat::from_bytes(data);
            if !self.supported_formats.contains(&format) {
                continue;
            }

            // Try to get dimensions
            let dimensions = self.extract_dimensions(data, &format);

            return Ok(Some(ExtractedImage {
                data: data.to_vec(),
                format,
                dimensions,
            }));
        }

        Ok(None)
    }

    /// Extract dimensions from image data
    fn extract_dimensions(&self, data: &[u8], format: &ImageFormat) -> Option<(u32, u32)> {
        match format {
            ImageFormat::Jpeg => self.extract_jpeg_dimensions(data),
            ImageFormat::Png => self.extract_png_dimensions(data),
            _ => None, // TODO: Add support for other formats
        }
    }

    /// Extract JPEG dimensions from raw data
    fn extract_jpeg_dimensions(&self, data: &[u8]) -> Option<(u32, u32)> {
        if data.len() < 4 || &data[0..2] != &[0xFF, 0xD8] {
            return None;
        }

        let mut pos = 2;
        while pos + 4 < data.len() {
            if data[pos] != 0xFF {
                return None;
            }

            let marker = data[pos + 1];
            pos += 2;

            // Skip variable length segments
            if marker == 0xC0 || marker == 0xC2 {
                // SOF0 or SOF2 - contains dimensions
                if pos + 6 < data.len() {
                    let height = u16::from_be_bytes([data[pos + 3], data[pos + 4]]) as u32;
                    let width = u16::from_be_bytes([data[pos + 5], data[pos + 6]]) as u32;
                    return Some((width, height));
                }
                return None;
            }

            // Get segment length
            if pos + 2 > data.len() {
                return None;
            }
            let length = u16::from_be_bytes([data[pos], data[pos + 1]]) as usize;
            pos += length;
        }

        None
    }

    /// Extract PNG dimensions from raw data
    fn extract_png_dimensions(&self, data: &[u8]) -> Option<(u32, u32)> {
        if data.len() < 24 || &data[0..8] != &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
            return None;
        }

        // IHDR chunk should be first
        if &data[12..16] != b"IHDR" {
            return None;
        }

        let width = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
        let height = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);

        Some((width, height))
    }

    /// Check if a file has embedded artwork
    pub async fn has_artwork<P: AsRef<Path>>(&self, path: P) -> Result<bool, ThumbnailError> {
        match self.extract_thumbnail(path).await? {
            Some(_) => Ok(true),
            None => Ok(false),
        }
    }

    /// Get artwork info without extracting the full image
    pub async fn get_artwork_info<P: AsRef<Path>>(
        &self,
        path: P,
    ) -> Result<Option<ArtworkInfo>, ThumbnailError> {
        let path = path.as_ref();

        let tagged_file = match Probe::open(path).and_then(|p| p.read()) {
            Ok(file) => file,
            Err(e) => {
                if self.ignore_errors {
                    return Ok(None);
                } else {
                    return Err(ThumbnailError::AudioParsingError(format!(
                        "Could not read audio file {:?}: {}",
                        path, e
                    )));
                }
            }
        };

        let tag = match tagged_file.primary_tag() {
            Some(tag) => tag,
            None => return Ok(None),
        };

        let pictures = tag.pictures();
        if pictures.is_empty() {
            return Ok(None);
        }

        for picture in pictures {
            let data = picture.data();
            if data.len() > self.max_size_bytes {
                continue;
            }

            let format = ImageFormat::from_bytes(data);
            if !self.supported_formats.contains(&format) {
                continue;
            }

            let dimensions = self.extract_dimensions(data, &format);

            return Ok(Some(ArtworkInfo {
                format,
                size_bytes: data.len(),
                dimensions,
            }));
        }

        Ok(None)
    }
}

impl Default for ThumbnailExtractor {
    fn default() -> Self {
        Self::new()
    }
}

/// Basic artwork information
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ArtworkInfo {
    /// Image format
    pub format: ImageFormat,
    /// Size in bytes
    pub size_bytes: usize,
    /// Image dimensions if available
    pub dimensions: Option<(u32, u32)>,
}

/// Convenience function to extract thumbnail with default settings
pub async fn extract_thumbnail<P: AsRef<Path>>(
    path: P,
) -> Result<Option<ExtractedImage>, ThumbnailError> {
    let extractor = ThumbnailExtractor::new();
    extractor.extract_thumbnail(path).await
}

/// Convenience function to check if file has artwork
pub async fn has_artwork<P: AsRef<Path>>(path: P) -> Result<bool, ThumbnailError> {
    let extractor = ThumbnailExtractor::new();
    extractor.has_artwork(path).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;
    use tokio::fs;

    #[test]
    fn test_image_format_detection() {
        // JPEG magic bytes
        let jpeg_bytes = [0xFF, 0xD8, 0xFF, 0xE0];
        assert_eq!(ImageFormat::from_bytes(&jpeg_bytes), ImageFormat::Jpeg);

        // PNG magic bytes
        let png_bytes = [0x89, 0x50, 0x4E, 0x47];
        assert_eq!(ImageFormat::from_bytes(&png_bytes), ImageFormat::Png);

        // GIF magic bytes
        let gif_bytes = [0x47, 0x49, 0x46, 0x38];
        assert_eq!(ImageFormat::from_bytes(&gif_bytes), ImageFormat::Gif);

        // BMP magic bytes
        let bmp_bytes = [0x42, 0x4D, 0x00, 0x00];
        assert_eq!(ImageFormat::from_bytes(&bmp_bytes), ImageFormat::Bmp);

        // Unknown format
        let unknown_bytes = [0x00, 0x00, 0x00, 0x00];
        assert_eq!(
            ImageFormat::from_bytes(&unknown_bytes),
            ImageFormat::Unknown
        );
    }

    #[test]
    fn test_image_format_content_types() {
        assert_eq!(ImageFormat::Jpeg.content_type(), "image/jpeg");
        assert_eq!(ImageFormat::Png.content_type(), "image/png");
        assert_eq!(ImageFormat::Gif.content_type(), "image/gif");
        assert_eq!(ImageFormat::Bmp.content_type(), "image/bmp");
        assert_eq!(ImageFormat::WebP.content_type(), "image/webp");
        assert_eq!(
            ImageFormat::Unknown.content_type(),
            "application/octet-stream"
        );
    }

    #[test]
    fn test_image_format_extensions() {
        assert_eq!(ImageFormat::Jpeg.extension(), "jpg");
        assert_eq!(ImageFormat::Png.extension(), "png");
        assert_eq!(ImageFormat::Gif.extension(), "gif");
        assert_eq!(ImageFormat::Bmp.extension(), "bmp");
        assert_eq!(ImageFormat::WebP.extension(), "webp");
        assert_eq!(ImageFormat::Unknown.extension(), "bin");
    }

    #[test]
    fn test_webp_detection() {
        // WebP magic bytes: RIFF...WEBP
        let webp_bytes = [
            0x52, 0x49, 0x46, 0x46, // RIFF
            0x00, 0x00, 0x00, 0x00, // file size
            0x57, 0x45, 0x42, 0x50, // WEBP
        ];
        assert_eq!(ImageFormat::from_bytes(&webp_bytes), ImageFormat::WebP);
    }

    #[tokio::test]
    async fn test_extractor_creation() {
        let extractor = ThumbnailExtractor::new();
        assert!(extractor.ignore_errors);
        assert_eq!(extractor.max_size_bytes, 10 * 1024 * 1024);
        assert!(extractor.supported_formats.contains(&ImageFormat::Jpeg));
        assert!(extractor.supported_formats.contains(&ImageFormat::Png));

        let strict_extractor = ThumbnailExtractor::strict();
        assert!(!strict_extractor.ignore_errors);
    }

    #[tokio::test]
    async fn test_extract_thumbnail_no_file() {
        let extractor = ThumbnailExtractor::new();
        let result = extractor.extract_thumbnail("/nonexistent/file.mp3").await;

        // Should return None (no artwork) when ignore_errors is true
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[tokio::test]
    async fn test_extract_thumbnail_strict_no_file() {
        let extractor = ThumbnailExtractor::strict();
        let result = extractor.extract_thumbnail("/nonexistent/file.mp3").await;

        // Should return error when ignore_errors is false
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_extract_thumbnail_non_audio_file() {
        let temp_file = NamedTempFile::new().unwrap();
        let test_content = b"This is not an audio file";
        fs::write(temp_file.path(), test_content).await.unwrap();

        let extractor = ThumbnailExtractor::new();
        let result = extractor.extract_thumbnail(temp_file.path()).await;

        // Should handle non-audio files gracefully
        assert!(result.is_ok());
        assert!(result.unwrap().is_none());
    }

    #[test]
    fn test_png_dimensions_extraction() {
        let extractor = ThumbnailExtractor::new();

        // Mock PNG data with IHDR chunk (100x200 pixels)
        let png_data = [
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
            0x00, 0x00, 0x00, 0x0D, // IHDR chunk length
            0x49, 0x48, 0x44, 0x52, // IHDR
            0x00, 0x00, 0x00, 0x64, // Width: 100
            0x00, 0x00, 0x00, 0xC8, // Height: 200
            0x08, 0x06, 0x00, 0x00, 0x00, // Rest of IHDR
        ];

        let dimensions = extractor.extract_png_dimensions(&png_data);
        assert_eq!(dimensions, Some((100, 200)));
    }

    #[test]
    fn test_invalid_png_dimensions() {
        let extractor = ThumbnailExtractor::new();

        // Invalid PNG data
        let invalid_data = [0x00, 0x01, 0x02, 0x03];
        let dimensions = extractor.extract_png_dimensions(&invalid_data);
        assert_eq!(dimensions, None);
    }

    #[test]
    fn test_convenience_functions() {
        // Test that convenience functions exist and compile
        // (We can't test functionality without real audio files)
        let _extractor = ThumbnailExtractor::default();
    }

    #[test]
    fn test_artwork_info_serialization() {
        let info = ArtworkInfo {
            format: ImageFormat::Jpeg,
            size_bytes: 1024,
            dimensions: Some((800, 600)),
        };

        // Test that it can be serialized/deserialized
        let json = serde_json::to_string(&info).unwrap();
        let deserialized: ArtworkInfo = serde_json::from_str(&json).unwrap();

        assert_eq!(deserialized.size_bytes, 1024);
        assert_eq!(deserialized.dimensions, Some((800, 600)));
    }

    #[test]
    fn test_extracted_image_structure() {
        let image = ExtractedImage {
            data: vec![0xFF, 0xD8, 0xFF, 0xE0],
            format: ImageFormat::Jpeg,
            dimensions: Some((640, 480)),
        };

        assert_eq!(image.data.len(), 4);
        assert_eq!(image.format, ImageFormat::Jpeg);
        assert_eq!(image.dimensions, Some((640, 480)));
    }
}
