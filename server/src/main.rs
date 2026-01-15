//! server binary entry point

use clap::Parser;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

/// freqhole server
#[derive(Parser, Debug)]
#[command(name = "freqhole-server")]
#[command(about = "freqhole music server")]
struct Args {
    /// path to configuration file
    #[arg(long, short = 'c', default_value = "assets/config/config.jsonc")]
    config: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    // load config first (before tracing)
    grimoire::config::init_config(Some(args.config.clone().into()))
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
    tracing::info!("log level: {}", log_level);

    // initialize session store from grimoire (grimoire handles migrations automatically)
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
    let state = server::AppState::new(config.clone(), session_store);

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

    // spawn job runner if enabled
    if server_config.start_job_runner {
        tracing::info!("spawning job runner task...");
        tokio::spawn(async {
            tracing::info!("job runner started");
            let result = grimoire::jobs::run_job_processor().await;
            if result.success {
                tracing::info!("job runner stopped gracefully");
            } else {
                tracing::error!("job runner failed: {}", result.message);
            }
        });
    } else {
        tracing::info!("job runner disabled - use CLI to process jobs");
    }

    // start server
    tracing::info!("starting http server on {}:{}", host, port);
    server::start_server(state, &host, port).await?;

    Ok(())
}
