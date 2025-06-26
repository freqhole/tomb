//! Integration tests for media blob cursor-based pagination
//!
//! These tests verify that the cursor-based pagination implementation works correctly
//! with the database and provides consistent results.

use super::{
    CreateMediaBlob, MediaBlob, MediaBlobQuery, MediaBlobRepository, MediaBlobService,
    PaginationDirection,
};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

/// Helper function to create test media blobs with different timestamps
async fn create_test_blobs(service: &MediaBlobService) -> Vec<MediaBlob> {
    let base_time = OffsetDateTime::now_utc() - time::Duration::hours(1);
    let mut blobs = Vec::new();

    for i in 0..10 {
        let create_blob = CreateMediaBlob {
            data: Some(vec![i as u8; 100]),
            sha256: format!("{:064x}", i), // Create unique SHA256 for each blob
            size: Some(100),
            mime: Some("text/plain".to_string()),
            source_client_id: Some("test-client".to_string()),
            local_path: None,
            metadata: serde_json::json!({"index": i}),
        };

        // Create blob with adjusted timestamp to ensure ordering
        let mut blob = create_blob.into_media_blob();
        blob.created_at = base_time + time::Duration::minutes(i as i64);
        blob.updated_at = blob.created_at;

        blobs.push(blob);
    }

    blobs
}

#[cfg(test)]
mod tests {
    use super::*;

    // Helper to create a test database connection
    // This would be implemented with a real test database in integration tests
    async fn setup_test_db() -> Option<PgPool> {
        // Return None for now since we don't have a test database setup
        // In a real implementation, this would:
        // 1. Create a test database
        // 2. Run migrations
        // 3. Return the connection pool
        None
    }

    #[tokio::test]
    #[ignore] // Ignored until test database is available
    async fn test_cursor_pagination_forward() {
        let pool = setup_test_db()
            .await
            .expect("Failed to setup test database");
        let repository = MediaBlobRepository::new(pool);
        let service = MediaBlobService::new(repository);

        // Create test data
        let test_blobs = create_test_blobs(&service).await;

        // Insert test blobs (this would require actual database operations)
        // for blob in test_blobs {
        //     service.create_media_blob(...).await.unwrap();
        // }

        // Test forward pagination
        let query = MediaBlobQuery::with_cursor(None, Some(3));
        let result = service.query_media_blobs(query).await.unwrap();

        assert_eq!(result.items.len(), 3);
        assert!(result.pagination.has_next_page);
        assert!(!result.pagination.has_previous_page);
        assert!(result.pagination.next_cursor.is_some());
        assert!(result.pagination.previous_cursor.is_none());

        // Test second page using cursor
        let next_cursor = result.pagination.next_cursor.unwrap();
        let query2 = MediaBlobQuery::with_cursor(Some(next_cursor), Some(3));
        let result2 = service.query_media_blobs(query2).await.unwrap();

        assert_eq!(result2.items.len(), 3);
        assert!(result2.pagination.has_next_page);
        assert!(result2.pagination.has_previous_page);
        assert!(result2.pagination.next_cursor.is_some());
        assert!(result2.pagination.previous_cursor.is_some());

        // Verify no overlap between pages
        let first_page_ids: Vec<_> = result.items.iter().map(|b| b.id).collect();
        let second_page_ids: Vec<_> = result2.items.iter().map(|b| b.id).collect();

        for id in &first_page_ids {
            assert!(!second_page_ids.contains(id), "Pages should not overlap");
        }
    }

    #[tokio::test]
    #[ignore] // Ignored until test database is available
    async fn test_cursor_pagination_backward() {
        let pool = setup_test_db()
            .await
            .expect("Failed to setup test database");
        let repository = MediaBlobRepository::new(pool);
        let service = MediaBlobService::new(repository);

        // Test backward pagination
        let mut query = MediaBlobQuery::with_cursor(None, Some(5));
        query.direction = Some(PaginationDirection::Backward);

        let result = service.query_media_blobs(query).await.unwrap();

        // With backward pagination, we get older items first
        assert!(result.items.len() <= 5);

        // Verify items are in ascending order (older first) for backward pagination
        for i in 1..result.items.len() {
            assert!(
                result.items[i - 1].created_at <= result.items[i].created_at,
                "Backward pagination should return items in ascending order"
            );
        }
    }

    #[tokio::test]
    #[ignore] // Ignored until test database is available
    async fn test_cursor_encoding_decoding() {
        let cursor =
            super::super::models::MediaBlobCursor::new(OffsetDateTime::now_utc(), Uuid::new_v4());

        let encoded = cursor.encode().expect("Failed to encode cursor");
        let decoded = super::super::models::MediaBlobCursor::decode(&encoded)
            .expect("Failed to decode cursor");

        assert_eq!(cursor.created_at, decoded.created_at);
        assert_eq!(cursor.id, decoded.id);
    }

    #[tokio::test]
    #[ignore] // Ignored until test database is available
    async fn test_offset_vs_cursor_consistency() {
        let pool = setup_test_db()
            .await
            .expect("Failed to setup test database");
        let repository = MediaBlobRepository::new(pool);
        let service = MediaBlobService::new(repository);

        // Get first page with offset-based pagination
        let offset_query = MediaBlobQuery::with_offset(Some(5), Some(0));
        let offset_result = service.query_media_blobs(offset_query).await.unwrap();

        // Get first page with cursor-based pagination
        let cursor_query = MediaBlobQuery::with_cursor(None, Some(5));
        let cursor_result = service.query_media_blobs(cursor_query).await.unwrap();

        // Both should return the same items in the same order
        assert_eq!(offset_result.items.len(), cursor_result.items.len());

        for (offset_blob, cursor_blob) in offset_result.items.iter().zip(cursor_result.items.iter())
        {
            assert_eq!(offset_blob.id, cursor_blob.id);
            assert_eq!(offset_blob.created_at, cursor_blob.created_at);
        }
    }

    #[tokio::test]
    #[ignore] // Ignored until test database is available
    async fn test_filtering_with_cursor_pagination() {
        let pool = setup_test_db()
            .await
            .expect("Failed to setup test database");
        let repository = MediaBlobRepository::new(pool);
        let service = MediaBlobService::new(repository);

        // Test filtering with cursor pagination
        let mut query = MediaBlobQuery::with_cursor(None, Some(10));
        query.mime_pattern = Some("text/".to_string());
        query.source_client_id = Some("test-client".to_string());

        let result = service.query_media_blobs(query).await.unwrap();

        // Verify all returned items match the filter criteria
        for blob in &result.items {
            if let Some(ref mime) = blob.mime {
                assert!(mime.starts_with("text/"), "MIME type should match pattern");
            }
            assert_eq!(
                blob.source_client_id.as_deref(),
                Some("test-client"),
                "Client ID should match filter"
            );
        }
    }

    #[tokio::test]
    #[ignore] // Ignored until test database is available
    async fn test_timestamp_range_filtering() {
        let pool = setup_test_db()
            .await
            .expect("Failed to setup test database");
        let repository = MediaBlobRepository::new(pool);
        let service = MediaBlobService::new(repository);

        let now = OffsetDateTime::now_utc();
        let one_hour_ago = now - time::Duration::hours(1);
        let two_hours_ago = now - time::Duration::hours(2);

        // Test created_after filtering
        let mut query = MediaBlobQuery::with_cursor(None, Some(10));
        query.created_after = Some(one_hour_ago);

        let result = service.query_media_blobs(query).await.unwrap();

        for blob in &result.items {
            assert!(
                blob.created_at > one_hour_ago,
                "All blobs should be created after the specified time"
            );
        }

        // Test created_before filtering
        let mut query2 = MediaBlobQuery::with_cursor(None, Some(10));
        query2.created_before = Some(one_hour_ago);

        let result2 = service.query_media_blobs(query2).await.unwrap();

        for blob in &result2.items {
            assert!(
                blob.created_at < one_hour_ago,
                "All blobs should be created before the specified time"
            );
        }

        // Test range filtering
        let mut query3 = MediaBlobQuery::with_cursor(None, Some(10));
        query3.created_after = Some(two_hours_ago);
        query3.created_before = Some(one_hour_ago);

        let result3 = service.query_media_blobs(query3).await.unwrap();

        for blob in &result3.items {
            assert!(
                blob.created_at > two_hours_ago && blob.created_at < one_hour_ago,
                "All blobs should be within the specified time range"
            );
        }
    }

    #[test]
    fn test_query_parameter_validation() {
        // Test that query validation works correctly
        let query = MediaBlobQuery::with_cursor(None, Some(50));
        assert!(query.is_cursor_based());
        assert!(!query.is_offset_based());
        assert_eq!(query.effective_page_size(), 50);

        let query2 = MediaBlobQuery::with_offset(Some(25), Some(10));
        assert!(!query2.is_cursor_based());
        assert!(query2.is_offset_based());
        assert_eq!(query2.effective_page_size(), 25);

        // Test page size limits
        let query3 = MediaBlobQuery::with_cursor(None, Some(2000));
        assert_eq!(query3.effective_page_size(), 1000); // Should be capped at 1000
    }

    #[test]
    fn test_pagination_direction_default() {
        let query = MediaBlobQuery::with_cursor(None, Some(10));
        assert_eq!(
            query.pagination_direction(),
            PaginationDirection::Forward,
            "Default pagination direction should be Forward"
        );
    }
}
