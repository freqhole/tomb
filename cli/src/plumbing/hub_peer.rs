//! hub peer CLI commands — start and manage the reliquary hub peer.

use clap::Subcommand;
use grimoire::error::ErrorDetail;
use serde::Serialize;
use tokio::signal;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use super::utils::CommandOutput;

#[derive(Subcommand)]
pub enum HubPeerAction {
    /// start the hub peer service (runs until Ctrl+C)
    Start,

    /// show hub peer identity and status
    Status,
}

#[derive(Debug, Serialize)]
struct StatusResponse {
    node_id: Option<String>,
    keypair_exists: bool,
    keypair_path: String,
    automerge_db_path: String,
    hub_peer_enabled: bool,
}

#[derive(Debug, Serialize)]
struct StartResponse {
    node_id: String,
}

pub async fn handle_command(action: HubPeerAction) -> CommandOutput<serde_json::Value> {
    match action {
        HubPeerAction::Start => start_hub_peer().await,
        HubPeerAction::Status => show_status().await,
    }
}

async fn show_status() -> CommandOutput<serde_json::Value> {
    let config = grimoire::config::get_config();
    let data_dir = &config.data_dir;

    let identity_info = reliquary::identity::get_identity_info(data_dir);
    let automerge_db = config.automerge_db_path();
    let hub_peer_enabled = config
        .federation
        .as_ref()
        .map(|f| f.hub_peer_enabled)
        .unwrap_or(false);

    let status = StatusResponse {
        node_id: identity_info.node_id,
        keypair_exists: identity_info.keypair_exists,
        keypair_path: identity_info.keypair_path.display().to_string(),
        automerge_db_path: automerge_db.display().to_string(),
        hub_peer_enabled,
    };

    CommandOutput::success("hub peer status", status)
}

async fn start_hub_peer() -> CommandOutput<serde_json::Value> {
    let config = grimoire::config::get_config();

    let fed_config = config.federation.as_ref();

    let hub_username = fed_config
        .map(|f| f.hub_peer_username.clone())
        .unwrap_or_else(|| "hub".to_string());

    let bind_port = fed_config.and_then(|f| f.bind_port).filter(|&p| p != 0);

    let hub_config = reliquary::hub::HubPeerConfig {
        data_dir: config.data_dir.clone(),
        automerge_db_path: config.automerge_db_path(),
        username: hub_username,
        bind_port,
        bio: fed_config
            .map(|f| f.hub_peer_bio.clone())
            .unwrap_or_default(),
        avatar_path: fed_config
            .map(|f| f.hub_peer_avatar.clone())
            .unwrap_or_default(),
    };

    info!("starting hub peer service...");
    eprintln!("starting hub peer service...");

    let service = match reliquary::hub::HubPeerService::start(hub_config).await {
        Ok(s) => s,
        Err(e) => {
            return CommandOutput::failure(
                format!("failed to start hub peer: {}", e),
                vec![ErrorDetail::new(
                    "hub_peer_start_failed",
                    "hub peer start failed",
                    e.to_string(),
                )],
                (),
            );
        }
    };

    let node_id = service.node_id().to_string();
    info!(node_id = %node_id, "hub peer service ready");
    eprintln!("hub peer ready");
    eprintln!("node_id: {}", node_id);
    eprintln!();
    eprintln!("press Ctrl+C to stop");

    // create a cancellation token for graceful shutdown
    let cancel = CancellationToken::new();
    let cancel_trigger = cancel.clone();

    // run the service in a background task — it will shut down gracefully
    // when the token is cancelled (sends offline announcements, closes connections)
    let service_handle = tokio::spawn(async move {
        service.run(cancel).await;
    });

    // wait for first Ctrl+C — triggers graceful shutdown
    match signal::ctrl_c().await {
        Ok(()) => {
            info!("received shutdown signal");
            eprintln!("\nshutting down... (press Ctrl+C again to force quit)");
        }
        Err(e) => {
            eprintln!("error waiting for shutdown signal: {}", e);
        }
    }

    // signal the service to shut down gracefully (offline announcement + cleanup)
    cancel_trigger.cancel();

    // wait for graceful shutdown with a timeout, and listen for a second
    // Ctrl+C to force-quit immediately
    let graceful = async {
        if let Err(e) = service_handle.await {
            if !e.is_cancelled() {
                warn!(error = ?e, "service task error during shutdown");
            }
        }
    };

    tokio::select! {
        _ = graceful => {
            info!("hub peer stopped gracefully");
        }
        _ = signal::ctrl_c() => {
            warn!("received second Ctrl+C, force quitting");
            eprintln!("force quit");
            std::process::exit(1);
        }
        _ = tokio::time::sleep(std::time::Duration::from_secs(10)) => {
            warn!("graceful shutdown timed out after 10s, force quitting");
            eprintln!("shutdown timed out, force quit");
            std::process::exit(1);
        }
    }

    info!("hub peer stopped");

    CommandOutput::success("hub peer stopped", StartResponse { node_id })
}
