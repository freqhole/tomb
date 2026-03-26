//! iroh P2P transport layer for federation
//!
//! this module handles the actual peer-to-peer networking using iroh.
//! it's entirely optional - only active when federation.enabled = true.
//!
//! incoming P2P requests are handled by dispatching directly to offal,
//! which means no HTTP server is required for P2P functionality.

mod connection;
mod endpoint;
mod freqhole_protocol;
mod handler;
mod protocol;

pub use connection::{BlobStreamInfo, PeerConnection, ProxyResponse};
pub use endpoint::FederationEndpoint;
pub use freqhole_protocol::FreqholeProtocol;
pub use handler::handle_incoming;
pub use protocol::{PeerMessage, FREQHOLE_ALPN};

use crate::config::get_config;
use crate::error::GrimoireResult;
use crate::gossip::GossipManager;
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
/// with triple protocol support (freqhole/1 + freqhole-blobz + iroh-gossip).
///
/// returns the endpoint and an optional GossipManager (if router was started).
///
/// optimization: if knocking is disabled AND no peer nodes exist,
/// skips the accept loop since no one can connect anyway.
pub async fn start_federation_endpoint(
) -> GrimoireResult<(FederationEndpoint, Option<GossipManager>)> {
    let mut endpoint = FederationEndpoint::new().await?;

    // check if should accept incoming connections
    if should_accept_incoming().await {
        info!("starting P2P router (knocking enabled or peers registered)");
        endpoint.start_router().await?;

        // create gossip manager and resubscribe to persisted channels
        let gossip_manager = if let Some(gossip) = endpoint.gossip().cloned() {
            let manager = GossipManager::new(gossip);
            if let Err(e) = manager.resubscribe_all().await {
                tracing::warn!("[gossip] resubscribe failed (non-fatal): {}", e);
            }
            Some(manager)
        } else {
            None
        };

        Ok((endpoint, gossip_manager))
    } else {
        info!("skipping P2P router (no knocking, no peers - outbound only)");
        Ok((endpoint, None))
    }
}
