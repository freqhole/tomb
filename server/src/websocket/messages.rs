//! WebSocket message types and serialization
//!
//! Defines the message format for WebSocket communication between
//! client and server, with serde for JSON serialization.

use crate::media::{CreateMediaBlob, MediaBlob};
use grimoire::notifications::{NotificationChannel, NotificationEvent};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::OffsetDateTime;
use uuid::Uuid;

/// Response type that can be either JSON or binary
#[derive(Clone)]
pub enum WebSocketResponseType {
    /// Standard JSON response
    Json(WebSocketResponse),
    /// Binary response with optional metadata
    Binary { data: Vec<u8>, blob_id: String },
    /// Multiple responses (for JSON + Binary pairs)
    Multiple(Vec<WebSocketResponseType>),
}

/// Messages sent from client to server
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum WebSocketMessage {
    /// Client sends a ping to check connection
    Ping,
    /// Client requests list of media blobs
    GetMediaBlobs {
        limit: Option<u32>,
        offset: Option<u32>,
    },
    /// Client uploads a new media blob
    UploadMediaBlob { blob: CreateMediaBlob },
    /// Client requests specific media blob by ID
    GetMediaBlob { id: String },
    /// Client requests media blob data by ID
    GetMediaBlobData { id: String },
    /// Client subscribes to notification channel
    SubscribeToNotifications { channel: NotificationChannel },
    /// Client unsubscribes from notification channel
    UnsubscribeFromNotifications { channel: NotificationChannel },
    /// Client requests notification status
    GetNotificationStatus,
    /// Client requests thumbnails for a media blob
    GetThumbnails { media_blob_id: String },
}

/// Messages sent from server to client (JSON only)
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum WebSocketResponse {
    /// Server greeting on connection
    Welcome {
        message: String,
        user_id: Option<Uuid>,
        connection_id: String,
    },
    /// Server responds to ping
    Pong,
    /// Server sends list of media blobs
    MediaBlobs {
        blobs: Vec<MediaBlob>,
        total_count: u32,
    },
    /// Server sends single media blob
    MediaBlob { blob: MediaBlob },
    /// Server sends media blob data header (metadata before binary frame)
    MediaBlobDataHeader {
        id: String,
        size: usize,
        mime: Option<String>,
    },
    /// Server sends media blob data (binary content) - DEPRECATED
    /// Use WebSocketResponseType::Binary instead for actual binary data
    MediaBlobData {
        id: String,
        data: Vec<u8>,
        mime: Option<String>,
    },
    /// Server sends error message
    Error {
        message: String,
        code: Option<String>,
    },
    /// Server sends connection status update
    ConnectionStatus { connected: bool, user_count: u32 },
    /// Server sends real-time notification
    Notification {
        id: Uuid,
        channel: NotificationChannel,
        event_type: String,
        payload: Value,
        priority: String,
        #[serde(with = "time::serde::rfc3339")]
        timestamp: OffsetDateTime,
    },
    /// Server confirms subscription to notifications
    NotificationSubscribed { channel: NotificationChannel },
    /// Server confirms unsubscription from notifications
    NotificationUnsubscribed { channel: NotificationChannel },
    /// Server sends notification status
    NotificationStatus {
        subscribed_channels: Vec<NotificationChannel>,
        connection_id: String,
        is_authenticated: bool,
    },
    /// Server sends thumbnails for a media blob
    Thumbnails {
        media_blob_id: String,
        thumbnails: Vec<MediaBlob>,
    },
}

impl WebSocketMessage {
    /// Parse a WebSocket message from JSON text
    pub fn from_json(text: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(text)
    }

    /// Serialize message to JSON text
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }
}

impl std::fmt::Debug for WebSocketMessage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WebSocketMessage::Ping => f.debug_struct("Ping").finish(),
            WebSocketMessage::GetMediaBlobs { limit, offset } => f
                .debug_struct("GetMediaBlobs")
                .field("limit", limit)
                .field("offset", offset)
                .finish(),
            WebSocketMessage::UploadMediaBlob { blob } => f
                .debug_struct("UploadMediaBlob")
                .field("blob_size", &blob.size)
                .field("blob_mime", &blob.mime)
                .field("blob_sha256_prefix", &format!("{}...", &blob.sha256[..8]))
                .finish(),
            WebSocketMessage::GetMediaBlob { id } => {
                f.debug_struct("GetMediaBlob").field("id", id).finish()
            }
            WebSocketMessage::GetMediaBlobData { id } => {
                f.debug_struct("GetMediaBlobData").field("id", id).finish()
            }
            WebSocketMessage::SubscribeToNotifications { channel } => f
                .debug_struct("SubscribeToNotifications")
                .field("channel", channel)
                .finish(),
            WebSocketMessage::UnsubscribeFromNotifications { channel } => f
                .debug_struct("UnsubscribeFromNotifications")
                .field("channel", channel)
                .finish(),
            WebSocketMessage::GetNotificationStatus => {
                f.debug_struct("GetNotificationStatus").finish()
            }
            WebSocketMessage::GetThumbnails { media_blob_id } => f
                .debug_struct("GetThumbnails")
                .field("media_blob_id", media_blob_id)
                .finish(),
        }
    }
}

impl WebSocketResponseType {
    /// Create a JSON response
    pub fn json(response: WebSocketResponse) -> Self {
        Self::Json(response)
    }

    /// Create a binary response
    pub fn binary(data: Vec<u8>, blob_id: String) -> Self {
        Self::Binary { data, blob_id }
    }

    /// Create a JSON + Binary pair for blob data
    pub fn json_binary_pair(id: String, data: Vec<u8>, mime: Option<String>) -> Self {
        let header = WebSocketResponse::MediaBlobDataHeader {
            id: id.clone(),
            size: data.len(),
            mime,
        };

        Self::Multiple(vec![Self::Json(header), Self::Binary { data, blob_id: id }])
    }

    /// Create multiple responses
    pub fn multiple(responses: Vec<WebSocketResponseType>) -> Self {
        Self::Multiple(responses)
    }

    /// Check if this is a binary response
    pub fn is_binary(&self) -> bool {
        matches!(self, Self::Binary { .. })
    }

    /// Check if this is a multiple response
    pub fn is_multiple(&self) -> bool {
        matches!(self, Self::Multiple(_))
    }

    /// Get binary data if this is a binary response
    pub fn binary_data(&self) -> Option<&[u8]> {
        match self {
            Self::Binary { data, .. } => Some(data),
            _ => None,
        }
    }

    /// Get blob ID if this is a binary response
    pub fn blob_id(&self) -> Option<&str> {
        match self {
            Self::Binary { blob_id, .. } => Some(blob_id),
            _ => None,
        }
    }

    /// Convert to JSON if this is a JSON response
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        match self {
            Self::Json(response) => response.to_json(),
            Self::Binary { blob_id, .. } => {
                // This shouldn't happen in normal flow, but provide fallback
                Err(serde_json::Error::io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!(
                        "Cannot serialize binary response for blob {} to JSON",
                        blob_id
                    ),
                )))
            }
            Self::Multiple(_) => {
                // Multiple responses cannot be serialized to a single JSON
                Err(serde_json::Error::io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "Cannot serialize multiple responses to JSON",
                )))
            }
        }
    }
}

impl WebSocketResponse {
    /// Serialize response to JSON text
    pub fn to_json(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string(self)
    }

    /// Create a welcome message
    pub fn welcome(user_id: Option<Uuid>, connection_id: String) -> Self {
        Self::Welcome {
            message: "Connected to WebSocket server".to_string(),
            user_id,
            connection_id,
        }
    }

    /// Create an error response
    pub fn error(message: impl Into<String>) -> Self {
        Self::Error {
            message: message.into(),
            code: None,
        }
    }

    /// Create an error response with code
    pub fn error_with_code(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self::Error {
            message: message.into(),
            code: Some(code.into()),
        }
    }

    /// Create a notification response from a NotificationEvent
    pub fn notification(event: &NotificationEvent) -> Self {
        Self::Notification {
            id: event.id,
            channel: event.channel,
            event_type: event.event_type.clone(),
            payload: event.payload_value().clone(),
            priority: format!("{:?}", event.priority),
            timestamp: event.timestamp(),
        }
    }

    /// Create a notification subscribed response
    pub fn notification_subscribed(channel: NotificationChannel) -> Self {
        Self::NotificationSubscribed { channel }
    }

    /// Create a notification unsubscribed response
    pub fn notification_unsubscribed(channel: NotificationChannel) -> Self {
        Self::NotificationUnsubscribed { channel }
    }

    /// Create a notification status response
    pub fn notification_status(
        subscribed_channels: Vec<NotificationChannel>,
        connection_id: String,
        is_authenticated: bool,
    ) -> Self {
        Self::NotificationStatus {
            subscribed_channels,
            connection_id,
            is_authenticated,
        }
    }
}

impl std::fmt::Debug for WebSocketResponse {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WebSocketResponse::Welcome {
                message,
                user_id,
                connection_id,
            } => f
                .debug_struct("Welcome")
                .field("message", message)
                .field("user_id", user_id)
                .field("connection_id", connection_id)
                .finish(),
            WebSocketResponse::Pong => f.debug_struct("Pong").finish(),
            WebSocketResponse::MediaBlobs { blobs, total_count } => f
                .debug_struct("MediaBlobs")
                .field("blob_count", &blobs.len())
                .field("total_count", total_count)
                .finish(),
            WebSocketResponse::MediaBlob { blob } => f
                .debug_struct("MediaBlob")
                .field("blob_id", &blob.id)
                .field("blob_size", &blob.size)
                .field("blob_mime", &blob.mime)
                .field("blob_sha256_prefix", &format!("{}...", &blob.sha256[..8]))
                .finish(),
            WebSocketResponse::MediaBlobData { id, data, mime } => f
                .debug_struct("MediaBlobData")
                .field("id", id)
                .field("data_size", &data.len())
                .field("mime", mime)
                .finish(),
            WebSocketResponse::Error { message, code } => f
                .debug_struct("Error")
                .field("message", message)
                .field("code", code)
                .finish(),
            WebSocketResponse::ConnectionStatus {
                connected,
                user_count,
            } => f
                .debug_struct("ConnectionStatus")
                .field("connected", connected)
                .field("user_count", user_count)
                .finish(),
            WebSocketResponse::Notification {
                id,
                channel,
                event_type,
                priority,
                timestamp,
                ..
            } => f
                .debug_struct("Notification")
                .field("id", id)
                .field("channel", channel)
                .field("event_type", event_type)
                .field("priority", priority)
                .field("timestamp", timestamp)
                .finish(),
            WebSocketResponse::NotificationSubscribed { channel } => f
                .debug_struct("NotificationSubscribed")
                .field("channel", channel)
                .finish(),
            WebSocketResponse::NotificationUnsubscribed { channel } => f
                .debug_struct("NotificationUnsubscribed")
                .field("channel", channel)
                .finish(),
            WebSocketResponse::NotificationStatus {
                subscribed_channels,
                connection_id,
                is_authenticated,
            } => f
                .debug_struct("NotificationStatus")
                .field("subscribed_channels", subscribed_channels)
                .field("connection_id", connection_id)
                .field("is_authenticated", is_authenticated)
                .finish(),
            WebSocketResponse::Thumbnails {
                media_blob_id,
                thumbnails,
            } => f
                .debug_struct("Thumbnails")
                .field("media_blob_id", media_blob_id)
                .field("thumbnail_count", &thumbnails.len())
                .finish(),
            WebSocketResponse::MediaBlobDataHeader { id, size, mime } => f
                .debug_struct("MediaBlobDataHeader")
                .field("id", id)
                .field("size", size)
                .field("mime", mime)
                .finish(),
        }
    }
}

#[cfg(test)]
mod tests {
    use time::OffsetDateTime;

    use super::*;

    #[test]
    fn test_websocket_message_serialization() {
        let msg = WebSocketMessage::Ping;
        let json = msg.to_json().unwrap();
        assert!(json.contains("Ping"));

        let parsed = WebSocketMessage::from_json(&json).unwrap();
        matches!(parsed, WebSocketMessage::Ping);
    }

    #[test]
    fn test_websocket_response_serialization() {
        let response = WebSocketResponse::welcome(None, "test-123".to_string());
        let json = response.to_json().unwrap();
        assert!(json.contains("Welcome"));
        assert!(json.contains("test-123"));
    }

    #[test]
    fn test_media_blob_serialization() {
        let blob = MediaBlob {
            id: "abc1234".to_string(),
            data: None,
            sha256: "abc123".to_string(),
            size: Some(1024),
            mime: Some("image/png".to_string()),
            source_client_id: Some("client-1".to_string()),
            local_path: Some("/path/to/file.png".to_string()),
            parent_blob_id: None,
            blob_type: "original".to_string(),
            metadata: serde_json::json!({"width": 800, "height": 600}),
            created_at: OffsetDateTime::now_utc(),
            updated_at: OffsetDateTime::now_utc(),
        };

        let json = serde_json::to_string(&blob).unwrap();
        let parsed: MediaBlob = serde_json::from_str(&json).unwrap();
        assert_eq!(blob.sha256, parsed.sha256);
        assert_eq!(blob.size, parsed.size);
    }
}
