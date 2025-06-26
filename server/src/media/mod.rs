//! Media blob module for file sharing through WebSocket
//!
//! This module provides a complete system for managing media blobs including:
//! - Database models and repository layer
//! - WebSocket integration for real-time sharing
//! - File storage and retrieval operations
//!
//! The media system is designed to work with the existing authentication
//! and analytics systems to provide secure, trackable file sharing.

pub mod models;
pub mod repository;

// Re-export commonly used types
use crate::error::WebauthnError;
use grimoire::config::MediaConfig;
pub use models::{CreateMediaBlob, MediaBlob, MediaBlobQuery, MediaBlobStats, PaginatedResult};
pub use repository::{MediaError, MediaRepository};

/// Media blob service that combines repository operations with business logic
pub struct MediaService<'a> {
    repository: MediaRepository<'a>,
}

impl<'a> MediaService<'a> {
    /// Create a new MediaService
    pub fn new(repository: MediaRepository<'a>) -> Self {
        Self { repository }
    }

    /// Create a new media blob with deduplication check
    pub async fn create_blob(
        &self,
        params: CreateMediaBlob,
        media_config: &MediaConfig,
    ) -> Result<MediaBlob, WebauthnError> {
        // Check if blob with same SHA256 already exists
        if let Ok(existing) = self.repository.get_by_sha256(&params.sha256).await {
            tracing::info!("Found existing blob with SHA256: {}", params.sha256);
            return Ok(existing);
        }

        // Create new blob
        self.repository.create(params, media_config).await
    }

    /// Get a blob by ID, optionally including data
    pub async fn get_blob(
        &self,
        id: uuid::Uuid,
        include_data: bool,
    ) -> Result<MediaBlob, WebauthnError> {
        if include_data {
            self.repository.find_by_id(id).await
        } else {
            self.repository.get_by_id_without_data(id).await
        }
    }

    /// List blobs with pagination and filtering (new cursor-based pagination)
    pub async fn list_blobs(
        &self,
        query: MediaBlobQuery,
    ) -> Result<PaginatedResult<MediaBlob>, WebauthnError> {
        self.repository.query(query).await
    }

    /// List blobs with pagination and filtering (legacy - returns only items)
    pub async fn list_blobs_legacy(
        &self,
        query: MediaBlobQuery,
    ) -> Result<Vec<MediaBlob>, WebauthnError> {
        self.repository.query_legacy(query).await
    }

    /// Get media statistics
    pub async fn get_stats(&self) -> Result<MediaBlobStats, WebauthnError> {
        self.repository.get_stats().await
    }

    /// Delete a blob by ID
    pub async fn delete_blob(&self, id: uuid::Uuid) -> Result<bool, WebauthnError> {
        self.repository.delete(id).await
    }

    /// Update blob metadata
    pub async fn update_metadata(
        &self,
        id: uuid::Uuid,
        metadata: serde_json::Value,
    ) -> Result<MediaBlob, WebauthnError> {
        self.repository.update_metadata(id, metadata).await
    }

    /// Clean up old blobs
    pub async fn cleanup_old_blobs(&self, days: i32) -> Result<u64, WebauthnError> {
        self.repository.cleanup_old_blobs(days).await
    }
}
