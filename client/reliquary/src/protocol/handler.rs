//! friendz protocol handler — manages P2P presence, heartbeat, and message dispatch.
//!
//! implements `iroh::protocol::ProtocolHandler` for the `freqhole-friendz/1` ALPN
//! and provides methods for sending messages to peers, tracking online status,
//! and running the heartbeat/discovery loops.
//!
//! the handler emits `FriendzEvent` values through a channel for the consumer
//! (hub peer service) to process.

use std::collections::HashMap;
use std::sync::Arc;

use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};
use iroh::{Endpoint, EndpointAddr, PublicKey};
use tokio::sync::{Mutex, Notify, RwLock};

use super::codec::{self, CodecError};
use super::messages::{
    FriendzMessage, DISCOVERY_SWEEP_MS, FRIENDZ_ALPN, HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS,
};

// ---------------------------------------------------------------------------
// events
// ---------------------------------------------------------------------------

/// events emitted by the friendz handler for the consumer to process.
#[derive(Debug, Clone)]
pub enum FriendzEvent {
    /// a peer sent its first heartbeat — it's now online.
    PeerOnline { node_id: String, username: String },
    /// a peer timed out or sent an offline announcement.
    PeerOffline { node_id: String },
    /// a message was received from a peer.
    MessageReceived {
        from_node_id: String,
        message: FriendzMessage,
    },
}

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum HandlerError {
    #[error("invalid node id: {0}")]
    InvalidNodeId(String),

    #[error("connection failed: {0}")]
    Connect(String),

    #[error("send failed: {0}")]
    Send(String),

    #[error("codec error: {0}")]
    Codec(#[from] CodecError),
}

// ---------------------------------------------------------------------------
// internal state
// ---------------------------------------------------------------------------

struct HandlerState {
    /// send halves of active streams, keyed by peer node ID.
    streams: HashMap<String, iroh::endpoint::SendStream>,
    /// last heartbeat received from each peer.
    last_seen: HashMap<String, tokio::time::Instant>,
}

struct Inner {
    endpoint: Endpoint,
    local_node_id: String,
    local_username: RwLock<String>,
    state: Mutex<HandlerState>,
    event_tx: tokio::sync::mpsc::UnboundedSender<FriendzEvent>,
    shutdown: Notify,
}

// ---------------------------------------------------------------------------
// FriendzHandler
// ---------------------------------------------------------------------------

/// manages P2P presence and message dispatch over the `freqhole-friendz/1` ALPN.
///
/// clone is cheap — the handler is backed by an `Arc<Inner>`.
#[derive(Clone)]
pub struct FriendzHandler {
    inner: Arc<Inner>,
}

impl std::fmt::Debug for FriendzHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FriendzHandler")
            .field("local_node_id", &self.inner.local_node_id)
            .finish_non_exhaustive()
    }
}

impl FriendzHandler {
    /// create a new handler. returns the handler and a receiver for events
    /// emitted by the protocol (peer online/offline, incoming messages).
    pub fn new(
        endpoint: Endpoint,
        local_node_id: String,
        local_username: String,
    ) -> (Self, tokio::sync::mpsc::UnboundedReceiver<FriendzEvent>) {
        let (event_tx, event_rx) = tokio::sync::mpsc::unbounded_channel();
        let handler = Self {
            inner: Arc::new(Inner {
                endpoint,
                local_node_id,
                local_username: RwLock::new(local_username),
                state: Mutex::new(HandlerState {
                    streams: HashMap::new(),
                    last_seen: HashMap::new(),
                }),
                event_tx,
                shutdown: Notify::new(),
            }),
        };
        (handler, event_rx)
    }

    // -- sending ------------------------------------------------------------

    /// send a message to a specific peer. opens a new stream if needed.
    pub async fn send_message(
        &self,
        peer_node_id: &str,
        msg: &FriendzMessage,
    ) -> Result<(), HandlerError> {
        // try existing stream first
        {
            let mut state = self.inner.state.lock().await;
            if let Some(send) = state.streams.get_mut(peer_node_id) {
                match codec::write_message(send, msg).await {
                    Ok(()) => {
                        tracing::debug!(
                            peer = %peer_node_id,
                            "friendz: sent message on existing stream"
                        );
                        return Ok(());
                    }
                    Err(e) => {
                        tracing::debug!(
                            peer = %peer_node_id,
                            error = %e,
                            "friendz: existing stream failed, opening new one"
                        );
                        state.streams.remove(peer_node_id);
                    }
                }
            }
        }

        // open new stream
        self.open_stream_and_send(peer_node_id, msg).await
    }

    /// open a new bi-stream to a peer, send a message, and start reading.
    async fn open_stream_and_send(
        &self,
        peer_node_id: &str,
        msg: &FriendzMessage,
    ) -> Result<(), HandlerError> {
        // parse the node ID as an iroh public key
        let public_key: PublicKey = peer_node_id
            .parse()
            .map_err(|e| HandlerError::InvalidNodeId(format!("{e}")))?;
        let addr = EndpointAddr::from_parts(public_key, []);

        let conn = self
            .inner
            .endpoint
            .connect(addr, FRIENDZ_ALPN)
            .await
            .map_err(|e| HandlerError::Connect(e.to_string()))?;
        let (mut send, recv) = conn
            .open_bi()
            .await
            .map_err(|e| HandlerError::Connect(e.to_string()))?;

        // send the message
        codec::write_message(&mut send, msg)
            .await
            .map_err(|e| HandlerError::Send(e.to_string()))?;

        tracing::debug!(
            peer = %peer_node_id,
            "friendz: sent message on new outbound stream"
        );

        // store stream and start read loop
        {
            let mut state = self.inner.state.lock().await;
            state.streams.insert(peer_node_id.to_string(), send);
        }

        let inner = self.inner.clone();
        let node_id = peer_node_id.to_string();
        tokio::spawn(async move {
            if let Err(e) = read_loop(&inner, &node_id, recv).await {
                tracing::debug!(peer = %node_id, error = %e, "friendz: outbound read loop ended");
            }
            let mut state = inner.state.lock().await;
            state.streams.remove(&node_id);
        });

        Ok(())
    }

    /// send a heartbeat to a specific peer.
    pub async fn send_heartbeat_to(&self, peer_node_id: &str) -> Result<(), HandlerError> {
        let username = self.inner.local_username.read().await.clone();
        let msg = FriendzMessage::Heartbeat {
            node_id: self.inner.local_node_id.clone(),
            username,
            canvas_activity: None,
        };
        self.send_message(peer_node_id, &msg).await
    }

    /// announce offline to all online peers. fire-and-forget.
    pub async fn announce_offline(&self) {
        let msg = FriendzMessage::OfflineAnnouncement {
            node_id: self.inner.local_node_id.clone(),
        };
        let online_peers = self.get_online_peers().await;
        for peer_id in online_peers {
            let mut state = self.inner.state.lock().await;
            if let Some(send) = state.streams.get_mut(&peer_id) {
                if let Err(e) = codec::write_message(send, &msg).await {
                    tracing::debug!(
                        peer = %peer_id,
                        error = %e,
                        "friendz: failed to send offline announcement"
                    );
                }
            }
        }
    }

    // -- queries -------------------------------------------------------------

    /// check if a peer is considered online (heartbeat within timeout window).
    pub async fn is_online(&self, node_id: &str) -> bool {
        let state = self.inner.state.lock().await;
        state
            .last_seen
            .get(node_id)
            .map(|t| t.elapsed().as_millis() < HEARTBEAT_TIMEOUT_MS as u128)
            .unwrap_or(false)
    }

    /// get all peer node IDs currently considered online.
    pub async fn get_online_peers(&self) -> Vec<String> {
        let state = self.inner.state.lock().await;
        state
            .last_seen
            .iter()
            .filter(|(_, t)| t.elapsed().as_millis() < HEARTBEAT_TIMEOUT_MS as u128)
            .map(|(id, _)| id.clone())
            .collect()
    }

    /// update the local username (e.g. when profile changes).
    pub async fn set_local_username(&self, username: String) {
        *self.inner.local_username.write().await = username;
    }

    // -- heartbeat / discovery loops -----------------------------------------

    /// run the heartbeat and discovery sweep loops. this future runs until
    /// shutdown is signaled. call this from a spawned task.
    pub async fn run_heartbeat_loop<F>(&self, get_friend_ids: F)
    where
        F: Fn() -> Vec<String> + Send + Sync + 'static,
    {
        let mut heartbeat_interval =
            tokio::time::interval(std::time::Duration::from_millis(HEARTBEAT_INTERVAL_MS));
        let mut discovery_interval =
            tokio::time::interval(std::time::Duration::from_millis(DISCOVERY_SWEEP_MS));

        // initial announce: send heartbeat to ALL friends
        let all_friends = get_friend_ids();
        for peer_id in &all_friends {
            if let Err(e) = self.send_heartbeat_to(peer_id).await {
                tracing::debug!(peer = %peer_id, error = %e, "friendz: initial announce failed");
            }
        }

        loop {
            tokio::select! {
                _ = heartbeat_interval.tick() => {
                    // send heartbeats to online peers
                    let online = self.get_online_peers().await;
                    for peer_id in &online {
                        if let Err(e) = self.send_heartbeat_to(peer_id).await {
                            tracing::debug!(
                                peer = %peer_id,
                                error = %e,
                                "friendz: heartbeat failed"
                            );
                        }
                    }

                    // check for timed-out peers
                    let mut state = self.inner.state.lock().await;
                    let timeout = std::time::Duration::from_millis(HEARTBEAT_TIMEOUT_MS);
                    let timed_out: Vec<String> = state
                        .last_seen
                        .iter()
                        .filter(|(_, t)| t.elapsed() >= timeout)
                        .map(|(id, _)| id.clone())
                        .collect();
                    for id in &timed_out {
                        state.last_seen.remove(id);
                        let _ = self.inner.event_tx.send(FriendzEvent::PeerOffline {
                            node_id: id.clone(),
                        });
                        tracing::debug!(peer = %id, "friendz: peer offline (timeout)");
                    }
                }

                _ = discovery_interval.tick() => {
                    // probe offline friends
                    let friends = get_friend_ids();
                    for peer_id in &friends {
                        if !self.is_online(peer_id).await {
                            let _ = self.send_heartbeat_to(peer_id).await;
                        }
                    }
                }

                _ = self.inner.shutdown.notified() => {
                    tracing::debug!("friendz: heartbeat loop shutting down");
                    break;
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// ProtocolHandler impl (inbound connections)
// ---------------------------------------------------------------------------

impl ProtocolHandler for FriendzHandler {
    async fn accept(&self, connection: Connection) -> Result<(), AcceptError> {
        let peer_id = connection.remote_id();
        let peer_node_id = peer_id.to_string();
        tracing::debug!(peer = %peer_node_id, "friendz: accepted inbound connection");

        let (send, recv) = connection.accept_bi().await.map_err(|e| {
            tracing::warn!(
                peer = %peer_node_id,
                error = %e,
                "friendz: failed to accept bi stream"
            );
            e
        })?;

        // store send half, replacing any existing stream
        {
            let mut state = self.inner.state.lock().await;
            state.streams.insert(peer_node_id.clone(), send);
        }

        tracing::debug!(peer = %peer_node_id, "friendz: stored send half and starting read loop");

        // spawn read loop
        let inner = self.inner.clone();
        let node_id = peer_node_id.clone();
        tokio::spawn(async move {
            if let Err(e) = read_loop(&inner, &node_id, recv).await {
                tracing::debug!(peer = %node_id, error = %e, "friendz: read loop ended");
            }
            // clean up stream on exit
            let mut state = inner.state.lock().await;
            state.streams.remove(&node_id);
        });

        Ok(())
    }

    async fn shutdown(&self) {
        tracing::debug!("friendz: shutting down");
        self.announce_offline().await;
        self.inner.shutdown.notify_waiters();
    }
}

// ---------------------------------------------------------------------------
// read loop + message handling (free functions)
// ---------------------------------------------------------------------------

/// read messages from a recv stream until the stream closes or errors.
async fn read_loop(
    inner: &Inner,
    peer_node_id: &str,
    mut recv: iroh::endpoint::RecvStream,
) -> Result<(), CodecError> {
    loop {
        let msg = codec::read_message(&mut recv).await?;
        handle_message(inner, peer_node_id, msg).await;
    }
}

/// dispatch a single inbound message.
async fn handle_message(inner: &Inner, from_node_id: &str, msg: FriendzMessage) {
    match &msg {
        FriendzMessage::Heartbeat {
            node_id, username, ..
        } => {
            let was_online;
            {
                let mut state = inner.state.lock().await;
                let now = tokio::time::Instant::now();
                was_online = state
                    .last_seen
                    .get(from_node_id)
                    .map(|t| now.duration_since(*t).as_millis() < HEARTBEAT_TIMEOUT_MS as u128)
                    .unwrap_or(false);
                state.last_seen.insert(from_node_id.to_string(), now);
            }

            // fast presence ACK: reply with heartbeat on first appearance
            if !was_online {
                tracing::debug!(peer = %from_node_id, "friendz: peer came online");
                let _ = inner.event_tx.send(FriendzEvent::PeerOnline {
                    node_id: node_id.clone(),
                    username: username.clone(),
                });
                // send reply heartbeat
                let reply = FriendzMessage::Heartbeat {
                    node_id: inner.local_node_id.clone(),
                    username: inner.local_username.read().await.clone(),
                    canvas_activity: None,
                };
                let mut state = inner.state.lock().await;
                if let Some(send) = state.streams.get_mut(from_node_id) {
                    match codec::write_message(send, &reply).await {
                        Ok(()) => {
                            tracing::info!(
                                peer = %from_node_id,
                                "friendz: presence ACK sent successfully"
                            );
                        }
                        Err(e) => {
                            tracing::warn!(
                                peer = %from_node_id,
                                error = %e,
                                "friendz: failed to send presence ACK"
                            );
                        }
                    }
                } else {
                    tracing::warn!(
                        peer = %from_node_id,
                        "friendz: no stream found for presence ACK (stream not stored?)"
                    );
                }
            }
        }

        FriendzMessage::OfflineAnnouncement { node_id } => {
            let mut state = inner.state.lock().await;
            if state.last_seen.remove(node_id).is_some() {
                tracing::debug!(peer = %node_id, "friendz: peer offline (announced)");
                let _ = inner.event_tx.send(FriendzEvent::PeerOffline {
                    node_id: node_id.clone(),
                });
            }
        }

        // all other message types: log for debugging, no special inline handling
        other => {
            tracing::debug!(
                from = %from_node_id,
                "friendz: received {:?}",
                std::mem::discriminant(other)
            );
        }
    }

    // always emit MessageReceived for all message types (including heartbeats)
    let _ = inner.event_tx.send(FriendzEvent::MessageReceived {
        from_node_id: from_node_id.to_string(),
        message: msg,
    });
}
