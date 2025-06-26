//! Media blob domain models with cursor-based pagination support
//!
//! This module defines the core data structures for media blobs and pagination
//! that are used throughout the application. It provides both traditional
//! offset-based pagination and modern cursor-based pagination for efficient
//! data synchronization.

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use uuid::Uuid;

/// Parameters for querying media blobs with both cursor and offset pagination support
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MediaBlobQuery {
    // Traditional pagination (legacy support)
    pub limit: Option<i64>,
    pub offset: Option<i64>,

    // Cursor-based pagination (new)
    pub cursor: Option<String>,
    pub page_size: Option<i64>,
    pub direction: Option<PaginationDirection>,

    // Filtering options
    pub sha256: Option<String>,
    pub source_client_id: Option<String>,
    pub mime_pattern: Option<String>,
    pub created_after: Option<OffsetDateTime>,
    pub created_before: Option<OffsetDateTime>,
}

/// Direction for cursor-based pagination
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum PaginationDirection {
    /// Forward pagination (newer items)
    Forward,
    /// Backward pagination (older items)
    Backward,
}

impl Default for PaginationDirection {
    fn default() -> Self {
        PaginationDirection::Forward
    }
}

/// Cursor information for a media blob
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct MediaBlobCursor {
    pub created_at: OffsetDateTime,
    pub id: Uuid,
}

impl MediaBlobCursor {
    /// Create a new cursor from timestamp and ID
    pub fn new(created_at: OffsetDateTime, id: Uuid) -> Self {
        Self { created_at, id }
    }

    /// Encode cursor as a base64 string for API use
    pub fn encode(&self) -> Result<String, CursorError> {
        let json = serde_json::to_string(self)?;
        Ok(general_purpose::STANDARD.encode(json))
    }

    /// Decode cursor from a base64 string
    pub fn decode(cursor_str: &str) -> Result<Self, CursorError> {
        let json = general_purpose::STANDARD.decode(cursor_str)?;
        let cursor: MediaBlobCursor = serde_json::from_slice(&json)?;
        Ok(cursor)
    }
}

/// Paginated result containing items and pagination metadata
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedResult<T> {
    /// The items in this page
    pub items: Vec<T>,
    /// Pagination metadata
    pub pagination: PaginationMetadata,
}

/// Metadata about pagination state
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginationMetadata {
    /// Number of items in this page
    pub page_size: usize,
    /// Whether there are more items available
    pub has_next_page: bool,
    /// Whether there are previous items available
    pub has_previous_page: bool,
    /// Cursor for the next page (if has_next_page is true)
    pub next_cursor: Option<String>,
    /// Cursor for the previous page (if has_previous_page is true)
    pub previous_cursor: Option<String>,
    /// Total count (only included in offset-based pagination)
    pub total_count: Option<i64>,
}

/// Core media blob model for domain logic
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaBlob {
    pub id: Uuid,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Vec<u8>>,
    pub sha256: String,
    pub size: Option<i64>,
    pub mime: Option<String>,
    pub source_client_id: Option<String>,
    pub local_path: Option<String>,
    #[serde(default)]
    pub metadata: serde_json::Value,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
}

impl MediaBlob {
    /// Create a cursor for this media blob
    pub fn cursor(&self) -> MediaBlobCursor {
        MediaBlobCursor::new(self.created_at, self.id)
    }

    /// Get the blob without binary data for efficient transmission
    pub fn without_data(&self) -> Self {
        let mut blob = self.clone();
        blob.data = None;
        blob
    }

    /// Check if this blob has binary data
    pub fn has_data(&self) -> bool {
        self.data.is_some() && !self.data.as_ref().unwrap().is_empty()
    }

    /// Check if this blob is stored on filesystem
    pub fn is_large_file(&self) -> bool {
        self.local_path.is_some() && self.data.is_none()
    }

    /// Check if this blob is stored in database
    pub fn is_small_file(&self) -> bool {
        self.data.is_some() && self.local_path.is_none()
    }
}

/// Parameters for creating a new media blob
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreateMediaBlob {
    pub data: Option<Vec<u8>>,
    pub sha256: String,
    pub size: Option<i64>,
    pub mime: Option<String>,
    pub source_client_id: Option<String>,
    pub local_path: Option<String>,
    #[serde(default)]
    pub metadata: serde_json::Value,
}

impl CreateMediaBlob {
    /// Convert to MediaBlob with generated ID and timestamps
    pub fn into_media_blob(self) -> MediaBlob {
        let now = OffsetDateTime::now_utc();
        MediaBlob {
            id: Uuid::new_v4(),
            data: self.data,
            sha256: self.sha256,
            size: self.size,
            mime: self.mime,
            source_client_id: self.source_client_id,
            local_path: self.local_path,
            metadata: self.metadata,
            created_at: now,
            updated_at: now,
        }
    }
}

/// Errors related to cursor operations
#[derive(Debug, thiserror::Error)]
pub enum CursorError {
    #[error("Invalid cursor format: {0}")]
    InvalidFormat(String),
    #[error("Base64 decode error: {0}")]
    Base64Error(#[from] base64::DecodeError),
    #[error("JSON serialization error: {0}")]
    JsonError(#[from] serde_json::Error),
}

impl MediaBlobQuery {
    /// Create a new query with cursor-based pagination
    pub fn with_cursor(cursor: Option<String>, page_size: Option<i64>) -> Self {
        Self {
            cursor,
            page_size,
            direction: Some(PaginationDirection::Forward),
            ..Default::default()
        }
    }

    /// Create a new query with offset-based pagination (legacy)
    pub fn with_offset(limit: Option<i64>, offset: Option<i64>) -> Self {
        Self {
            limit,
            offset,
            ..Default::default()
        }
    }

    /// Check if this query uses cursor-based pagination
    pub fn is_cursor_based(&self) -> bool {
        self.cursor.is_some() || self.page_size.is_some()
    }

    /// Check if this query uses offset-based pagination
    pub fn is_offset_based(&self) -> bool {
        self.limit.is_some() || self.offset.is_some()
    }

    /// Get the effective page size (with default and maximum limits)
    pub fn effective_page_size(&self) -> i64 {
        if self.is_cursor_based() {
            self.page_size.unwrap_or(50).min(1000)
        } else {
            self.limit.unwrap_or(50).min(1000)
        }
    }

    /// Get the decoded cursor if present
    pub fn decoded_cursor(&self) -> Result<Option<MediaBlobCursor>, CursorError> {
        match &self.cursor {
            Some(cursor_str) => Ok(Some(MediaBlobCursor::decode(cursor_str)?)),
            None => Ok(None),
        }
    }

    /// Get pagination direction
    pub fn pagination_direction(&self) -> PaginationDirection {
        self.direction.clone().unwrap_or_default()
    }
}

impl<T> PaginatedResult<T> {
    /// Create a new paginated result
    pub fn new(
        items: Vec<T>,
        has_next_page: bool,
        has_previous_page: bool,
        next_cursor: Option<String>,
        previous_cursor: Option<String>,
        total_count: Option<i64>,
    ) -> Self {
        let page_size = items.len();
        Self {
            items,
            pagination: PaginationMetadata {
                page_size,
                has_next_page,
                has_previous_page,
                next_cursor,
                previous_cursor,
                total_count,
            },
        }
    }

    /// Create a paginated result for cursor-based pagination
    pub fn from_cursor_page(
        items: Vec<T>,
        requested_size: usize,
        has_previous_page: bool,
        next_cursor: Option<String>,
        previous_cursor: Option<String>,
    ) -> Self {
        let has_next_page = items.len() > requested_size;
        let actual_items = if has_next_page {
            items.into_iter().take(requested_size).collect()
        } else {
            items
        };

        Self::new(
            actual_items,
            has_next_page,
            has_previous_page,
            next_cursor,
            previous_cursor,
            None, // No total count for cursor-based pagination
        )
    }

    /// Create a paginated result for offset-based pagination
    pub fn from_offset_page(items: Vec<T>, total_count: i64, offset: i64, limit: i64) -> Self {
        let has_next_page = (offset + limit) < total_count;
        let has_previous_page = offset > 0;

        Self::new(
            items,
            has_next_page,
            has_previous_page,
            None, // No cursors for offset-based pagination
            None,
            Some(total_count),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn test_cursor_encoding_decoding() {
        let cursor = MediaBlobCursor {
            created_at: OffsetDateTime::now_utc(),
            id: Uuid::new_v4(),
        };

        let encoded = cursor.encode().expect("Failed to encode cursor");
        let decoded = MediaBlobCursor::decode(&encoded).expect("Failed to decode cursor");

        assert_eq!(cursor, decoded);
    }

    #[test]
    fn test_media_blob_query_cursor_based() {
        let query = MediaBlobQuery::with_cursor(Some("test_cursor".to_string()), Some(25));

        assert!(query.is_cursor_based());
        assert!(!query.is_offset_based());
        assert_eq!(query.effective_page_size(), 25);
    }

    #[test]
    fn test_media_blob_query_offset_based() {
        let query = MediaBlobQuery::with_offset(Some(10), Some(5));

        assert!(!query.is_cursor_based());
        assert!(query.is_offset_based());
        assert_eq!(query.effective_page_size(), 10);
    }

    #[test]
    fn test_paginated_result_cursor_page() {
        let items = vec![1, 2, 3, 4, 5];
        let result = PaginatedResult::from_cursor_page(
            items.clone(),
            3,
            false,
            Some("next_cursor".to_string()),
            None,
        );

        assert_eq!(result.items.len(), 3);
        assert!(result.pagination.has_next_page);
        assert!(!result.pagination.has_previous_page);
        assert_eq!(
            result.pagination.next_cursor,
            Some("next_cursor".to_string())
        );
    }

    #[test]
    fn test_paginated_result_offset_page() {
        let items = vec![1, 2, 3];
        let result = PaginatedResult::from_offset_page(items, 10, 3, 3);

        assert_eq!(result.items.len(), 3);
        assert!(result.pagination.has_next_page);
        assert!(result.pagination.has_previous_page);
        assert_eq!(result.pagination.total_count, Some(10));
    }

    #[test]
    fn test_create_media_blob_conversion() {
        let create_blob = CreateMediaBlob {
            data: Some(vec![1, 2, 3]),
            sha256: "test_hash".to_string(),
            size: Some(3),
            mime: Some("text/plain".to_string()),
            source_client_id: Some("test_client".to_string()),
            local_path: None,
            metadata: serde_json::json!({"test": true}),
        };

        let media_blob = create_blob.into_media_blob();
        assert_eq!(media_blob.sha256, "test_hash");
        assert_eq!(media_blob.size, Some(3));
        assert!(media_blob.has_data());
    }
}
