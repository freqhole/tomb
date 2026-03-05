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
        /// Output as JSON
        #[arg(long)]
        json_output: bool,
    },

    /// Job queue management
    Jobs {
        #[command(subcommand)]
        action: plumbing::JobAction,
        /// Output as JSON
        #[arg(long)]
        json_output: bool,
    },

    /// Database operations
    Database {
        #[command(subcommand)]
        action: plumbing::DatabaseAction,
        /// Output as JSON
        #[arg(long)]
        json_output: bool,
    },

    /// Music query operations
    Music {
        #[command(subcommand)]
        action: plumbing::MusicAction,
        /// Output as JSON (applies to list/query commands)
        #[arg(long)]
        json_output: bool,
    },

    /// Wordlist operations
    Wordlist {
        #[command(subcommand)]
        action: plumbing::WordlistAction,
        /// Output as JSON
        #[arg(long)]
        json_output: bool,
    },

    /// User management operations
    Users {
        #[command(subcommand)]
        action: plumbing::UserAction,
        /// Output as JSON
        #[arg(long)]
        json_output: bool,
    },

    /// Maintenance operations
    Maintenance {
        #[command(subcommand)]
        action: plumbing::MaintenanceAction,
        /// Output as JSON
        #[arg(long)]
        json_output: bool,
    },

    /// Analytics operations
    Analytics {
        #[command(subcommand)]
        action: plumbing::AnalyticsAction,
        /// Output as JSON
        #[arg(long)]
        json_output: bool,
    },

    /// Directory tag rules (auto-tag albums based on file location)
    DirTags {
        #[command(subcommand)]
        action: plumbing::DirTagsAction,
        /// Output as JSON
        #[arg(long)]
        json_output: bool,
    },

    /// Federation (P2P) operations - sync users from haruspex
    Federation {
        #[command(subcommand)]
        action: plumbing::FederationAction,
        /// Output as JSON
        #[arg(long)]
        json_output: bool,
    },

    /// Start the HTTP server
    Server {
        /// Path to configuration file (overrides --config global flag)
        #[arg(long, short = 'c')]
        config: Option<std::path::PathBuf>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Server command handles its own initialization
    if let Commands::Server { config } = cli.command {
        let config_path = config
            .or(cli.config)
            .unwrap_or_else(|| std::path::PathBuf::from("freqhole-config.toml"));

        let options = server::ServerOptions { config_path };
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

        // initialize database (migrations + views) once at startup
        grimoire::database::initialize()
            .await
            .map_err(|e| anyhow::anyhow!("Failed to initialize database: {}", e))?;
    }

    // Initialize tracing (use config log level if available, else default to "info")
    let log_level = if needs_init {
        grimoire::config::get_config().logging.level.as_str()
    } else {
        "info"
    };
    let env_filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new(log_level));

    tracing_subscriber::registry()
        .with(env_filter)
        .with(tracing_subscriber::fmt::layer())
        .init();

    match cli.command {
        Commands::Setup(args) => {
            commands::setup::run(args).await?;
        }
        Commands::Config {
            action,
            json_output,
        } => {
            plumbing::handle_config(action, json_output, cli.config.clone()).await?;
        }
        Commands::Jobs {
            action,
            json_output,
        } => {
            plumbing::handle_jobs(action, json_output).await?;
        }
        Commands::Database {
            action,
            json_output,
        } => {
            plumbing::handle_database(action, json_output).await?;
        }
        Commands::Music {
            action,
            json_output,
        } => {
            plumbing::handle_music(action, json_output).await?;
        }
        Commands::Wordlist {
            action,
            json_output,
        } => {
            plumbing::handle_wordlist(action, json_output).await?;
        }
        Commands::Users {
            action,
            json_output,
        } => {
            plumbing::handle_users(action, json_output).await?;
        }
        Commands::Maintenance {
            action,
            json_output,
        } => {
            plumbing::handle_maintenance(action, json_output).await?;
        }
        Commands::Analytics {
            action,
            json_output,
        } => {
            plumbing::handle_analytics(action, json_output).await?;
        }
        Commands::DirTags {
            action,
            json_output,
        } => {
            plumbing::handle_dir_tags(action, json_output).await?;
        }
        Commands::Federation {
            action,
            json_output,
        } => {
            plumbing::handle_federation(action, json_output).await?;
        }
        Commands::Server { .. } => {
            // handled above with early return
            unreachable!()
        }
    }

    Ok(())
}
