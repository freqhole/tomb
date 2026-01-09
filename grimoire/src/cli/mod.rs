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
mod database;
mod jobs;
mod maintenance;
mod music;
pub mod output;
mod users;
mod utils;
mod wordlist;

// Re-export action enums for use in main CLI
pub use analytics::AnalyticsAction;
pub use database::DatabaseAction;
pub use jobs::JobAction;
pub use maintenance::MaintenanceAction;
pub use music::MusicAction;
pub use users::UserAction;
pub use wordlist::WordlistAction;

#[derive(Parser)]
#[command(name = "grimoire")]
#[command(about = "A CLI for managing the grimoire system", long_about = None)]
pub struct Cli {
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Subcommand)]
pub enum Commands {
    /// Job queue management
    Jobs {
        #[command(subcommand)]
        action: JobAction,
    },
    /// Database operations
    Database {
        #[command(subcommand)]
        action: DatabaseAction,
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
    },
    /// User management operations
    Users {
        #[command(subcommand)]
        action: UserAction,
    },
    /// Maintenance operations
    Maintenance {
        #[command(subcommand)]
        action: MaintenanceAction,
    },
    /// Analytics operations
    Analytics {
        #[command(subcommand)]
        action: AnalyticsAction,
    },
}

/// Main CLI entry point
pub async fn run_cli() -> crate::error::GrimoireResult<()> {
    use clap::Parser;
    let cli = Cli::parse();

    match cli.command {
        Commands::Jobs { action } => jobs::handle_command(action).await,
        Commands::Database { action } => database::handle_command(action).await,
        Commands::Music {
            action,
            json_output,
        } => music::handle_command(action, json_output).await,
        Commands::Wordlist { action } => wordlist::handle_command(action).await,
        Commands::Users { action } => users::handle_command(action).await,
        Commands::Maintenance { action } => maintenance::handle_command(action).await,
        Commands::Analytics { action } => analytics::handle_command(action).await,
    }
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
