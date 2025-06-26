//! Media blob service with cursor-based pagination support
//!
//! This module provides the service layer for media blob operations,
//! implementing business logic for media management with support for
//! both traditional offset-based pagination and modern cursor-based
//! pagination for efficient synchronization.

use super::models::{
    CreateMediaBlob, MediaBlob, MediaBlobQuery, PaginatedResult, PaginationDirection,
};
use super::repository::{MediaBlobRepository, MediaRepositoryError};
use std::sync::Arc;
use time::OffsetDateTime;
use tracing::{debug, info, warn};
use uuid::Uuid;

/// Service for media blob operations
#[derive(Clone)]
pub struct MediaBlobService {
    repository: Arc<MediaBlobRepository>,
}

/// Errors that can occur during media blob service operations
#[derive(Debug, thiserror::Error)]
pub enum MediaServiceError {
    #[error("Repository error: {0}")]
    Repository(#[from] MediaRepositoryError),
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Business logic error: {0}")]
    BusinessLogic(String),
    #[error("Concurrent modification detected")]
    ConcurrentModification,
}

impl MediaBlobService {
    /// Create a new media blob service
    pub fn new(repository: MediaBlobRepository) -> Self {
        Self {
            repository: Arc::new(repository),
        }
    }

    /// Create a new media blob with validation
    pub async fn create_media_blob(
        &self,
        create_blob: CreateMediaBlob,
    ) -> Result<MediaBlob, MediaServiceError> {
        info!(
            "Creating new media blob with SHA256: {}",
            create_blob.sha256
        );

        // Validate the blob data
        self.validate_create_blob(&create_blob)?;

        // Check for duplicates
        if self
            .repository
            .exists_by_sha256(&create_blob.sha256)
            .await?
        {
            warn!(
                "Attempt to create duplicate media blob: {}",
                create_blob.sha256
            );
            return Err(MediaServiceError::BusinessLogic(format!(
                "Media blob with SHA256 {} already exists",
                create_blob.sha256
            )));
        }

        // Create the blob
        let media_blob = self.repository.create(create_blob).await?;

        info!("Successfully created media blob: {}", media_blob.id);
        Ok(media_blob)
    }

    /// Get a media blob by ID
    pub async fn get_media_blob(&self, id: Uuid) -> Result<MediaBlob, MediaServiceError> {
        debug!("Retrieving media blob by ID: {}", id);
        let blob = self.repository.find_by_id(id).await?;
        Ok(blob)
    }

    /// Get a media blob by ID without binary data for efficient transmission
    pub async fn get_media_blob_metadata(&self, id: Uuid) -> Result<MediaBlob, MediaServiceError> {
        debug!("Retrieving media blob metadata by ID: {}", id);
        let blob = self.repository.find_by_id_without_data(id).await?;
        Ok(blob)
    }

    /// Get a media blob by SHA256 hash
    pub async fn get_media_blob_by_sha256(
        &self,
        sha256: &str,
    ) -> Result<MediaBlob, MediaServiceError> {
        debug!("Retrieving media blob by SHA256: {}", sha256);
        self.validate_sha256(sha256)?;
        let blob = self.repository.find_by_sha256(sha256).await?;
        Ok(blob)
    }

    /// Query media blobs with advanced pagination and filtering
    pub async fn query_media_blobs(
        &self,
        query: MediaBlobQuery,
    ) -> Result<PaginatedResult<MediaBlob>, MediaServiceError> {
        debug!("Querying media blobs with query: {:?}", query);

        // Validate query parameters
        self.validate_query(&query)?;

        // Execute query
        let result = self.repository.query(query).await?;

        info!(
            "Query returned {} media blobs (has_next: {}, has_previous: {})",
            result.items.len(),
            result.pagination.has_next_page,
            result.pagination.has_previous_page
        );

        Ok(result)
    }

    /// Get recent media blobs using cursor-based pagination
    pub async fn get_recent_media_blobs(
        &self,
        cursor: Option<String>,
        page_size: Option<i64>,
    ) -> Result<PaginatedResult<MediaBlob>, MediaServiceError> {
        debug!(
            "Getting recent media blobs (cursor: {:?}, page_size: {:?})",
            cursor, page_size
        );

        let query = MediaBlobQuery::with_cursor(cursor, page_size);
        self.query_media_blobs(query).await
    }

    /// Get media blobs created after a specific timestamp
    pub async fn get_media_blobs_since(
        &self,
        since: OffsetDateTime,
        cursor: Option<String>,
        page_size: Option<i64>,
    ) -> Result<PaginatedResult<MediaBlob>, MediaServiceError> {
        debug!(
            "Getting media blobs since {} (cursor: {:?}, page_size: {:?})",
            since, cursor, page_size
        );

        let mut query = MediaBlobQuery::with_cursor(cursor, page_size);
        query.created_after = Some(since);
        self.query_media_blobs(query).await
    }

    /// Get media blobs for synchronization (optimized for sync operations)
    pub async fn get_sync_page(
        &self,
        last_sync_time: Option<OffsetDateTime>,
        cursor: Option<String>,
        page_size: Option<i64>,
    ) -> Result<PaginatedResult<MediaBlob>, MediaServiceError> {
        debug!(
            "Getting sync page (last_sync: {:?}, cursor: {:?}, page_size: {:?})",
            last_sync_time, cursor, page_size
        );

        let mut query = MediaBlobQuery::with_cursor(cursor, page_size);

        // For sync operations, we want items modified since last sync
        if let Some(last_sync) = last_sync_time {
            query.created_after = Some(last_sync);
        }

        // Use forward pagination for sync (newest first)
        query.direction = Some(PaginationDirection::Forward);

        // Return metadata only for efficiency
        let mut result = self.query_media_blobs(query).await?;

        // Ensure all items have no binary data for sync efficiency
        for item in &mut result.items {
            item.data = None;
        }

        Ok(result)
    }

    /// Check if a media blob exists by SHA256
    pub async fn exists_by_sha256(&self, sha256: &str) -> Result<bool, MediaServiceError> {
        debug!("Checking existence of media blob by SHA256: {}", sha256);
        self.validate_sha256(sha256)?;
        let exists = self.repository.exists_by_sha256(sha256).await?;
        Ok(exists)
    }

    /// Update metadata for a media blob
    pub async fn update_metadata(
        &self,
        id: Uuid,
        metadata: serde_json::Value,
    ) -> Result<MediaBlob, MediaServiceError> {
        info!("Updating metadata for media blob: {}", id);

        // Validate metadata size and structure
        self.validate_metadata(&metadata)?;

        let updated_blob = self.repository.update_metadata(id, metadata).await?;

        info!("Successfully updated metadata for media blob: {}", id);
        Ok(updated_blob)
    }

    /// Delete a media blob
    pub async fn delete_media_blob(&self, id: Uuid) -> Result<(), MediaServiceError> {
        info!("Deleting media blob: {}", id);

        self.repository.delete(id).await?;

        info!("Successfully deleted media blob: {}", id);
        Ok(())
    }

    /// Get media blob statistics
    pub async fn get_statistics(
        &self,
    ) -> Result<super::repository::MediaBlobStats, MediaServiceError> {
        debug!("Retrieving media blob statistics");
        let stats = self.repository.get_stats().await?;
        Ok(stats)
    }

    /// Find media blobs by client ID
    pub async fn find_by_client_id(
        &self,
        client_id: &str,
        cursor: Option<String>,
        page_size: Option<i64>,
    ) -> Result<PaginatedResult<MediaBlob>, MediaServiceError> {
        debug!(
            "Finding media blobs by client ID: {} (cursor: {:?}, page_size: {:?})",
            client_id, cursor, page_size
        );

        let mut query = MediaBlobQuery::with_cursor(cursor, page_size);
        query.source_client_id = Some(client_id.to_string());

        self.query_media_blobs(query).await
    }

    /// Search media blobs by MIME type pattern
    pub async fn search_by_mime_type(
        &self,
        mime_pattern: &str,
        cursor: Option<String>,
        page_size: Option<i64>,
    ) -> Result<PaginatedResult<MediaBlob>, MediaServiceError> {
        debug!(
            "Searching media blobs by MIME pattern: {} (cursor: {:?}, page_size: {:?})",
            mime_pattern, cursor, page_size
        );

        let mut query = MediaBlobQuery::with_cursor(cursor, page_size);
        query.mime_pattern = Some(mime_pattern.to_string());

        self.query_media_blobs(query).await
    }

    /// Validate create blob parameters
    fn validate_create_blob(&self, create_blob: &CreateMediaBlob) -> Result<(), MediaServiceError> {
        // Validate SHA256
        self.validate_sha256(&create_blob.sha256)?;

        // Validate that we have either data or local_path
        let has_data = create_blob.data.as_ref().map_or(false, |d| !d.is_empty());
        let has_path = create_blob.local_path.is_some();

        if !has_data && !has_path {
            return Err(MediaServiceError::Validation(
                "Either data or local_path must be provided".to_string(),
            ));
        }

        // Validate size consistency
        if let (Some(data), Some(size)) = (&create_blob.data, create_blob.size) {
            if data.len() as i64 != size {
                return Err(MediaServiceError::Validation(
                    "Data size does not match provided size field".to_string(),
                ));
            }
        }

        // Validate metadata
        self.validate_metadata(&create_blob.metadata)?;

        Ok(())
    }

    /// Validate SHA256 hash format
    fn validate_sha256(&self, sha256: &str) -> Result<(), MediaServiceError> {
        if sha256.is_empty() {
            return Err(MediaServiceError::Validation(
                "SHA256 hash cannot be empty".to_string(),
            ));
        }

        if sha256.len() != 64 {
            return Err(MediaServiceError::Validation(
                "SHA256 hash must be 64 characters long".to_string(),
            ));
        }

        if !sha256.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(MediaServiceError::Validation(
                "SHA256 hash must contain only hexadecimal characters".to_string(),
            ));
        }

        Ok(())
    }

    /// Validate query parameters
    fn validate_query(&self, query: &MediaBlobQuery) -> Result<(), MediaServiceError> {
        // Validate page sizes
        if let Some(page_size) = query.page_size {
            if page_size <= 0 {
                return Err(MediaServiceError::Validation(
                    "Page size must be positive".to_string(),
                ));
            }
            if page_size > 1000 {
                return Err(MediaServiceError::Validation(
                    "Page size cannot exceed 1000".to_string(),
                ));
            }
        }

        if let Some(limit) = query.limit {
            if limit <= 0 {
                return Err(MediaServiceError::Validation(
                    "Limit must be positive".to_string(),
                ));
            }
            if limit > 1000 {
                return Err(MediaServiceError::Validation(
                    "Limit cannot exceed 1000".to_string(),
                ));
            }
        }

        if let Some(offset) = query.offset {
            if offset < 0 {
                return Err(MediaServiceError::Validation(
                    "Offset cannot be negative".to_string(),
                ));
            }
        }

        // Validate SHA256 if provided
        if let Some(ref sha256) = query.sha256 {
            self.validate_sha256(sha256)?;
        }

        // Validate timestamp range
        if let (Some(after), Some(before)) = (query.created_after, query.created_before) {
            if after >= before {
                return Err(MediaServiceError::Validation(
                    "created_after must be before created_before".to_string(),
                ));
            }
        }

        Ok(())
    }

    /// Validate metadata structure and size
    fn validate_metadata(&self, metadata: &serde_json::Value) -> Result<(), MediaServiceError> {
        // Check metadata size (PostgreSQL JSONB has practical limits)
        let metadata_str = metadata.to_string();
        if metadata_str.len() > 1_000_000 {
            // 1MB limit for metadata
            return Err(MediaServiceError::Validation(
                "Metadata size exceeds 1MB limit".to_string(),
            ));
        }

        // Validate JSON structure depth to prevent stack overflow
        if self.get_json_depth(metadata) > 10 {
            return Err(MediaServiceError::Validation(
                "Metadata JSON depth exceeds maximum of 10 levels".to_string(),
            ));
        }

        Ok(())
    }

    /// Calculate JSON depth recursively
    fn get_json_depth(&self, value: &serde_json::Value) -> usize {
        match value {
            serde_json::Value::Object(obj) => {
                1 + obj
                    .values()
                    .map(|v| self.get_json_depth(v))
                    .max()
                    .unwrap_or(0)
            }
            serde_json::Value::Array(arr) => {
                1 + arr
                    .iter()
                    .map(|v| self.get_json_depth(v))
                    .max()
                    .unwrap_or(0)
            }
            _ => 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::media::repository::MediaBlobRepository;
    use sqlx::PgPool;
    use uuid::Uuid;

    fn create_test_service() -> MediaBlobService {
        // For unit tests, we'll use a mock repository
        // In integration tests, we'd use a real database
        todo!("Create mock repository for unit tests")
    }

    #[test]
    fn test_validate_sha256() {
        let service = create_test_service();

        // Valid SHA256
        assert!(service.validate_sha256(&"a".repeat(64)).is_ok());

        // Invalid cases
        assert!(service.validate_sha256("").is_err());
        assert!(service.validate_sha256(&"a".repeat(63)).is_err());
        assert!(service.validate_sha256(&"a".repeat(65)).is_err());
        assert!(service.validate_sha256("invalid_hex_g").is_err());
    }

    #[test]
    fn test_validate_metadata() {
        let service = create_test_service();

        // Valid metadata
        assert!(service
            .validate_metadata(&serde_json::json!({"key": "value"}))
            .is_ok());

        // Too deep metadata
        let deep_json = serde_json::json!({
            "a": {"b": {"c": {"d": {"e": {"f": {"g": {"h": {"i": {"j": {"k": "too_deep"}}}}}}}}}}
        });
        assert!(service.validate_metadata(&deep_json).is_err());
    }

    #[test]
    fn test_get_json_depth() {
        let service = create_test_service();

        assert_eq!(service.get_json_depth(&serde_json::json!("simple")), 0);
        assert_eq!(service.get_json_depth(&serde_json::json!({"a": "b"})), 1);
        assert_eq!(
            service.get_json_depth(&serde_json::json!({"a": {"b": "c"}})),
            2
        );
        assert_eq!(service.get_json_depth(&serde_json::json!([1, 2, 3])), 1);
        assert_eq!(service.get_json_depth(&serde_json::json!([{"a": "b"}])), 2);
    }

    #[test]
    fn test_service_error_display() {
        let error = MediaServiceError::Validation("test error".to_string());
        assert!(error.to_string().contains("test error"));
    }
}
