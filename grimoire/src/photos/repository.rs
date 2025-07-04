//! Photo domain repository
//!
//! This module provides database access layer for photos and galleries,
//! including CRUD operations and queries with proper error handling.

use crate::media::{CreateMediaBlob, MediaBlobRepository, MediaBlobService};
use crate::photos::models::{
    CreateGallery, CreatePhoto, Gallery, Photo, PhotoMetadata, UpdatePhoto,
};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum PhotoRepositoryError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Photo not found: {0}")]
    PhotoNotFound(Uuid),
    #[error("Gallery not found: {0}")]
    GalleryNotFound(Uuid),
    #[error("Gallery not found by title: {0}")]
    GalleryNotFoundByTitle(String),
    #[error("Photo already in gallery")]
    PhotoAlreadyInGallery,
    #[error("Photo not in gallery")]
    PhotoNotInGallery,
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Duplicate gallery title: {0}")]
    DuplicateGalleryTitle(String),
    #[error("Media blob error: {0}")]
    MediaBlob(#[from] crate::media::MediaServiceError),
}

pub type Result<T> = std::result::Result<T, PhotoRepositoryError>;

/// Repository for photo and gallery database operations
pub struct PhotoRepository {
    pool: PgPool,
    pub media_blob_service: MediaBlobService,
}

impl PhotoRepository {
    /// Create a new repository instance
    pub fn new(pool: PgPool) -> Self {
        let media_blob_repo = MediaBlobRepository::new(pool.clone());
        let media_blob_service = MediaBlobService::new(media_blob_repo);

        Self {
            pool,
            media_blob_service,
        }
    }

    /// Get the database pool
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Get the media blob service
    pub fn media_blob_service(&self) -> &MediaBlobService {
        &self.media_blob_service
    }

    // Photo operations

    /// Get a photo by ID
    pub async fn get_photo(&self, id: Uuid) -> Result<Photo> {
        let photo = sqlx::query_as!(
            Photo,
            "SELECT * FROM photos WHERE id = $1 AND deleted_at IS NULL",
            id
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or(PhotoRepositoryError::PhotoNotFound(id))?;

        Ok(photo)
    }

    /// Create a photo record with media blob
    pub async fn create_photo_with_blob(
        &self,
        file_path: &str,
        file_hash: String,
        file_size: i64,
        mime_type: String,
        metadata: PhotoMetadata,
        client_id: Option<&str>,
        thumbnail_blob_id: Option<String>,
    ) -> Result<Photo> {
        // Create media blob for the original photo (stored on filesystem)
        let create_blob = CreateMediaBlob {
            data: None, // Photos are stored on filesystem, not in database
            sha256: file_hash,
            size: Some(file_size),
            mime: Some(mime_type),
            source_client_id: client_id.map(|s| s.to_string()),
            local_path: Some(file_path.to_string()),
            parent_blob_id: None,
            blob_type: Some("original".to_string()),
            metadata: serde_json::json!({
                "original_filename": std::path::Path::new(file_path)
                    .file_name()
                    .and_then(|n| n.to_str()),
                "file_extension": std::path::Path::new(file_path)
                    .extension()
                    .and_then(|e| e.to_str()),
            }),
        };

        let media_blob = self
            .media_blob_service
            .create_media_blob(create_blob)
            .await?;

        // Create title from metadata or filename
        let title = self.create_photo_title(&metadata, file_path);

        // Insert photo record
        let photo_id = Uuid::new_v4();
        let now = OffsetDateTime::now_utc();

        let photo = sqlx::query_as!(
            Photo,
            r#"
            INSERT INTO photos (
                id, media_blob_id, thumbnail_blob_id, title, caption, alt_text, location,
                latitude, longitude, taken_at, camera_make, camera_model, lens_info,
                focal_length, aperture, shutter_speed, iso, flash_used, orientation,
                width_px, height_px, color_space, rating, is_favorite, tags, metadata,
                created_at, updated_at, version
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, 1
            )
            RETURNING *
            "#,
            photo_id,
            media_blob.id,
            thumbnail_blob_id,
            Some(title),
            None::<String>, // caption
            None::<String>, // alt_text
            metadata.camera_make.clone(), // use camera as location for now
            metadata.latitude,
            metadata.longitude,
            metadata.taken_at,
            metadata.camera_make,
            metadata.camera_model,
            metadata.lens_info,
            metadata.focal_length,
            metadata.aperture,
            metadata.shutter_speed,
            metadata.iso,
            metadata.flash_used,
            metadata.orientation,
            metadata.width_px,
            metadata.height_px,
            metadata.color_space,
            None::<i32>, // rating
            Some(false), // is_favorite
            Some(&[] as &[String]), // tags
            serde_json::to_value(&metadata).unwrap_or_default(),
            now,
            now
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(photo)
    }

    /// Create a photo from CreatePhoto struct
    pub async fn create_photo(&self, create_photo: CreatePhoto) -> Result<Photo> {
        let photo_id = Uuid::new_v4();
        let now = OffsetDateTime::now_utc();

        let photo = sqlx::query_as!(
            Photo,
            r#"
            INSERT INTO photos (
                id, media_blob_id, thumbnail_blob_id, title, caption, alt_text, location,
                latitude, longitude, taken_at, camera_make, camera_model, lens_info,
                focal_length, aperture, shutter_speed, iso, flash_used, orientation,
                width_px, height_px, color_space, rating, is_favorite, tags, metadata,
                created_at, updated_at, version
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, 1
            )
            RETURNING *
            "#,
            photo_id,
            create_photo.media_blob_id,
            create_photo.thumbnail_blob_id,
            create_photo.title,
            create_photo.caption,
            create_photo.alt_text,
            create_photo.location,
            create_photo.metadata.latitude,
            create_photo.metadata.longitude,
            create_photo.metadata.taken_at,
            create_photo.metadata.camera_make,
            create_photo.metadata.camera_model,
            create_photo.metadata.lens_info,
            create_photo.metadata.focal_length,
            create_photo.metadata.aperture,
            create_photo.metadata.shutter_speed,
            create_photo.metadata.iso,
            create_photo.metadata.flash_used,
            create_photo.metadata.orientation,
            create_photo.metadata.width_px,
            create_photo.metadata.height_px,
            create_photo.metadata.color_space,
            None::<i32>, // rating
            Some(create_photo.is_favorite),
            Some(&create_photo.tags as &[String]),
            serde_json::to_value(&create_photo.metadata).unwrap_or_default(),
            now,
            now
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(photo)
    }

    /// Update a photo
    pub async fn update_photo(&self, id: Uuid, update_photo: UpdatePhoto) -> Result<Photo> {
        let photo = sqlx::query_as!(
            Photo,
            r#"
            UPDATE photos
            SET title = $2, caption = $3, alt_text = $4, location = $5,
                thumbnail_blob_id = $6, is_favorite = $7, tags = $8, rating = $9,
                updated_at = NOW()
            WHERE id = $1 AND deleted_at IS NULL
            RETURNING *
            "#,
            id,
            update_photo.title,
            update_photo.caption,
            update_photo.alt_text,
            update_photo.location,
            update_photo.thumbnail_blob_id,
            update_photo.is_favorite,
            update_photo.tags.as_ref().map(|v| v.as_slice()),
            update_photo.rating
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or(PhotoRepositoryError::PhotoNotFound(id))?;

        Ok(photo)
    }

    /// Delete a photo (soft delete)
    pub async fn delete_photo(&self, id: Uuid) -> Result<()> {
        let rows_affected = sqlx::query!(
            "UPDATE photos SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL",
            id
        )
        .execute(&self.pool)
        .await?
        .rows_affected();

        if rows_affected == 0 {
            return Err(PhotoRepositoryError::PhotoNotFound(id));
        }

        Ok(())
    }

    /// Update photo thumbnail
    pub async fn update_photo_thumbnail(
        &self,
        photo_id: Uuid,
        thumbnail_blob_id: String,
    ) -> Result<()> {
        let rows_affected = sqlx::query!(
            "UPDATE photos SET thumbnail_blob_id = $1, updated_at = NOW() WHERE id = $2 AND deleted_at IS NULL",
            thumbnail_blob_id,
            photo_id
        )
        .execute(&self.pool)
        .await?
        .rows_affected();

        if rows_affected == 0 {
            return Err(PhotoRepositoryError::PhotoNotFound(photo_id));
        }

        Ok(())
    }

    /// List recent photos
    pub async fn list_recent_photos(&self, limit: i64) -> Result<Vec<Photo>> {
        let photos = sqlx::query_as!(
            Photo,
            "SELECT * FROM photos WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1",
            limit
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(photos)
    }

    /// Count total photos
    pub async fn count_photos(&self) -> Result<i64> {
        let count = sqlx::query_scalar!("SELECT COUNT(*) FROM photos WHERE deleted_at IS NULL")
            .fetch_one(&self.pool)
            .await?;

        Ok(count.unwrap_or(0))
    }

    /// Check if a photo exists by file hash
    pub async fn exists_by_hash(&self, hash: &str) -> Result<bool> {
        let exists = self.media_blob_service.exists_by_sha256(hash).await?;
        Ok(exists)
    }

    // Gallery operations

    /// Get a gallery by ID
    pub async fn get_gallery(&self, id: Uuid) -> Result<Gallery> {
        let gallery = sqlx::query_as!(
            Gallery,
            "SELECT * FROM galleries WHERE id = $1 AND deleted_at IS NULL",
            id
        )
        .fetch_optional(&self.pool)
        .await?
        .ok_or(PhotoRepositoryError::GalleryNotFound(id))?;

        Ok(gallery)
    }

    /// Create a gallery
    pub async fn create_gallery(&self, create_gallery: CreateGallery) -> Result<Gallery> {
        let gallery_id = Uuid::new_v4();
        let now = OffsetDateTime::now_utc();

        let gallery = sqlx::query_as!(
            Gallery,
            r#"
            INSERT INTO galleries (
                id, media_blob_id, thumbnail_blob_id, title, description, client_id,
                is_public, is_collaborative, metadata, created_at, updated_at, version
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1
            )
            RETURNING *
            "#,
            gallery_id,
            None::<String>, // media_blob_id
            create_gallery.thumbnail_blob_id,
            create_gallery.title,
            create_gallery.description,
            create_gallery.client_id,
            create_gallery.is_public,
            create_gallery.is_collaborative,
            serde_json::Value::Null, // metadata
            now,
            now
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(gallery)
    }

    /// List galleries
    pub async fn list_galleries(&self, limit: i64) -> Result<Vec<Gallery>> {
        let galleries = sqlx::query_as!(
            Gallery,
            "SELECT * FROM galleries WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT $1",
            limit
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(galleries)
    }

    /// Find galleries by title (case-insensitive partial match)
    pub async fn find_galleries_by_title(&self, title_pattern: &str) -> Result<Vec<Gallery>> {
        let pattern = format!("%{}%", title_pattern.to_lowercase());
        let galleries = sqlx::query_as!(
            Gallery,
            "SELECT * FROM galleries WHERE deleted_at IS NULL AND LOWER(title) LIKE $1 ORDER BY created_at DESC",
            pattern
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(galleries)
    }

    /// Delete gallery (soft delete)
    pub async fn delete_gallery(&self, gallery_id: Uuid) -> Result<()> {
        let result = sqlx::query!(
            "UPDATE galleries SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL",
            gallery_id
        )
        .execute(&self.pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(PhotoRepositoryError::GalleryNotFound(gallery_id));
        }

        Ok(())
    }

    // Photo-Gallery operations

    /// Add photo to gallery
    pub async fn add_photo_to_gallery(
        &self,
        gallery_id: Uuid,
        photo_id: Uuid,
        position: Option<i32>,
    ) -> Result<()> {
        // Check if photo is already in gallery
        let exists = sqlx::query_scalar!(
            "SELECT EXISTS(SELECT 1 FROM photo_galleries WHERE gallery_id = $1 AND photo_id = $2)",
            gallery_id,
            photo_id
        )
        .fetch_one(&self.pool)
        .await?;

        if exists.unwrap_or(false) {
            return Err(PhotoRepositoryError::PhotoAlreadyInGallery);
        }

        // Get next position if not specified
        let final_position = if let Some(pos) = position {
            pos
        } else {
            let max_position: Option<i32> = sqlx::query_scalar!(
                "SELECT MAX(position) FROM photo_galleries WHERE gallery_id = $1",
                gallery_id
            )
            .fetch_one(&self.pool)
            .await?;

            max_position.unwrap_or(0) + 1
        };

        // Insert photo into gallery
        sqlx::query!(
            r#"
            INSERT INTO photo_galleries (gallery_id, photo_id, position, created_at, added_by_client_id, metadata)
            VALUES ($1, $2, $3, $4, $5, $6)
            "#,
            gallery_id,
            photo_id,
            final_position,
            OffsetDateTime::now_utc(),
            Some("photo-cli".to_string()),
            serde_json::json!({})
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    /// Remove photo from gallery
    pub async fn remove_photo_from_gallery(&self, gallery_id: Uuid, photo_id: Uuid) -> Result<()> {
        let rows_affected = sqlx::query!(
            "DELETE FROM photo_galleries WHERE gallery_id = $1 AND photo_id = $2",
            gallery_id,
            photo_id
        )
        .execute(&self.pool)
        .await?
        .rows_affected();

        if rows_affected == 0 {
            return Err(PhotoRepositoryError::PhotoNotInGallery);
        }

        Ok(())
    }

    /// Get photos in a gallery with their positions
    pub async fn get_gallery_photos(&self, gallery_id: Uuid, limit: i64) -> Result<Vec<Photo>> {
        let photos = sqlx::query_as!(
            Photo,
            r#"
            SELECT p.* FROM photos p
            JOIN photo_galleries pg ON p.id = pg.photo_id
            WHERE pg.gallery_id = $1 AND p.deleted_at IS NULL
            ORDER BY pg.position ASC
            LIMIT $2
            "#,
            gallery_id,
            limit
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(photos)
    }

    /// Create a title for the photo from metadata or filename
    fn create_photo_title(&self, metadata: &PhotoMetadata, file_path: &str) -> String {
        // Try various sources for a good title
        if let Some(camera_info) = self.format_camera_info(metadata) {
            if let Some(taken_at) = metadata.taken_at {
                return format!("{} - {}", camera_info, taken_at.date());
            } else {
                return camera_info;
            }
        }

        if let Some(taken_at) = metadata.taken_at {
            return format!("Photo from {}", taken_at.date());
        }

        // Fall back to filename without extension
        std::path::Path::new(file_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("Untitled Photo")
            .to_string()
    }

    /// Format camera information for display
    fn format_camera_info(&self, metadata: &PhotoMetadata) -> Option<String> {
        match (&metadata.camera_make, &metadata.camera_model) {
            (Some(make), Some(model)) => Some(format!("{} {}", make, model)),
            (Some(make), None) => Some(make.clone()),
            (None, Some(model)) => Some(model.clone()),
            (None, None) => None,
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
    use super::*;

    #[test]
    fn test_photo_title_creation() {
        // This test would need a real database pool to run
        // let pool = PgPool::connect("...").await.unwrap();
        // let repo = PhotoRepository::new(pool);

        let metadata = PhotoMetadata {
            camera_make: Some("Canon".to_string()),
            camera_model: Some("EOS 5D".to_string()),
            ..Default::default()
        };

        // Test would verify title creation logic
        // let title = repo.create_photo_title(&metadata, "/path/to/photo.jpg");
        // assert!(title.contains("Canon EOS 5D"));
    }
}
