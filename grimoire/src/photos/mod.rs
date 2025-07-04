//! Photos domain module
//!
//! This module provides comprehensive photo management functionality including:
//! - Photo metadata extraction from EXIF data
//! - Gallery management for organizing photos
//! - Photo scanning and discovery
//! - GPS coordinate handling
//! - Camera and technical information processing
//!
//! ## Key Features
//!
//! - **EXIF Metadata**: Extract camera settings, GPS coordinates, and technical data
//! - **Gallery Management**: Create and manage photo collections
//! - **Photo Scanning**: Discover and process photo files in directories
//! - **Format Support**: Handle JPEG, PNG, RAW formats and more
//! - **Generic Traits**: Implements MediaItem and MediaCollection traits
//!
//! ## Usage Examples
//!
//! ### Extract photo metadata
//!
//! ```rust
//! use grimoire::photos::{PhotoMetadataExtractor, extract_full_photo_metadata};
//! use std::path::Path;
//!
//! let metadata = extract_full_photo_metadata(Path::new("photo.jpg")).await?;
//! println!("Camera: {:?}", metadata.camera_make);
//! println!("GPS: {:?}", (metadata.latitude, metadata.longitude));
//! ```
//!
//! ### Scan for photos
//!
//! ```rust
//! use grimoire::photos::PhotoScanner;
//! use grimoire::media::scanner::UnifiedScannerBuilder;
//!
//! let scanner = UnifiedScannerBuilder::new()
//!     .add_scanner(PhotoScanner::new())
//!     .build();
//!
//! let results = scanner.scan_directory(Path::new("/photos")).await?;
//! ```
//!
//! ### Work with galleries
//!
//! ```rust
//! use grimoire::photos::{CreateGallery, Gallery};
//!
//! let gallery = CreateGallery {
//!     title: "Vacation Photos".to_string(),
//!     description: Some("Photos from our trip".to_string()),
//!     is_public: true,
//!     is_collaborative: false,
//!     ..Default::default()
//! };
//! ```

pub mod metadata;
pub mod models;
pub mod scanner;

// Re-export main types for convenience
pub use metadata::{
    extract_basic_photo_info, extract_full_photo_metadata, extract_photo_info_with_gps,
    PhotoMetadataError, PhotoMetadataExtractor,
};
pub use models::{
    CreateGallery, CreatePhoto, Gallery, GalleryQuery, Photo, PhotoGallery, PhotoMetadata,
    PhotoQuery, UpdateGallery, UpdatePhoto,
};
pub use scanner::{ConfigurablePhotoScanner, PhotoScanConfig, PhotoScanner};

/// Re-exports for convenience
pub mod prelude {
    pub use super::{
        CreateGallery, CreatePhoto, Gallery, Photo, PhotoMetadata, PhotoMetadataExtractor,
        PhotoScanner,
    };
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use std::path::Path;

    #[tokio::test]
    async fn test_photo_metadata_extraction() {
        // This would test the full metadata extraction pipeline
        // when actual image files are available
        let extractor = PhotoMetadataExtractor::new();
        assert!(extractor.supports_file(Path::new("test.jpg")));
    }

    #[test]
    fn test_photo_model_traits() {
        // Test that Photo implements MediaItem trait
        let photo = Photo::default();
        assert!(!photo.is_deleted());
        assert!(!photo.is_favorite());
        assert_eq!(photo.tags().len(), 0);
    }

    #[test]
    fn test_gallery_model_traits() {
        // Test that Gallery implements MediaCollection trait
        let gallery = Gallery::default();
        assert!(!gallery.is_deleted());
        assert!(!gallery.is_public());
        assert!(!gallery.is_collaborative());
    }
}
