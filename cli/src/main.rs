//! FREQHOLE CLI
//!
//! CLI for FREQHOLE server
//! - Setup: One-time setup command for initial configuration
//! - Plumbing: CLI commands wrapping grimoire public API

mod commands;
mod plumbing;

use anyhow::Result;
use clap::{Parser, Subcommand};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Parser)]
#[command(name = "freqhole")]
#[command(about = "freqhole music server CLI", long_about = None)]
struct Cli {
    /// Optional path to config file
    #[arg(long, global = true)]
    config: Option<std::path::PathBuf>,

    /// Output as JSON
    #[arg(long, global = true)]
    json_output: bool,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Initial setup (config, database, wordlist)
    Setup(commands::setup::SetupArgs),

    /// Configuration management
    Config {
        #[command(subcommand)]
        action: plumbing::ConfigAction,
    },

    /// Job queue management
    Jobs {
        #[command(subcommand)]
        action: plumbing::JobAction,
    },

    /// Database operations
    Database {
        #[command(subcommand)]
        action: plumbing::DatabaseAction,
    },

    /// Music query operations
    Music {
        #[command(subcommand)]
        action: plumbing::MusicAction,
    },

    /// Wordlist operations
    Wordlist {
        #[command(subcommand)]
        action: plumbing::WordlistAction,
    },

    /// User management operations
    Users {
        #[command(subcommand)]
        action: plumbing::UserAction,
    },

    /// Maintenance operations
    Maintenance {
        #[command(subcommand)]
        action: plumbing::MaintenanceAction,
    },

    /// Analytics operations
    Analytics {
        #[command(subcommand)]
        action: plumbing::AnalyticsAction,
    },

    /// Directory tag rules (auto-tag albums based on file location)
    DirTags {
        #[command(subcommand)]
        action: plumbing::DirTagsAction,
    },

    /// Federation (P2P) operations - sync users from haruspex
    Federation {
        #[command(subcommand)]
        action: plumbing::FederationAction,
    },

    /// Blob operations (blake3 hashes for P2P streaming)
    Blobz {
        #[command(subcommand)]
        action: plumbing::BlobzAction,
    },

    /// Sync operations (send-to-remote: album/song/playlist receive routes)
    Sync {
        #[command(subcommand)]
        action: plumbing::SyncAction,
    },

    /// Radio (live audio streaming over iroh)
    Radio {
        #[command(subcommand)]
        action: plumbing::RadioAction,
    },

    /// Rust rodio player daemon (plays audio on this machine)
    #[cfg(feature = "rodio-playback")]
    Player {
        #[command(subcommand)]
        action: plumbing::PlayerAction,
    },

    /// Start HTTP server and/or P2P endpoint based on config
    Serve {
        /// Path to configuration file (overrides --config global flag)
        #[arg(long, short = 'c')]
        config: Option<std::path::PathBuf>,
    },

    /// Start HTTP server only (ignores server.enabled config)
    Http {
        /// Path to configuration file (overrides --config global flag)
        #[arg(long, short = 'c')]
        config: Option<std::path::PathBuf>,
    },

    /// Start P2P endpoint only (ignores federation.enabled config)
    P2p {
        /// Path to configuration file (overrides --config global flag)
        #[arg(long, short = 'c')]
        config: Option<std::path::PathBuf>,
    },

    /// Launch rathole — terminal-ui freqhole client (m0)
    Rathole,
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // server commands handle their own initialization
    let serve_mode = match &cli.command {
        Commands::Serve { config } => Some((config.clone(), server::ServeMode::Auto)),
        Commands::Http { config } => Some((config.clone(), server::ServeMode::HttpOnly)),
        Commands::P2p { config } => Some((config.clone(), server::ServeMode::P2pOnly)),
        _ => None,
    };

    if let Some((config, mode)) = serve_mode {
        let config_path = config
            .or(cli.config)
            .unwrap_or_else(|| std::path::PathBuf::from("freqhole-config.toml"));

        let options = server::ServerOptions { config_path, mode };
        return server::run_server(options).await;
    }

    // Check if this command needs config/database initialization
    let needs_init = !matches!(
        cli.command,
        Commands::Setup(_)
            | Commands::Config {
                action: plumbing::ConfigAction::Init { .. },
                ..
            }
            | Commands::Config {
                action: plumbing::ConfigAction::Validate { .. },
                ..
            }
    );

    // Initialize config and database for most commands
    if needs_init {
        grimoire::init_config(cli.config.clone())
            .map_err(|e| anyhow::anyhow!("Failed to initialize config: {}", e))?;

        // initialize database (pool warmup + migrations + views) once at startup
        grimoire::database::initialize()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to initialize database: {}", e))?;
        grimoire::database::run_migrations()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to run migrations: {}", e))?;
    }

    // Initialize tracing (use config log level if available, else default to "info")
    // Note: file logging is handled by server::run_server() for the server command
    let log_level = if needs_init {
        grimoire::config::get_config().logging.level.clone()
    } else {
        "info".to_string()
    };
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| {
        // start with the configured log level, then suppress noisy internal
        // warnings from samod's connection lifecycle (benign "nonexistent
        // connection" warnings that fire during normal sync churn)
        tracing_subscriber::EnvFilter::new(format!(
            "{},samod_core::actors::hub::state=error,samod_core::actors::hub::connection=error,noq_proto::connection=error",
            log_level
        ))
    });

    // tui commands (rathole) take over the terminal, so logging to stdout
    // would corrupt the rendered ui. write to <data_dir>/rathole.log instead.
    let is_tui_command = matches!(cli.command, Commands::Rathole);
    if is_tui_command && needs_init {
        let log_path = grimoire::config::get_config().data_dir.join("rathole.log");
        if let Some(parent) = log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        match std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)
        {
            Ok(file) => {
                let file_layer = tracing_subscriber::fmt::layer()
                    .with_writer(std::sync::Mutex::new(file))
                    .with_ansi(false);
                tracing_subscriber::registry()
                    .with(env_filter)
                    .with(file_layer)
                    .init();
            }
            Err(e) => {
                eprintln!(
                    "warning: could not open {:?} for logging ({e}); tui logs will be silenced",
                    log_path
                );
                // install a no-op subscriber so tracing macros don't write
                // anywhere — corrupting the tui is worse than missing logs.
                tracing_subscriber::registry().with(env_filter).init();
            }
        }
    } else {
        tracing_subscriber::registry()
            .with(env_filter)
            .with(tracing_subscriber::fmt::layer())
            .init();
    }

    let json_output = cli.json_output;

    match cli.command {
        Commands::Setup(args) => {
            commands::setup::run(args).await?;
        }
        Commands::Config { action } => {
            plumbing::handle_config(action, json_output, cli.config.clone()).await?;
        }
        Commands::Jobs { action } => {
            plumbing::handle_jobs(action, json_output).await?;
        }
        Commands::Database { action } => {
            plumbing::handle_database(action, json_output).await?;
        }
        Commands::Music { action } => {
            plumbing::handle_music(action, json_output).await?;
        }
        Commands::Wordlist { action } => {
            plumbing::handle_wordlist(action, json_output).await?;
        }
        Commands::Users { action } => {
            plumbing::handle_users(action, json_output).await?;
        }
        Commands::Maintenance { action } => {
            plumbing::handle_maintenance(action, json_output, cli.config.clone()).await?;
        }
        Commands::Analytics { action } => {
            plumbing::handle_analytics(action, json_output).await?;
        }
        Commands::DirTags { action } => {
            plumbing::handle_dir_tags(action, json_output).await?;
        }
        Commands::Federation { action } => {
            plumbing::handle_federation(action, json_output).await?;
        }
        Commands::Blobz { action } => {
            plumbing::handle_blobz(action, json_output).await?;
        }
        Commands::Sync { action } => {
            plumbing::handle_sync(action, json_output).await?;
        }
        Commands::Radio { action } => {
            plumbing::handle_radio(action, json_output).await?;
        }
        #[cfg(feature = "rodio-playback")]
        Commands::Player { action } => {
            plumbing::handle_player(action, json_output).await?;
        }
        Commands::Serve { .. } | Commands::Http { .. } | Commands::P2p { .. } => {
            // handled above with early return
            unreachable!()
        }
        Commands::Rathole => {
            rathole::run(rathole::LaunchOpts {
                config: cli.config.clone(),
            })
            .await
            .map_err(|e| anyhow::anyhow!("rathole exited with error: {e}"))?;
        }
    }

    Ok(())
}
