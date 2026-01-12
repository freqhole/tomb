//! Integration tests for sync endpoints
//!
//! This module provides tests to verify that sync endpoints are properly
//! registered and handle basic request/response patterns correctly.

#[cfg(test)]
mod tests {
    use super::super::handlers::*;
    use axum::{
        routing::{get, post},
        Router,
    };

    /// Create a test router with sync endpoints (without auth middleware for testing)
    fn create_test_sync_router() -> Router {
        Router::new()
            .route("/api/sync/media", get(incremental_sync))
            .route("/api/sync/media/full", get(full_sync))
            .route("/api/sync/media/acknowledge", post(acknowledge_sync))
            .route("/api/sync/status", get(sync_status))
            .route("/api/sync/recommendations", get(sync_recommendations))
            .route("/api/sync/check", get(check_sync_needed))
    }

    #[test]
    fn test_sync_router_creation() {
        // Test that the sync router can be created without panicking
        let _router = create_test_sync_router();
    }

    #[test]
    fn test_sync_models_serialization() {
        // Test that sync models can be serialized/deserialized properly
        let req = IncrementalSyncQuery {
            last_sync_time: Some("2023-10-01T12:00:00Z".to_string()),
            cursor: Some("test_cursor".to_string()),
            page_size: Some(50),
            include_data: Some(false),
            mime_types: Some("image/*,video/*".to_string()),
        };

        // This tests the Serialize/Deserialize implementation
        let json_str = serde_json::to_string(&req).unwrap();
        let _deserialized: IncrementalSyncQuery = serde_json::from_str(&json_str).unwrap();

        let response = SyncRecommendationsResponse {
            should_sync: true,
            recommended_batch_size: 25,
            recommended_interval_seconds: 60,
            estimated_batches: 4,
            estimated_duration_seconds: 120,
            priority: "normal".to_string(),
            items_to_sync: 100,
        };

        // This tests the Serialize implementation
        let _json_str = serde_json::to_string(&response).unwrap();
    }

    #[test]
    fn test_query_parameters_default_values() {
        let query = IncrementalSyncQuery {
            last_sync_time: None,
            cursor: None,
            page_size: None,
            include_data: None,
            mime_types: None,
        };

        // Test that default/None values work correctly
        assert!(query.last_sync_time.is_none());
        assert!(query.cursor.is_none());
        assert!(query.page_size.is_none());
        assert!(query.include_data.is_none());
        assert!(query.mime_types.is_none());
    }

    #[test]
    fn test_sync_ack_request_creation() {
        let ack_request = SyncAckRequest {
            sync_timestamp: "2023-10-01T12:30:00Z".to_string(),
            items_synced: 25,
            failed_items: Some(vec!["uuid1".to_string(), "uuid2".to_string()]),
        };

        assert_eq!(ack_request.items_synced, 25);
        assert_eq!(ack_request.failed_items.as_ref().unwrap().len(), 2);
    }

    #[test]
    fn test_sync_recommendations_response_creation() {
        let response = SyncRecommendationsResponse {
            should_sync: true,
            recommended_batch_size: 50,
            recommended_interval_seconds: 120,
            estimated_batches: 5,
            estimated_duration_seconds: 600,
            priority: "high".to_string(),
            items_to_sync: 250,
        };

        assert!(response.should_sync);
        assert_eq!(response.recommended_batch_size, 50);
        assert_eq!(response.priority, "high");
    }
}
