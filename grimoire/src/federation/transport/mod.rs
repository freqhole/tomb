//! iroh P2P transport layer for federation
//!
//! this module handles the actual peer-to-peer networking using iroh.
//! it's entirely optional - only active when federation.enabled = true.
//!
//! incoming P2P requests are handled by dispatching directly to offal,
//! which means no HTTP server is required for P2P functionality.

mod admin_client;
mod admin_handler;
mod admin_iroh;
mod admin_protocol;
mod connection;
mod endpoint;
mod freqhole_protocol;
mod handler;
mod protocol;

pub use admin_client::send_admin_request;
pub use admin_iroh::AdminProtocol;
pub use admin_protocol::{AdminMessage, ADMIN_ALPN};
pub use connection::{BlobStreamInfo, EnsureBlobOutcome, PeerConnection, ProxyResponse};
pub use endpoint::FederationEndpoint;
pub use freqhole_protocol::FreqholeProtocol;
pub use handler::handle_incoming;
pub use protocol::{PeerMessage, FREQHOLE_ALPN};

// re-exports so callers (cli, charnel, …) don't need a direct
// `iroh` dependency just to dial a peer or hold a Connection.
pub use iroh::endpoint::Connection as IrohConnection;
pub use iroh::PublicKey as IrohPublicKey;

use crate::config::get_config;
use crate::error::GrimoireResult;
use crate::users::UserService;
use tracing::info;

/// check to allow incoming P2P connections
///
/// returns true if:
/// - knocking_enabled is true (unknown peers can knock), OR
/// - there are registered peer nodes (known peers can connect)
///
/// returns false only when both conditions are false, meaning
/// no other peerz can connect anyway so save some resourcez by skipping.
async fn should_accept_incoming() -> bool {
    let config = get_config();

    // check if knocking is enabled
    let knocking_enabled = config
        .federation
        .as_ref()
        .map(|f| f.knocking_enabled)
        .unwrap_or(false);

    if knocking_enabled {
        return true;
    }

    // check if any peer nodes exist
    let service = UserService::new();
    service.has_peer_nodes().await
}

/// start the federation endpoint and begin accepting P2P connections
///
/// this is the main entry point for P2P networking. it creates the
/// endpoint, generates/loads the keypair, and starts the router
/// with dual protocol support (freqhole/1 + freqhole-blobz).
///
/// optimization: if knocking is disabled AND no peer nodes exist,
/// skips the accept loop since no one can connect anyway.
pub async fn start_federation_endpoint() -> GrimoireResult<FederationEndpoint> {
    let mut endpoint = FederationEndpoint::new().await?;

    // check if should accept incoming connections
    if should_accept_incoming().await {
        info!("starting P2P router (knocking enabled or peers registered)");
        endpoint.start_router().await?;
    } else {
        info!("skipping P2P router (no knocking, no peers - outbound only)");
    }

    Ok(endpoint)
}
