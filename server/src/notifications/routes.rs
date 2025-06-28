//! HTTP routes for notification management
//!
//! This module provides REST endpoints for managing notifications, connection monitoring,
//! testing notifications, and administrative operations.

use crate::auth::require_user;
use crate::notifications::NotificationInfrastructure;
use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use grimoire::notifications::{NotificationChannel, NotificationEvent, NotificationPriority};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;
use time::OffsetDateTime;
use tower_sessions::Session;
use tracing::{error, info};
use uuid::Uuid;

/// Notification management routes
pub fn build_notification_routes() -> Router<Arc<NotificationInfrastructure>> {
    Router::new()
        .route("/notifications/status", get(get_notification_status))
        .route("/notifications/stats", get(get_notification_stats))
        .route("/notifications/connections", get(get_active_connections))
        .route(
            "/notifications/connections/{connection_id}",
            get(get_connection_info),
        )
        .route("/notifications/test", post(send_test_notification))
        .route("/notifications/broadcast", post(broadcast_admin_message))
        .route("/notifications/health", get(health_check))
        .route("/notifications/channels", get(list_notification_channels))
        .route(
            "/notifications/channels/{channel}/test",
            post(test_channel_notification),
        )
}

/// Status response for notification system
#[derive(Debug, Serialize)]
pub struct NotificationStatus {
    pub is_running: bool,
    pub uptime_seconds: u64,
    pub postgres_listener_status: String,
    pub websocket_connections: u64,
    pub last_notification_at: Option<OffsetDateTime>,
}

/// Statistics response
#[derive(Debug, Serialize)]
pub struct NotificationStatsResponse {
    pub service_stats: ServiceStatsResponse,
    pub postgres_stats: Option<PostgresStatsResponse>,
    pub websocket_stats: WebSocketStatsResponse,
    pub infrastructure_status: String,
}

#[derive(Debug, Serialize)]
pub struct ServiceStatsResponse {
    pub total_published: u64,
    pub total_delivered: u64,
    pub total_failed: u64,
    pub total_subscriptions: u64,
    pub events_by_channel: HashMap<String, u64>,
    pub events_by_priority: HashMap<String, u64>,
    pub avg_processing_time_ms: f64,
    pub last_processed_at: Option<OffsetDateTime>,
}

#[derive(Debug, Serialize)]
pub struct PostgresStatsResponse {
    pub total_notifications_received: u64,
    pub notifications_by_channel: HashMap<String, u64>,
    pub total_processing_errors: u64,
    pub last_notification_at: Option<OffsetDateTime>,
    pub connection_status: String,
    pub uptime_seconds: u64,
}

#[derive(Debug, Serialize)]
pub struct WebSocketStatsResponse {
    pub total_messages_sent: u64,
    pub total_messages_failed: u64,
    pub active_connections: u64,
    pub messages_by_channel: HashMap<String, u64>,
    pub last_message_at: Option<OffsetDateTime>,
}

/// Connection information response
#[derive(Debug, Serialize)]
pub struct ConnectionInfoResponse {
    pub connection_id: String,
    pub user_id: Option<Uuid>,
    pub connected_at: OffsetDateTime,
    pub subscribed_channels: Vec<String>,
    pub last_activity: OffsetDateTime,
}

/// Test notification request
#[derive(Debug, Deserialize)]
pub struct TestNotificationRequest {
    pub channel: NotificationChannel,
    pub event_type: String,
    pub payload: Value,
    pub priority: Option<NotificationPriority>,
}

/// Admin broadcast message request
#[derive(Debug, Deserialize)]
pub struct AdminBroadcastRequest {
    pub message: String,
    pub message_type: Option<String>,
    pub target_users: Option<Vec<Uuid>>,
    pub priority: Option<NotificationPriority>,
}

/// Channel test request
#[derive(Debug, Deserialize)]
pub struct ChannelTestRequest {
    pub event_type: String,
    pub payload: Value,
}

/// Available notification channels response
#[derive(Debug, Serialize)]
pub struct NotificationChannelsResponse {
    pub channels: Vec<ChannelInfo>,
}

#[derive(Debug, Serialize)]
pub struct ChannelInfo {
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub min_priority: String,
}

/// Get notification system status
pub async fn get_notification_status(
    State(infrastructure): State<Arc<NotificationInfrastructure>>,
) -> Result<Json<NotificationStatus>, StatusCode> {
    let stats = infrastructure.get_stats().await;

    let status = NotificationStatus {
        is_running: stats.is_running,
        uptime_seconds: stats
            .postgres_stats
            .as_ref()
            .map(|ps| ps.uptime_seconds)
            .unwrap_or(0),
        postgres_listener_status: stats
            .postgres_stats
            .as_ref()
            .map(|ps| format!("{:?}", ps.connection_status))
            .unwrap_or_else(|| "Not Running".to_string()),
        websocket_connections: stats.service_stats.total_subscriptions,
        last_notification_at: stats.service_stats.last_processed_at,
    };

    Ok(Json(status))
}

/// Get detailed notification statistics
pub async fn get_notification_stats(
    session: Session,
    State(infrastructure): State<Arc<NotificationInfrastructure>>,
) -> Result<Json<NotificationStatsResponse>, StatusCode> {
    // Require authentication for detailed stats
    let _user = require_user(&session)
        .await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    let stats = infrastructure.get_stats().await;

    let service_stats = ServiceStatsResponse {
        total_published: stats.service_stats.total_published,
        total_delivered: stats.service_stats.total_delivered,
        total_failed: stats.service_stats.total_failed,
        total_subscriptions: stats.service_stats.total_subscriptions,
        events_by_channel: stats
            .service_stats
            .events_by_channel
            .iter()
            .map(|(k, v)| (format!("{:?}", k), *v))
            .collect(),
        events_by_priority: stats
            .service_stats
            .events_by_priority
            .iter()
            .map(|(k, v)| (format!("{:?}", k), *v))
            .collect(),
        avg_processing_time_ms: stats.service_stats.avg_processing_time_ms,
        last_processed_at: stats.service_stats.last_processed_at,
    };

    let postgres_stats = stats.postgres_stats.map(|ps| PostgresStatsResponse {
        total_notifications_received: ps.total_notifications_received,
        notifications_by_channel: ps.notifications_by_channel,
        total_processing_errors: ps.total_processing_errors,
        last_notification_at: ps.last_notification_at,
        connection_status: format!("{:?}", ps.connection_status),
        uptime_seconds: ps.uptime_seconds,
    });

    let websocket_stats = WebSocketStatsResponse {
        total_messages_sent: 0, // Would come from WebSocket publisher stats
        total_messages_failed: 0,
        active_connections: stats.service_stats.total_subscriptions,
        messages_by_channel: HashMap::new(),
        last_message_at: None,
    };

    let response = NotificationStatsResponse {
        service_stats,
        postgres_stats,
        websocket_stats,
        infrastructure_status: if stats.is_running {
            "Running".to_string()
        } else {
            "Stopped".to_string()
        },
    };

    Ok(Json(response))
}

/// Get active WebSocket connections
pub async fn get_active_connections(
    session: Session,
    State(_infrastructure): State<Arc<NotificationInfrastructure>>,
) -> Result<Json<Vec<ConnectionInfoResponse>>, StatusCode> {
    // Require authentication for connection info
    let _user = require_user(&session)
        .await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // For now, return empty list as we'd need access to WebSocket publisher
    // In a real implementation, we'd get this from the WebSocket publisher
    let connections = Vec::new();

    Ok(Json(connections))
}

/// Get information about a specific connection
pub async fn get_connection_info(
    session: Session,
    Path(connection_id): Path<String>,
    State(_infrastructure): State<Arc<NotificationInfrastructure>>,
) -> Result<Json<ConnectionInfoResponse>, StatusCode> {
    // Require authentication
    let _user = require_user(&session)
        .await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    // For now, return not found as we'd need access to WebSocket publisher
    // In a real implementation, we'd get this from the WebSocket publisher
    error!("Connection not found: {}", connection_id);
    Err(StatusCode::NOT_FOUND)
}

/// Send a test notification
pub async fn send_test_notification(
    session: Session,
    State(infrastructure): State<Arc<NotificationInfrastructure>>,
    Json(request): Json<TestNotificationRequest>,
) -> Result<Json<Value>, StatusCode> {
    // Require authentication for test notifications
    let _user = require_user(&session)
        .await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    let event = NotificationEvent::new(request.channel, request.event_type, request.payload);

    match infrastructure.service().publish_event(event).await {
        Ok(()) => {
            info!("Test notification sent successfully");
            Ok(Json(serde_json::json!({
                "success": true,
                "message": "Test notification sent successfully"
            })))
        }
        Err(e) => {
            error!("Failed to send test notification: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// Broadcast an admin message to all connected clients
pub async fn broadcast_admin_message(
    session: Session,
    State(infrastructure): State<Arc<NotificationInfrastructure>>,
    Json(request): Json<AdminBroadcastRequest>,
) -> Result<Json<Value>, StatusCode> {
    // Require authentication for admin broadcasts
    let _user = require_user(&session)
        .await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    let payload = serde_json::json!({
        "message": request.message,
        "message_type": request.message_type.unwrap_or_else(|| "admin".to_string()),
        "timestamp": OffsetDateTime::now_utc(),
        "target_users": request.target_users
    });

    let event = NotificationEvent::new(
        NotificationChannel::System, // Assuming we have a System channel
        "admin.broadcast".to_string(),
        payload,
    );

    match infrastructure.service().publish_event(event).await {
        Ok(()) => {
            info!("Admin broadcast sent successfully");
            Ok(Json(serde_json::json!({
                "success": true,
                "message": "Admin broadcast sent successfully"
            })))
        }
        Err(e) => {
            error!("Failed to send admin broadcast: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// Health check for notification system
pub async fn health_check(
    State(infrastructure): State<Arc<NotificationInfrastructure>>,
) -> Result<Json<Value>, StatusCode> {
    let stats = infrastructure.get_stats().await;

    let health_status = if stats.is_running {
        "healthy"
    } else {
        "unhealthy"
    };

    Ok(Json(serde_json::json!({
        "status": health_status,
        "is_running": stats.is_running,
        "checks": {
            "postgres_listener": stats.postgres_stats.is_some(),
            "notification_service": true
        }
    })))
}

/// List available notification channels
pub async fn list_notification_channels(
    State(_infrastructure): State<Arc<NotificationInfrastructure>>,
) -> Result<Json<NotificationChannelsResponse>, StatusCode> {
    let channels = vec![
        ChannelInfo {
            name: "MediaBlobs".to_string(),
            description: "Media blob creation, updates, and deletions".to_string(),
            enabled: true,
            min_priority: "Low".to_string(),
        },
        ChannelInfo {
            name: "ThumbnailJobs".to_string(),
            description: "Thumbnail generation job status updates".to_string(),
            enabled: true,
            min_priority: "Low".to_string(),
        },
        ChannelInfo {
            name: "System".to_string(),
            description: "System-wide notifications and admin messages".to_string(),
            enabled: true,
            min_priority: "Medium".to_string(),
        },
    ];

    Ok(Json(NotificationChannelsResponse { channels }))
}

/// Test a specific notification channel
pub async fn test_channel_notification(
    session: Session,
    Path(channel): Path<String>,
    State(infrastructure): State<Arc<NotificationInfrastructure>>,
    Json(request): Json<ChannelTestRequest>,
) -> Result<Json<Value>, StatusCode> {
    // Require authentication for channel tests
    let _user = require_user(&session)
        .await
        .map_err(|_| StatusCode::UNAUTHORIZED)?;

    let notification_channel = match channel.as_str() {
        "MediaBlobs" => NotificationChannel::MediaBlobs,
        "ThumbnailJobs" => NotificationChannel::ThumbnailJobs,
        "System" => NotificationChannel::System,
        _ => {
            return Ok(Json(serde_json::json!({
                "success": false,
                "error": format!("Unknown channel: {}", channel)
            })));
        }
    };

    let event = NotificationEvent::new(notification_channel, request.event_type, request.payload);

    match infrastructure.service().publish_event(event).await {
        Ok(()) => {
            info!("Channel test notification sent successfully: {}", channel);
            Ok(Json(serde_json::json!({
                "success": true,
                "message": format!("Test notification sent to {} channel", channel)
            })))
        }
        Err(e) => {
            error!("Failed to send channel test notification: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_notification_status_serialization() {
        let status = NotificationStatus {
            is_running: true,
            uptime_seconds: 3600,
            postgres_listener_status: "Connected".to_string(),
            websocket_connections: 5,
            last_notification_at: Some(OffsetDateTime::now_utc()),
        };

        let serialized = serde_json::to_string(&status).unwrap();
        assert!(serialized.contains("is_running"));
        assert!(serialized.contains("uptime_seconds"));
    }

    #[test]
    fn test_test_notification_request_deserialization() {
        let json = r#"{
            "channel": "MediaBlobs",
            "event_type": "test.event",
            "payload": {"test": "data"},
            "priority": "High"
        }"#;

        let request: TestNotificationRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.event_type, "test.event");
        assert!(matches!(request.channel, NotificationChannel::MediaBlobs));
    }
}
