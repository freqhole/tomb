//! skein transport bridge
//!
//! provides a single `skein_dispatch` tauri command that bridges skein's
//! P2P transport layer (previously handled by midden WASM) to the native
//! iroh endpoint running in the tauri app process.
//!
//! the JS side calls `skein_dispatch(action, payload)` for all transport
//! operations. stream handles are managed rust-side in a concurrent map.
//!
//! supported actions:
//! - `get_node_id` — returns the local iroh node ID
//! - `open_bi` — opens a bidirectional stream to a peer on a specific ALPN
//! - `write_message` — writes a length-delimited message to a stream
//! - `read_message` — reads a length-delimited message from a stream
//! - `close_stream` — closes and removes a stream
//! - `stream_info` — returns metadata for a stream handle
//! - `accept_stream` — blocks until an incoming stream arrives from a remote peer

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use base64::Engine;
use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};
use serde_json::json;
use tokio::sync::mpsc;
use tokio::sync::Mutex;

/// global sender for incoming skein streams
///
/// set once during SkeinTransportState::new(), read by init_p2p_client
/// when building the router with skein protocol handlers.
static INCOMING_SENDER: std::sync::Mutex<Option<mpsc::Sender<IncomingStream>>> =
    std::sync::Mutex::new(None);

/// get a clone of the incoming stream sender (for use in init_p2p_client)
pub fn get_incoming_sender() -> Option<mpsc::Sender<IncomingStream>> {
    INCOMING_SENDER.lock().unwrap().clone()
}

/// ALPN for friend requests, profile sharing, and presence heartbeat
pub const FRIENDZ_ALPN: &[u8] = b"freqhole-friendz/1";

/// ALPN for automerge-repo document sync
pub const AUTOMERGE_ALPN: &[u8] = b"iroh/automerge-repo/1";

/// an incoming stream from a remote peer, queued for JS consumption
pub struct IncomingStream {
    pub send: iroh::endpoint::SendStream,
    pub recv: iroh::endpoint::RecvStream,
    pub peer_node_id: String,
    pub alpn: String,
}

/// protocol handler for skein ALPNs (friendz, automerge)
///
/// accepts incoming connections and queues them as stream handles
/// that can be consumed by the JS side via skein_dispatch("accept_stream").
#[derive(Debug, Clone)]
pub struct SkeinProtocolHandler {
    alpn: String,
    incoming_tx: mpsc::Sender<IncomingStream>,
}

impl SkeinProtocolHandler {
    pub fn new(alpn: &str, incoming_tx: mpsc::Sender<IncomingStream>) -> Self {
        Self {
            alpn: alpn.to_string(),
            incoming_tx,
        }
    }
}

impl ProtocolHandler for SkeinProtocolHandler {
    async fn accept(&self, connection: Connection) -> Result<(), AcceptError> {
        let peer_id = connection.remote_id();
        tracing::info!(
            peer = %peer_id,
            alpn = &self.alpn,
            "skein: accepted incoming connection"
        );

        // accept a bidirectional stream from the connection
        let (send, recv) = connection.accept_bi().await.map_err(|e| {
            tracing::warn!(error = %e, alpn = &self.alpn, "skein: failed to accept bi stream");
            e
        })?;

        let stream = IncomingStream {
            send,
            recv,
            peer_node_id: peer_id.to_string(),
            alpn: self.alpn.clone(),
        };

        if self.incoming_tx.send(stream).await.is_err() {
            tracing::warn!(
                alpn = &self.alpn,
                "skein: incoming stream channel closed, dropping connection"
            );
        }

        Ok(())
    }

    async fn shutdown(&self) {
        tracing::info!(alpn = &self.alpn, "skein: protocol handler shutting down");
    }
}

/// a single bidirectional QUIC stream
struct BiStreamHandle {
    send: Mutex<iroh::endpoint::SendStream>,
    recv: Mutex<iroh::endpoint::RecvStream>,
    peer_node_id: String,
    alpn: String,
}

/// managed state for skein transport
pub struct SkeinTransportState {
    streams: Mutex<HashMap<u64, Arc<BiStreamHandle>>>,
    next_id: AtomicU64,
    /// receiver for incoming streams from SkeinProtocolHandler
    incoming_rx: Mutex<Option<mpsc::Receiver<IncomingStream>>>,
}

impl Default for SkeinTransportState {
    fn default() -> Self {
        Self::new()
    }
}

impl SkeinTransportState {
    /// create transport state and register the incoming stream channel globally
    ///
    /// creates an mpsc channel internally. the sender is stored in a global
    /// static so init_p2p_client can retrieve it when building the router
    /// with skein protocol handlers.
    pub fn new() -> Self {
        let (tx, rx) = mpsc::channel(64);

        // store sender globally for init_p2p_client to pick up
        *INCOMING_SENDER.lock().unwrap() = Some(tx);

        Self {
            streams: Mutex::new(HashMap::new()),
            next_id: AtomicU64::new(1),
            incoming_rx: Mutex::new(Some(rx)),
        }
    }

    fn next_handle(&self) -> u64 {
        self.next_id.fetch_add(1, Ordering::Relaxed)
    }
}

/// single dispatch command for all skein transport operations
#[tauri::command]
pub async fn skein_dispatch(
    state: tauri::State<'_, SkeinTransportState>,
    action: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    match action.as_str() {
        "get_node_id" => get_node_id(),
        "open_bi" => open_bi(&state, &payload).await,
        "write_message" => write_message(&state, &payload).await,
        "read_message" => read_message(&state, &payload).await,
        "close_stream" => close_stream(&state, &payload).await,
        "stream_info" => stream_info(&state, &payload).await,
        "accept_stream" => accept_stream(&state).await,
        _ => Err(format!("unknown skein_dispatch action: {}", action)),
    }
}

/// get the node ID of the running iroh endpoint
fn get_node_id() -> Result<serde_json::Value, String> {
    let node_id = grimoire::federation::p2p_client::get_node_id()
        .map_err(|e| format!("P2P not initialized: {}", e))?;
    Ok(json!({ "node_id": node_id }))
}

/// open a bidirectional stream to a peer on a specific ALPN
async fn open_bi(
    state: &SkeinTransportState,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let peer_addr = payload["peer_addr"].as_str().ok_or("missing peer_addr")?;
    let alpn = payload["alpn"].as_str().ok_or("missing alpn")?;

    let endpoint = grimoire::federation::p2p_client::get_endpoint_arc()
        .map_err(|e| format!("P2P not initialized: {}", e))?;

    // parse peer address (supports plain node_id hex or endpoint JSON)
    let addr = grimoire::federation::p2p_client::parse_peer_address(peer_addr)
        .map_err(|e| format!("invalid peer address: {}", e))?;

    // connect with the specified ALPN
    let alpn_bytes = alpn.as_bytes();
    let conn = endpoint
        .connect(addr, alpn_bytes)
        .await
        .map_err(|e| format!("failed to connect: {}", e))?;

    // open bidirectional stream
    let (send, recv) = conn
        .open_bi()
        .await
        .map_err(|e| format!("failed to open bi stream: {}", e))?;

    let peer_node_id = conn.remote_id().to_string();
    let handle_id = state.next_handle();

    let stream = Arc::new(BiStreamHandle {
        send: Mutex::new(send),
        recv: Mutex::new(recv),
        peer_node_id: peer_node_id.clone(),
        alpn: alpn.to_string(),
    });

    state.streams.lock().await.insert(handle_id, stream);

    tracing::info!(
        handle = handle_id,
        peer = &peer_node_id[..std::cmp::min(16, peer_node_id.len())],
        alpn = alpn,
        "skein: opened bi stream"
    );

    Ok(json!({
        "handle": handle_id,
        "peer_node_id": peer_node_id,
    }))
}

/// write a length-delimited message to a stream
///
/// framing: 4-byte big-endian u32 length prefix + payload bytes
/// (matches midden WASM framing used by automerge-repo sync)
async fn write_message(
    state: &SkeinTransportState,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let handle_id = payload["handle"].as_u64().ok_or("missing handle")?;
    let data_b64 = payload["data"].as_str().ok_or("missing data")?;

    let data = base64::engine::general_purpose::STANDARD
        .decode(data_b64)
        .map_err(|e| format!("invalid base64: {}", e))?;

    let stream = {
        let map = state.streams.lock().await;
        map.get(&handle_id)
            .cloned()
            .ok_or_else(|| format!("stream handle {} not found", handle_id))?
    };

    let send = &mut *stream.send.lock().await;

    // write 4-byte big-endian length prefix + payload (matches midden framing)
    let len = data.len() as u32;
    send.write_all(&len.to_be_bytes())
        .await
        .map_err(|e| format!("write length failed: {}", e))?;
    send.write_all(&data)
        .await
        .map_err(|e| format!("write data failed: {}", e))?;

    Ok(json!({}))
}

/// read a length-delimited message from a stream
///
/// returns `{ data: "<base64>" }` on success, `{ data: null }` if stream closed
async fn read_message(
    state: &SkeinTransportState,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let handle_id = payload["handle"].as_u64().ok_or("missing handle")?;

    let stream = {
        let map = state.streams.lock().await;
        map.get(&handle_id)
            .cloned()
            .ok_or_else(|| format!("stream handle {} not found", handle_id))?
    };

    let recv = &mut *stream.recv.lock().await;

    // read 4-byte length prefix
    let mut len_buf = [0u8; 4];
    match recv.read_exact(&mut len_buf).await {
        Ok(()) => {}
        Err(e) => {
            let err_str = e.to_string();
            // check for clean stream close (EOF / finished / closed)
            if err_str.contains("finished") || err_str.contains("closed") || err_str.contains("eof")
            {
                return Ok(json!({ "data": serde_json::Value::Null }));
            }
            return Err(format!("read length failed: {}", err_str));
        }
    }

    let len = u32::from_be_bytes(len_buf) as usize;

    // sanity check: reject absurdly large messages (256 MB)
    if len > 256 * 1024 * 1024 {
        return Err(format!("message too large: {} bytes", len));
    }

    let mut buf = vec![0u8; len];
    recv.read_exact(&mut buf)
        .await
        .map_err(|e| format!("read data failed: {}", e))?;

    let data_b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    Ok(json!({ "data": data_b64 }))
}

/// close and remove a stream
async fn close_stream(
    state: &SkeinTransportState,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let handle_id = payload["handle"].as_u64().ok_or("missing handle")?;

    let removed = {
        let mut map = state.streams.lock().await;
        map.remove(&handle_id)
    };

    if let Some(stream) = removed {
        // finish the send half to signal we're done
        let send = &mut *stream.send.lock().await;
        let _ = send.finish();
        tracing::debug!(handle = handle_id, "skein: closed stream");
    }

    Ok(json!({}))
}

/// get stream metadata (peer_node_id, alpn)
async fn stream_info(
    state: &SkeinTransportState,
    payload: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let handle_id = payload["handle"].as_u64().ok_or("missing handle")?;

    let map = state.streams.lock().await;
    let stream = map
        .get(&handle_id)
        .ok_or_else(|| format!("stream handle {} not found", handle_id))?;

    Ok(json!({
        "peer_node_id": stream.peer_node_id,
        "alpn": stream.alpn,
    }))
}

/// accept an incoming stream from a remote peer
///
/// blocks until a stream arrives or returns null if no incoming channel is configured.
/// returns `{ handle, peer_node_id, alpn }` on success, `{ handle: null }` if unavailable.
async fn accept_stream(state: &SkeinTransportState) -> Result<serde_json::Value, String> {
    let mut rx_guard = state.incoming_rx.lock().await;
    let rx = match rx_guard.as_mut() {
        Some(rx) => rx,
        None => return Ok(json!({ "handle": serde_json::Value::Null })),
    };

    match rx.recv().await {
        Some(incoming) => {
            let handle_id = state.next_handle();
            let peer_node_id = incoming.peer_node_id.clone();
            let alpn = incoming.alpn.clone();

            let stream = Arc::new(BiStreamHandle {
                send: Mutex::new(incoming.send),
                recv: Mutex::new(incoming.recv),
                peer_node_id: peer_node_id.clone(),
                alpn: alpn.clone(),
            });

            state.streams.lock().await.insert(handle_id, stream);

            tracing::info!(
                handle = handle_id,
                peer = &peer_node_id[..std::cmp::min(16, peer_node_id.len())],
                alpn = &alpn,
                "skein: accepted incoming stream"
            );

            Ok(json!({
                "handle": handle_id,
                "peer_node_id": peer_node_id,
                "alpn": alpn,
            }))
        }
        None => {
            // channel closed — all protocol handlers shut down
            Ok(json!({ "handle": serde_json::Value::Null }))
        }
    }
}
