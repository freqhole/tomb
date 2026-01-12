//! Freqhole CLI
//!
//! User-friendly CLI for Freqhole music server
//! - Setup: One-time setup command for initial configuration
//! - Plumbing: All existing CLI commands (machine-readable, JSON output)

mod commands;
mod plumbing;

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "freqhole")]
#[command(about = "Freqhole music server CLI", long_about = None)]
struct Cli {
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
        #[arg(long, global = true)]
        json_output: bool,
        /// Optional path to config file
        #[arg(long, global = true)]
        config: Option<std::path::PathBuf>,
    },

    /// Job queue management
    Jobs {
        #[command(subcommand)]
        action: plumbing::JobAction,
        /// Output as JSON
        #[arg(long, global = true)]
        json_output: bool,
        /// Optional path to config file
        #[arg(long, global = true)]
        config: Option<std::path::PathBuf>,
    },

    /// Database operations
    Database {
        #[command(subcommand)]
        action: plumbing::DatabaseAction,
        /// Output as JSON
        #[arg(long, global = true)]
        json_output: bool,
        /// Optional path to config file
        #[arg(long, global = true)]
        config: Option<std::path::PathBuf>,
    },

    /// Music query operations
    Music {
        #[command(subcommand)]
        action: plumbing::MusicAction,
        /// Output as JSON (applies to list/query commands)
        #[arg(long, global = true)]
        json_output: bool,
        /// Optional path to config file
        #[arg(long, global = true)]
        config: Option<std::path::PathBuf>,
    },

    /// Wordlist operations
    Wordlist {
        #[command(subcommand)]
        action: plumbing::WordlistAction,
        /// Output as JSON
        #[arg(long, global = true)]
        json_output: bool,
        /// Optional path to config file
        #[arg(long, global = true)]
        config: Option<std::path::PathBuf>,
    },

    /// User management operations
    Users {
        #[command(subcommand)]
        action: plumbing::UserAction,
        /// Output as JSON
        #[arg(long, global = true)]
        json_output: bool,
        /// Optional path to config file
        #[arg(long, global = true)]
        config: Option<std::path::PathBuf>,
    },

    /// Maintenance operations
    Maintenance {
        #[command(subcommand)]
        action: plumbing::MaintenanceAction,
        /// Output as JSON
        #[arg(long, global = true)]
        json_output: bool,
        /// Optional path to config file
        #[arg(long, global = true)]
        config: Option<std::path::PathBuf>,
    },

    /// Analytics operations
    Analytics {
        #[command(subcommand)]
        action: plumbing::AnalyticsAction,
        /// Output as JSON
        #[arg(long, global = true)]
        json_output: bool,
        /// Optional path to config file
        #[arg(long, global = true)]
        config: Option<std::path::PathBuf>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Setup(args) => {
            commands::setup::run(args).await?;
        }
        Commands::Config {
            action,
            json_output,
            config,
        } => {
            plumbing::handle_config(action, json_output, config).await?;
        }
        Commands::Jobs {
            action,
            json_output,
            config,
        } => {
            plumbing::handle_jobs(action, json_output, config).await?;
        }
        Commands::Database {
            action,
            json_output,
            config,
        } => {
            plumbing::handle_database(action, json_output, config).await?;
        }
        Commands::Music {
            action,
            json_output,
            config,
        } => {
            plumbing::handle_music(action, json_output, config).await?;
        }
        Commands::Wordlist {
            action,
            json_output,
            config,
        } => {
            plumbing::handle_wordlist(action, json_output, config).await?;
        }
        Commands::Users {
            action,
            json_output,
            config,
        } => {
            plumbing::handle_users(action, json_output, config).await?;
        }
        Commands::Maintenance {
            action,
            json_output,
            config,
        } => {
            plumbing::handle_maintenance(action, json_output, config).await?;
        }
        Commands::Analytics {
            action,
            json_output,
            config,
        } => {
            plumbing::handle_analytics(action, json_output, config).await?;
        }
    }

    Ok(())
}
