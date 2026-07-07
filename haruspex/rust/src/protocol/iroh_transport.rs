//! the `iroh` feature: a thin transport shell over [`FriendzService`].
//!
//! every iroh-specific type (`Connection`, `ProtocolHandler`, `Endpoint`,
//! `EndpointAddr`, `PublicKey`, `AcceptError`) lives only in this file,
//! gated behind the `iroh` cargo feature, per PHASE_4_HARUSPEX_RUST.md's
//! transport-agnostic design tenet. [`FriendzProtocolHandler::accept`] does
//! nothing but: extract the caller's identity from the connection
//! (`remote_id()`), read a framed message via [`super::codec`], call
//! [`FriendzService::dispatch`] (zero iroh types in that signature), and
//! write the response back via the codec. no dispatch decision-making
//! lives here.
//!
//! ported from skein's `reliquary/src/protocol/handler.rs`'s
//! `ProtocolHandler` impl and heartbeat loop, restructured so the presence
//! bookkeeping and message routing (now `FriendzService`/`dispatch`) no
//! longer live inside the iroh-coupled type.

use std::sync::Arc;

use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};
use iroh::{Endpoint, EndpointAddr, PublicKey};

use crate::acl::caller::Caller;
use crate::stores::Role;

use super::codec::{self, CodecError};
use super::messages::{FriendzMessage, DISCOVERY_SWEEP_MS, FRIENDZ_ALPN, HEARTBEAT_INTERVAL_MS};
use super::service::{FriendzResponse, FriendzService};

#[derive(Debug, thiserror::Error)]
pub enum FriendzTransportError {
    #[error("invalid node id: {0}")]
    InvalidNodeId(String),
    #[error("connection failed: {0}")]
    Connect(String),
    #[error("codec error: {0}")]
    Codec(#[from] CodecError),
}

/// the `iroh::protocol::ProtocolHandler` for `freqhole-friendz/1`. wraps an
/// `Arc<FriendzService>` - clone is cheap.
#[derive(Debug, Clone)]
pub struct FriendzProtocolHandler {
    service: Arc<FriendzService>,
}

impl FriendzProtocolHandler {
    pub fn new(service: Arc<FriendzService>) -> Self {
        Self { service }
    }

    pub fn service(&self) -> &Arc<FriendzService> {
        &self.service
    }

    /// open a bi-stream to `peer_node_id` over `endpoint` and send one
    /// message. fire-and-forget - does not wait for a reply (a reply, if
    /// any, arrives on the peer's own outbound connection back to us and
    /// is handled by `accept` like any other inbound message).
    pub async fn send_message(
        &self,
        endpoint: &Endpoint,
        peer_node_id: &str,
        msg: &FriendzMessage,
    ) -> Result<(), FriendzTransportError> {
        let public_key: PublicKey = peer_node_id
            .parse()
            .map_err(|e| FriendzTransportError::InvalidNodeId(format!("{e}")))?;
        let addr = EndpointAddr::from_parts(public_key, []);

        let conn = endpoint
            .connect(addr, FRIENDZ_ALPN)
            .await
            .map_err(|e| FriendzTransportError::Connect(e.to_string()))?;
        let (mut send, _recv) = conn
            .open_bi()
            .await
            .map_err(|e| FriendzTransportError::Connect(e.to_string()))?;

        codec::write_message(&mut send, msg).await?;
        tracing::debug!(peer = %peer_node_id, "friendz: sent message on new outbound stream");
        Ok(())
    }

    /// send a heartbeat to a specific peer.
    pub async fn send_heartbeat_to(
        &self,
        endpoint: &Endpoint,
        peer_node_id: &str,
    ) -> Result<(), FriendzTransportError> {
        let msg = self.service.build_heartbeat().await;
        self.send_message(endpoint, peer_node_id, &msg).await
    }

    /// run the heartbeat + discovery-sweep loops until the endpoint closes.
    /// mirrors skein's `run_heartbeat_loop`: an initial announce to every
    /// friend, periodic heartbeats to online peers, a timeout sweep
    /// (delegated to `FriendzService::sweep_timeouts`), and periodic probes
    /// of offline friends. call this from a spawned task.
    pub async fn run_heartbeat_loop<F>(&self, endpoint: Endpoint, get_friend_ids: F)
    where
        F: Fn() -> Vec<String> + Send + Sync + 'static,
    {
        let mut heartbeat_interval =
            tokio::time::interval(std::time::Duration::from_millis(HEARTBEAT_INTERVAL_MS));
        let mut discovery_interval =
            tokio::time::interval(std::time::Duration::from_millis(DISCOVERY_SWEEP_MS));

        for peer_id in get_friend_ids() {
            if let Err(e) = self.send_heartbeat_to(&endpoint, &peer_id).await {
                tracing::debug!(peer = %peer_id, error = %e, "friendz: initial announce failed");
            }
        }

        loop {
            tokio::select! {
                _ = heartbeat_interval.tick() => {
                    for peer_id in self.service.online_peers().await {
                        if let Err(e) = self.send_heartbeat_to(&endpoint, &peer_id).await {
                            tracing::debug!(peer = %peer_id, error = %e, "friendz: heartbeat failed");
                        }
                    }
                    for id in self.service.sweep_timeouts().await {
                        tracing::debug!(peer = %id, "friendz: peer offline (timeout)");
                    }
                }
                _ = discovery_interval.tick() => {
                    for peer_id in get_friend_ids() {
                        if !self.service.is_online(&peer_id).await {
                            let _ = self.send_heartbeat_to(&endpoint, &peer_id).await;
                        }
                    }
                }
            }
        }
    }
}

impl ProtocolHandler for FriendzProtocolHandler {
    async fn accept(&self, connection: Connection) -> Result<(), AcceptError> {
        let node_id = connection.remote_id().to_string();
        tracing::info!(peer = %node_id, "friendz: accepted inbound connection");

        // the caller's role is a transport/app concern this handler does
        // not resolve (haruspex's acl evaluator needs an identity lookup +
        // resource context this thin shell doesn't have) - a real
        // deployment wraps this handler (or replaces `Role::Viewer` here)
        // with its own resolution before calling `dispatch`.
        let caller = Caller::new(node_id.clone(), Role::Viewer);

        let (mut send, mut recv) = connection.accept_bi().await.map_err(|e| {
            tracing::warn!(peer = %node_id, error = %e, "friendz: failed to accept bi stream");
            e
        })?;

        loop {
            let msg = match codec::read_message(&mut recv).await {
                Ok(msg) => msg,
                Err(CodecError::StreamClosed) => break,
                Err(e) => {
                    tracing::warn!(peer = %node_id, error = %e, "friendz: failed to read message, closing stream");
                    break;
                }
            };

            tracing::debug!(peer = %node_id, msg_type = %msg.message_type(), "friendz: received message");
            let response = self.service.dispatch(&caller, msg).await;
            if let FriendzResponse::Message(reply) = response {
                if let Err(e) = codec::write_message(&mut send, &reply).await {
                    tracing::warn!(peer = %node_id, error = %e, "friendz: failed to write response");
                    break;
                }
            }
        }

        Ok(())
    }

    async fn shutdown(&self) {
        tracing::debug!("friendz: protocol handler shutting down");
    }
}
