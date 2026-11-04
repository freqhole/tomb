//! Configuration management CLI commands

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::config::{
    config_needs_upgrade, create_config, find_config, get_binary_version, ConfigValidationResponse,
    GrimoireConfig,
};
use grimoire::error::GrimoireError;
use std::path::PathBuf;

#[derive(Subcommand)]
pub enum ConfigAction {
    /// inspect, queue, apply or cancel a restart-time storage change
    Storage {
        #[command(subcommand)]
        action: StorageAction,
    },
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
}

#[derive(Subcommand)]
pub enum StorageAction {
    /// inspect files and collisions without changing anything
    Preview {
        #[arg(value_enum)]
        operation: grimoire::storage_migration::Operation,
        destination: PathBuf,
    },
    /// queue a change; close all apps, then run `config storage apply`
    Queue {
        #[arg(value_enum)]
        operation: grimoire::storage_migration::Operation,
        destination: PathBuf,
        /// keep differing media files under different names
        #[arg(long)]
        merge: bool,
        /// must be exactly "move my storage"
        #[arg(long)]
        confirm: String,
    },
    /// execute/resume the queued change while all other apps are stopped
    Apply,
    /// cancel a queued change only if copying has not started
    Cancel,
    /// change only where future music/video fetches are saved
    AssignFetch { destination: PathBuf },
    /// verify canonical sources without modifying the transport index
    AuditReferences {
        /// register verified sources in the transport index; close all apps first
        #[arg(long)]
        repair: bool,
    },
}

fn storage_command(
    action: StorageAction,
    config: Option<PathBuf>,
) -> anyhow::Result<serde_json::Value> {
    use grimoire::storage_migration as storage;
    let path = find_config(config)?;
    match action {
        StorageAction::Preview {
            operation,
            destination,
        } => Ok(serde_json::to_value(storage::preview(
            &path,
            operation,
            &destination,
        )?)?),
        StorageAction::Queue {
            operation,
            destination,
            merge,
            confirm,
        } => Ok(serde_json::to_value(storage::schedule(
            &path,
            operation,
            &destination,
            merge,
            &confirm,
        )?)?),
        StorageAction::Apply => {
            storage::prepare_startup(&path)?;
            Ok(
                serde_json::json!({"message": "storage is ready; select-only changes may require setup"}),
            )
        }
        StorageAction::Cancel => {
            storage::cancel(&path)?;
            Ok(serde_json::json!({"message": "unstarted storage change cancelled"}))
        }
        StorageAction::AssignFetch { destination } => {
            let path = storage::assign_fetch_directory(&path, &destination)?;
            Ok(
                serde_json::json!({"destination": path, "message": "future fetches only; existing files were not moved"}),
            )
        }
        StorageAction::AuditReferences { repair } => Ok(serde_json::to_value(
            storage::audit_references(&path, repair)?,
        )?),
    }
}

/// Handle config commands
pub async fn handle_command(
    action: ConfigAction,
    global_config: Option<std::path::PathBuf>,
) -> CommandOutput<serde_json::Value> {
    match action {
        ConfigAction::Storage { action } => match storage_command(action, global_config) {
            Ok(data) => {
                let errors: Vec<_> = data
                    .get("entries")
                    .and_then(|v| v.as_array())
                    .into_iter()
                    .flatten()
                    .filter_map(|entry| {
                        entry.get("error").and_then(|v| v.as_str()).map(|error| {
                            GrimoireError::Validation {
                                field: "reference".into(),
                                message: error.into(),
                            }
                            .into()
                        })
                    })
                    .collect();
                if errors.is_empty() {
                    CommandOutput::success("storage command complete", data)
                } else {
                    CommandOutput::failure(
                        "some references could not be resolved; no source files were deleted",
                        errors,
                        data,
                    )
                }
            }
            Err(error) => CommandOutput::failure(
                "storage command failed",
                vec![GrimoireError::Validation {
                    field: "storage".into(),
                    message: format!("{error:#}"),
                }
                .into()],
                (),
            ),
        },
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
            let path = match find_config(global_config.clone()) {
                Ok(p) => p,
                Err(e) => {
                    return CommandOutput::failure(
                        "failed to find config",
                        vec![GrimoireError::ProcessingFailed {
                            message: e.to_string(),
                        }
                        .into()],
                        (),
                    )
                }
            };

            // migration failures/skips are still an overall command success:
            // the config upgrade itself succeeded, and the outcome fields
            // carry the migration detail.
            match grimoire::upgrade::upgrade_config_and_migrate(&path).await {
                Ok(outcome) => {
                    let message = grimoire::upgrade::describe_outcome(&outcome);
                    CommandOutput::success(
                        message,
                        serde_json::json!({
                            "old_version": outcome.config.old_version,
                            "new_version": outcome.config.new_version,
                            "backup_path": outcome.config.backup_path.display().to_string(),
                            "config_path": path.display().to_string(),
                            "haruspex_migration": serde_json::to_value(&outcome.haruspex)
                                .unwrap_or(serde_json::Value::Null),
                            "reliquary_migration": serde_json::to_value(&outcome.reliquary)
                                .unwrap_or(serde_json::Value::Null),
                            "radio_encode_args_migration": serde_json::to_value(&outcome.radio_encode_args)
                                .unwrap_or(serde_json::Value::Null),
                            "blake3_backfill_migration": serde_json::to_value(&outcome.blake3_backfill)
                                .unwrap_or(serde_json::Value::Null),
                            "contentless_blob_cleanup_migration": serde_json::to_value(&outcome.contentless_blob_cleanup)
                                .unwrap_or(serde_json::Value::Null),
                        }),
                    )
                }
                Err(e) => CommandOutput::failure(
                    "failed to upgrade config",
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

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[test]
    fn parses_reference_audit_and_explicit_repair() {
        for repair in [false, true] {
            let mut args = vec!["freqhole", "config", "storage", "audit-references"];
            if repair {
                args.push("--repair");
            }
            let parsed = crate::Cli::try_parse_from(args).unwrap();
            assert!(matches!(
                parsed.command,
                Some(crate::Commands::Config {
                    action: ConfigAction::Storage {
                        action: StorageAction::AuditReferences { repair: actual }
                    }
                }) if actual == repair
            ));
        }
    }
}
