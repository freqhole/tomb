//! Federation CLI commands
//!
//! Commands for managing P2P federation - syncing users from haruspex,
//! managing peer nodes, etc.

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use dialoguer::{Input, Password};
use grimoire::error::ErrorDetail;
use serde::Serialize;

#[derive(Subcommand)]
pub enum FederationAction {
    /// Set up federation by authenticating to haruspex
    ///
    /// Prompts for haruspex credentials, then stores the refresh token
    /// securely for future use. Run this before using other federation commands.
    Setup,

    /// Sync users from haruspex (Supabase) to freqhole
    ///
    /// Prompts for haruspex credentials, then creates/updates freqhole users
    /// for all members in your groups.
    Sync,

    /// Show federation configuration and setup status
    Status,

    /// Clear stored federation credentials (logout)
    Logout,
}

// Response types for JSON serialization

#[derive(Debug, Serialize)]
struct SetupResponse {
    haruspex_user_id: String,
    email: String,
    credentials_path: String,
}

#[derive(Debug, Serialize)]
struct SyncResponse {
    groups_found: usize,
    members_found: usize,
    users_created: usize,
    users_updated: usize,
    users_skipped: usize,
    peer_nodes_registered: usize,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    errors: Vec<String>,
}

#[derive(Debug, Serialize)]
struct StatusResponse {
    config: Option<ConfigStatus>,
    credentials: CredentialsStatus,
}

#[derive(Debug, Serialize)]
struct ConfigStatus {
    enabled: bool,
    haruspex_url: String,
    auto_create_users: bool,
    default_role: String,
}

#[derive(Debug, Serialize)]
struct CredentialsStatus {
    stored: bool,
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    email: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    haruspex_user_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    created_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_refreshed_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    verified: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    verification_error: Option<String>,
}

#[derive(Debug, Serialize)]
struct LogoutResponse {
    cleared: bool,
}

/// Handle federation commands
pub async fn handle_command(action: FederationAction) -> CommandOutput<serde_json::Value> {
    match action {
        FederationAction::Setup => setup_federation().await,
        FederationAction::Sync => sync_users().await,
        FederationAction::Status => show_status().await,
        FederationAction::Logout => logout(),
    }
}

/// Get federation config or return error
fn get_federation_config() -> Result<&'static grimoire::config::FederationConfig, CommandOutput<serde_json::Value>> {
    let config = grimoire::config::get_config();
    match &config.federation {
        Some(fed) if fed.enabled => Ok(fed),
        Some(_) => Err(CommandOutput::failure(
            "federation is disabled in config - set [federation].enabled = true",
            vec![],
            (),
        )),
        None => Err(CommandOutput::failure(
            "no [federation] section in config",
            vec![],
            (),
        )),
    }
}

/// Prompt for email and password
fn prompt_credentials(haruspex_url: &str) -> Result<(String, String), CommandOutput<serde_json::Value>> {
    // print context for interactive mode
    eprintln!("haruspex url: {}\n", haruspex_url);

    let email: String = Input::new()
        .with_prompt("email")
        .interact_text()
        .map_err(|e| CommandOutput::failure(
            format!("failed to read email: {}", e),
            vec![],
            (),
        ))?;

    let password: String = Password::new()
        .with_prompt("password")
        .interact()
        .map_err(|e| CommandOutput::failure(
            format!("failed to read password: {}", e),
            vec![],
            (),
        ))?;

    Ok((email, password))
}

async fn setup_federation() -> CommandOutput<serde_json::Value> {
    let federation_config = match get_federation_config() {
        Ok(cfg) => cfg,
        Err(e) => return e,
    };

    let (email, password) = match prompt_credentials(&federation_config.haruspex_url) {
        Ok(creds) => creds,
        Err(e) => return e,
    };

    eprintln!("authenticating...");

    match grimoire::federation::setup_federation(federation_config, &email, &password).await {
        Ok(result) => {
            let data = SetupResponse {
                haruspex_user_id: result.haruspex_user_id,
                email: result.email,
                credentials_path: result.credentials_path.display().to_string(),
            };
            CommandOutput::success("federation setup complete", data)
        }
        Err(e) => CommandOutput::failure(
            format!("setup failed: {}", e),
            vec![ErrorDetail::from(e)],
            (),
        ),
    }
}

async fn sync_users() -> CommandOutput<serde_json::Value> {
    let federation_config = match get_federation_config() {
        Ok(cfg) => cfg,
        Err(e) => return e,
    };

    let (email, password) = match prompt_credentials(&federation_config.haruspex_url) {
        Ok(creds) => creds,
        Err(e) => return e,
    };

    eprintln!("signing in...");

    match grimoire::federation::sync_users_from_haruspex(federation_config, &email, &password).await {
        Ok(result) => {
            let data = SyncResponse {
                groups_found: result.stats.groups_found,
                members_found: result.stats.members_found,
                users_created: result.stats.users_created,
                users_updated: result.stats.users_updated,
                users_skipped: result.stats.users_skipped,
                peer_nodes_registered: result.stats.peer_nodes_registered,
                errors: result.stats.errors,
            };

            let message = format!(
                "sync complete: {} groups, {} members, {} created, {} updated",
                result.stats.groups_found,
                result.stats.members_found,
                result.stats.users_created,
                result.stats.users_updated,
            );
            CommandOutput::success(message, data)
        }
        Err(e) => CommandOutput::failure(
            format!("sync failed: {}", e),
            vec![ErrorDetail::from(e)],
            (),
        ),
    }
}

async fn show_status() -> CommandOutput<serde_json::Value> {
    use std::io::Write;

    // show progress for interactive mode
    eprint!("verifying credentials...");
    std::io::stderr().flush().ok();

    let setup_status = grimoire::federation::get_setup_status_verified().await;

    // clear progress
    eprint!("\r                        \r");
    std::io::stderr().flush().ok();

    let config = grimoire::config::get_config();

    let config_status = config.federation.as_ref().map(|fed| ConfigStatus {
        enabled: fed.enabled,
        haruspex_url: fed.haruspex_url.clone(),
        auto_create_users: fed.auto_create_users,
        default_role: fed.default_role.clone(),
    });

    let credentials_status = CredentialsStatus {
        stored: setup_status.credentials_exist,
        path: setup_status.credentials_path.display().to_string(),
        email: setup_status.email,
        haruspex_user_id: setup_status.haruspex_user_id,
        created_at: setup_status.created_at,
        last_refreshed_at: setup_status.last_refreshed_at,
        verified: setup_status.verified,
        verification_error: setup_status.verification_error,
    };

    let data = StatusResponse {
        config: config_status,
        credentials: credentials_status,
    };

    let message = if setup_status.credentials_exist {
        match setup_status.verified {
            Some(true) => "federation configured and credentials valid",
            Some(false) => "federation configured but credentials invalid",
            None => "federation configured, credentials not verified",
        }
    } else {
        "federation configured but no credentials stored"
    };

    CommandOutput::success(message, data)
}

fn logout() -> CommandOutput<serde_json::Value> {
    match grimoire::federation::clear_credentials() {
        Ok(()) => CommandOutput::success(
            "credentials cleared",
            LogoutResponse { cleared: true },
        ),
        Err(e) => CommandOutput::failure(
            format!("failed to clear credentials: {}", e),
            vec![ErrorDetail::from(e)],
            (),
        ),
    }
}
