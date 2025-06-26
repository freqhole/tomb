//! Media blob synchronization models and utilities
//!
//! This module provides the core data structures and logic for efficient
//! media blob synchronization between clients and server. It builds on
//! the cursor-based pagination system to enable incremental sync workflows.

use super::models::MediaBlob;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// Sync request parameters for incremental synchronization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncRequest {
    /// Last sync timestamp - only get items modified after this time
    pub last_sync_time: Option<OffsetDateTime>,
    /// Pagination cursor for continuing a large sync operation
    pub cursor: Option<String>,
    /// Maximum number of items to return in this sync batch
    pub page_size: Option<i64>,
    /// Client ID for tracking sync state per client
    pub client_id: String,
    /// Whether to include binary data or just metadata
    pub include_data: Option<bool>,
    /// Filter by specific MIME types
    pub mime_types: Option<Vec<String>>,
}

/// Sync response containing incremental updates
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncResponse {
    /// Media blobs that have been added or modified since last sync
    pub items: Vec<MediaBlob>,
    /// Pagination metadata for continuing the sync
    pub pagination: SyncPaginationMetadata,
    /// Server timestamp when this sync response was generated
    pub sync_timestamp: OffsetDateTime,
    /// Whether this is a full sync (true) or incremental (false)
    pub is_full_sync: bool,
    /// Total number of items available for sync (if known)
    pub total_items: Option<i64>,
}

/// Pagination metadata specific to sync operations
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncPaginationMetadata {
    /// Number of items in this batch
    pub batch_size: usize,
    /// Whether there are more items to sync
    pub has_more: bool,
    /// Cursor for the next batch of sync items
    pub next_cursor: Option<String>,
    /// Estimated progress (0.0 to 1.0) if calculable
    pub progress: Option<f64>,
    /// Suggested delay before next sync request (in seconds)
    pub suggested_delay: Option<u32>,
}

/// Sync acknowledgment to confirm successful client sync
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncAcknowledgment {
    /// Client ID acknowledging the sync
    pub client_id: String,
    /// Timestamp of the sync that was successfully processed
    pub sync_timestamp: OffsetDateTime,
    /// Number of items successfully synced
    pub items_synced: i64,
    /// Any items that failed to sync (by ID)
    pub failed_items: Vec<Uuid>,
    /// Client's current sync state
    pub client_sync_state: ClientSyncState,
}

/// Client synchronization state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClientSyncState {
    /// Client identifier
    pub client_id: String,
    /// Last successful sync timestamp
    pub last_sync_time: OffsetDateTime,
    /// Total number of items synced by this client
    pub total_items_synced: i64,
    /// Current sync status
    pub status: SyncStatus,
    /// Last sync cursor position (for resuming interrupted syncs)
    pub last_cursor: Option<String>,
    /// Timestamp when this state was last updated
    pub updated_at: OffsetDateTime,
}

/// Synchronization status enumeration
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub enum SyncStatus {
    /// Client has never synced
    Never,
    /// Sync is currently in progress
    InProgress,
    /// Sync completed successfully
    Complete,
    /// Sync failed with errors
    Failed,
    /// Sync was paused/interrupted
    Paused,
}

/// Full sync request for initial synchronization
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FullSyncRequest {
    /// Client ID requesting full sync
    pub client_id: String,
    /// Batch size for paginated full sync
    pub batch_size: Option<i64>,
    /// Starting cursor (for resuming interrupted full sync)
    pub start_cursor: Option<String>,
    /// Whether to include binary data
    pub include_data: Option<bool>,
    /// Filter by MIME types
    pub mime_types: Option<Vec<String>>,
}

/// Sync status response for monitoring sync health
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncStatusResponse {
    /// Current server timestamp
    pub server_time: OffsetDateTime,
    /// Number of active sync sessions
    pub active_syncs: i64,
    /// Total items available for sync
    pub total_items: i64,
    /// Last modification time in the system
    pub last_modification: Option<OffsetDateTime>,
    /// Server sync capabilities
    pub capabilities: SyncCapabilities,
}

/// Server synchronization capabilities
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncCapabilities {
    /// Maximum batch size supported
    pub max_batch_size: i64,
    /// Minimum sync interval in seconds
    pub min_sync_interval: u32,
    /// Supported MIME type filters
    pub supported_mime_filters: Vec<String>,
    /// Whether incremental sync is supported
    pub supports_incremental: bool,
    /// Whether cursor-based pagination is supported
    pub supports_cursors: bool,
    /// Maximum client sync history retained (in days)
    pub sync_history_retention_days: u32,
}

/// Error types specific to sync operations
#[derive(Debug, thiserror::Error)]
pub enum SyncError {
    #[error("Invalid sync timestamp: {0}")]
    InvalidTimestamp(String),
    #[error("Client sync state not found: {0}")]
    ClientStateNotFound(String),
    #[error("Sync already in progress for client: {0}")]
    SyncInProgress(String),
    #[error("Invalid cursor: {0}")]
    InvalidCursor(String),
    #[error("Sync batch size too large: {0}, max: {1}")]
    BatchSizeTooLarge(i64, i64),
    #[error("Sync rate limit exceeded for client: {0}")]
    RateLimitExceeded(String),
    #[error("Sync operation failed: {0}")]
    OperationFailed(String),
}

impl SyncRequest {
    /// Create a new incremental sync request
    pub fn incremental(
        client_id: String,
        last_sync_time: OffsetDateTime,
        page_size: Option<i64>,
    ) -> Self {
        Self {
            last_sync_time: Some(last_sync_time),
            cursor: None,
            page_size,
            client_id,
            include_data: Some(false), // Default to metadata only for efficiency
            mime_types: None,
        }
    }

    /// Create a new full sync request
    pub fn full(client_id: String, page_size: Option<i64>) -> Self {
        Self {
            last_sync_time: None,
            cursor: None,
            page_size,
            client_id,
            include_data: Some(false),
            mime_types: None,
        }
    }

    /// Validate sync request parameters
    pub fn validate(&self, max_batch_size: i64) -> Result<(), SyncError> {
        if let Some(page_size) = self.page_size {
            if page_size > max_batch_size {
                return Err(SyncError::BatchSizeTooLarge(page_size, max_batch_size));
            }
        }

        if self.client_id.is_empty() {
            return Err(SyncError::OperationFailed(
                "Client ID cannot be empty".to_string(),
            ));
        }

        Ok(())
    }

    /// Get effective page size with default and limits
    pub fn effective_page_size(&self, default_size: i64, max_size: i64) -> i64 {
        self.page_size.unwrap_or(default_size).min(max_size).max(1)
    }

    /// Check if this is a full sync request
    pub fn is_full_sync(&self) -> bool {
        self.last_sync_time.is_none() && self.cursor.is_none()
    }

    /// Check if this is a continuation of a previous sync
    pub fn is_continuation(&self) -> bool {
        self.cursor.is_some()
    }
}

impl SyncResponse {
    /// Create a new sync response
    pub fn new(
        items: Vec<MediaBlob>,
        has_more: bool,
        next_cursor: Option<String>,
        is_full_sync: bool,
    ) -> Self {
        let batch_size = items.len();
        Self {
            items,
            pagination: SyncPaginationMetadata {
                batch_size,
                has_more,
                next_cursor,
                progress: None,
                suggested_delay: if has_more { Some(1) } else { Some(60) }, // 1s if more, 60s if done
            },
            sync_timestamp: OffsetDateTime::now_utc(),
            is_full_sync,
            total_items: None,
        }
    }

    /// Set progress information
    pub fn with_progress(mut self, progress: f64, total_items: i64) -> Self {
        self.pagination.progress = Some(progress.clamp(0.0, 1.0));
        self.total_items = Some(total_items);
        self
    }

    /// Set suggested delay for next sync
    pub fn with_delay(mut self, delay_seconds: u32) -> Self {
        self.pagination.suggested_delay = Some(delay_seconds);
        self
    }

    /// Check if this sync response indicates completion
    pub fn is_complete(&self) -> bool {
        !self.pagination.has_more
    }
}

impl ClientSyncState {
    /// Create a new client sync state
    pub fn new(client_id: String) -> Self {
        Self {
            client_id,
            last_sync_time: OffsetDateTime::UNIX_EPOCH,
            total_items_synced: 0,
            status: SyncStatus::Never,
            last_cursor: None,
            updated_at: OffsetDateTime::now_utc(),
        }
    }

    /// Update sync state after successful sync
    pub fn update_after_sync(
        &mut self,
        sync_timestamp: OffsetDateTime,
        items_synced: i64,
        cursor: Option<String>,
    ) {
        self.last_sync_time = sync_timestamp;
        self.total_items_synced += items_synced;
        let has_cursor = cursor.is_some();
        self.last_cursor = cursor;
        self.status = if has_cursor {
            SyncStatus::InProgress
        } else {
            SyncStatus::Complete
        };
        self.updated_at = OffsetDateTime::now_utc();
    }

    /// Mark sync as failed
    pub fn mark_failed(&mut self) {
        self.status = SyncStatus::Failed;
        self.updated_at = OffsetDateTime::now_utc();
    }

    /// Check if sync is currently in progress
    pub fn is_in_progress(&self) -> bool {
        self.status == SyncStatus::InProgress
    }

    /// Get time since last sync
    pub fn time_since_last_sync(&self) -> time::Duration {
        OffsetDateTime::now_utc() - self.last_sync_time
    }
}

impl Default for SyncStatus {
    fn default() -> Self {
        SyncStatus::Never
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sync_request_creation() {
        let client_id = "test-client".to_string();
        let now = OffsetDateTime::now_utc();

        // Test incremental sync request
        let incremental = SyncRequest::incremental(client_id.clone(), now, Some(50));
        assert_eq!(incremental.client_id, client_id);
        assert_eq!(incremental.last_sync_time, Some(now));
        assert!(!incremental.is_full_sync());
        assert!(!incremental.is_continuation());

        // Test full sync request
        let full = SyncRequest::full(client_id.clone(), Some(100));
        assert_eq!(full.client_id, client_id);
        assert!(full.last_sync_time.is_none());
        assert!(full.is_full_sync());
        assert!(!full.is_continuation());
    }

    #[test]
    fn test_sync_request_validation() {
        let request = SyncRequest::full("test-client".to_string(), Some(50));
        assert!(request.validate(100).is_ok());

        let invalid_request = SyncRequest::full("test-client".to_string(), Some(200));
        assert!(invalid_request.validate(100).is_err());

        let empty_client_request = SyncRequest::full("".to_string(), Some(50));
        assert!(empty_client_request.validate(100).is_err());
    }

    #[test]
    fn test_sync_response_creation() {
        let items = vec![];
        let response = SyncResponse::new(items, true, Some("cursor123".to_string()), false);

        assert_eq!(response.pagination.batch_size, 0);
        assert!(response.pagination.has_more);
        assert_eq!(
            response.pagination.next_cursor,
            Some("cursor123".to_string())
        );
        assert!(!response.is_full_sync);
        assert!(!response.is_complete());
    }

    #[test]
    fn test_client_sync_state() {
        let mut state = ClientSyncState::new("test-client".to_string());
        assert_eq!(state.status, SyncStatus::Never);
        assert!(!state.is_in_progress());

        let now = OffsetDateTime::now_utc();
        state.update_after_sync(now, 10, Some("cursor".to_string()));
        assert_eq!(state.status, SyncStatus::InProgress);
        assert!(state.is_in_progress());
        assert_eq!(state.total_items_synced, 10);

        state.update_after_sync(now, 5, None);
        assert_eq!(state.status, SyncStatus::Complete);
        assert!(!state.is_in_progress());
        assert_eq!(state.total_items_synced, 15);
    }

    #[test]
    fn test_effective_page_size() {
        let request = SyncRequest::full("test-client".to_string(), Some(75));
        assert_eq!(request.effective_page_size(50, 100), 75);

        let request_no_size = SyncRequest::full("test-client".to_string(), None);
        assert_eq!(request_no_size.effective_page_size(50, 100), 50);

        let request_too_big = SyncRequest::full("test-client".to_string(), Some(150));
        assert_eq!(request_too_big.effective_page_size(50, 100), 100);
    }
}
