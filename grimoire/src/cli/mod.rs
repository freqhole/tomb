//! CLI module for grimoire
//!
//! This module is organized into subcommands, each in its own file:
//! - jobs: Job queue management
//! - database: Database operations
//! - music: Music query and manipulation
//! - musicbrainz: MusicBrainz API integration
//! - wordlist: Wordlist generation and validation
//! - users: User management
//! - maintenance: Maintenance operations
//! - analytics: Analytics operations
//! - utils: Shared utilities

use clap::{Parser, Subcommand};

mod analytics;
mod config;
mod database;
mod jobs;
mod maintenance;
mod music;
mod users;
pub mod utils;
mod wordlist;

// Re-export action enums for use in main CLI
pub use analytics::AnalyticsAction;
pub use config::ConfigAction;
pub use database::DatabaseAction;
pub use jobs::JobAction;
pub use maintenance::MaintenanceAction;
pub use music::MusicAction;
pub use users::UserAction;
pub use wordlist::WordlistAction;

use std::path::PathBuf;
use utils::OutputFormat;

#[derive(Parser)]
#[command(name = "grimoire")]
#[command(about = "A CLI for managing the grimoire system", long_about = None)]
pub struct Cli {
    /// Optional path to config file
    #[arg(long, global = true)]
    pub config: Option<PathBuf>,

    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Configuration management
    Config {
        #[command(subcommand)]
        action: ConfigAction,
        /// Output as JSON
        #[arg(long, global = true)]
        json_output: bool,
    },
    /// Job queue management
    Jobs {
        #[command(subcommand)]
        action: JobAction,
        /// Output as JSON
        #[arg(long, global = true)]
        json_output: bool,
    },
    /// Database operations
    Database {
        #[command(subcommand)]
        action: DatabaseAction,
        /// Output as JSON
        #[arg(long, global = true)]
        json_output: bool,
    },
    /// Music query operations
    Music {
        #[command(subcommand)]
        action: MusicAction,
        /// Output as JSON (applies to list/query commands)
        #[arg(long, global = true)]
        json_output: bool,
    },
    /// Wordlist operations
    Wordlist {
        #[command(subcommand)]
        action: WordlistAction,
        /// Output as JSON
        #[arg(long, global = true)]
        json_output: bool,
    },
    /// User management operations
    Users {
        #[command(subcommand)]
        action: UserAction,
        /// Output as JSON
        #[arg(long, global = true)]
        json_output: bool,
    },
    /// Maintenance operations
    Maintenance {
        #[command(subcommand)]
        action: MaintenanceAction,
        /// Output as JSON
        #[arg(long, global = true)]
        json_output: bool,
    },
    /// Analytics operations
    Analytics {
        #[command(subcommand)]
        action: AnalyticsAction,
        /// Output as JSON
        #[arg(long, global = true)]
        json_output: bool,
    },
}

/// Main CLI entry point with pre-parsed args
pub async fn run_cli_with_args(cli: Cli) -> crate::error::GrimoireResult<()> {
    match cli.command {
        Commands::Config {
            action,
            json_output,
        } => {
            let format = OutputFormat::from_json_flag(json_output);
            config::handle_command(action, format).await
        }
        Commands::Jobs {
            action,
            json_output,
        } => {
            let format = OutputFormat::from_json_flag(json_output);
            jobs::handle_command(action, format).await
        }
        Commands::Database {
            action,
            json_output,
        } => {
            let format = OutputFormat::from_json_flag(json_output);
            database::handle_command(action, format).await
        }
        Commands::Music {
            action,
            json_output,
        } => music::handle_command(action, json_output).await,
        Commands::Wordlist {
            action,
            json_output,
        } => {
            let format = OutputFormat::from_json_flag(json_output);
            wordlist::handle_command(action, format).await
        }
        Commands::Users {
            action,
            json_output,
        } => {
            let format = OutputFormat::from_json_flag(json_output);
            users::handle_command(action, format).await
        }
        Commands::Maintenance {
            action,
            json_output,
        } => {
            let format = OutputFormat::from_json_flag(json_output);
            maintenance::handle_command(action, format).await
        }
        Commands::Analytics {
            action,
            json_output,
        } => {
            let format = OutputFormat::from_json_flag(json_output);
            analytics::handle_command(action, format).await
        }
    }
}

/// Main CLI entry point (parses args internally)
pub async fn run_cli() -> crate::error::GrimoireResult<()> {
    let cli = Cli::parse();
    run_cli_with_args(cli).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn test_cli_parsing() {
        // Verify the CLI structure is valid
        Cli::command().debug_assert();
    }
}
