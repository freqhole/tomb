//! iroh P2P transport layer for federation
//!
//! this module handles the actual peer-to-peer networking using iroh.
//! it's entirely optional - only active when federation.enabled = true.
//!
//! uses a proxy pattern - incoming requests are HTTP-like messages
//! that get forwarded to the local freqhole server via reqwest.

mod connection;
mod endpoint;
mod handler;
mod protocol;

pub use connection::{BlobStreamInfo, PeerConnection, ProxyResponse};
pub use endpoint::FederationEndpoint;
pub use handler::handle_incoming;
pub use protocol::{PeerMessage, FREQHOLE_ALPN};

use crate::error::GrimoireResult;

/// start the federation endpoint with the handler already wired up
///
/// this is the main entry point for the server to start P2P networking.
/// it creates the endpoint, generates/loads the keypair, and starts
/// accepting incoming connections.
pub async fn start_federation_endpoint() -> GrimoireResult<FederationEndpoint> {
    let mut endpoint = FederationEndpoint::new().await?;

    // start accepting connections with our handler
    endpoint.start_accept_loop(|peer_id, conn| {
        // spawn handler for each connection
        tokio::spawn(async move {
            handle_incoming(peer_id, conn).await;
        });
    });

    Ok(endpoint)
}
