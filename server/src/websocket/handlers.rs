//! WebSocket handlers with authentication and message processing
//!
//! Provides authenticated WebSocket endpoints that integrate with the existing
//! auth system and handle real-time communication for media blob sharing.

use crate::media::{MediaBlobQuery, MediaRepository, MediaService};
use crate::websocket::messages::{WebSocketMessage, WebSocketResponse, WebSocketResponseType};
use axum::{
    extract::{ws::WebSocket, WebSocketUpgrade},
    response::Response,
    Extension,
};
use grimoire::AppConfig;
use grimoire::DatabaseConnection;
// use futures_util::{sink::SinkExt, stream::StreamExt}; // TODO: Uncomment when needed
use grimoire::notifications::NotificationChannel;
use grimoire::thumbnails::ThumbnailService;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use time::{format_description, OffsetDateTime};
use tokio::sync::broadcast;
use tower_sessions::Session;
use tracing::{debug, error, info, warn};
use uuid::Uuid;

/// Connection manager to track active WebSocket connections
#[derive(Clone)]
pub struct ConnectionManager {
    connections: Arc<Mutex<HashMap<String, ConnectionInfo>>>,
    notification_tx: broadcast::Sender<String>,
}

/// Information about an active WebSocket connection
#[derive(Debug, Clone)]
struct ConnectionInfo {
    _user_id: Option<Uuid>,
    _connected_at: OffsetDateTime,
    subscribed_channels: Vec<NotificationChannel>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        let (notification_tx, _) = broadcast::channel(1000);
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
            notification_tx,
        }
    }

    pub fn get_notification_receiver(&self) -> broadcast::Receiver<String> {
        self.notification_tx.subscribe()
    }

    pub fn get_notification_sender(&self) -> broadcast::Sender<String> {
        self.notification_tx.clone()
    }

    pub async fn broadcast_notification(
        &self,
        message: String,
    ) -> Result<usize, broadcast::error::SendError<String>> {
        self.notification_tx.send(message)
    }

    fn add_connection(&self, connection_id: String, user_id: Option<Uuid>) {
        if let Ok(mut connections) = self.connections.lock() {
            connections.insert(
                connection_id,
                ConnectionInfo {
                    _user_id: user_id,
                    _connected_at: OffsetDateTime::now_utc(),
                    subscribed_channels: Vec::new(),
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

    fn subscribe_to_channel(&self, connection_id: &str, channel: NotificationChannel) -> bool {
        if let Ok(mut connections) = self.connections.lock() {
            if let Some(conn_info) = connections.get_mut(connection_id) {
                if !conn_info.subscribed_channels.contains(&channel) {
                    conn_info.subscribed_channels.push(channel);
                    return true;
                }
            }
        }
        false
    }

    fn unsubscribe_from_channel(&self, connection_id: &str, channel: &NotificationChannel) -> bool {
        if let Ok(mut connections) = self.connections.lock() {
            if let Some(conn_info) = connections.get_mut(connection_id) {
                let before_len = conn_info.subscribed_channels.len();
                conn_info.subscribed_channels.retain(|c| c != channel);
                return conn_info.subscribed_channels.len() < before_len;
            }
        }
        false
    }

    fn get_subscribed_channels(&self, connection_id: &str) -> Vec<NotificationChannel> {
        if let Ok(connections) = self.connections.lock() {
            if let Some(conn_info) = connections.get(connection_id) {
                return conn_info.subscribed_channels.clone();
            }
        }
        Vec::new()
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

    // Set up notification receiver for broadcasting
    let mut notification_rx = connection_manager.get_notification_receiver();

    // Handle messages and notifications concurrently
    loop {
        tokio::select! {
            // Handle incoming WebSocket messages
            msg = socket.recv() => {
                let Some(msg) = msg else {
                    break;
                };

                match handle_websocket_message(
                    msg,
                    &mut socket,
                    user_id,
                    &db,
                    &config,
                    &connection_manager,
                    &connection_id
                ).await {
                    Ok(should_continue) => {
                        if !should_continue {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }

            // Handle notification broadcasts
            notification = notification_rx.recv() => {
                match notification {
                    Ok(notification_json) => {
                        if let Err(e) = socket.send(axum::extract::ws::Message::Text(notification_json.into())).await {
                            error!("Failed to send notification: {}", e);
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        debug!("Notification channel closed");
                        break;
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => {
                        warn!("Notification receiver lagged, continuing");
                    }
                }
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

/// Handle a single WebSocket message
async fn handle_websocket_message(
    msg: Result<axum::extract::ws::Message, axum::Error>,
    socket: &mut WebSocket,
    user_id: Option<Uuid>,
    db: &DatabaseConnection,
    config: &AppConfig,
    connection_manager: &ConnectionManager,
    connection_id: &str,
) -> Result<bool, Box<dyn std::error::Error>> {
    match msg {
        Ok(axum::extract::ws::Message::Text(text)) => {
            debug!("Received WebSocket message: {}", text);

            match WebSocketMessage::from_json(&text) {
                Ok(parsed_msg) => {
                    if let Some(response) = handle_message(
                        parsed_msg,
                        user_id,
                        db,
                        config,
                        connection_manager,
                        connection_id,
                    )
                    .await
                    {
                        match response {
                            WebSocketResponseType::Json(json_response) => {
                                if let Ok(response_json) = json_response.to_json() {
                                    if let Err(e) = socket
                                        .send(axum::extract::ws::Message::Text(
                                            response_json.into(),
                                        ))
                                        .await
                                    {
                                        error!("Failed to send JSON response: {}", e);
                                        return Ok(false);
                                    }
                                }
                            }
                            WebSocketResponseType::Binary { data, blob_id } => {
                                info!(
                                    "Sending binary WebSocket frame for blob {} ({} bytes)",
                                    blob_id,
                                    data.len()
                                );
                                if let Err(e) = socket
                                    .send(axum::extract::ws::Message::Binary(data.into()))
                                    .await
                                {
                                    error!(
                                        "Failed to send binary response for blob {}: {}",
                                        blob_id, e
                                    );
                                    return Ok(false);
                                }
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
            info!("WebSocket connection closed");
            return Ok(false);
        }
        Ok(axum::extract::ws::Message::Ping(data)) => {
            debug!("Received ping, sending pong");
            if let Err(e) = socket.send(axum::extract::ws::Message::Pong(data)).await {
                error!("Failed to send pong: {}", e);
                return Ok(false);
            }
        }
        Ok(_) => {
            // Ignore other message types (Binary, Pong)
        }
        Err(e) => {
            error!("WebSocket error: {}", e);
            return Ok(false);
        }
    }

    Ok(true)
}

/// Handle a parsed WebSocket message and return optional response
async fn handle_message(
    message: WebSocketMessage,
    user_id: Option<Uuid>,
    db: &DatabaseConnection,
    config: &AppConfig,
    connection_manager: &ConnectionManager,
    connection_id: &str,
) -> Option<WebSocketResponseType> {
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
            Some(WebSocketResponseType::json(WebSocketResponse::Pong))
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
                only_originals: Some(true),
                ..Default::default()
            };

            match service.list_blobs(query).await {
                Ok(blobs_result) => {
                    let total_count = blobs_result
                        .pagination
                        .total_count
                        .unwrap_or(blobs_result.items.len() as i64)
                        as u32;
                    Some(WebSocketResponseType::json(WebSocketResponse::MediaBlobs {
                        blobs: blobs_result.items,
                        total_count,
                    }))
                }
                Err(e) => {
                    error!("Failed to fetch media blobs: {}", e);
                    Some(WebSocketResponseType::json(WebSocketResponse::error(
                        "Failed to fetch media blobs",
                    )))
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

            match service.get_blob(&id, false).await {
                Ok(blob) => Some(WebSocketResponseType::json(WebSocketResponse::MediaBlob {
                    blob,
                })),
                Err(e) => {
                    warn!("Media blob not found: {} - {}", id, e);
                    Some(WebSocketResponseType::json(WebSocketResponse::error(
                        "Media blob not found",
                    )))
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

            match service.get_blob(&id, true).await {
                Ok(blob) => {
                    if let Some(data) = blob.data {
                        info!(
                            "Sending binary data for blob {} (size: {} bytes)",
                            blob.id,
                            data.len()
                        );
                        // Send raw binary data instead of JSON
                        Some(WebSocketResponseType::binary(data, blob.id))
                    } else {
                        warn!("Media blob {} has no data", id);
                        Some(WebSocketResponseType::json(WebSocketResponse::error(
                            "Media blob has no data",
                        )))
                    }
                }
                Err(e) => {
                    warn!("Media blob not found: {} - {}", id, e);
                    Some(WebSocketResponseType::json(WebSocketResponse::error(
                        "Media blob not found",
                    )))
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

            let mut create_params = blob.clone();
            // Ensure this is marked as an original file, not a thumbnail
            if create_params.parent_blob_id.is_none() {
                create_params.blob_type = Some("original".to_string());
            }

            match service.create_blob(create_params, &config.media).await {
                Ok(created_blob) => {
                    info!("Successfully created media blob: {}", created_blob.id);

                    // Enqueue thumbnail generation job if applicable
                    if let Some(ref mime) = created_blob.mime {
                        if mime.starts_with("image/") || mime.starts_with("video/") {
                            let thumbnail_service = ThumbnailService::new_with_defaults(db);

                            match thumbnail_service
                                .auto_enqueue_for_media_blob(&created_blob.id)
                                .await
                            {
                                Ok(job_ids) => {
                                    info!(
                                        "🖼️ Enqueued {} thumbnail jobs for blob {}: {:?}",
                                        job_ids.len(),
                                        created_blob.id,
                                        job_ids
                                    );
                                }
                                Err(e) => {
                                    warn!(
                                        "⚠️ Failed to enqueue thumbnail jobs for blob {}: {}",
                                        created_blob.id, e
                                    );
                                }
                            }
                        }
                    }

                    // Create a safe version of the blob without the data field for notifications
                    let safe_blob = json!({
                        "id": created_blob.id,
                        "sha256": created_blob.sha256,
                        "size": created_blob.size,
                        "mime": created_blob.mime,
                        "source_client_id": created_blob.source_client_id,
                        "local_path": created_blob.local_path,
                        "metadata": created_blob.metadata,
                        "created_at": created_blob.created_at,
                        "updated_at": created_blob.updated_at
                        // Intentionally omitting 'data' field to avoid large payloads in notifications
                    });

                    // Broadcast notification to all connected clients
                    let notification_message = json!({
                        "type": "Notification",
                        "data": {
                            "id": Uuid::new_v4(),
                            "channel": "MediaBlobs",
                            "event_type": "media_blob.created",
                            "payload": {
                                "media_blob": safe_blob
                            },
                            "priority": "Normal",
                            "timestamp": OffsetDateTime::now_utc().format(&format_description::well_known::Rfc3339).unwrap()
                        }
                    });

                    if let Ok(notification_json) = serde_json::to_string(&notification_message) {
                        match connection_manager
                            .broadcast_notification(notification_json)
                            .await
                        {
                            Ok(receiver_count) => {
                                info!(
                                    "📡 Broadcast media_blob.created notification to {} receivers for blob: {}",
                                    receiver_count, created_blob.id
                                );
                            }
                            Err(e) => {
                                warn!("Failed to broadcast notification: {}", e);
                            }
                        }
                    }

                    Some(WebSocketResponseType::json(WebSocketResponse::MediaBlob {
                        blob: created_blob,
                    }))
                }
                Err(e) => {
                    error!("Failed to create media blob: {}", e);
                    Some(WebSocketResponseType::json(WebSocketResponse::error(
                        "Failed to upload media blob",
                    )))
                }
            }
        }
        WebSocketMessage::SubscribeToNotifications { channel } => {
            info!(
                "SubscribeToNotifications request for channel: {:?} from user: {:?}",
                channel, user_id
            );

            if connection_manager.subscribe_to_channel(connection_id, channel) {
                info!(
                    "✅ Successfully subscribed connection {} to channel {:?}",
                    connection_id, channel
                );
                Some(WebSocketResponseType::json(
                    WebSocketResponse::notification_subscribed(channel),
                ))
            } else {
                warn!(
                    "❌ Failed to subscribe connection {} to channel {:?}",
                    connection_id, channel
                );
                Some(WebSocketResponseType::json(WebSocketResponse::error(
                    "Failed to subscribe to channel",
                )))
            }
        }
        WebSocketMessage::UnsubscribeFromNotifications { channel } => {
            info!(
                "UnsubscribeFromNotifications request for channel: {:?} from user: {:?}",
                channel, user_id
            );

            if connection_manager.unsubscribe_from_channel(connection_id, &channel) {
                info!(
                    "✅ Successfully unsubscribed connection {} from channel {:?}",
                    connection_id, channel
                );
                Some(WebSocketResponseType::json(
                    WebSocketResponse::notification_unsubscribed(channel),
                ))
            } else {
                warn!(
                    "❌ Failed to unsubscribe connection {} from channel {:?}",
                    connection_id, channel
                );
                Some(WebSocketResponseType::json(WebSocketResponse::error(
                    "Failed to unsubscribe from channel",
                )))
            }
        }
        WebSocketMessage::GetNotificationStatus => {
            info!("GetNotificationStatus request from user: {:?}", user_id);

            let subscribed_channels = connection_manager.get_subscribed_channels(connection_id);
            Some(WebSocketResponseType::json(
                WebSocketResponse::notification_status(
                    subscribed_channels,
                    connection_id.to_string(),
                    user_id.is_some(),
                ),
            ))
        }
        WebSocketMessage::GetThumbnails { media_blob_id } => {
            info!(
                "GetThumbnails request for blob ID: {} from user: {:?}",
                media_blob_id, user_id
            );

            let thumbnail_service = ThumbnailService::new_with_defaults(db);

            match thumbnail_service
                .get_thumbnails_for_blob(&media_blob_id)
                .await
            {
                Ok(thumbnail_infos) => {
                    info!(
                        "Found {} thumbnails for blob {}",
                        thumbnail_infos.len(),
                        media_blob_id
                    );

                    // Convert MediaBlobInfo to MediaBlob by fetching full records
                    let media_repository = MediaRepository::new(db);
                    let media_service = MediaService::new(media_repository);
                    let mut thumbnails = Vec::new();

                    for thumbnail_info in thumbnail_infos {
                        match media_service.get_blob(&thumbnail_info.id, true).await {
                            Ok(media_blob) => thumbnails.push(media_blob),
                            Err(e) => {
                                warn!(
                                    "Failed to fetch full thumbnail blob {}: {}",
                                    thumbnail_info.id, e
                                );
                            }
                        }
                    }

                    Some(WebSocketResponseType::json(WebSocketResponse::Thumbnails {
                        media_blob_id: media_blob_id.clone(),
                        thumbnails,
                    }))
                }
                Err(e) => {
                    warn!("Failed to get thumbnails for blob {}: {}", media_blob_id, e);
                    Some(WebSocketResponseType::json(WebSocketResponse::error(
                        "Failed to get thumbnails",
                    )))
                }
            }
        }
    }
}
