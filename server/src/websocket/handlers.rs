//! WebSocket handlers with authentication and message processing
//!
//! Provides authenticated WebSocket endpoints that integrate with the existing
//! auth system and handle real-time communication for media blob sharing.

use crate::config::AppConfig;
use crate::media::{CreateMediaBlob, MediaBlobQuery, MediaRepository, MediaService};
use crate::websocket::messages::{WebSocketMessage, WebSocketResponse};
use axum::{
    extract::{ws::WebSocket, WebSocketUpgrade},
    response::Response,
    Extension,
};
use grimoire::DatabaseConnection;
// use futures_util::{sink::SinkExt, stream::StreamExt}; // TODO: Uncomment when needed
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use time::OffsetDateTime;
use tower_sessions::Session;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Connection manager to track active WebSocket connections
#[derive(Clone)]
pub struct ConnectionManager {
    connections: Arc<Mutex<HashMap<String, ConnectionInfo>>>,
}

/// Information about an active WebSocket connection
#[derive(Debug, Clone)]
struct ConnectionInfo {
    _user_id: Option<Uuid>,
    _connected_at: OffsetDateTime,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    fn add_connection(&self, connection_id: String, user_id: Option<Uuid>) {
        if let Ok(mut connections) = self.connections.lock() {
            connections.insert(
                connection_id,
                ConnectionInfo {
                    _user_id: user_id,
                    _connected_at: OffsetDateTime::now_utc(),
                },
            );
        }
    }

    fn remove_connection(&self, connection_id: &str) {
        if let Ok(mut connections) = self.connections.lock() {
            connections.remove(connection_id);
        }
    }

    fn get_user_count(&self) -> u32 {
        self.connections
            .lock()
            .map(|connections| connections.len() as u32)
            .unwrap_or(0)
    }
}

/// WebSocket upgrade handler - this gets called on GET /ws
pub async fn websocket_handler(
    ws: WebSocketUpgrade,
    session: Session,
    Extension(connection_manager): Extension<ConnectionManager>,
    Extension(db): Extension<DatabaseConnection>,
    Extension(config): Extension<AppConfig>,
) -> Response {
    // Check if user is authenticated by looking for user_id in session
    let user_id = session.get::<Uuid>("user_id").await.ok().flatten();

    if user_id.is_none() {
        // Not authenticated - reject the WebSocket upgrade
        warn!("WebSocket connection attempt without authentication");
        return axum::http::Response::builder()
            .status(401)
            .body("Authentication required for WebSocket connection".into())
            .unwrap();
    }

    info!("WebSocket upgrade for authenticated user: {:?}", user_id);

    // Upgrade to WebSocket and handle the connection
    ws.on_upgrade(move |socket| {
        handle_websocket_connection(socket, user_id, connection_manager, db, config)
    })
}

/// Handle an individual WebSocket connection after upgrade
pub async fn handle_websocket_connection(
    mut socket: WebSocket,
    user_id: Option<Uuid>,
    connection_manager: ConnectionManager,
    db: DatabaseConnection,
    config: AppConfig,
) {
    let connection_id = format!("conn_{}", Uuid::new_v4());
    info!(
        "WebSocket connection established: {} (user: {:?})",
        connection_id, user_id
    );

    // Add to connection manager
    connection_manager.add_connection(connection_id.clone(), user_id);

    // Send welcome message
    let welcome = WebSocketResponse::welcome(user_id, connection_id.clone());
    if let Ok(welcome_json) = welcome.to_json() {
        if let Err(e) = socket
            .send(axum::extract::ws::Message::Text(welcome_json.into()))
            .await
        {
            error!("Failed to send welcome message: {}", e);
            return;
        }
    }

    // Send connection status
    let user_count = connection_manager.get_user_count();
    let status = WebSocketResponse::ConnectionStatus {
        connected: true,
        user_count,
    };
    if let Ok(status_json) = status.to_json() {
        let _ = socket
            .send(axum::extract::ws::Message::Text(status_json.into()))
            .await;
    }

    // Handle messages in a loop
    while let Some(msg) = socket.recv().await {
        match msg {
            Ok(axum::extract::ws::Message::Text(text)) => {
                debug!("Received WebSocket message: {}", text);

                match WebSocketMessage::from_json(&text) {
                    Ok(parsed_msg) => {
                        if let Some(response) =
                            handle_message(parsed_msg, user_id, &db, &config, &connection_manager)
                                .await
                        {
                            if let Ok(response_json) = response.to_json() {
                                if let Err(e) = socket
                                    .send(axum::extract::ws::Message::Text(response_json.into()))
                                    .await
                                {
                                    error!("Failed to send response: {}", e);
                                    break;
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Failed to parse WebSocket message: {}", e);
                        let error_response = WebSocketResponse::error("Invalid message format");
                        if let Ok(error_json) = error_response.to_json() {
                            let _ = socket
                                .send(axum::extract::ws::Message::Text(error_json.into()))
                                .await;
                        }
                    }
                }
            }
            Ok(axum::extract::ws::Message::Close(_)) => {
                info!("WebSocket connection closed: {}", connection_id);
                break;
            }
            Ok(axum::extract::ws::Message::Ping(data)) => {
                debug!("Received ping, sending pong");
                if let Err(e) = socket.send(axum::extract::ws::Message::Pong(data)).await {
                    error!("Failed to send pong: {}", e);
                    break;
                }
            }
            Ok(_) => {
                // Ignore other message types (Binary, Pong)
            }
            Err(e) => {
                error!("WebSocket error: {}", e);
                break;
            }
        }
    }

    // Clean up connection
    connection_manager.remove_connection(&connection_id);
    info!(
        "WebSocket connection closed and cleaned up: {}",
        connection_id
    );
}

/// Handle a parsed WebSocket message and return optional response
async fn handle_message(
    message: WebSocketMessage,
    user_id: Option<Uuid>,
    db: &DatabaseConnection,
    config: &AppConfig,
    _connection_manager: &ConnectionManager,
) -> Option<WebSocketResponse> {
    match &message {
        WebSocketMessage::UploadMediaBlob { blob } => {
            info!(
                "Processing UploadMediaBlob message (size: {:?}, mime: {:?}, sha256: {})",
                blob.size,
                blob.mime,
                &blob.sha256[..8]
            );
        }
        _ => {
            info!("Processing WebSocket message: {:?}", message);
        }
    }

    match message {
        WebSocketMessage::Ping => {
            debug!("Ping received, responding with pong");
            Some(WebSocketResponse::Pong)
        }
        WebSocketMessage::GetMediaBlobs { limit, offset } => {
            info!(
                "GetMediaBlobs request (limit: {:?}, offset: {:?}) from user: {:?}",
                limit, offset, user_id
            );

            let repository = MediaRepository::new(db);
            let service = MediaService::new(repository);

            let query = MediaBlobQuery {
                limit: limit.map(|l| l as i64),
                offset: offset.map(|o| o as i64),
                ..Default::default()
            };

            match service.list_blobs(query).await {
                Ok(blobs) => {
                    let total_count = blobs.len() as u32;
                    Some(WebSocketResponse::MediaBlobs { blobs, total_count })
                }
                Err(e) => {
                    error!("Failed to fetch media blobs: {}", e);
                    Some(WebSocketResponse::error("Failed to fetch media blobs"))
                }
            }
        }
        WebSocketMessage::GetMediaBlob { id } => {
            info!(
                "GetMediaBlob request for ID: {} from user: {:?}",
                id, user_id
            );

            let repository = MediaRepository::new(db);
            let service = MediaService::new(repository);

            match service.get_blob(id, false).await {
                Ok(blob) => Some(WebSocketResponse::MediaBlob { blob }),
                Err(e) => {
                    warn!("Media blob not found: {} - {}", id, e);
                    Some(WebSocketResponse::error("Media blob not found"))
                }
            }
        }
        WebSocketMessage::GetMediaBlobData { id } => {
            info!(
                "GetMediaBlobData request for ID: {} from user: {:?}",
                id, user_id
            );

            let repository = MediaRepository::new(db);
            let service = MediaService::new(repository);

            match service.get_blob(id, true).await {
                Ok(blob) => {
                    if let Some(data) = blob.data {
                        Some(WebSocketResponse::MediaBlobData {
                            id: blob.id,
                            data,
                            mime: blob.mime,
                        })
                    } else {
                        warn!("Media blob {} has no data", id);
                        Some(WebSocketResponse::error("Media blob has no data"))
                    }
                }
                Err(e) => {
                    warn!("Media blob not found: {} - {}", id, e);
                    Some(WebSocketResponse::error("Media blob not found"))
                }
            }
        }
        WebSocketMessage::UploadMediaBlob { blob } => {
            info!(
                "UploadMediaBlob request (size: {:?}, mime: {:?}) from user: {:?}",
                blob.size, blob.mime, user_id
            );

            let repository = MediaRepository::new(db);
            let service = MediaService::new(repository);

            let create_params = CreateMediaBlob {
                data: blob.data,
                sha256: blob.sha256,
                size: blob.size,
                mime: blob.mime,
                source_client_id: blob.source_client_id,
                local_path: blob.local_path,
                metadata: blob.metadata,
            };

            match service.create_blob(create_params, &config.media).await {
                Ok(created_blob) => {
                    info!("Successfully created media blob: {}", created_blob.id);
                    Some(WebSocketResponse::MediaBlob { blob: created_blob })
                }
                Err(e) => {
                    error!("Failed to create media blob: {}", e);
                    Some(WebSocketResponse::error("Failed to upload media blob"))
                }
            }
        }
    }
}
