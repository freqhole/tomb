//! Media blob domain module with cursor-based pagination support
//!
//! This module provides the core domain logic for media blob management,
//! including both traditional offset-based pagination and modern cursor-based
//! pagination for efficient data synchronization.
//!
//! ## Key Features
//!
//! - **Cursor-based pagination**: Efficient pagination using timestamp + ID cursors
//! - **Offset-based pagination**: Traditional limit/offset pagination for compatibility
//! - **Advanced filtering**: Filter by SHA256, client ID, MIME type, and timestamp ranges
//! - **Sync optimization**: Specialized methods for incremental synchronization
//! - **Validation**: Comprehensive validation for all inputs and business rules
//!
//! ## Usage Examples
//!
//! ### Basic cursor-based pagination
//!
//! ```rust
//! use legacylib::media::{MediaBlobService, MediaBlobQuery};
//!
//! // Get recent media blobs with cursor pagination
//! let query = MediaBlobQuery::with_cursor(None, Some(25));
//! let result = service.query_media_blobs(query).await?;
//!
//! // Use the next_cursor for subsequent pages
//! if let Some(next_cursor) = result.pagination.next_cursor {
//!     let next_query = MediaBlobQuery::with_cursor(Some(next_cursor), Some(25));
//!     let next_result = service.query_media_blobs(next_query).await?;
//! }
//! ```
//!
//! ### Synchronization workflow
//!
//! ```rust
//! use time::OffsetDateTime;
//!
//! // Get items modified since last sync
//! let last_sync = OffsetDateTime::now_utc() - time::Duration::hours(1);
//! let sync_result = service.get_sync_page(Some(last_sync), None, Some(50)).await?;
//! ```
//!
//! ### Advanced filtering
//!
//! ```rust
//! let mut query = MediaBlobQuery::with_cursor(None, Some(20));
//! query.mime_pattern = Some("image/".to_string());
//! query.source_client_id = Some("mobile-app".to_string());
//! query.created_after = Some(last_week);
//!
//! let filtered_result = service.query_media_blobs(query).await?;
//! ```

pub mod models;
pub mod repository;
pub mod scanner;
pub mod service;
pub mod sync;
pub mod traits;
pub mod types;

pub use models::{
    CreateMediaBlob, CursorError, MediaBlob, MediaBlobCursor, MediaBlobQuery, PaginatedResult,
    PaginationDirection, PaginationMetadata,
};
pub use repository::{MediaBlobRepository, MediaBlobStats, MediaRepositoryError, MimeTypeCount};
pub use scanner::{
    ConsoleScanProgress, DomainScanner, ScanError, ScanProgress, ScanResult, ScanStats,
    UnifiedMediaScanner, UnifiedScannerBuilder,
};
pub use service::{MediaBlobService, MediaServiceError, SyncPriority, SyncRecommendations};
pub use sync::{
    ClientSyncState, FullSyncRequest, SyncAcknowledgment, SyncCapabilities, SyncError, SyncRequest,
    SyncResponse, SyncStatus, SyncStatusResponse,
};
pub use traits::{
    CollectionRepository, CreateCollection, CreateMediaItem, ImageFormat, MediaCollection,
    MediaItem, MediaQuery, MediaRepository, MediaScanner, MediaService, MediaStats,
    MetadataExtractor, ScanConfig, ScannedFile, ThumbnailGenerator, ThumbnailInfo,
    UpdateCollection, UpdateMediaItem,
};
pub use types::{MediaTypeDetector, MediaTypeError, StorageStrategy};

/// Re-exports for convenience
pub mod prelude {
    pub use super::{
        CollectionRepository,
        CreateMediaBlob,
        DomainScanner,
        MediaBlob,
        MediaBlobCursor,
        MediaBlobQuery,
        MediaBlobRepository,
        MediaBlobService,
        MediaCollection,
        // Generic traits
        MediaItem,
        MediaRepository,
        MediaScanner,
        MediaService,
        MediaTypeDetector,
        MetadataExtractor,
        PaginatedResult,
        PaginationDirection,
        ScanConfig,
        StorageStrategy,
        SyncRequest,
        SyncResponse,
        SyncStatusResponse,
        ThumbnailGenerator,
        // Scanner types
        UnifiedMediaScanner,
        UnifiedScannerBuilder,
    };
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use sqlx::PgPool;

    // Helper function to create a test service
    // This would be implemented in actual integration tests
    #[allow(dead_code)]
    async fn create_test_service(_pool: PgPool) -> MediaBlobService {
        todo!("Implement test service creation for integration tests")
    }

    // Integration test examples (to be implemented when database is available)
    #[tokio::test]
    #[ignore] // Ignored until test database is available
    async fn test_cursor_pagination_integration() {
        // This test would verify end-to-end cursor pagination
        // including database queries and cursor encoding/decoding
        todo!("Implement integration test for cursor pagination")
    }

    #[tokio::test]
    #[ignore] // Ignored until test database is available
    async fn test_sync_workflow_integration() {
        // This test would verify the complete sync workflow
        // including timestamp-based filtering and cursor navigation
        todo!("Implement integration test for sync workflow")
    }
}
