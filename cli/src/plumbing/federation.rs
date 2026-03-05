//! Federation CLI commands
//!
//! Commands for managing P2P federation - syncing users from haruspex,
//! managing peer nodes, etc.

use clap::Subcommand;

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

pub async fn handle_action(action: FederationAction, json_output: bool) {
    match action {
        FederationAction::Setup => setup_federation(json_output).await,
        FederationAction::Sync => sync_users(json_output).await,
        FederationAction::Status => show_status(json_output).await,
        FederationAction::Logout => logout(json_output),
    }
}

async fn setup_federation(json_output: bool) {
    // get federation config
    let config = grimoire::config::get_config();
    let federation_config = match &config.federation {
        Some(fed) if fed.enabled => fed,
        Some(_) => {
            if json_output {
                println!(
                    "{}",
                    serde_json::json!({"success": false, "error": "federation is disabled in config"})
                );
            } else {
                eprintln!("error: federation is disabled in config");
                eprintln!("set [federation].enabled = true in freqhole-config.toml");
            }
            return;
        }
        None => {
            if json_output {
                println!(
                    "{}",
                    serde_json::json!({"success": false, "error": "no federation config found"})
                );
            } else {
                eprintln!("error: no [federation] section in config");
                eprintln!("see assets/config/freqhole-config.toml for an example");
            }
            return;
        }
    };

    match grimoire::federation::interactive_setup(federation_config).await {
        Ok(result) => {
            if json_output {
                println!(
                    "{}",
                    serde_json::json!({
                        "success": true,
                        "haruspex_user_id": result.haruspex_user_id,
                        "email": result.email,
                        "credentials_path": result.credentials_path.display().to_string()
                    })
                );
            } else {
                println!("{}", result.message);
                println!(
                    "  credentials saved to: {}",
                    result.credentials_path.display()
                );
                println!("  haruspex user id: {}", result.haruspex_user_id);
            }
        }
        Err(e) => {
            let error_msg = e.to_string();
            if json_output {
                println!(
                    "{}",
                    serde_json::json!({"success": false, "error": error_msg})
                );
            } else {
                eprintln!("setup failed: {}", error_msg);
            }
        }
    }
}

async fn sync_users(json_output: bool) {
    // get federation config
    let config = grimoire::config::get_config();
    let federation_config = match &config.federation {
        Some(fed) if fed.enabled => fed,
        Some(_) => {
            if json_output {
                println!(
                    "{}",
                    serde_json::json!({"success": false, "error": "federation is disabled in config"})
                );
            } else {
                eprintln!("error: federation is disabled in config");
                eprintln!("set [federation].enabled = true in freqhole-config.toml");
            }
            return;
        }
        None => {
            if json_output {
                println!(
                    "{}",
                    serde_json::json!({"success": false, "error": "no federation config found"})
                );
            } else {
                eprintln!("error: no [federation] section in config");
                eprintln!("see assets/config/freqhole-config.toml for an example");
            }
            return;
        }
    };

    // perform interactive sync
    match grimoire::federation::interactive_sync(federation_config).await {
        Ok(result) => {
            if json_output {
                println!(
                    "{}",
                    serde_json::json!({
                        "success": true,
                        "stats": {
                            "groups_found": result.stats.groups_found,
                            "members_found": result.stats.members_found,
                            "users_created": result.stats.users_created,
                            "users_updated": result.stats.users_updated,
                            "users_skipped": result.stats.users_skipped,
                            "peer_nodes_registered": result.stats.peer_nodes_registered,
                            "errors": result.stats.errors
                        }
                    })
                );
            } else {
                println!("sync complete:");
                println!("  groups found: {}", result.stats.groups_found);
                println!("  members found: {}", result.stats.members_found);
                println!("  users created: {}", result.stats.users_created);
                println!("  users updated: {}", result.stats.users_updated);
                println!("  users skipped: {}", result.stats.users_skipped);
                println!(
                    "  peer nodes registered: {}",
                    result.stats.peer_nodes_registered
                );
                if !result.stats.errors.is_empty() {
                    println!("  errors:");
                    for err in &result.stats.errors {
                        println!("    - {}", err);
                    }
                }
            }
        }
        Err(e) => {
            let error_msg = e.to_string();
            if json_output {
                println!(
                    "{}",
                    serde_json::json!({"success": false, "error": error_msg})
                );
            } else {
                eprintln!("sync failed: {}", error_msg);
            }
        }
    }
}

async fn show_status(json_output: bool) {
    use std::io::Write;

    let config = grimoire::config::get_config();

    // show "verifying..." message for interactive mode
    if !json_output {
        print!("verifying credentials...");
        std::io::stdout().flush().ok();
    }

    let setup_status = grimoire::federation::get_setup_status_verified().await;

    // clear the "verifying..." line
    if !json_output {
        print!("\r                        \r");
        std::io::stdout().flush().ok();
    }

    if json_output {
        match &config.federation {
            Some(fed) => {
                println!(
                    "{}",
                    serde_json::json!({
                        "config": {
                            "enabled": fed.enabled,
                            "haruspex_url": fed.haruspex_url,
                            "auto_create_users": fed.auto_create_users,
                            "default_role": fed.default_role
                        },
                        "setup": {
                            "credentials_exist": setup_status.credentials_exist,
                            "credentials_path": setup_status.credentials_path.display().to_string(),
                            "email": setup_status.email,
                            "haruspex_user_id": setup_status.haruspex_user_id,
                            "created_at": setup_status.created_at,
                            "last_refreshed_at": setup_status.last_refreshed_at,
                            "verified": setup_status.verified,
                            "verification_error": setup_status.verification_error
                        }
                    })
                );
            }
            None => {
                println!(
                    "{}",
                    serde_json::json!({
                        "config": null,
                        "setup": {
                            "credentials_exist": setup_status.credentials_exist,
                            "credentials_path": setup_status.credentials_path.display().to_string()
                        }
                    })
                );
            }
        }
    } else {
        println!("federation status:\n");

        // config status
        match &config.federation {
            Some(fed) => {
                println!("  config:");
                println!("    enabled: {}", fed.enabled);
                println!("    haruspex url: {}", fed.haruspex_url);
                println!("    auto create users: {}", fed.auto_create_users);
                println!("    default role: {}", fed.default_role);
            }
            None => {
                println!("  config: not configured");
                println!("    add [federation] section to freqhole-config.toml");
            }
        }

        println!();

        // setup status
        println!("  credentials:");
        if setup_status.credentials_exist {
            println!("    stored: yes");
            println!("    path: {}", setup_status.credentials_path.display());
            if let Some(email) = setup_status.email {
                println!("    email: {}", email);
            }
            if let Some(user_id) = setup_status.haruspex_user_id {
                println!("    haruspex user id: {}", user_id);
            }
            if let Some(created) = setup_status.created_at {
                println!("    created at: {}", created);
            }
            if let Some(refreshed) = setup_status.last_refreshed_at {
                println!("    last refreshed: {}", refreshed);
            }

            // show verification result
            match setup_status.verified {
                Some(true) => println!("    verified: yes"),
                Some(false) => {
                    println!("    verified: NO");
                    if let Some(err) = setup_status.verification_error {
                        println!("    error: {}", err);
                    }
                    println!("    run 'freqhole federation setup' to re-authenticate");
                }
                None => {}
            }
        } else {
            println!("    stored: no");
            println!("    run 'freqhole federation setup' to authenticate");
        }
    }
}

fn logout(json_output: bool) {
    match grimoire::federation::clear_credentials() {
        Ok(()) => {
            if json_output {
                println!(
                    "{}",
                    serde_json::json!({"success": true, "message": "credentials cleared"})
                );
            } else {
                println!("credentials cleared");
            }
        }
        Err(e) => {
            let error_msg = e.to_string();
            if json_output {
                println!(
                    "{}",
                    serde_json::json!({"success": false, "error": error_msg})
                );
            } else {
                eprintln!("failed to clear credentials: {}", error_msg);
            }
        }
    }
}
