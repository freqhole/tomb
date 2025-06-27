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
use super::sync::{
    FullSyncRequest, SyncAcknowledgment, SyncCapabilities, SyncError, SyncRequest, SyncResponse,
    SyncStatusResponse,
};
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
    /// Get media blob statistics
    pub async fn get_statistics(
        &self,
    ) -> Result<super::repository::MediaBlobStats, MediaServiceError> {
        debug!("Retrieving media blob statistics");
        let stats = self.repository.get_stats().await?;
        Ok(stats)
    }

    /// Perform incremental sync for a client
    pub async fn incremental_sync(
        &self,
        request: SyncRequest,
    ) -> Result<SyncResponse, MediaServiceError> {
        info!(
            "Starting incremental sync for client: {} since: {:?}",
            request.client_id, request.last_sync_time
        );

        // Validate request
        request.validate(1000)?; // Max 1000 items per batch

        let page_size = request.effective_page_size(50, 1000);

        // Build query for incremental sync
        let mut query = MediaBlobQuery::with_cursor(request.cursor.clone(), Some(page_size));

        // Add timestamp filter for incremental sync
        if let Some(last_sync) = request.last_sync_time {
            query.created_after = Some(last_sync);
        }

        // Add MIME type filters if specified
        if let Some(mime_types) = &request.mime_types {
            if !mime_types.is_empty() {
                // For simplicity, use the first MIME type as a pattern
                // In a full implementation, this would support multiple patterns
                query.mime_pattern = Some(mime_types[0].clone());
            }
        }

        // Execute query
        let result = self.query_media_blobs(query).await?;

        // Remove binary data if not requested
        let mut items = result.items;
        if !request.include_data.unwrap_or(false) {
            for item in &mut items {
                item.data = None;
            }
        }

        // Create sync response
        let sync_response = SyncResponse::new(
            items,
            result.pagination.has_next_page,
            result.pagination.next_cursor,
            false, // This is incremental, not full sync
        );

        info!(
            "Incremental sync completed for client: {} - {} items",
            request.client_id, sync_response.pagination.batch_size
        );

        Ok(sync_response)
    }

    /// Perform full sync for a client
    pub async fn full_sync(
        &self,
        request: FullSyncRequest,
    ) -> Result<SyncResponse, MediaServiceError> {
        info!("Starting full sync for client: {}", request.client_id);

        let page_size = request.batch_size.unwrap_or(50).min(1000).max(1);

        // Build query for full sync
        let mut query = MediaBlobQuery::with_cursor(request.start_cursor.clone(), Some(page_size));

        // Add MIME type filters if specified
        if let Some(mime_types) = &request.mime_types {
            if !mime_types.is_empty() {
                query.mime_pattern = Some(mime_types[0].clone());
            }
        }

        // Execute query
        let result = self.query_media_blobs(query).await?;

        // Remove binary data if not requested
        let mut items = result.items;
        if !request.include_data.unwrap_or(false) {
            for item in &mut items {
                item.data = None;
            }
        }

        // Get total count for progress calculation
        let stats = self.get_statistics().await?;
        let total_items = stats.total_count;

        // Calculate progress if possible
        let progress = if total_items > 0 {
            let synced_so_far = items.len() as f64;
            Some(synced_so_far / total_items as f64)
        } else {
            None
        };

        // Create sync response
        let mut sync_response = SyncResponse::new(
            items,
            result.pagination.has_next_page,
            result.pagination.next_cursor,
            true, // This is full sync
        );

        if let Some(progress_val) = progress {
            sync_response = sync_response.with_progress(progress_val, total_items);
        }

        info!(
            "Full sync batch completed for client: {} - {} items",
            request.client_id, sync_response.pagination.batch_size
        );

        Ok(sync_response)
    }

    /// Get sync status and server capabilities
    pub async fn get_sync_status(&self) -> Result<SyncStatusResponse, MediaServiceError> {
        debug!("Getting sync status");

        let stats = self.get_statistics().await?;

        // Get latest modification time by querying recent items
        let recent_query = MediaBlobQuery::with_cursor(None, Some(1));
        let recent_result = self.query_media_blobs(recent_query).await?;
        let last_modification = recent_result.items.first().map(|item| item.updated_at);

        let capabilities = SyncCapabilities {
            max_batch_size: 1000,
            min_sync_interval: 1, // 1 second minimum
            supported_mime_filters: vec![
                "image/*".to_string(),
                "video/*".to_string(),
                "audio/*".to_string(),
                "text/*".to_string(),
                "application/*".to_string(),
            ],
            supports_incremental: true,
            supports_cursors: true,
            sync_history_retention_days: 30,
        };

        Ok(SyncStatusResponse {
            server_time: OffsetDateTime::now_utc(),
            active_syncs: 0, // Would track this in a real implementation
            total_items: stats.total_count,
            last_modification,
            capabilities,
        })
    }

    /// Process sync acknowledgment from client
    pub async fn process_sync_acknowledgment(
        &self,
        ack: SyncAcknowledgment,
    ) -> Result<(), MediaServiceError> {
        info!(
            "Processing sync acknowledgment from client: {} - {} items synced",
            ack.client_id, ack.items_synced
        );

        // In a full implementation, this would:
        // 1. Update client sync state in database
        // 2. Clean up any temporary sync state
        // 3. Log sync metrics
        // 4. Handle any failed items

        if !ack.failed_items.is_empty() {
            warn!(
                "Client {} reported {} failed sync items: {:?}",
                ack.client_id,
                ack.failed_items.len(),
                ack.failed_items
            );
        }

        debug!("Sync acknowledgment processed successfully");
        Ok(())
    }

    /// Check if incremental sync is needed for a client
    pub async fn needs_sync(
        &self,
        client_id: &str,
        last_sync_time: OffsetDateTime,
    ) -> Result<bool, MediaServiceError> {
        debug!(
            "Checking if client {} needs sync since {}",
            client_id, last_sync_time
        );

        // Query for any items modified since last sync
        let mut query = MediaBlobQuery::with_cursor(None, Some(1));
        query.created_after = Some(last_sync_time);

        let result = self.query_media_blobs(query).await?;

        let needs_sync = !result.items.is_empty();
        debug!("Client {} needs sync: {}", client_id, needs_sync);

        Ok(needs_sync)
    }

    /// Get sync recommendations for a client
    pub async fn get_sync_recommendations(
        &self,
        client_id: &str,
        last_sync_time: Option<OffsetDateTime>,
    ) -> Result<SyncRecommendations, MediaServiceError> {
        debug!("Getting sync recommendations for client: {}", client_id);

        let now = OffsetDateTime::now_utc();
        let default_last_sync = now - time::Duration::days(7); // Default to last week
        let last_sync = last_sync_time.unwrap_or(default_last_sync);

        // Count items that need sync
        let mut count_query = MediaBlobQuery::with_cursor(None, Some(1000));
        count_query.created_after = Some(last_sync);
        let result = self.query_media_blobs(count_query).await?;

        let items_to_sync = result
            .pagination
            .total_count
            .unwrap_or(result.items.len() as i64);
        let time_since_sync = now - last_sync;

        // Calculate recommendations
        let recommended_batch_size = if items_to_sync > 1000 {
            100 // Smaller batches for large syncs
        } else if items_to_sync > 100 {
            50
        } else {
            items_to_sync.max(10)
        };

        let recommended_interval = if time_since_sync > time::Duration::days(1) {
            300 // 5 minutes for old syncs
        } else {
            60 // 1 minute for recent syncs
        };

        Ok(SyncRecommendations {
            should_sync: items_to_sync > 0,
            recommended_batch_size,
            recommended_interval_seconds: recommended_interval,
            estimated_batches: (items_to_sync as f64 / recommended_batch_size as f64).ceil() as i64,
            estimated_duration_seconds: (items_to_sync / 10).max(1), // Rough estimate
            priority: if time_since_sync > time::Duration::hours(1) {
                SyncPriority::High
            } else {
                SyncPriority::Normal
            },
        })
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

/// Sync recommendations for a client
#[derive(Debug, Clone)]
pub struct SyncRecommendations {
    pub should_sync: bool,
    pub recommended_batch_size: i64,
    pub recommended_interval_seconds: u64,
    pub estimated_batches: i64,
    pub estimated_duration_seconds: i64,
    pub priority: SyncPriority,
}

/// Sync priority levels
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncPriority {
    Low,
    Normal,
    High,
    Critical,
}

impl From<SyncError> for MediaServiceError {
    fn from(err: SyncError) -> Self {
        match err {
            SyncError::InvalidTimestamp(msg) => MediaServiceError::Validation(msg),
            SyncError::InvalidCursor(msg) => MediaServiceError::Validation(msg),
            SyncError::BatchSizeTooLarge(_, _) => MediaServiceError::Validation(err.to_string()),
            SyncError::ClientStateNotFound(msg) => MediaServiceError::BusinessLogic(msg),
            SyncError::SyncInProgress(msg) => MediaServiceError::BusinessLogic(msg),
            SyncError::RateLimitExceeded(msg) => MediaServiceError::BusinessLogic(msg),
            SyncError::OperationFailed(msg) => MediaServiceError::BusinessLogic(msg),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_service() -> MediaBlobService {
        // For unit tests, we'll use a mock repository
        // In integration tests, we'd use a real database
        todo!("Create mock repository for unit tests")
    }

    #[test]
    #[ignore = "Requires database connection - should be converted to integration test"]
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
    #[ignore = "Requires database connection - should be converted to integration test"]
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
    #[ignore = "Requires database connection - should be converted to integration test"]
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
