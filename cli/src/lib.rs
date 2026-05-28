//! freqhole CLI library
//!
//! the binary at `cli/src/main.rs` is a thin wrapper around `run()`.
//! exposing the entrypoint as a library lets other binaries (notably
//! the tauri desktop app) reuse the full cli surface — when launched
//! with arguments — without having to ship a second executable.

pub mod commands;
pub mod plumbing;

use anyhow::Result;
use clap::{Parser, Subcommand};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Parser)]
#[command(name = "rathole")]
#[command(about = "freqhole music server CLI", long_about = None)]
pub struct Cli {
    /// Optional path to config file
    #[arg(long, global = true)]
    pub config: Option<std::path::PathBuf>,

    /// Output as JSON
    #[arg(long, global = true)]
    pub json_output: bool,

    #[command(subcommand)]
    pub command: Option<Commands>,
}

#[derive(Subcommand)]
pub enum Commands {
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

    /// launch rathole TUI, or manage pending remote connections.
    ///
    /// with no subcommand: opens the interactive rathole TUI client.
    /// with a subcommand (add-remote, list-pending, check, remove-pending):
    /// manages the local list of pending remote connection attempts.
    Rathole {
        #[command(subcommand)]
        action: Option<plumbing::RatholeRemoteAction>,
    },
}

/// run the cli to completion. parses argv (or honors the override
/// list when called via `run_with_args`) and dispatches to the
/// matching subcommand. expects to be polled inside a tokio runtime.
pub async fn run() -> Result<()> {
    let cli = Cli::parse();
    run_with(cli).await
}

/// like `run` but accepts a pre-built `Cli` (lets callers inject a
/// custom argv vector — useful for the tauri passthrough where the
/// host process may want to munge args before dispatch).
pub async fn run_with(mut cli: Cli) -> Result<()> {
    // no subcommand → default to launching rathole (the tui client).
    // this lets users just type `rathole` with no args.
    if cli.command.is_none() {
        cli.command = Some(Commands::Rathole { action: None });
    }
    let command = cli.command.expect("command set above");
    // rebuild a local view so the rest of this function can use a
    // non-Option `command` field unchanged.
    struct Cli2 {
        config: Option<std::path::PathBuf>,
        json_output: bool,
        command: Commands,
    }
    let cli = Cli2 {
        config: cli.config,
        json_output: cli.json_output,
        command,
    };

    // first-run wizard: when launching rathole and no config file
    // exists at the resolved path, run the setup wizard before
    // doing anything else. on success the wizard creates the config
    // + db + admin user, and we fall through to the normal init
    // path which just attaches to the freshly-created install.
    if matches!(cli.command, Commands::Rathole { action: None }) {
        let cfg_path = cli
            .config
            .clone()
            .unwrap_or_else(|| std::path::PathBuf::from("freqhole-config.toml"));
        if !cfg_path.exists() {
            match rathole::wizard::run(cfg_path.clone()).await {
                Ok(result) => {
                    eprintln!("setup complete. config: {}", result.config_path);
                    if let Some(api_key) = &result.api_key {
                        eprintln!("admin api key (save this): {api_key}");
                    }
                    if let Some(invite) = &result.invite_code {
                        eprintln!("invite code: {invite}");
                    }
                }
                Err(e) => {
                    return Err(anyhow::anyhow!("setup wizard failed: {e}"));
                }
            }
        }
    }

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
    let is_tui_command = matches!(cli.command, Commands::Rathole { action: None });
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
                // mirror into rathole's in-memory ring buffer so
                // the `/logs` slash command can show recent log
                // lines without reading the on-disk file.
                let ring = rathole::log_buffer::install();
                let ring_layer = tracing_subscriber::fmt::layer()
                    .with_writer(ring)
                    .with_ansi(false);
                let _ = tracing_subscriber::registry()
                    .with(env_filter)
                    .with(file_layer)
                    .with(ring_layer)
                    .try_init();
            }
            Err(e) => {
                eprintln!(
                    "warning: could not open {:?} for logging ({e}); tui logs will be silenced",
                    log_path
                );
                // even without a file, install the ring buffer so
                // /logs still works (in-memory only).
                let ring = rathole::log_buffer::install();
                let ring_layer = tracing_subscriber::fmt::layer()
                    .with_writer(ring)
                    .with_ansi(false);
                let _ = tracing_subscriber::registry()
                    .with(env_filter)
                    .with(ring_layer)
                    .try_init();
            }
        }
    } else {
        let _ = tracing_subscriber::registry()
            .with(env_filter)
            .with(tracing_subscriber::fmt::layer())
            .try_init();
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
        Commands::Rathole { action: None } => {
            rathole::run(rathole::LaunchOpts {
                config: cli.config.clone(),
            })
            .await
            .map_err(|e| anyhow::anyhow!("rathole exited with error: {e}"))?;
        }
        Commands::Rathole { action: Some(action) } => {
            plumbing::handle_rathole_remote(action, json_output).await?;
        }
    }

    Ok(())
}
