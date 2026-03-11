//! Configuration management CLI commands

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::config::{
    config_needs_upgrade, create_config, ensure_server_image_blob, find_config,
    get_binary_version, upgrade_config, ConfigValidationResponse, GrimoireConfig,
};
use grimoire::error::GrimoireError;
use std::path::PathBuf;

#[derive(Subcommand)]
pub enum ConfigAction {
    /// Initialize a new configuration file
    Init {
        /// Output path for config file (default: ./freqhole-config.toml)
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
    /// Check if config needs upgrade (version mismatch)
    CheckUpgrade,
    /// Upgrade config file to current version
    /// merges user values into fresh template, creates backup first
    Upgrade,
    /// Update server image blob for P2P transport
    /// reads server.image_path, creates a media blob, and stores the blob_id in config
    UpdateServerImage,
}

/// Handle config commands
pub async fn handle_command(
    action: ConfigAction,
    global_config: Option<std::path::PathBuf>,
) -> CommandOutput<serde_json::Value> {
    match action {
        ConfigAction::Init {
            output,
            data_dir,
            force,
        } => match create_config(output, data_dir, force) {
            Ok(path) => {
                let message = format!("Config file created: {}", path.display());
                CommandOutput::success(
                    message,
                    serde_json::json!({
                        "path": path.display().to_string()
                    }),
                )
            }
            Err(e) => CommandOutput::failure(
                "Failed to create config",
                vec![GrimoireError::ProcessingFailed {
                    message: e.to_string(),
                }
                .into()],
                (),
            ),
        },
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
        ConfigAction::CheckUpgrade => {
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

            match config_needs_upgrade(&path) {
                Ok(needs_upgrade) => {
                    let binary_version = get_binary_version();
                    let config = GrimoireConfig::load(&path).ok();
                    let config_version = config
                        .and_then(|c| c.server.map(|s| s.version))
                        .unwrap_or_else(|| "unknown".to_string());

                    let message = if needs_upgrade {
                        format!(
                            "config upgrade available: {} -> {}",
                            config_version, binary_version
                        )
                    } else {
                        format!("config is up to date (version {})", binary_version)
                    };

                    CommandOutput::success(
                        message,
                        serde_json::json!({
                            "needs_upgrade": needs_upgrade,
                            "config_version": config_version,
                            "binary_version": binary_version,
                            "config_path": path.display().to_string()
                        }),
                    )
                }
                Err(e) => CommandOutput::failure(
                    "Failed to check config version",
                    vec![GrimoireError::ProcessingFailed {
                        message: e.to_string(),
                    }
                    .into()],
                    (),
                ),
            }
        }
        ConfigAction::Upgrade => {
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

            match upgrade_config(&path) {
                Ok(result) => {
                    let message = format!(
                        "config upgraded: {} -> {} (backup: {})",
                        result.old_version,
                        result.new_version,
                        result.backup_path.display()
                    );
                    CommandOutput::success(
                        message,
                        serde_json::json!({
                            "old_version": result.old_version,
                            "new_version": result.new_version,
                            "backup_path": result.backup_path.display().to_string(),
                            "config_path": path.display().to_string()
                        }),
                    )
                }
                Err(e) => CommandOutput::failure(
                    "Failed to upgrade config",
                    vec![GrimoireError::ProcessingFailed {
                        message: e.to_string(),
                    }
                    .into()],
                    (),
                ),
            }
        }
        ConfigAction::UpdateServerImage => {
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

            match ensure_server_image_blob(&path).await {
                Ok(blob_id) => {
                    let message = format!("Server image blob created: {}", blob_id);
                    CommandOutput::success(
                        message,
                        serde_json::json!({
                            "blob_id": blob_id,
                            "config_path": path.display().to_string()
                        }),
                    )
                }
                Err(e) => CommandOutput::failure(
                    "Failed to update server image blob",
                    vec![GrimoireError::ProcessingFailed {
                        message: e.to_string(),
                    }
                    .into()],
                    (),
                ),
            }
        }
    }
}
