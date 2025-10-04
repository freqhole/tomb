//! Photo service for photo processing and storage
//!
//! This service provides photo processing functionality including:
//! - Photo file processing and storage
//! - Metadata extraction and storage
//! - Thumbnail generation
//! - Database integration

use crate::media::CreateMediaBlob;
use crate::photos::models::{CreateGallery, Gallery, Photo};
use crate::photos::{
    extract_full_photo_metadata, PhotoMetadataError, PhotoRepository, PhotoRepositoryError,
};
use sqlx::PgPool;
use std::path::Path;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum PhotoServiceError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Repository error: {0}")]
    Repository(#[from] PhotoRepositoryError),
    #[error("Media blob service error: {0}")]
    MediaBlob(#[from] crate::media::MediaServiceError),
    #[error("Metadata extraction error: {0}")]
    MetadataExtraction(#[from] PhotoMetadataError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Validation error: {0}")]
    Validation(String),
}

pub type Result<T> = std::result::Result<T, PhotoServiceError>;

/// Photo service for photo operations
pub struct PhotoService {
    repository: PhotoRepository,
}

impl PhotoService {
    /// Create a new photo service
    pub fn new(pool: PgPool) -> Self {
        let repository = PhotoRepository::new(pool);
        Self { repository }
    }

    /// Process a photo file and save it to the database
    /// This is the main method that integrates scanning with storage
    pub async fn process_and_store_photo(
        &self,
        file_path: &Path,
        _session_id: Option<Uuid>,
        client_id: Option<&str>,
    ) -> Result<Photo> {
        debug!("Processing photo file: {}", file_path.display());

        // Validate file exists and is readable
        if !file_path.exists() {
            return Err(PhotoServiceError::Validation(format!(
                "File not found: {}",
                file_path.display()
            )));
        }

        let file_size = std::fs::metadata(file_path)?.len();
        debug!("File size: {} bytes", file_size);

        // Extract metadata from the photo
        let photo_metadata = extract_full_photo_metadata(file_path)
            .await
            .map_err(PhotoServiceError::MetadataExtraction)?;

        debug!(
            "Extracted metadata: camera={:?}, dimensions={:?}x{:?}",
            photo_metadata.camera_make, photo_metadata.width_px, photo_metadata.height_px
        );

        // Calculate file hash for deduplication
        let file_hash = self.calculate_file_hash(file_path).await?;
        debug!("File hash: {}", file_hash);

        // Check if we already have this photo (by hash)
        if self.repository.exists_by_hash(&file_hash).await? {
            warn!("Photo already exists with hash {}, skipping", file_hash);
            return Err(PhotoServiceError::Validation(
                "Photo already exists in database".to_string(),
            ));
        }

        // Detect MIME type
        let mime_type = self.detect_mime_type(file_path);
        debug!("Detected MIME type: {}", mime_type);

        // Create photo record with blob first
        let photo = self
            .repository
            .create_photo_with_blob(
                &file_path.to_string_lossy(),
                file_hash,
                file_size as i64,
                mime_type,
                photo_metadata,
                client_id,
                None, // thumbnail_blob_id - will be updated after thumbnail creation
            )
            .await?;

        // Generate thumbnail using the main photo's blob ID
        let thumbnail_blob_id = self
            .generate_and_store_thumbnail(file_path, &photo.media_blob_id, client_id)
            .await
            .map_err(|e| {
                warn!("Failed to generate thumbnail: {}", e);
                e
            })
            .ok(); // Make thumbnail generation non-fatal

        // Update photo with thumbnail blob ID if generation succeeded
        if let Some(thumbnail_id) = thumbnail_blob_id {
            self.repository
                .update_photo_thumbnail(photo.id, thumbnail_id.clone())
                .await
                .map_err(|e| {
                    warn!("Failed to update photo with thumbnail ID: {}", e);
                    e
                })?;
            debug!(
                "Updated photo {} with thumbnail ID: {}",
                photo.id, thumbnail_id
            );
        }

        info!("Created photo record with ID: {}", photo.id);

        Ok(photo)
    }

    /// List recent photos
    pub async fn list_recent_photos(&self, limit: i64) -> Result<Vec<Photo>> {
        let photos = self.repository.list_recent_photos(limit).await?;
        Ok(photos)
    }

    /// Get a photo by ID
    pub async fn get_photo(&self, id: Uuid) -> Result<Photo> {
        let photo = self.repository.get_photo(id).await?;
        Ok(photo)
    }

    /// Create a new gallery
    pub async fn create_gallery(&self, create_gallery: CreateGallery) -> Result<Gallery> {
        let gallery = self.repository.create_gallery(create_gallery).await?;
        Ok(gallery)
    }

    /// Add photos to a gallery
    pub async fn add_photos_to_gallery(&self, gallery_id: Uuid, photo_ids: &[Uuid]) -> Result<()> {
        for photo_id in photo_ids {
            self.repository
                .add_photo_to_gallery(gallery_id, *photo_id, None)
                .await?;
        }
        Ok(())
    }

    /// Remove photos from a gallery
    pub async fn remove_photos_from_gallery(
        &self,
        gallery_id: Uuid,
        photo_ids: &[Uuid],
    ) -> Result<()> {
        for photo_id in photo_ids {
            self.repository
                .remove_photo_from_gallery(gallery_id, *photo_id)
                .await?;
        }
        Ok(())
    }

    /// List galleries
    pub async fn list_galleries(&self, limit: i64) -> Result<Vec<Gallery>> {
        let galleries = self.repository.list_galleries(limit).await?;
        Ok(galleries)
    }

    /// Get a gallery by ID
    pub async fn get_gallery(&self, id: Uuid) -> Result<Gallery> {
        let gallery = self.repository.get_gallery(id).await?;
        Ok(gallery)
    }

    /// Get photos in a gallery
    pub async fn get_gallery_photos(&self, gallery_id: Uuid, limit: i64) -> Result<Vec<Photo>> {
        let photos = self
            .repository
            .get_gallery_photos(gallery_id, limit)
            .await?;
        Ok(photos)
    }

    /// Find galleries by title (case-insensitive partial match)
    pub async fn find_galleries_by_title(&self, title_pattern: &str) -> Result<Vec<Gallery>> {
        let galleries = self
            .repository
            .find_galleries_by_title(title_pattern)
            .await?;
        Ok(galleries)
    }

    /// Delete gallery (soft delete)
    pub async fn delete_gallery(&self, gallery_id: Uuid) -> Result<()> {
        self.repository.delete_gallery(gallery_id).await?;
        Ok(())
    }

    /// Get photo statistics
    pub async fn get_photo_stats(&self) -> Result<PhotoStats> {
        let total_photos = self.repository.count_photos().await?;

        Ok(PhotoStats {
            total_photos,
            total_galleries: 0, // TODO: implement galleries
            total_favorites: 0, // TODO: implement favorites count
            storage_used_mb: 0, // TODO: implement storage calculation
        })
    }

    // Private helper methods

    /// Calculate SHA256 hash of a file
    async fn calculate_file_hash(&self, file_path: &Path) -> Result<String> {
        use sha2::{Digest, Sha256};
        use tokio::io::AsyncReadExt;

        let mut file = tokio::fs::File::open(file_path).await?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 8192];

        loop {
            let bytes_read = file.read(&mut buffer).await?;
            if bytes_read == 0 {
                break;
            }
            hasher.update(&buffer[..bytes_read]);
        }

        let hash = hasher.finalize();
        Ok(format!("{:x}", hash))
    }

    /// Detect MIME type from file extension
    fn detect_mime_type(&self, file_path: &Path) -> String {
        mime_guess::from_path(file_path)
            .first()
            .map(|mime| mime.to_string())
            .unwrap_or_else(|| "application/octet-stream".to_string())
    }

    /// Generate and store thumbnail for a photo
    async fn generate_and_store_thumbnail(
        &self,
        file_path: &Path,
        parent_blob_id: &str,
        client_id: Option<&str>,
    ) -> Result<String> {
        use image::{GenericImageView, ImageOutputFormat};
        use std::io::Cursor;

        debug!("Generating thumbnail for: {}", file_path.display());

        // Open and decode the image
        let img = image::open(file_path)
            .map_err(|e| PhotoServiceError::Validation(format!("Failed to open image: {}", e)))?;

        // Calculate thumbnail dimensions (max 300x300, preserve aspect ratio)
        let (width, height) = img.dimensions();
        let max_size = 300u32;
        let (thumb_width, thumb_height) = if width > height {
            if width > max_size {
                (max_size, (height * max_size) / width)
            } else {
                (width, height)
            }
        } else {
            if height > max_size {
                ((width * max_size) / height, max_size)
            } else {
                (width, height)
            }
        };

        // Resize the image
        let thumbnail = img.resize(
            thumb_width,
            thumb_height,
            image::imageops::FilterType::Lanczos3,
        );

        // Convert to WebP bytes
        let mut webp_bytes = Vec::new();
        {
            let mut cursor = Cursor::new(&mut webp_bytes);
            thumbnail
                .write_to(&mut cursor, ImageOutputFormat::WebP)
                .map_err(|e| {
                    PhotoServiceError::Validation(format!("Failed to encode thumbnail: {}", e))
                })?;
        }

        // Calculate thumbnail hash
        let thumbnail_hash = {
            use sha2::{Digest, Sha256};
            let mut hasher = Sha256::new();
            hasher.update(&webp_bytes);
            format!("{:x}", hasher.finalize())
        };

        // Create thumbnail blob
        let create_thumbnail_blob = CreateMediaBlob {
            data: Some(webp_bytes),
            sha256: thumbnail_hash,
            size: None, // Will be calculated automatically
            mime: Some("image/webp".to_string()),
            source_client_id: client_id.map(|s| s.to_string()),
            local_path: None, // Thumbnails are stored in database
            parent_blob_id: Some(parent_blob_id.to_string()),
            blob_type: Some("thumbnail".to_string()),
            content_id: None,
            metadata: serde_json::json!({
                "width": thumb_width,
                "height": thumb_height,
                "format": "webp",
                "filter": "Lanczos3"
            }),
        };

        let thumbnail_blob = self
            .repository
            .media_blob_service
            .create_media_blob(create_thumbnail_blob)
            .await?;

        debug!("Created thumbnail blob with ID: {}", thumbnail_blob.id);
        Ok(thumbnail_blob.id)
    }
}

/// Photo statistics
#[derive(Debug, Clone)]
pub struct PhotoStats {
    pub total_photos: i64,
    pub total_galleries: i64,
    pub total_favorites: i64,
    pub storage_used_mb: i64,
}

impl PhotoStats {
    pub fn display(&self) -> String {
        format!(
            "Photos: {}, Galleries: {}, Favorites: {}, Storage: {} MB",
            self.total_photos, self.total_galleries, self.total_favorites, self.storage_used_mb
        )
    }
}

/// Photo processing configuration
#[derive(Debug, Clone)]
pub struct PhotoProcessingConfig {
    pub thumbnail_size: u32,
    pub thumbnail_quality: u8,
    pub thumbnail_format: String,
}

impl Default for PhotoProcessingConfig {
    fn default() -> Self {
        Self {
            thumbnail_size: 300,
            thumbnail_quality: 85,
            thumbnail_format: "webp".to_string(),
        }
    }
}

/// Photo with media blob information
#[derive(Debug, Clone)]
pub struct PhotoWithMedia {
    pub photo: Photo,
    pub media_blob: crate::media::MediaBlob,
    pub thumbnail_blob: Option<crate::media::MediaBlob>,
}

#[cfg(test)]
mod tests {

    use std::io::Write;
    use tempfile::NamedTempFile;

    #[tokio::test]
    async fn test_file_hash_calculation() {
        // Create a temporary file with known content
        let mut temp_file = NamedTempFile::new().unwrap();
        temp_file.write_all(b"test content").unwrap();

        // This would need a real database connection to test
        // let pool = PgPool::connect("...").await.unwrap();
        // let service = PhotoService::new(pool);
        // let hash = service.calculate_file_hash(temp_file.path()).await.unwrap();
        // assert!(!hash.is_empty());
    }

    #[test]
    fn test_mime_type_detection() {
        // Can't create service without async context in sync test
        // let service = PhotoService::new(pool);

        // Test mime type detection logic
        let jpeg_mime = mime_guess::from_path("test.jpg")
            .first()
            .unwrap()
            .to_string();
        let png_mime = mime_guess::from_path("test.png")
            .first()
            .unwrap()
            .to_string();
        assert_eq!(jpeg_mime, "image/jpeg");
        assert_eq!(png_mime, "image/png");
    }
}
