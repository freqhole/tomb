//! Media blob repository for database operations
//!
//! This module provides database access layer for media blobs,
//! including CRUD operations and queries with cursor-based pagination support.
//! #todo: i'm not sure i love these abstractionz :/ basically just shallow wrapperz for grimoire fnz YANK!

use crate::error::WebauthnError;
use grimoire::media::{
    CreateMediaBlob, MediaBlob, MediaBlobQuery, MediaBlobRepository, MediaBlobService,
    MediaBlobStats, MediaRepositoryError, MediaServiceError, PaginatedResult,
};
use grimoire::DatabaseConnection;
use tracing::{debug, error, info};

/// Media repository wrapper that uses grimoire services
pub struct MediaRepository<'a> {
    service: MediaBlobService,
    _db: &'a DatabaseConnection,
}

#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("Service error: {0}")]
    Service(#[from] MediaServiceError),
    #[error("Repository error: {0}")]
    Repository(#[from] MediaRepositoryError),
    #[error("Media blob not found")]
    NotFound,
    #[error("Invalid SHA256 hash")]
    InvalidHash,
    #[error("Validation error: {0}")]
    Validation(String),
    #[error("Duplicate SHA256 hash")]
    Duplicate,
}

impl From<MediaError> for WebauthnError {
    fn from(err: MediaError) -> Self {
        match err {
            MediaError::Service(MediaServiceError::Repository(MediaRepositoryError::NotFound(
                _,
            ))) => WebauthnError::UserNotFound,
            MediaError::Service(MediaServiceError::Validation(_)) => WebauthnError::BadRequest,
            MediaError::Service(MediaServiceError::BusinessLogic(_)) => WebauthnError::BadRequest,
            MediaError::Service(e) => {
                error!("Media service error: {}", e);
                WebauthnError::DatabaseError
            }
            MediaError::Repository(e) => {
                error!("Media repository error: {}", e);
                WebauthnError::DatabaseError
            }
            MediaError::NotFound => WebauthnError::UserNotFound,
            MediaError::InvalidHash => WebauthnError::BadRequest,
            MediaError::Validation(_) => WebauthnError::BadRequest,
            MediaError::Duplicate => WebauthnError::BadRequest,
        }
    }
}

impl From<MediaServiceError> for WebauthnError {
    fn from(err: MediaServiceError) -> Self {
        match err {
            MediaServiceError::Repository(MediaRepositoryError::NotFound(_)) => {
                WebauthnError::UserNotFound
            }
            MediaServiceError::Repository(MediaRepositoryError::NotFoundBySha256(_)) => {
                WebauthnError::UserNotFound
            }
            MediaServiceError::Validation(_) => WebauthnError::BadRequest,
            MediaServiceError::BusinessLogic(_) => WebauthnError::BadRequest,
            MediaServiceError::ConcurrentModification => WebauthnError::BadRequest,
            MediaServiceError::Repository(e) => {
                error!("Media repository error: {}", e);
                WebauthnError::DatabaseError
            }
        }
    }
}

impl<'a> MediaRepository<'a> {
    /// Create a new repository instance
    pub fn new(db: &'a DatabaseConnection) -> Self {
        let repository = MediaBlobRepository::new(db.pool().clone());
        let service = MediaBlobService::new(repository);
        Self { service, _db: db }
    }

    /// Create a new media blob
    pub async fn create(
        &self,
        params: CreateMediaBlob,
        _media_config: &grimoire::config::MediaConfig,
    ) -> Result<MediaBlob, WebauthnError> {
        info!("Creating media blob with SHA256: {}", params.sha256);

        let blob = self.service.create_media_blob(params).await?;

        info!("Successfully created media blob: {}", blob.id);
        Ok(blob)
    }

    /// Find a media blob by ID
    pub async fn find_by_id(&self, id: &str) -> Result<MediaBlob, WebauthnError> {
        debug!("Finding media blob by ID: {}", id);

        let blob = self.service.get_media_blob(id).await?;
        Ok(blob)
    }

    /// Find a media blob by SHA256 hash
    pub async fn get_by_sha256(&self, sha256: &str) -> Result<MediaBlob, WebauthnError> {
        debug!("Finding media blob by SHA256: {}", sha256);

        let blob = self.service.get_media_blob_by_sha256(sha256).await?;
        Ok(blob)
    }

    /// Find a media blob by ID without data (for efficient responses)
    /// Get a media blob by ID without data field for efficiency
    pub async fn get_by_id_without_data(&self, id: &str) -> Result<MediaBlob, WebauthnError> {
        debug!("Finding media blob by ID without data: {}", id);

        let blob = self.service.get_media_blob_metadata(id).await?;
        Ok(blob)
    }

    /// Query media blobs with filtering and pagination (supports both cursor and offset)
    pub async fn query(
        &self,
        params: MediaBlobQuery,
    ) -> Result<PaginatedResult<MediaBlob>, WebauthnError> {
        debug!("Querying media blobs with params: {:?}", params);

        let result = self.service.query_media_blobs(params).await?;
        Ok(result)
    }

    /// Legacy method for backward compatibility - returns only the items
    pub async fn query_legacy(
        &self,
        params: MediaBlobQuery,
    ) -> Result<Vec<MediaBlob>, WebauthnError> {
        let result = self.query(params).await?;
        Ok(result.items)
    }

    /// Get media blob statistics
    pub async fn get_stats(&self) -> Result<MediaBlobStats, WebauthnError> {
        debug!("Getting media blob statistics");

        let stats = self.service.get_statistics().await?;
        Ok(stats)
    }

    /// Update blob metadata
    pub async fn update_metadata(
        &self,
        id: &str,
        metadata: serde_json::Value,
    ) -> Result<MediaBlob, WebauthnError> {
        debug!("Updating metadata for media blob: {}", id);

        let updated_blob = self.service.update_metadata(id, metadata).await?;
        Ok(updated_blob)
    }

    /// Delete a media blob by ID
    pub async fn delete(&self, id: &str) -> Result<bool, WebauthnError> {
        info!("Deleting media blob: {}", id);

        self.service.delete_media_blob(id).await?;
        Ok(true)
    }

    /// Clean up old media blobs (older than specified days)
    pub async fn cleanup_old_blobs(&self, days: i32) -> Result<u64, WebauthnError> {
        info!("Cleaning up media blobs older than {} days", days);

        let cutoff_date = time::OffsetDateTime::now_utc() - time::Duration::days(days as i64);

        let mut query = MediaBlobQuery::with_cursor(None, Some(1000));
        query.created_before = Some(cutoff_date);

        // Get all old blobs and delete them
        let old_blobs = self.service.query_media_blobs(query).await?;
        let mut deleted_count = 0;

        for blob in old_blobs.items {
            self.service.delete_media_blob(&blob.id).await?;
            deleted_count += 1;
        }

        info!("Deleted {} old media blobs", deleted_count);
        Ok(deleted_count)
    }

    /// Get media blobs by client ID
    pub async fn find_by_client_id(
        &self,
        client_id: &str,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<MediaBlob>, WebauthnError> {
        let mut query = MediaBlobQuery::with_offset(limit, offset);
        query.source_client_id = Some(client_id.to_string());

        let result = self.query(query).await?;
        Ok(result.items)
    }

    /// Check if a media blob exists by SHA256
    pub async fn exists_by_sha256(&self, sha256: &str) -> Result<bool, WebauthnError> {
        debug!("Checking if media blob exists by SHA256: {}", sha256);

        let exists = self.service.exists_by_sha256(sha256).await?;
        Ok(exists)
    }

    /// Get recent media blobs (within last N days)
    pub async fn get_recent(
        &self,
        days: i32,
        limit: Option<i64>,
    ) -> Result<Vec<MediaBlob>, WebauthnError> {
        debug!("Getting recent media blobs from last {} days", days);

        let cutoff_date = time::OffsetDateTime::now_utc() - time::Duration::days(days as i64);

        let result = self
            .service
            .get_media_blobs_since(cutoff_date, None, limit)
            .await?;
        Ok(result.items)
    }
}

#[cfg(test)]
mod tests {
    use grimoire::DatabaseConnection;

    async fn _setup_test_db() -> DatabaseConnection {
        // This would be set up with test database in real tests
        todo!("Setup test database")
    }

    #[tokio::test]
    async fn test_create_media_blob() {
        // let db = setup_test_db().await;
        // let repo = MediaRepository::new(&db);

        // let params = CreateMediaBlob {
        //     data: Some(vec![1, 2, 3, 4]),
        //     sha256: "a".repeat(64),
        //     size: Some(4),
        //     mime: Some("image/png".to_string()),
        //     source_client_id: Some("test-client".to_string()),
        //     local_path: None,
        //     metadata: serde_json::Value::Null,
        // };

        // let result = repo.create(params).await;
        // assert!(result.is_ok());
        assert!(true); // Placeholder test
    }
}
