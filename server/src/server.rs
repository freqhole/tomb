//! server startup and shutdown

use std::net::SocketAddr;

use axum::extract::Extension;
use tokio::net::TcpListener;
use tower_http::{
    compression::CompressionLayer,
    cors::CorsLayer,
    trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer},
};
use tower_sessions::SessionManagerLayer;
use tracing::Level;

use crate::{routes, state::AppState, ApiError};

/// start the http server
///
/// binds to the configured host:port and serves the application
pub async fn start_server(state: AppState, host: &str, port: u16) -> Result<(), ApiError> {
    // validate app state configuration
    state
        .validate()
        .map_err(|e| ApiError::Internal(format!("invalid configuration: {}", e)))?;

    // extract session store before building router (needs to be moved)
    let session_store = state.session_store.clone();

    // build router with state
    let app = routes::build_router()
        .layer(Extension(state.clone())) // Add state as extension for middleware
        .layer(SessionManagerLayer::new(session_store)) // Enable session extraction
        .layer(
            TraceLayer::new_for_http()
                .make_span_with(DefaultMakeSpan::new().level(Level::INFO))
                .on_response(DefaultOnResponse::new().level(Level::INFO)),
        )
        .layer(CompressionLayer::new())
        .layer(CorsLayer::permissive()) // TODO: configure from config
        .with_state(state);

    // bind to address
    let addr = format!("{}:{}", host, port)
        .parse::<SocketAddr>()
        .map_err(|e| ApiError::Internal(format!("invalid address: {}", e)))?;

    let listener = TcpListener::bind(addr)
        .await
        .map_err(|e| ApiError::Internal(format!("failed to bind: {}", e)))?;

    tracing::info!("server listening on {}", addr);

    // serve application
    axum::serve(listener, app)
        .await
        .map_err(|e| ApiError::Internal(format!("server error: {}", e)))?;

    Ok(())
}
