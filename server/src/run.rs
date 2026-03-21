//! server runner - entry point for starting the server
//!
//! this module provides a high-level `run_server` function that can be called
//! from the CLI or other entry points (like Tauri)

use std::path::PathBuf;
use std::sync::Arc;

use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

use crate::{start_server, AppState};

/// what services to start
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub enum ServeMode {
    /// start whatever is enabled in config (default)
    #[default]
    Auto,
    /// start HTTP server only (ignores server.enabled config)
    HttpOnly,
    /// start P2P endpoint only (ignores federation.enabled config)
    P2pOnly,
}

/// Server run options
#[derive(Debug, Clone)]
pub struct ServerOptions {
    /// Path to configuration file
    pub config_path: PathBuf,
    /// What services to start
    pub mode: ServeMode,
}

impl Default for ServerOptions {
    fn default() -> Self {
        Self {
            config_path: PathBuf::from("freqhole-config.toml"),
            mode: ServeMode::Auto,
        }
    }
}

/// truncate log file if it exceeds max_lines, keeping only the last max_lines
fn truncate_log_file_if_needed(path: &std::path::Path, max_lines: usize) {
    use std::io::{BufRead, BufReader, Write};

    let file = match std::fs::File::open(path) {
        Ok(f) => f,
        Err(_) => return, // file doesn't exist, nothing to truncate
    };

    let reader = BufReader::new(file);
    let lines: Vec<String> = reader.lines().filter_map(|l| l.ok()).collect();

    if lines.len() <= max_lines {
        return; // file is within limit
    }

    // keep only the last max_lines
    let keep_from = lines.len() - max_lines;
    let truncated: Vec<&str> = lines[keep_from..].iter().map(|s| s.as_str()).collect();

    // write truncated content back
    if let Ok(mut file) = std::fs::File::create(path) {
        for line in truncated {
            let _ = writeln!(file, "{}", line);
        }
    }
}

/// Run the freqhole server
///
/// This is the main entry point for starting the server.
/// It handles:
/// - Loading configuration
/// - Setting up tracing/logging (console + optional file)
/// - Initializing the database
/// - Setting up signal handlers for graceful shutdown
/// - Starting the HTTP server and/or P2P endpoint based on mode
///
/// # Arguments
/// * `options` - Server configuration options
///
/// # Returns
/// Ok(()) on graceful shutdown, Err on fatal error
pub async fn run_server(options: ServerOptions) -> anyhow::Result<()> {
    // set up shutdown channel
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

        // trigger shutdown
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

    // determine what to start based on mode and config
    let start_http = match options.mode {
        ServeMode::Auto => config.server.as_ref().map(|s| s.enabled).unwrap_or(false),
        ServeMode::HttpOnly => true,
        ServeMode::P2pOnly => false,
    };

    let start_p2p = match options.mode {
        ServeMode::Auto => config
            .federation
            .as_ref()
            .map(|f| f.enabled)
            .unwrap_or(false),
        ServeMode::HttpOnly => false,
        ServeMode::P2pOnly => true,
    };

    // validate that we have something to start
    if !start_http && !start_p2p {
        return Err(anyhow::anyhow!(
            "nothing to start: both HTTP server (server.enabled) and P2P endpoint (federation.enabled) are disabled in config"
        ));
    }

    // validate required config sections exist
    if start_http && config.server.is_none() {
        return Err(anyhow::anyhow!(
            "[server] section required in config to start HTTP server"
        ));
    }
    if start_p2p && config.federation.is_none() {
        return Err(anyhow::anyhow!(
            "[federation] section required in config to start P2P endpoint"
        ));
    }

    // initialize tracing with config log level
    // RUST_LOG env var takes full precedence if set
    // otherwise use config level + silence noisy iroh internals
    let log_level = config.logging.level.as_str();
    let filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        tracing_subscriber::EnvFilter::new(format!(
            "{},iroh=error,iroh_relay=error,iroh_quinn=error",
            log_level
        ))
    });

    // set up logging: file OR stdout (not both)
    // if log_file is configured and opens successfully → file only
    // if log_file is empty or fails to open → stdout only
    if let Some(log_path) = config.log_file_path() {
        // truncate log file if it exceeds ~10,000 lines
        truncate_log_file_if_needed(&log_path, 10_000);

        // create parent directory if needed
        if let Some(parent) = log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }

        // set up file appender
        let file = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
            .ok();

        if let Some(file) = file {
            // file logging only (no stdout)
            let file_layer = tracing_subscriber::fmt::layer()
                .with_writer(std::sync::Mutex::new(file))
                .with_ansi(false);

            tracing_subscriber::registry()
                .with(filter)
                .with(file_layer)
                .init();
        } else {
            // file failed to open, fall back to stdout
            eprintln!(
                "warning: could not open log file {:?}, falling back to stdout",
                log_path
            );
            tracing_subscriber::registry()
                .with(filter)
                .with(tracing_subscriber::fmt::layer())
                .init();
        }
    } else {
        // no file logging configured, use stdout
        tracing_subscriber::registry()
            .with(filter)
            .with(tracing_subscriber::fmt::layer())
            .init();
    }

    // check if config needs upgrade
    if let Ok(needs_upgrade) = grimoire::config::config_needs_upgrade(&options.config_path) {
        if needs_upgrade {
            tracing::warn!("");
            tracing::warn!("╔══════════════════════════════════════════════════════════════════╗");
            tracing::warn!("║  CONFIG UPGRADE AVAILABLE!                                       ║");
            tracing::warn!("║                                                                  ║");
            tracing::warn!("║  your config file is using an older format.                      ║");
            tracing::warn!("║  please run this command to upgrade:                             ║");
            tracing::warn!("║                                                                  ║");
            tracing::warn!("║    freqhole config upgrade                                       ║");
            tracing::warn!("║                                                                  ║");
            tracing::warn!("╚══════════════════════════════════════════════════════════════════╝");
            tracing::warn!("");
        }
    }

    tracing::info!("starting freqhole...");
    tracing::info!("config: {}", options.config_path.display());
    tracing::info!("log level: {}", log_level);
    tracing::info!("mode: {:?}", options.mode);
    tracing::info!("start HTTP: {}, start P2P: {}", start_http, start_p2p);

    // initialize database (migrations + views) once at startup
    grimoire::database::initialize()
        .await
        .map_err(|e| anyhow::anyhow!("failed to initialize database: {}", e))?;

    // HTTP server setup (only if starting HTTP)
    let http_state = if start_http {
        // initialize session store from grimoire
        tracing::info!("initializing session store...");
        let session_store = grimoire::sessions::init_session_store()
            .await
            .map_err(|e| anyhow::anyhow!("failed to initialize session store: {}", e))?;

        // get server config
        let server_config = config
            .server
            .as_ref()
            .expect("server config validated above");

        // build app state
        let state = AppState::new(config.clone(), session_store);

        // validate state
        state
            .validate()
            .map_err(|e| anyhow::anyhow!("invalid configuration: {}", e))?;

        tracing::info!("HTTP server configuration validated");
        tracing::info!("webauthn enabled: {}", server_config.auth.webauthn_enabled);
        tracing::info!(
            "static files enabled: {}",
            server_config.static_files.enabled
        );

        Some((state, server_config.host.clone(), server_config.port))
    } else {
        None
    };

    // spawn job runner if enabled (only when running HTTP server)
    let job_runner_handle = if start_http {
        let server_config = config
            .server
            .as_ref()
            .expect("server config validated above");
        if server_config.start_job_runner {
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
        }
    } else {
        None
    };

    // start federation P2P endpoint
    let federation_endpoint = if start_p2p {
        tracing::info!("starting federation P2P endpoint...");
        match grimoire::federation::transport::start_federation_endpoint().await {
            Ok(endpoint) => {
                tracing::info!(
                    "federation endpoint started, node_id: {}",
                    endpoint.node_id()
                );
                // initialize P2P client for outbound connections
                grimoire::federation::p2p_client::set_federation_endpoint(endpoint.endpoint());
                Some(endpoint)
            }
            Err(e) => {
                tracing::error!("failed to start federation endpoint: {}", e);
                return Err(anyhow::anyhow!("failed to start P2P endpoint: {}", e));
            }
        }
    } else {
        tracing::debug!("P2P federation not started");
        None
    };

    // start HTTP server and/or wait for shutdown
    if let Some((state, host, port)) = http_state {
        tracing::info!("starting HTTP server on {}:{}", host, port);

        let shutdown_future = async move {
            let _ = shutdown_rx.await;
        };

        start_server(state, &host, port, shutdown_future).await?;
    } else {
        // P2P only mode - wait for shutdown signal
        tracing::info!("P2P-only mode, waiting for shutdown signal...");
        let _ = shutdown_rx.await;
    }

    tracing::info!("shutting down, cleaning up...");

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
