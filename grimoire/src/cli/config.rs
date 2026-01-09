//! Configuration management CLI commands

use crate::cli::utils::{CommandOutput, OutputFormat};
use crate::config::{find_config, ConfigValidationResponse, GrimoireConfig};
use crate::error::{GrimoireError, GrimoireResult};
use clap::Subcommand;

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
pub async fn handle_command(action: ConfigAction, format: OutputFormat) -> GrimoireResult<()> {
    match action {
        ConfigAction::Validate { config_path } => {
            let path = find_config(config_path.map(std::path::PathBuf::from)).map_err(|e| {
                GrimoireError::ProcessingFailed {
                    message: format!("Failed to find config: {}", e),
                }
            })?;

            let config =
                GrimoireConfig::load(&path).map_err(|e| GrimoireError::ProcessingFailed {
                    message: format!("Failed to load config: {}", e),
                })?;

            let response = ConfigValidationResponse {
                valid: true,
                config_path: path.display().to_string(),
                app_name: config.app.name.clone(),
                app_version: config.app.version.clone(),
                data_dir: config.data_dir.display().to_string(),
                database_path: config.database_path().display().to_string(),
            };

            let message = format!("Configuration is valid: {}", path.display());
            let output = CommandOutput::success(message, response);
            print!("{}", output.format(format));
        }
    }

    Ok(())
}
