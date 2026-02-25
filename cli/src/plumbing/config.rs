//! Configuration management CLI commands

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::config::{create_config, find_config, ConfigValidationResponse, GrimoireConfig};
use grimoire::error::GrimoireError;
use std::path::PathBuf;

#[derive(Subcommand)]
pub enum ConfigAction {
    /// Initialize a new configuration file
    Init {
        /// Output path for config file (default: ./config.jsonc)
        #[arg(long, short = 'o')]
        output: Option<PathBuf>,
        /// Data directory to use (default: ./data)
        #[arg(long, short = 'd')]
        data_dir: Option<PathBuf>,
        /// Overwrite existing config file
        #[arg(long)]
        force: bool,
    },
    /// Validate configuration file (uses global --config flag)
    Validate,
}

/// Handle config commands
pub async fn handle_command(
    action: ConfigAction,
    global_config: Option<std::path::PathBuf>,
) -> CommandOutput<serde_json::Value> {
    match action {
        ConfigAction::Init { output, data_dir, force } => {
            match create_config(output, data_dir, force) {
                Ok(path) => {
                    let message = format!("Config file created: {}", path.display());
                    CommandOutput::success(message, serde_json::json!({
                        "path": path.display().to_string()
                    }))
                }
                Err(e) => {
                    CommandOutput::failure(
                        "Failed to create config",
                        vec![GrimoireError::ProcessingFailed {
                            message: e.to_string(),
                        }
                        .into()],
                        (),
                    )
                }
            }
        }
        ConfigAction::Validate => {
            let path = match find_config(global_config) {
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

            let server_name = config
                .server
                .as_ref()
                .map(|s| s.name.clone())
                .unwrap_or_else(|| "grimoire".to_string());
            let server_version = config
                .server
                .as_ref()
                .map(|s| s.version.clone())
                .unwrap_or_else(|| "unknown".to_string());

            let response = ConfigValidationResponse {
                valid: true,
                config_path: path.display().to_string(),
                server_name,
                server_version,
                data_dir: config.data_dir.display().to_string(),
                database_path: config.database_path().display().to_string(),
            };

            let message = format!("Configuration is valid: {}", path.display());
            CommandOutput::success(message, response)
        }
    }
}
