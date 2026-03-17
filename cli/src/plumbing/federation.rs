//! Federation CLI commands
//!
//! Commands for managing P2P federation - syncing users from haruspex,
//! managing peer nodes, and running the P2P server.

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use dialoguer::{Input, Password};
use grimoire::error::ErrorDetail;
use serde::Serialize;
use tokio::signal;
use tracing::info;

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

    /// Allow a P2P peer to connect by node_id
    ///
    /// Links a peer node_id to a user account. Creates a new user if the
    /// username doesn't exist.
    AllowPeer {
        /// The 64-character hex node_id of the peer to allow
        node_id: String,

        /// Username to associate with this peer (default: peer_<node_id prefix>)
        #[arg(short, long)]
        username: Option<String>,

        /// Role for the user: admin, member, or viewer (default: viewer)
        #[arg(short, long)]
        role: Option<String>,
    },

    /// List pending knock requests from unknown peers
    ListKnocks {
        /// Include all knocks, not just pending
        #[arg(short, long)]
        all: bool,
    },

    /// Accept a knock request - creates user and peer mapping
    AcceptKnock {
        /// ID of the knock request to accept
        id: String,

        /// Override the username from the knock request
        #[arg(short, long)]
        username: Option<String>,

        /// Role for the new user: admin, member, or viewer (default: member)
        #[arg(short, long, default_value = "member")]
        role: String,
    },

    /// Reject a knock request
    RejectKnock {
        /// ID of the knock request to reject
        id: String,
    },

    /// Delete a knock request (allows node to knock again)
    DeleteKnock {
        /// ID of the knock request to delete
        id: String,
    },

    /// Start P2P server to accept incoming connections
    ///
    /// Runs the iroh endpoint with the offal handler, serving the freqhole API
    /// directly without requiring an HTTP server. Use Ctrl+C to stop.
    Serve,
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
    identity: IdentityStatus,
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
struct IdentityStatus {
    keypair_exists: bool,
    keypair_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    node_id: Option<String>,
}

#[derive(Debug, Serialize)]
struct LogoutResponse {
    cleared: bool,
}

#[derive(Debug, Serialize)]
struct AllowPeerResponse {
    user_id: String,
    username: String,
    node_id: String,
    created_user: bool,
}

/// Handle federation commands
pub async fn handle_command(action: FederationAction) -> CommandOutput<serde_json::Value> {
    match action {
        FederationAction::Setup => setup_federation().await,
        FederationAction::Sync => sync_users().await,
        FederationAction::Status => show_status().await,
        FederationAction::Logout => logout(),
        FederationAction::AllowPeer {
            node_id,
            username,
            role,
        } => allow_peer(node_id, username, role).await,
        FederationAction::ListKnocks { all } => list_knocks(all).await,
        FederationAction::AcceptKnock { id, username, role } => {
            accept_knock(id, username, role).await
        }
        FederationAction::RejectKnock { id } => reject_knock(id).await,
        FederationAction::DeleteKnock { id } => delete_knock(id).await,
        FederationAction::Serve => serve_p2p().await,
    }
}

/// Get federation config or return error
fn get_federation_config(
) -> Result<grimoire::config::FederationConfig, CommandOutput<serde_json::Value>> {
    let config = grimoire::config::get_config();
    match config.federation {
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
fn prompt_credentials(
    haruspex_url: &str,
) -> Result<(String, String), CommandOutput<serde_json::Value>> {
    // print context for interactive mode
    eprintln!("haruspex url: {}\n", haruspex_url);

    let email: String = Input::new()
        .with_prompt("email")
        .interact_text()
        .map_err(|e| CommandOutput::failure(format!("failed to read email: {}", e), vec![], ()))?;

    let password: String = Password::new()
        .with_prompt("password")
        .interact()
        .map_err(|e| {
            CommandOutput::failure(format!("failed to read password: {}", e), vec![], ())
        })?;

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

    match grimoire::federation::setup_federation(&federation_config, &email, &password).await {
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

    match grimoire::federation::sync_users_from_haruspex(&federation_config, &email, &password)
        .await
    {
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

    let identity_info = grimoire::federation::get_identity_info();
    let identity_status = IdentityStatus {
        keypair_exists: identity_info.keypair_exists,
        keypair_path: identity_info.keypair_path.display().to_string(),
        node_id: identity_info.node_id,
    };

    let data = StatusResponse {
        config: config_status,
        credentials: credentials_status,
        identity: identity_status,
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
        Ok(()) => CommandOutput::success("credentials cleared", LogoutResponse { cleared: true }),
        Err(e) => CommandOutput::failure(
            format!("failed to clear credentials: {}", e),
            vec![ErrorDetail::from(e)],
            (),
        ),
    }
}

async fn allow_peer(
    node_id: String,
    username: Option<String>,
    role: Option<String>,
) -> CommandOutput<serde_json::Value> {
    use grimoire::users::{CreateUserRequest, UserRole, UserService};

    // validate node_id looks reasonable (64 hex chars)
    if node_id.len() != 64 || !node_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return CommandOutput::failure("invalid node_id: expected 64 hex characters", vec![], ());
    }

    // parse role (default to viewer)
    let user_role = match role.as_deref().unwrap_or("viewer") {
        "admin" => UserRole::Admin,
        "member" => UserRole::Member,
        "viewer" => UserRole::Viewer,
        other => {
            return CommandOutput::failure(
                format!(
                    "invalid role '{}': expected admin, member, or viewer",
                    other
                ),
                vec![],
                (),
            );
        }
    };

    // determine username - use provided or generate from node_id prefix
    let username = username.unwrap_or_else(|| format!("peer_{}", &node_id[..8]));

    let service = UserService::new();

    // try to find existing user by username
    let (user, created_user) = {
        let find_result = service.get_user_by_username(&username).await;
        if let Some(existing) = find_result.data {
            (existing, false)
        } else {
            // create new user
            let request = CreateUserRequest {
                username: username.clone(),
                role: Some(user_role),
                invite_code: None,
            };
            let create_result = service.register_user(&request).await;
            match create_result.data {
                Some(user) => (user, true),
                None => {
                    let err = create_result
                        .errors
                        .first()
                        .map(|e| e.detail.clone())
                        .unwrap_or_else(|| "failed to create user".to_string());
                    return CommandOutput::failure(err, create_result.errors, ());
                }
            }
        }
    };

    // link node_id to user
    let peer_result = service.upsert_peer_node(&user.id, &node_id, None).await;

    if peer_result.data.is_none() {
        let err = peer_result
            .errors
            .first()
            .map(|e| e.detail.clone())
            .unwrap_or_else(|| "failed to link peer node".to_string());
        return CommandOutput::failure(err, peer_result.errors, ());
    }

    let data = AllowPeerResponse {
        user_id: user.id,
        username: user.username,
        node_id,
        created_user,
    };

    let message = if created_user {
        format!("created user '{}' and linked peer node", data.username)
    } else {
        format!("linked peer node to existing user '{}'", data.username)
    };

    CommandOutput::success(message, data)
}

async fn list_knocks(include_all: bool) -> CommandOutput<serde_json::Value> {
    let result = grimoire::federation::knock::list_knocks(include_all).await;

    if !result.success {
        return CommandOutput::failure(result.message, result.errors, ());
    }

    let knocks = result.data.unwrap_or_default();
    let count = knocks.len();
    let message = if include_all {
        format!("{} knock request(s) total", count)
    } else {
        format!("{} pending knock request(s)", count)
    };

    CommandOutput::success(message, knocks)
}

async fn accept_knock(
    knock_id: String,
    username: Option<String>,
    role: String,
) -> CommandOutput<serde_json::Value> {
    use grimoire::federation::knock::ProcessKnockRequest;
    use grimoire::users::UserService;

    let request = ProcessKnockRequest { username, role };

    // get root user for admin_user_id
    let service = UserService::new();
    let admin_user = match service.get_first_root_user().await {
        grimoire::response::GrimoireResponse {
            data: Some(user), ..
        } => user,
        response => {
            return CommandOutput::failure(
                "no root user found - run setup first",
                response.errors,
                (),
            );
        }
    };

    match grimoire::federation::knock::accept_knock(&knock_id, request, &admin_user.id).await {
        Ok(knock) => {
            let message = format!(
                "accepted knock '{}' - created user for node {}",
                knock_id,
                &knock.node_id[..8]
            );
            CommandOutput::success(message, knock)
        }
        Err(e) => CommandOutput::failure(
            format!("failed to accept knock: {}", e),
            vec![ErrorDetail::from(e)],
            (),
        ),
    }
}

async fn reject_knock(knock_id: String) -> CommandOutput<serde_json::Value> {
    use grimoire::users::UserService;

    // get root user for admin_user_id
    let service = UserService::new();
    let admin_user = match service.get_first_root_user().await {
        grimoire::response::GrimoireResponse {
            data: Some(user), ..
        } => user,
        response => {
            return CommandOutput::failure(
                "no root user found - run setup first",
                response.errors,
                (),
            );
        }
    };

    match grimoire::federation::knock::reject_knock(&knock_id, &admin_user.id).await {
        Ok(knock) => {
            let message = format!("rejected knock '{}'", knock_id);
            CommandOutput::success(message, knock)
        }
        Err(e) => CommandOutput::failure(
            format!("failed to reject knock: {}", e),
            vec![ErrorDetail::from(e)],
            (),
        ),
    }
}

async fn delete_knock(knock_id: String) -> CommandOutput<serde_json::Value> {
    match grimoire::federation::knock::delete_knock(&knock_id).await {
        Ok(()) => {
            let message = format!("deleted knock '{}'", knock_id);
            CommandOutput::success(
                message,
                serde_json::json!({ "deleted": true, "id": knock_id }),
            )
        }
        Err(e) => CommandOutput::failure(
            format!("failed to delete knock: {}", e),
            vec![ErrorDetail::from(e)],
            (),
        ),
    }
}

async fn serve_p2p() -> CommandOutput<serde_json::Value> {
    let _federation_config = match get_federation_config() {
        Ok(cfg) => cfg,
        Err(e) => return e,
    };

    info!("starting P2P server...");
    eprintln!("starting P2P server...");

    // start the federation endpoint
    let endpoint = match grimoire::federation::transport::start_federation_endpoint().await {
        Ok(ep) => ep,
        Err(e) => {
            return CommandOutput::failure(
                format!("failed to start P2P endpoint: {}", e),
                vec![ErrorDetail::from(e)],
                (),
            );
        }
    };

    let node_id = endpoint.node_id().to_string();
    info!("P2P server ready, node_id: {}", node_id);
    eprintln!("P2P server ready");
    eprintln!("node_id: {}", node_id);
    eprintln!();
    eprintln!("press Ctrl+C to stop");

    // wait for shutdown signal
    match signal::ctrl_c().await {
        Ok(()) => {
            info!("received shutdown signal");
            eprintln!("\nshutting down...");
        }
        Err(e) => {
            eprintln!("error waiting for shutdown signal: {}", e);
        }
    }

    // graceful shutdown
    endpoint.close().await;
    info!("P2P server stopped");

    CommandOutput::success(
        "P2P server stopped",
        serde_json::json!({ "node_id": node_id }),
    )
}
