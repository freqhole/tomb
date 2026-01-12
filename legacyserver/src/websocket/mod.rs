//! WebSocket module for real-time communication
//!
//! Provides WebSocket endpoints with authentication and message handling
//! for media blob sharing and real-time updates.

pub mod handlers;
pub mod messages;

use axum::{routing::get, Extension, Router};
use handlers::ConnectionManager;

// Re-export commonly used types
pub use crate::media::MediaBlob;
pub use handlers::{handle_websocket_connection, websocket_handler};
pub use messages::{WebSocketMessage, WebSocketResponse};

/// Build WebSocket routes
pub fn build_websocket_routes() -> Router {
    // Create connection manager singleton
    let connection_manager = ConnectionManager::new();

    Router::new()
        .route("/ws", get(websocket_handler))
        .layer(Extension(connection_manager))
}

/// Build websocket routes with external connection manager
pub fn build_websocket_routes_with_manager(connection_manager: ConnectionManager) -> Router {
    Router::new()
        .route("/ws", get(websocket_handler))
        .layer(Extension(connection_manager))
}
