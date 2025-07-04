//! Photo domain models
//!
//! This module provides data models for photos and galleries in the photo domain.
//! These models implement the generic media traits to enable code reuse across
//! different media domains while maintaining photo-specific functionality.

use crate::media::traits::{MediaCollection, MediaItem};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// A photo entity representing an image file
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Photo {
    pub id: Uuid,
    pub media_blob_id: String,
    pub thumbnail_blob_id: Option<String>,
    pub title: Option<String>,
    pub caption: Option<String>,
    pub alt_text: Option<String>,
    pub location: Option<String>,
    pub latitude: Option<rust_decimal::Decimal>,
    pub longitude: Option<rust_decimal::Decimal>,
    pub taken_at: Option<OffsetDateTime>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens_info: Option<String>,
    pub focal_length: Option<i32>,
    pub aperture: Option<rust_decimal::Decimal>,
    pub shutter_speed: Option<String>,
    pub iso: Option<i32>,
    pub flash_used: Option<bool>,
    pub orientation: Option<i32>,
    pub width_px: Option<i32>,
    pub height_px: Option<i32>,
    pub color_space: Option<String>,
    pub rating: Option<i32>,
    pub is_favorite: bool,
    pub tags: Vec<String>,
    pub metadata: serde_json::Value,
    pub deleted_at: Option<OffsetDateTime>,
    pub deleted_by: Option<Uuid>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub version: i64,
}

/// Photo-specific metadata extracted from EXIF data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PhotoMetadata {
    /// Camera make (e.g., "Canon", "Nikon")
    pub camera_make: Option<String>,
    /// Camera model (e.g., "EOS 5D Mark IV")
    pub camera_model: Option<String>,
    /// Lens information
    pub lens_info: Option<String>,
    /// Focal length in millimeters
    pub focal_length: Option<i32>,
    /// Aperture value (f-stop)
    pub aperture: Option<rust_decimal::Decimal>,
    /// Shutter speed as string (e.g., "1/60", "2s")
    pub shutter_speed: Option<String>,
    /// ISO sensitivity value
    pub iso: Option<i32>,
    /// Whether flash was used
    pub flash_used: Option<bool>,
    /// EXIF orientation value (1-8)
    pub orientation: Option<i32>,
    /// Image width in pixels
    pub width_px: Option<i32>,
    /// Image height in pixels
    pub height_px: Option<i32>,
    /// Color space (sRGB, Adobe RGB, etc.)
    pub color_space: Option<String>,
    /// GPS coordinates
    pub latitude: Option<rust_decimal::Decimal>,
    pub longitude: Option<rust_decimal::Decimal>,
    /// When the photo was taken (from EXIF)
    pub taken_at: Option<OffsetDateTime>,
    /// Additional EXIF data
    pub extended_exif: serde_json::Value,
}

impl Default for PhotoMetadata {
    fn default() -> Self {
        Self {
            camera_make: None,
            camera_model: None,
            lens_info: None,
            focal_length: None,
            aperture: None,
            shutter_speed: None,
            iso: None,
            flash_used: None,
            orientation: None,
            width_px: None,
            height_px: None,
            color_space: None,
            latitude: None,
            longitude: None,
            taken_at: None,
            extended_exif: serde_json::Value::Object(serde_json::Map::new()),
        }
    }
}

/// A gallery entity for organizing photos
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Gallery {
    pub id: Uuid,
    pub media_blob_id: Option<String>,
    pub thumbnail_blob_id: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub client_id: Option<String>,
    pub is_public: bool,
    pub is_collaborative: bool,
    pub metadata: serde_json::Value,
    pub deleted_at: Option<OffsetDateTime>,
    pub deleted_by: Option<Uuid>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
    pub version: i64,
}

/// Join table entry for photos in galleries
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct PhotoGallery {
    pub id: Uuid,
    pub gallery_id: Uuid,
    pub photo_id: Uuid,
    pub position: i32,
    pub created_at: OffsetDateTime,
    pub added_by_client_id: Option<String>,
    pub metadata: serde_json::Value,
}

/// Structure for creating a new photo
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatePhoto {
    pub media_blob_id: String,
    pub thumbnail_blob_id: Option<String>,
    pub title: Option<String>,
    pub caption: Option<String>,
    pub alt_text: Option<String>,
    pub location: Option<String>,
    pub is_favorite: bool,
    pub tags: Vec<String>,
    pub metadata: PhotoMetadata,
}

/// Structure for updating a photo
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdatePhoto {
    pub title: Option<String>,
    pub caption: Option<String>,
    pub alt_text: Option<String>,
    pub location: Option<String>,
    pub thumbnail_blob_id: Option<String>,
    pub is_favorite: Option<bool>,
    pub tags: Option<Vec<String>>,
    pub rating: Option<i32>,
}

/// Structure for creating a new gallery
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateGallery {
    pub title: String,
    pub description: Option<String>,
    pub client_id: Option<String>,
    pub is_public: bool,
    pub is_collaborative: bool,
    pub thumbnail_blob_id: Option<String>,
}

/// Structure for updating a gallery
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateGallery {
    pub title: Option<String>,
    pub description: Option<String>,
    pub is_public: Option<bool>,
    pub is_collaborative: Option<bool>,
    pub thumbnail_blob_id: Option<String>,
}

/// Query parameters for photos
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct PhotoQuery {
    pub is_favorite: Option<bool>,
    pub tags: Vec<String>,
    pub search: Option<String>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub location: Option<String>,
    pub rating: Option<i32>,
    pub taken_after: Option<OffsetDateTime>,
    pub taken_before: Option<OffsetDateTime>,
    pub created_after: Option<OffsetDateTime>,
    pub created_before: Option<OffsetDateTime>,
    pub has_gps: Option<bool>,
    pub width_min: Option<i32>,
    pub width_max: Option<i32>,
    pub height_min: Option<i32>,
    pub height_max: Option<i32>,
}

/// Query parameters for galleries
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct GalleryQuery {
    pub is_public: Option<bool>,
    pub is_collaborative: Option<bool>,
    pub search: Option<String>,
    pub created_after: Option<OffsetDateTime>,
    pub created_before: Option<OffsetDateTime>,
    pub client_id: Option<String>,
}

impl MediaItem for Photo {
    type Metadata = PhotoMetadata;
    type Collection = Gallery;

    fn id(&self) -> Uuid {
        self.id
    }

    fn media_blob_id(&self) -> &str {
        &self.media_blob_id
    }

    fn thumbnail_blob_id(&self) -> Option<&str> {
        self.thumbnail_blob_id.as_deref()
    }

    fn title(&self) -> &str {
        self.title.as_deref().unwrap_or("Untitled Photo")
    }

    fn created_at(&self) -> OffsetDateTime {
        self.created_at
    }

    fn updated_at(&self) -> OffsetDateTime {
        self.updated_at
    }

    fn version(&self) -> i64 {
        self.version
    }

    fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }

    fn is_favorite(&self) -> bool {
        self.is_favorite
    }

    fn tags(&self) -> &[String] {
        &self.tags
    }

    fn metadata(&self) -> &Self::Metadata {
        // In a real implementation, this would deserialize from self.metadata JSON
        // For now, we'll use a static reference to avoid lifetime issues
        use std::sync::LazyLock;
        static DEFAULT_METADATA: LazyLock<PhotoMetadata> = LazyLock::new(|| PhotoMetadata {
            camera_make: None,
            camera_model: None,
            lens_info: None,
            focal_length: None,
            aperture: None,
            shutter_speed: None,
            iso: None,
            flash_used: None,
            orientation: None,
            width_px: None,
            height_px: None,
            color_space: None,
            latitude: None,
            longitude: None,
            taken_at: None,
            extended_exif: serde_json::Value::Object(serde_json::Map::new()),
        });
        &DEFAULT_METADATA
    }

    fn display_title(&self) -> String {
        if let Some(title) = &self.title {
            title.clone()
        } else if let Some(location) = &self.location {
            format!("Photo from {}", location)
        } else if let Some(taken_at) = self.taken_at {
            format!(
                "Photo from {}",
                taken_at
                    .format(&time::format_description::well_known::Rfc3339)
                    .unwrap_or_else(|_| "Unknown Date".to_string())
            )
        } else {
            "Untitled Photo".to_string()
        }
    }

    fn typical_extensions() -> &'static [&'static str] {
        &[
            "jpg", "jpeg", "png", "gif", "webp", "heic", "avif", "bmp", "tiff", "raw", "cr2",
            "nef", "orf", "dng",
        ]
    }

    fn supported_mime_types() -> &'static [&'static str] {
        &[
            "image/jpeg",
            "image/png",
            "image/gif",
            "image/webp",
            "image/heic",
            "image/avif",
            "image/bmp",
            "image/tiff",
            "image/x-canon-cr2",
            "image/x-nikon-nef",
            "image/x-olympus-orf",
            "image/x-adobe-dng",
        ]
    }
}

impl MediaCollection for Gallery {
    type Item = Photo;

    fn id(&self) -> Uuid {
        self.id
    }

    fn title(&self) -> &str {
        &self.title
    }

    fn description(&self) -> Option<&str> {
        self.description.as_deref()
    }

    fn created_at(&self) -> OffsetDateTime {
        self.created_at
    }

    fn updated_at(&self) -> OffsetDateTime {
        self.updated_at
    }

    fn version(&self) -> i64 {
        self.version
    }

    fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }

    fn is_public(&self) -> bool {
        self.is_public
    }

    fn is_collaborative(&self) -> bool {
        self.is_collaborative
    }

    fn thumbnail_blob_id(&self) -> Option<&str> {
        self.thumbnail_blob_id.as_deref()
    }

    fn client_id(&self) -> Option<&str> {
        self.client_id.as_deref()
    }
}

impl Photo {
    /// Get a formatted display title for UI purposes
    pub fn display_name(&self) -> String {
        self.display_title()
    }

    /// Get camera info as a display string
    pub fn camera_info(&self) -> Option<String> {
        match (&self.camera_make, &self.camera_model) {
            (Some(make), Some(model)) => Some(format!("{} {}", make, model)),
            (Some(make), None) => Some(make.clone()),
            (None, Some(model)) => Some(model.clone()),
            (None, None) => None,
        }
    }

    /// Get formatted technical info
    pub fn technical_info(&self) -> Vec<String> {
        let mut info = Vec::new();

        if let (Some(width), Some(height)) = (self.width_px, self.height_px) {
            info.push(format!("{}×{}", width, height));
        }

        if let Some(focal_length) = self.focal_length {
            info.push(format!("{}mm", focal_length));
        }

        if let Some(aperture) = &self.aperture {
            info.push(format!("f/{}", aperture));
        }

        if let Some(shutter_speed) = &self.shutter_speed {
            info.push(shutter_speed.clone());
        }

        if let Some(iso) = self.iso {
            info.push(format!("ISO {}", iso));
        }

        info
    }

    /// Check if photo has GPS coordinates
    pub fn has_gps(&self) -> bool {
        self.latitude.is_some() && self.longitude.is_some()
    }

    /// Get aspect ratio
    pub fn aspect_ratio(&self) -> Option<f64> {
        match (self.width_px, self.height_px) {
            (Some(w), Some(h)) if h != 0 => Some(w as f64 / h as f64),
            _ => None,
        }
    }

    /// Get orientation category
    pub fn orientation_category(&self) -> String {
        match (self.width_px, self.height_px) {
            (Some(w), Some(h)) if w > h => "landscape".to_string(),
            (Some(w), Some(h)) if h > w => "portrait".to_string(),
            (Some(_), Some(_)) => "square".to_string(),
            _ => "unknown".to_string(),
        }
    }

    /// Check if photo is deleted (soft delete)
    pub fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }
}

impl Gallery {
    /// Check if gallery is deleted (soft delete)
    pub fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }

    /// Get display title with item count
    pub fn display_title_with_count(&self, count: usize) -> String {
        format!("{} ({} photos)", self.title, count)
    }
}

impl PhotoMetadata {
    /// Create metadata from EXIF data
    pub fn from_exif(exif_data: &serde_json::Value) -> Self {
        let mut metadata = PhotoMetadata::default();

        // Extract common EXIF fields
        if let Some(make) = exif_data.get("Make").and_then(|v| v.as_str()) {
            metadata.camera_make = Some(make.to_string());
        }

        if let Some(model) = exif_data.get("Model").and_then(|v| v.as_str()) {
            metadata.camera_model = Some(model.to_string());
        }

        if let Some(lens) = exif_data.get("LensModel").and_then(|v| v.as_str()) {
            metadata.lens_info = Some(lens.to_string());
        }

        if let Some(focal_length) = exif_data.get("FocalLength").and_then(|v| v.as_f64()) {
            metadata.focal_length = Some(focal_length as i32);
        }

        if let Some(aperture) = exif_data.get("FNumber").and_then(|v| v.as_f64()) {
            metadata.aperture =
                Some(rust_decimal::Decimal::from_f64_retain(aperture).unwrap_or_default());
        }

        if let Some(shutter_speed) = exif_data.get("ExposureTime").and_then(|v| v.as_str()) {
            metadata.shutter_speed = Some(shutter_speed.to_string());
        }

        if let Some(iso) = exif_data.get("ISOSpeedRatings").and_then(|v| v.as_i64()) {
            metadata.iso = Some(iso as i32);
        }

        if let Some(flash) = exif_data.get("Flash").and_then(|v| v.as_bool()) {
            metadata.flash_used = Some(flash);
        }

        if let Some(orientation) = exif_data.get("Orientation").and_then(|v| v.as_i64()) {
            metadata.orientation = Some(orientation as i32);
        }

        if let Some(width) = exif_data.get("ImageWidth").and_then(|v| v.as_i64()) {
            metadata.width_px = Some(width as i32);
        }

        if let Some(height) = exif_data.get("ImageHeight").and_then(|v| v.as_i64()) {
            metadata.height_px = Some(height as i32);
        }

        if let Some(color_space) = exif_data.get("ColorSpace").and_then(|v| v.as_str()) {
            metadata.color_space = Some(color_space.to_string());
        }

        // Store the full EXIF data for extended information
        metadata.extended_exif = exif_data.clone();

        metadata
    }

    /// Check if metadata has camera information
    pub fn has_camera_info(&self) -> bool {
        self.camera_make.is_some() || self.camera_model.is_some()
    }

    /// Check if metadata has technical information
    pub fn has_technical_info(&self) -> bool {
        self.focal_length.is_some()
            || self.aperture.is_some()
            || self.shutter_speed.is_some()
            || self.iso.is_some()
    }

    /// Check if metadata has GPS coordinates
    pub fn has_gps(&self) -> bool {
        self.latitude.is_some() && self.longitude.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_photo_display_title() {
        let mut photo = Photo {
            id: Uuid::new_v4(),
            media_blob_id: "test".to_string(),
            title: Some("Sunset".to_string()),
            location: Some("Beach".to_string()),
            taken_at: Some(OffsetDateTime::now_utc()),
            ..Default::default()
        };

        assert_eq!(photo.display_title(), "Sunset");

        photo.title = None;
        assert_eq!(photo.display_title(), "Photo from Beach");
    }

    #[test]
    fn test_photo_camera_info() {
        let mut photo = Photo {
            id: Uuid::new_v4(),
            media_blob_id: "test".to_string(),
            camera_make: Some("Canon".to_string()),
            camera_model: Some("EOS 5D".to_string()),
            ..Default::default()
        };

        assert_eq!(photo.camera_info(), Some("Canon EOS 5D".to_string()));

        photo.camera_model = None;
        assert_eq!(photo.camera_info(), Some("Canon".to_string()));
    }

    #[test]
    fn test_photo_technical_info() {
        let photo = Photo {
            id: Uuid::new_v4(),
            media_blob_id: "test".to_string(),
            width_px: Some(1920),
            height_px: Some(1080),
            focal_length: Some(85),
            aperture: Some(rust_decimal::Decimal::from_f64_retain(2.8).unwrap_or_default()),
            shutter_speed: Some("1/60".to_string()),
            iso: Some(400),
            ..Default::default()
        };

        let tech_info = photo.technical_info();
        assert!(tech_info.contains(&"1920×1080".to_string()));
        assert!(tech_info.contains(&"85mm".to_string()));
        assert!(tech_info.contains(&"f/2.8".to_string()));
        assert!(tech_info.contains(&"1/60".to_string()));
        assert!(tech_info.contains(&"ISO 400".to_string()));
    }

    #[test]
    fn test_photo_metadata_from_exif() {
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
            "ImageWidth": 1920,
            "ImageHeight": 1080,
            "ColorSpace": "sRGB"
        });

        let metadata = PhotoMetadata::from_exif(&exif_data);

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
        assert_eq!(metadata.width_px, Some(1920));
        assert_eq!(metadata.height_px, Some(1080));
        assert_eq!(metadata.color_space, Some("sRGB".to_string()));
    }

    #[test]
    fn test_photo_aspect_ratio() {
        let photo = Photo {
            id: Uuid::new_v4(),
            media_blob_id: "test".to_string(),
            width_px: Some(1920),
            height_px: Some(1080),
            ..Default::default()
        };

        assert_eq!(photo.aspect_ratio(), Some(1920.0 / 1080.0));

        let square_photo = Photo {
            id: Uuid::new_v4(),
            media_blob_id: "test".to_string(),
            width_px: Some(1080),
            height_px: Some(1080),
            ..Default::default()
        };

        assert_eq!(square_photo.aspect_ratio(), Some(1.0));
    }

    #[test]
    fn test_photo_orientation_category() {
        let landscape = Photo {
            id: Uuid::new_v4(),
            media_blob_id: "test".to_string(),
            width_px: Some(1920),
            height_px: Some(1080),
            ..Default::default()
        };
        assert_eq!(landscape.orientation_category(), "landscape");

        let portrait = Photo {
            id: Uuid::new_v4(),
            media_blob_id: "test".to_string(),
            width_px: Some(1080),
            height_px: Some(1920),
            ..Default::default()
        };
        assert_eq!(portrait.orientation_category(), "portrait");

        let square = Photo {
            id: Uuid::new_v4(),
            media_blob_id: "test".to_string(),
            width_px: Some(1080),
            height_px: Some(1080),
            ..Default::default()
        };
        assert_eq!(square.orientation_category(), "square");
    }
}

// Implement Default for Photo for testing
impl Default for Photo {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4(),
            media_blob_id: String::new(),
            thumbnail_blob_id: None,
            title: None,
            caption: None,
            alt_text: None,
            location: None,
            latitude: None,
            longitude: None,
            taken_at: None,
            camera_make: None,
            camera_model: None,
            lens_info: None,
            focal_length: None,
            aperture: None,
            shutter_speed: None,
            iso: None,
            flash_used: None,
            orientation: None,
            width_px: None,
            height_px: None,
            color_space: None,
            rating: None,
            is_favorite: false,
            tags: Vec::new(),
            metadata: serde_json::Value::Object(serde_json::Map::new()),
            deleted_at: None,
            deleted_by: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
            version: 1,
        }
    }
}

// Implement Default for Gallery for testing
impl Default for Gallery {
    fn default() -> Self {
        Self {
            id: Uuid::new_v4(),
            media_blob_id: None,
            thumbnail_blob_id: None,
            title: String::new(),
            description: None,
            client_id: None,
            is_public: false,
            is_collaborative: false,
            metadata: serde_json::Value::Object(serde_json::Map::new()),
            deleted_at: None,
            deleted_by: None,
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
            version: 1,
        }
    }
}
