//! `freqhole-admin/1` protocol handler wrapper for iroh Router
//!
//! mirrors `freqhole_protocol.rs` for the admin ALPN. delegates to
//! `admin_handler::handle_incoming`.
//!
//! see docs/wizard-remote-admin.md.

use crate::federation::transport::admin_handler::handle_incoming;
use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};
use std::sync::Arc;
use tracing::info;

/// protocol handler for `freqhole-admin/1`
#[derive(Debug, Clone)]
pub struct AdminProtocol {
    _inner: Arc<()>,
}

impl AdminProtocol {
    pub fn new() -> Self {
        Self {
            _inner: Arc::new(()),
        }
    }
}

impl Default for AdminProtocol {
    fn default() -> Self {
        Self::new()
    }
}

impl ProtocolHandler for AdminProtocol {
    async fn accept(&self, conn: Connection) -> std::result::Result<(), AcceptError> {
        let peer_id = conn.remote_id();
        info!(
            "[admin-protocol] accepted connection from peer: {}",
            peer_id
        );
        handle_incoming(peer_id, conn).await;
        Ok(())
    }

    async fn shutdown(&self) {
        info!("[admin-protocol] shutting down");
    }
}
