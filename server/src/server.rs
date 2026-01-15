//! server startup and shutdown

use std::net::SocketAddr;
use std::path::Path;

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
pub async fn start_server(
    state: AppState,
    host: &str,
    port: u16,
    shutdown_signal: impl std::future::Future<Output = ()> + Send + 'static,
) -> Result<(), ApiError> {
    // validate app state configuration
    state
        .validate()
        .map_err(|e| ApiError::Internal(format!("invalid configuration: {}", e)))?;

    // validate static files directory if enabled
    if let Some(server_config) = &state.config.server {
        if server_config.static_files.enabled {
            let static_dir = server_config
                .static_files
                .directory
                .as_ref()
                .expect("static_files.directory must be set when static_files.enabled is true");

            let path = Path::new(static_dir);

            // require absolute path
            if !path.is_absolute() {
                panic!(
                    "static_files.directory must be an absolute path, got: {}",
                    path.display()
                );
            }

            // verify directory exists
            if !path.exists() {
                panic!("static_files.directory does not exist: {}", path.display());
            }

            // verify it's actually a directory
            if !path.is_dir() {
                panic!(
                    "static_files.directory is not a directory: {}",
                    path.display()
                );
            }

            tracing::info!("static files enabled, serving from: {}", path.display());
        }
    }

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

    // serve application with graceful shutdown
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal)
        .await
        .map_err(|e| ApiError::Internal(format!("server error: {}", e)))?;

    Ok(())
}
