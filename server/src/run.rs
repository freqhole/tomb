//! server runner - entry point for starting the server
//!
//! this module provides a high-level `run_server` function that can be called
//! from the CLI or other entry points (like Tauri)

use std::path::PathBuf;
use std::sync::Arc;

use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::{start_server, AppState};

/// Server run options
#[derive(Debug, Clone)]
pub struct ServerOptions {
    /// Path to configuration file
    pub config_path: PathBuf,
}

impl Default for ServerOptions {
    fn default() -> Self {
        Self {
            config_path: PathBuf::from("freqhole-config.toml"),
        }
    }
}

/// Run the freqhole server
///
/// This is the main entry point for starting the server.
/// It handles:
/// - Loading configuration
/// - Setting up tracing/logging
/// - Initializing the database
/// - Setting up signal handlers for graceful shutdown
/// - Starting the HTTP server
///
/// # Arguments
/// * `options` - Server configuration options
///
/// # Returns
/// Ok(()) on graceful shutdown, Err on fatal error
pub async fn run_server(options: ServerOptions) -> anyhow::Result<()> {
    // set up shutdown channel for HTTP server
    let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
    let shutdown_tx = Arc::new(tokio::sync::Mutex::new(Some(shutdown_tx)));
    let shutdown_tx_clone = shutdown_tx.clone();

    // shared cancellation token for job processor
    let job_cancellation_token = grimoire::jobs::CancellationToken::new();
    let job_cancellation_token_clone = job_cancellation_token.clone();

    tokio::spawn(async move {
        use tokio::signal::unix::{signal, SignalKind};

        let mut sigterm = signal(SignalKind::terminate()).expect("failed to setup SIGTERM handler");
        let mut sigint = signal(SignalKind::interrupt()).expect("failed to setup SIGINT handler");

        // wait for first signal
        tokio::select! {
            _ = sigterm.recv() => {
                tracing::info!("received SIGTERM, initiating graceful shutdown...");
            }
            _ = sigint.recv() => {
                tracing::info!("received SIGINT (ctrl-c), initiating graceful shutdown...");
                eprintln!("\none moment please! shutting down gracefully... (press ctrl-c again to force quit)");
            }
        }

        // trigger shutdown of HTTP server
        if let Some(tx) = shutdown_tx_clone.lock().await.take() {
            let _ = tx.send(());
        }

        // cancel job processor
        job_cancellation_token_clone.cancel();

        // wait for second signal to force quit
        tokio::select! {
            _ = sigterm.recv() => {
                tracing::warn!("received second SIGTERM, forcing shutdown!");
                eprintln!("forcing immediate shutdown!");
                std::process::exit(1);
            }
            _ = sigint.recv() => {
                tracing::warn!("received second SIGINT, forcing shutdown!");
                eprintln!("forcing immediate shutdown!");
                std::process::exit(1);
            }
        }
    });

    // load config first (before tracing)
    grimoire::config::init_config(Some(options.config_path.clone()))
        .map_err(|e| anyhow::anyhow!("failed to initialize config: {}", e))?;

    let config = grimoire::config::get_config();

    // initialize tracing with config log level
    let log_level = config.logging.level.as_str();
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(log_level)),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    tracing::info!("starting freqhole server...");
    tracing::info!("config: {}", options.config_path.display());
    tracing::info!("log level: {}", log_level);

    // initialize database (migrations + views) once at startup
    grimoire::database::initialize()
        .await
        .map_err(|e| anyhow::anyhow!("failed to initialize database: {}", e))?;

    // initialize session store from grimoire
    tracing::info!("initializing session store...");
    let session_store = grimoire::sessions::init_session_store()
        .await
        .map_err(|e| anyhow::anyhow!("failed to initialize session store: {}", e))?;

    // get server config before building state
    let server_config = config
        .server
        .as_ref()
        .ok_or_else(|| anyhow::anyhow!("server config missing"))?;

    let host = server_config.host.clone();
    let port = server_config.port;

    // build app state
    let state = AppState::new(config.clone(), session_store);

    // validate state
    state
        .validate()
        .map_err(|e| anyhow::anyhow!("invalid configuration: {}", e))?;

    tracing::info!("server configuration validated");
    tracing::info!("webauthn enabled: {}", server_config.auth.webauthn_enabled);
    tracing::info!(
        "static files enabled: {}",
        server_config.static_files.enabled
    );

    // spawn job runner if enabled (with shared cancellation token)
    let job_runner_handle = if server_config.start_job_runner {
        tracing::info!("spawning job runner task...");
        let token = job_cancellation_token.clone();
        Some(tokio::spawn(async move {
            tracing::info!("job runner started");
            let result = grimoire::jobs::run_job_processor_with_token(token).await;
            if result.success {
                tracing::info!("job runner stopped gracefully");
            } else {
                tracing::error!("job runner failed: {}", result.message);
            }
        }))
    } else {
        tracing::info!("job runner disabled - use CLI to process jobs");
        None
    };

    // start federation endpoint if enabled
    let federation_endpoint = if config
        .federation
        .as_ref()
        .map(|f| f.enabled)
        .unwrap_or(false)
    {
        tracing::info!("starting federation P2P endpoint...");
        match grimoire::federation::transport::start_federation_endpoint().await {
            Ok(endpoint) => {
                tracing::info!(
                    "federation endpoint started, node_id: {}",
                    endpoint.node_id()
                );
                Some(endpoint)
            }
            Err(e) => {
                tracing::error!("failed to start federation endpoint: {}", e);
                None
            }
        }
    } else {
        tracing::debug!("federation disabled");
        None
    };

    // start server with graceful shutdown
    tracing::info!("starting http server on {}:{}", host, port);

    let shutdown_future = async move {
        let _ = shutdown_rx.await;
    };

    start_server(state, &host, port, shutdown_future).await?;

    tracing::info!("server stopped, cleaning up...");

    // close federation endpoint
    if let Some(endpoint) = federation_endpoint {
        tracing::info!("closing federation endpoint...");
        endpoint.close().await;
        tracing::info!("federation endpoint closed");
    }

    // wait for job runner to finish with timeout
    if let Some(handle) = job_runner_handle {
        tracing::info!("waiting for job runner to finish (10s timeout)...");
        match tokio::time::timeout(std::time::Duration::from_secs(10), handle).await {
            Ok(_) => tracing::info!("job runner stopped cleanly"),
            Err(_) => tracing::warn!("job runner did not stop within 10s, continuing shutdown"),
        }
    }

    tracing::info!("shutdown complete");

    Ok(())
}
