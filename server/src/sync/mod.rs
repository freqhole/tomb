//! Synchronization module for media blob sync endpoints
//!
//! This module provides HTTP API endpoints for efficient media blob synchronization
//! between clients and server. It leverages the cursor-based pagination system
//! and timestamp filtering to enable incremental sync workflows.
//!
//! ## API Endpoints
//!
//! - `GET /api/sync/media` - Incremental sync with timestamp cursors
//! - `GET /api/sync/media/full` - Full sync for initial synchronization
//! - `POST /api/sync/media/acknowledge` - Acknowledge successful sync
//! - `GET /api/sync/status` - Get sync status and server capabilities
//! - `GET /api/sync/recommendations` - Get sync recommendations for a client
//! - `GET /api/sync/check` - Check if sync is needed
//!
//! ## Key Features
//!
//! - **Incremental sync**: Only sync items modified since last sync
//! - **Cursor-based pagination**: Efficient pagination for large datasets
//! - **Timestamp filtering**: Precise sync boundaries using RFC3339 timestamps
//! - **Selective sync**: Filter by MIME types and other criteria
//! - **Progress tracking**: Batch progress and completion status
//! - **Error handling**: Robust error handling and recovery
//! - **Rate limiting**: Built-in sync rate recommendations
//!
//! ## Usage Examples
//!
//! ### Incremental Sync
//! ```
//! GET /api/sync/media?last_sync_time=2023-10-01T12:00:00Z&page_size=50
//! ```
//!
//! ### Full Sync (Initial)
//! ```
//! GET /api/sync/media/full?batch_size=100&include_data=false
//! ```
//!
//! ### Sync Acknowledgment
//! ```
//! POST /api/sync/media/acknowledge
//! {
//!   "sync_timestamp": "2023-10-01T12:30:00Z",
//!   "items_synced": 25,
//!   "failed_items": []
//! }
//! ```

pub mod handlers;
pub mod integration_tests;

pub use handlers::{
    acknowledge_sync, check_sync_needed, full_sync, incremental_playlist_song_sync,
    incremental_playlist_sync, incremental_song_sync, incremental_sync, sync_recommendations,
    sync_status, FullSyncQuery, IncrementalSyncQuery, PlaylistSongSyncQuery, PlaylistSyncQuery,
    SongSyncQuery, SyncAckRequest, SyncRecommendationsResponse,
};

use axum::{
    routing::{get, post},
    Router,
};

/// Create sync API routes
pub fn create_sync_routes() -> Router {
    use crate::auth::middleware::require_authentication;
    use axum::middleware;

    Router::new()
        .route("/api/sync/media", get(incremental_sync))
        .route("/api/sync/media/full", get(full_sync))
        .route("/api/sync/media/acknowledge", post(acknowledge_sync))
        .route("/api/sync/songs", get(incremental_song_sync))
        .route("/api/sync/playlists", get(incremental_playlist_sync))
        .route(
            "/api/sync/playlist-songs",
            get(incremental_playlist_song_sync),
        )
        .route("/api/sync/status", get(sync_status))
        .route("/api/sync/recommendations", get(sync_recommendations))
        .route("/api/sync/check", get(check_sync_needed))
        .layer(middleware::from_fn(require_authentication))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sync_routes_creation() {
        // This test verifies that sync routes can be created without panicking
        let _router = create_sync_routes();
    }
}
