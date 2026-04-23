//! radio CLI commands.
//!
//! phase 0: a single `serve` subcommand that starts a federation endpoint
//! with the `freqhole-radio/1` ALPN registered, prints the node id, and runs
//! until Ctrl-C. each inbound connection gets its own ffmpeg pipeline and
//! random song stream.
//!
//! phase 1 will add `status` / `info` / `skip` subcommands that talk to a
//! running broadcaster.

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::error::ErrorDetail;
use grimoire::radio::{RadioProtocol, RADIO_ALPN};
use tokio::signal;
use tracing::info;

#[derive(Subcommand)]
pub enum RadioAction {
    /// start a radio broadcaster on the iroh `freqhole-radio/1` ALPN.
    ///
    /// runs until Ctrl-C. pulls random songs from the local library and
    /// streams fMP4/AAC chunks to each connected listener.
    Serve,
}

pub async fn handle_command(action: RadioAction) -> CommandOutput<serde_json::Value> {
    match action {
        RadioAction::Serve => serve().await,
    }
}

async fn serve() -> CommandOutput<serde_json::Value> {
    info!("[radio] starting radio broadcaster...");
    eprintln!("starting radio broadcaster...");

    // build the federation endpoint manually so we can register the radio
    // ALPN via the customize hook. unlike `start_federation_endpoint`, this
    // does not require federation to be enabled in config — radio only needs
    // an iroh endpoint and the keypair.
    let mut endpoint = match grimoire::federation::transport::FederationEndpoint::new().await {
        Ok(ep) => ep,
        Err(e) => {
            return CommandOutput::failure(
                format!("failed to create iroh endpoint: {e}"),
                vec![ErrorDetail::from(e)],
                serde_json::json!({}),
            );
        }
    };

    let node_id = endpoint.node_id().to_string();

    if let Err(e) = endpoint
        .start_router_with(|builder| builder.accept(RADIO_ALPN, RadioProtocol::new()))
        .await
    {
        return CommandOutput::failure(
            format!("failed to start radio router: {e}"),
            vec![ErrorDetail::from(e)],
            serde_json::json!({ "node_id": node_id }),
        );
    }

    info!("[radio] broadcaster ready, node_id: {node_id}");
    eprintln!("radio broadcaster ready");
    eprintln!("node_id: {node_id}");
    eprintln!();
    eprintln!("paste this node_id into client/spume/radio-demo.html to listen.");
    eprintln!("press Ctrl+C to stop");

    if let Err(e) = signal::ctrl_c().await {
        eprintln!("error waiting for shutdown signal: {e}");
    } else {
        info!("[radio] received shutdown signal");
        eprintln!("\nshutting down...");
    }

    endpoint.close().await;
    info!("[radio] broadcaster stopped");

    CommandOutput::success(
        "radio broadcaster stopped",
        serde_json::json!({ "node_id": node_id }),
    )
}
