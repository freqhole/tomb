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
mod dir_tags;
mod federation;
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
pub use dir_tags::DirTagsAction;
pub use federation::FederationAction;
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
    /// Directory tag rules (auto-tag albums based on file location)
    DirTags {
        #[command(subcommand)]
        action: DirTagsAction,
        /// Output as JSON
        #[arg(long, global = true)]
        json_output: bool,
    },
}

// Public handler functions for use in main.rs
// Config must be initialized before calling these handlers (done in main.rs)

pub async fn handle_config(
    action: ConfigAction,
    json_output: bool,
    global_config: Option<std::path::PathBuf>,
) -> anyhow::Result<()> {
    let format = OutputFormat::from_json_flag(json_output);
    let output = config::handle_command(action, global_config).await;
    utils::print_and_exit(output, format);
}

pub async fn handle_jobs(action: JobAction, json_output: bool) -> anyhow::Result<()> {
    let format = OutputFormat::from_json_flag(json_output);
    let output = jobs::handle_command(action).await;
    utils::print_and_exit(output, format);
}

pub async fn handle_database(action: DatabaseAction, json_output: bool) -> anyhow::Result<()> {
    let format = OutputFormat::from_json_flag(json_output);
    let output = database::handle_command(action).await;
    utils::print_and_exit(output, format);
}

pub async fn handle_music(action: MusicAction, json_output: bool) -> anyhow::Result<()> {
    let format = OutputFormat::from_json_flag(json_output);
    let output = music::handle_command(action).await;
    utils::print_and_exit(output, format);
}

pub async fn handle_wordlist(action: WordlistAction, json_output: bool) -> anyhow::Result<()> {
    let format = OutputFormat::from_json_flag(json_output);
    let output = wordlist::handle_command(action).await;
    utils::print_and_exit(output, format);
}

pub async fn handle_users(action: UserAction, json_output: bool) -> anyhow::Result<()> {
    let format = OutputFormat::from_json_flag(json_output);
    let output = users::handle_command(action).await;
    utils::print_and_exit(output, format);
}

pub async fn handle_maintenance(
    action: MaintenanceAction,
    json_output: bool,
    global_config: Option<std::path::PathBuf>,
) -> anyhow::Result<()> {
    let format = OutputFormat::from_json_flag(json_output);
    let output = maintenance::handle_command(action, global_config).await;
    utils::print_and_exit(output, format);
}

pub async fn handle_analytics(action: AnalyticsAction, json_output: bool) -> anyhow::Result<()> {
    let format = OutputFormat::from_json_flag(json_output);
    let output = analytics::handle_command(action).await;
    utils::print_and_exit(output, format);
}

pub async fn handle_dir_tags(action: DirTagsAction, json_output: bool) -> anyhow::Result<()> {
    let format = OutputFormat::from_json_flag(json_output);
    let output = dir_tags::handle_command(action).await;
    utils::print_and_exit(output, format);
}

pub async fn handle_federation(action: FederationAction, json_output: bool) -> anyhow::Result<()> {
    let format = OutputFormat::from_json_flag(json_output);
    let output = federation::handle_command(action).await;
    utils::print_and_exit(output, format);
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
