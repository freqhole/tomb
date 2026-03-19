//! freqhole/1 protocol handler wrapper for iroh Router
//!
//! wraps the existing handle_incoming logic as an iroh ProtocolHandler
//! so it can be used with Router alongside iroh-blobs.

use crate::federation::transport::handler::handle_incoming;
use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};
use std::sync::Arc;
use tracing::info;

/// protocol handler for freqhole/1 (existing P2P protocol)
///
/// wraps handle_incoming as a ProtocolHandler for use with iroh Router.
#[derive(Debug, Clone)]
pub struct FreqholeProtocol {
    _inner: Arc<()>, // placeholder for future state
}

impl FreqholeProtocol {
    /// create a new freqhole/1 protocol handler
    pub fn new() -> Self {
        Self {
            _inner: Arc::new(()),
        }
    }
}

impl Default for FreqholeProtocol {
    fn default() -> Self {
        Self::new()
    }
}

impl ProtocolHandler for FreqholeProtocol {
    async fn accept(&self, conn: Connection) -> std::result::Result<(), AcceptError> {
        let peer_id = conn.remote_id();
        info!(
            "[freqhole-protocol] accepted connection from peer: {}",
            peer_id
        );

        // delegate to existing handler
        handle_incoming(peer_id, conn).await;

        Ok(())
    }

    async fn shutdown(&self) {
        info!("[freqhole-protocol] shutting down");
        // no cleanup needed currently
    }
}
