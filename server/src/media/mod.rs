//! Media blob module for file sharing through WebSocket
//!
//! This module provides a complete system for managing media blobs including:
//! - Database models and repository layer
//! - WebSocket integration for real-time sharing
//! - File storage and retrieval operations
//!
//! The media system is designed to work with the existing authentication
//! and analytics systems to provide secure, trackable file sharing.
//! #todo: unsure about the MediaService abstractionz here...

pub mod filters;
pub mod genres;
pub mod models;
pub mod music_jobs;
pub mod playlists;
pub mod repository;
pub mod search;
pub mod songs;
pub mod sorting;

// Re-export commonly used types
use crate::error::WebauthnError;
use axum::Router;
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
    pub async fn get_blob(&self, id: &str, include_data: bool) -> Result<MediaBlob, WebauthnError> {
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
    pub async fn delete_blob(&self, id: &str) -> Result<bool, WebauthnError> {
        self.repository.delete(id).await
    }

    /// Update blob metadata
    pub async fn update_metadata(
        &self,
        id: &str,
        metadata: serde_json::Value,
    ) -> Result<MediaBlob, WebauthnError> {
        self.repository.update_metadata(id, metadata).await
    }

    /// Clean up old blobs
    pub async fn cleanup_old_blobs(&self, days: i32) -> Result<u64, WebauthnError> {
        self.repository.cleanup_old_blobs(days).await
    }
}

/// Build media routes including songs and playlists
pub fn build_media_routes() -> Router {
    // Merge all music API routes first to avoid nesting conflicts
    let music_routes = Router::new()
        .merge(search::create_search_routes())
        .merge(filters::create_filter_routes())
        .merge(genres::create_genre_routes());

    Router::new()
        .nest("/api/media", songs::create_routes())
        .merge(playlists::create_routes())
        .nest("/api/music", music_routes)
}
