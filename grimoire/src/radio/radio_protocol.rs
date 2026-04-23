//! `freqhole-radio/1` ProtocolHandler wrapper for iroh Router.
//!
//! mirrors `freqhole_protocol.rs` — thin adapter that delegates to
//! [`handler::handle_connection`].

use crate::radio::handler::handle_connection;
use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};
use std::sync::Arc;
use tracing::info;

/// protocol handler for `freqhole-radio/1`.
#[derive(Debug, Clone)]
pub struct RadioProtocol {
    _inner: Arc<()>,
}

impl RadioProtocol {
    pub fn new() -> Self {
        Self {
            _inner: Arc::new(()),
        }
    }
}

impl Default for RadioProtocol {
    fn default() -> Self {
        Self::new()
    }
}

impl ProtocolHandler for RadioProtocol {
    async fn accept(&self, conn: Connection) -> std::result::Result<(), AcceptError> {
        info!("[radio-protocol] accepted connection");
        handle_connection(conn).await;
        Ok(())
    }

    async fn shutdown(&self) {
        info!("[radio-protocol] shutting down");
    }
}
