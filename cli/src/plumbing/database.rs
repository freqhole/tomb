//! Database operations CLI commands

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;

#[derive(Subcommand)]
pub enum DatabaseAction {
    /// Test database connection
    Test,
    /// Show database information
    Info,
}

/// Handle database commands
pub async fn handle_command(action: DatabaseAction) -> CommandOutput<serde_json::Value> {
    match action {
        DatabaseAction::Test => match grimoire::test_database().await {
            Ok(result) => {
                let message = if result.connection_ok {
                    "Database connection successful"
                } else {
                    "Database connection test failed"
                };
                CommandOutput::success(message, result)
            }
            Err(e) => {
                CommandOutput::failure("Failed to test database connection", vec![e.into()], ())
            }
        },

        DatabaseAction::Info => match grimoire::get_database_info().await {
            Ok(info) => {
                let message = format!("Database: {}", info.database_file);
                CommandOutput::success(message, info)
            }
            Err(e) => CommandOutput::failure("Failed to get database info", vec![e.into()], ()),
        },
    }
}
