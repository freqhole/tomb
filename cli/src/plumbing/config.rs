//! Configuration management CLI commands

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::config::{find_config, ConfigValidationResponse, GrimoireConfig};
use grimoire::error::GrimoireError;

#[derive(Subcommand)]
pub enum ConfigAction {
    /// Validate configuration file
    Validate {
        /// Path to config file (optional, uses default search strategy if not provided)
        #[arg(long)]
        config_path: Option<String>,
    },
}

/// Handle config commands
pub async fn handle_command(action: ConfigAction) -> CommandOutput<serde_json::Value> {
    match action {
        ConfigAction::Validate { config_path } => {
            let path = match find_config(config_path.map(std::path::PathBuf::from)) {
                Ok(p) => p,
                Err(e) => {
                    return CommandOutput::failure(
                        "Failed to find config",
                        vec![GrimoireError::ProcessingFailed {
                            message: e.to_string(),
                        }
                        .into()],
                        (),
                    )
                }
            };

            let config = match GrimoireConfig::load(&path) {
                Ok(c) => c,
                Err(e) => {
                    return CommandOutput::failure(
                        "Failed to load config",
                        vec![GrimoireError::ProcessingFailed {
                            message: e.to_string(),
                        }
                        .into()],
                        (),
                    )
                }
            };

            let response = ConfigValidationResponse {
                valid: true,
                config_path: path.display().to_string(),
                app_name: config.app.name.clone(),
                app_version: config.app.version.clone(),
                data_dir: config.data_dir.display().to_string(),
                database_path: config.database_path().display().to_string(),
            };

            let message = format!("Configuration is valid: {}", path.display());
            CommandOutput::success(message, response)
        }
    }
}
