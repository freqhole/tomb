//! freqhole/1 protocol handler for the hub peer.
//!
//! handles incoming `ensure_blob_request` messages from peers who want to
//! download blobs from the hub via iroh-blobs verified transfer. when a peer
//! sends an ensure request, the hub delegates to grimoire's FsStore via
//! `ensure_blob_by_blake3()` which adds the file by reference (only storing
//! the outboard tree, no data copy).
//!
//! the protocol framing matches grimoire's `PeerMessage` format: raw JSON with
//! no length prefix, terminated by the sender calling `finish()` on the send
//! stream. this is the same format used by midden (browser WASM) and charnel
//! (tauri desktop).

use std::sync::Arc;

use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};
use serde::{Deserialize, Serialize};

/// ALPN protocol identifier for freqhole peer connections.
pub const FREQHOLE_ALPN: &[u8] = b"freqhole/1";

// ---------------------------------------------------------------------------
// protocol messages (subset matching grimoire's PeerMessage)
// ---------------------------------------------------------------------------

/// messages for the freqhole/1 protocol.
///
/// only the variants the hub needs are defined here. the wire format matches
/// grimoire's `PeerMessage` exactly (snake_case type tag, snake_case fields).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PeerMessage {
    /// request to ensure a blob is loaded into the store by blake3 hash.
    /// sent by a peer before attempting an iroh-blobs download.
    EnsureBlobRequest { id: u64, blake3_hash: String },

    /// response indicating whether the blob is now available for download.
    EnsureBlobResponse {
        id: u64,
        available: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },

    /// request to compute blake3 hash for a blob by its blob_id (sha256).
    ComputeBlake3Request { id: u64, blob_id: String },

    /// response with computed blake3 hash.
    ComputeBlake3Response {
        id: u64,
        blake3: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
}

// ---------------------------------------------------------------------------
// FreqholeHandler
// ---------------------------------------------------------------------------

/// hub's freqhole/1 protocol handler.
///
/// handles `ensure_blob_request` by ensuring blobs are available in grimoire's
/// FsStore for verified streaming. blobs are added by reference (only the
/// outboard tree is stored, no data copy).
///
/// clone is cheap — backed by `Arc`.
#[derive(Clone)]
pub struct FreqholeHandler {
    inner: Arc<FreqholeInner>,
}

struct FreqholeInner {
    store: &'static iroh_blobs::store::fs::FsStore,
}

impl std::fmt::Debug for FreqholeHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FreqholeHandler").finish_non_exhaustive()
    }
}

impl FreqholeHandler {
    /// create a new freqhole/1 handler backed by grimoire's FsStore.
    pub fn new(store: &'static iroh_blobs::store::fs::FsStore) -> Self {
        Self {
            inner: Arc::new(FreqholeInner { store }),
        }
    }
}

impl ProtocolHandler for FreqholeHandler {
    async fn accept(&self, conn: Connection) -> Result<(), AcceptError> {
        let peer_id = conn.remote_id();
        let peer_id_str = peer_id.to_string();
        let peer_short = &peer_id_str[..16.min(peer_id_str.len())];
        tracing::info!(peer = peer_short, "freqhole/1: accepted connection");

        // accept streams in a loop (mirrors grimoire's handler pattern).
        // each stream carries one request/response pair.
        loop {
            let (send, recv) = match conn.accept_bi().await {
                Ok(bi) => bi,
                Err(e) => {
                    tracing::debug!(
                        peer = peer_short,
                        error = %e,
                        "freqhole/1: connection closed"
                    );
                    break;
                }
            };

            let handler = self.clone();
            let peer_short = peer_short.to_string();
            tokio::spawn(async move {
                if let Err(e) = handle_stream(send, recv, &handler, &peer_short).await {
                    tracing::debug!(
                        peer = %peer_short,
                        error = %e,
                        "freqhole/1: stream error"
                    );
                }
            });
        }

        Ok(())
    }

    async fn shutdown(&self) {
        tracing::debug!("freqhole/1: shutting down");
        // FsStore manages its own lifecycle — nothing to clean up here.
        let _ = self.inner.store;
    }
}

// ---------------------------------------------------------------------------
// stream handling
// ---------------------------------------------------------------------------

/// handle a single request/response stream.
async fn handle_stream(
    mut send: iroh::endpoint::SendStream,
    mut recv: iroh::endpoint::RecvStream,
    handler: &FreqholeHandler,
    peer_short: &str,
) -> Result<(), String> {
    // read the full request (raw JSON, no length prefix)
    let msg_bytes = recv
        .read_to_end(64 * 1024)
        .await
        .map_err(|e| format!("failed to read request: {e}"))?;

    let msg: PeerMessage = match serde_json::from_slice(&msg_bytes) {
        Ok(m) => m,
        Err(e) => {
            let preview = String::from_utf8_lossy(&msg_bytes[..msg_bytes.len().min(200)]);
            tracing::warn!(
                peer = peer_short,
                error = %e,
                raw_preview = %preview,
                "freqhole/1: failed to parse request"
            );
            return Err(format!("failed to parse request: {e}"));
        }
    };

    tracing::info!(
        peer = peer_short,
        msg_type = match &msg {
            PeerMessage::EnsureBlobRequest { .. } => "ensure_blob_request",
            PeerMessage::ComputeBlake3Request { .. } => "compute_blake3_request",
            _ => "other",
        },
        "freqhole/1: received request"
    );

    match msg {
        PeerMessage::EnsureBlobRequest { id, blake3_hash } => {
            handle_ensure_blob(&mut send, handler, peer_short, id, &blake3_hash).await
        }

        PeerMessage::ComputeBlake3Request { id, blob_id } => {
            handle_compute_blake3(&mut send, peer_short, id, &blob_id).await
        }

        _ => {
            tracing::debug!(
                peer = peer_short,
                "freqhole/1: ignoring non-request message"
            );
            Ok(())
        }
    }
}

/// handle an ensure_blob_request: look up the blob in grimoire, ensure it's
/// in the FsStore, and respond with availability.
async fn handle_ensure_blob(
    send: &mut iroh::endpoint::SendStream,
    handler: &FreqholeHandler,
    peer_short: &str,
    id: u64,
    blake3_hash: &str,
) -> Result<(), String> {
    let hash_short = &blake3_hash[..16.min(blake3_hash.len())];
    let hash_len = blake3_hash.len();
    tracing::info!(
        peer = peer_short,
        hash_short = hash_short,
        hash_full = blake3_hash,
        hash_len,
        "freqhole/1: ensure_blob request (blake3 should be 64 hex chars)"
    );

    if hash_len != 64 {
        tracing::warn!(
            peer = peer_short,
            hash_full = blake3_hash,
            hash_len,
            "freqhole/1: received non-blake3 hash! expected 64 hex chars — client may be sending a blob ID instead of a blake3 hash"
        );
    }

    let (available, error) = ensure_blob_in_store(handler, blake3_hash).await;

    if available {
        tracing::info!(
            peer = peer_short,
            hash = hash_short,
            "freqhole/1: blob ensured in store"
        );
    } else {
        tracing::debug!(
            peer = peer_short,
            hash = hash_short,
            error = ?error,
            "freqhole/1: blob not available"
        );
    }

    let resp = PeerMessage::EnsureBlobResponse {
        id,
        available,
        error,
    };
    send_response(send, &resp).await
}

/// handle a compute_blake3_request: compute the blake3 hash for a blob
/// identified by its blob_id (sha256).
async fn handle_compute_blake3(
    send: &mut iroh::endpoint::SendStream,
    peer_short: &str,
    id: u64,
    blob_id: &str,
) -> Result<(), String> {
    let id_short = &blob_id[..16.min(blob_id.len())];
    tracing::debug!(
        peer = peer_short,
        blob_id = id_short,
        "freqhole/1: compute_blake3 request"
    );

    // look up blob in grimoire
    let (blake3, error) = match grimoire::media_blobz::get_media_blob(blob_id).await {
        Ok(blob) => {
            if let Some(ref hash) = blob.blake3 {
                // already has blake3
                (Some(hash.clone()), None)
            } else if let Some(ref local_path) = blob.local_path {
                // compute from file
                match tokio::fs::read(local_path).await {
                    Ok(data) => {
                        let hash = blake3::hash(&data);
                        let hash_str = hash.to_hex().to_string();
                        // update in grimoire for next time
                        let _ = grimoire::media_blobz::update_blob_blake3(blob_id, &hash_str).await;
                        (Some(hash_str), None)
                    }
                    Err(e) => (None, Some(format!("failed to read file: {e}"))),
                }
            } else {
                // try blob_data table
                match grimoire::blob_data::get_blob_data(blob_id).await.data {
                    Some(data) => {
                        let hash = blake3::hash(&data);
                        let hash_str = hash.to_hex().to_string();
                        let _ = grimoire::media_blobz::update_blob_blake3(blob_id, &hash_str).await;
                        (Some(hash_str), None)
                    }
                    None => (None, Some("no data available".to_string())),
                }
            }
        }
        Err(_) => (None, Some("blob not found".to_string())),
    };

    let resp = PeerMessage::ComputeBlake3Response { id, blake3, error };
    send_response(send, &resp).await
}

// ---------------------------------------------------------------------------
// blob import logic
// ---------------------------------------------------------------------------

/// ensure a blob is available in grimoire's FsStore by blake3 hash.
///
/// delegates to `grimoire::blobz::ensure_blob_by_blake3()` which:
/// 1. checks if already in FsStore
/// 2. looks up blob in grimoire by blake3
/// 3. adds file to FsStore by reference (only stores outboard tree, no data copy)
async fn ensure_blob_in_store(
    _handler: &FreqholeHandler,
    blake3_hash: &str,
) -> (bool, Option<String>) {
    match grimoire::blobz::ensure_blob_by_blake3(blake3_hash).await {
        Ok(true) => {
            tracing::info!(
                hash = &blake3_hash[..blake3_hash.len().min(16)],
                "freqhole/1: blob available in FsStore"
            );
            (true, None)
        }
        Ok(false) => {
            tracing::info!(
                hash = &blake3_hash[..blake3_hash.len().min(16)],
                "freqhole/1: blob not found in grimoire by blake3"
            );
            (
                false,
                Some("blob not found in grimoire by blake3".to_string()),
            )
        }
        Err(e) => {
            tracing::warn!(
                hash = &blake3_hash[..blake3_hash.len().min(16)],
                error = %e,
                "freqhole/1: failed to ensure blob in FsStore"
            );
            (false, Some(format!("failed to ensure blob: {e}")))
        }
    }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/// send a response message as raw JSON (no length prefix), then finish the stream.
async fn send_response(
    send: &mut iroh::endpoint::SendStream,
    msg: &PeerMessage,
) -> Result<(), String> {
    let bytes =
        serde_json::to_vec(msg).map_err(|e| format!("failed to serialize response: {e}"))?;

    tracing::info!(
        response_size = bytes.len(),
        response_type = match msg {
            PeerMessage::EnsureBlobResponse { available, .. } => {
                if *available {
                    "ensure_blob_response(available=true)"
                } else {
                    "ensure_blob_response(available=false)"
                }
            }
            PeerMessage::ComputeBlake3Response { blake3, .. } => {
                if blake3.is_some() {
                    "compute_blake3_response(found)"
                } else {
                    "compute_blake3_response(not_found)"
                }
            }
            _ => "other",
        },
        "freqhole/1: sending response"
    );

    send.write_all(&bytes)
        .await
        .map_err(|e| format!("failed to write response: {e}"))?;
    send.finish()
        .map_err(|e| format!("failed to finish stream: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// client-side helpers (for the snatch module to use)
// ---------------------------------------------------------------------------

/// send an `ensure_blob_request` to a peer and return whether the blob is available.
///
/// connects to the peer on the `freqhole/1` ALPN, sends the request as raw JSON,
/// reads the response, and returns the availability status.
pub async fn send_ensure_blob_request(
    endpoint: &iroh::Endpoint,
    peer_node_id: iroh::PublicKey,
    blake3_hash: &str,
) -> Result<bool, String> {
    let addr = iroh::EndpointAddr::from(peer_node_id);
    let conn = endpoint
        .connect(addr, FREQHOLE_ALPN)
        .await
        .map_err(|e| format!("failed to connect to peer: {e}"))?;

    let (mut send, mut recv) = conn
        .open_bi()
        .await
        .map_err(|e| format!("failed to open bi stream: {e}"))?;

    // send ensure request
    let request = PeerMessage::EnsureBlobRequest {
        id: 1,
        blake3_hash: blake3_hash.to_string(),
    };
    let bytes =
        serde_json::to_vec(&request).map_err(|e| format!("failed to serialize request: {e}"))?;
    send.write_all(&bytes)
        .await
        .map_err(|e| format!("failed to write request: {e}"))?;
    send.finish()
        .map_err(|e| format!("failed to finish request stream: {e}"))?;

    // read response
    let response_bytes = recv
        .read_to_end(64 * 1024)
        .await
        .map_err(|e| format!("failed to read response: {e}"))?;

    let response: PeerMessage = serde_json::from_slice(&response_bytes)
        .map_err(|e| format!("failed to parse response: {e}"))?;

    match response {
        PeerMessage::EnsureBlobResponse {
            available, error, ..
        } => {
            if let Some(err) = error {
                tracing::debug!(error = %err, "ensure_blob error from peer");
            }
            Ok(available)
        }
        _ => Err("unexpected response type".to_string()),
    }
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_peer_message_ensure_blob_request_serialization() {
        let msg = PeerMessage::EnsureBlobRequest {
            id: 42,
            blake3_hash: "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"
                .to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"ensure_blob_request""#));
        assert!(json.contains(r#""id":42"#));
        assert!(json.contains(r#""blake3_hash":"af1349b9"#));

        // round-trip
        let parsed: PeerMessage = serde_json::from_str(&json).unwrap();
        match parsed {
            PeerMessage::EnsureBlobRequest { id, blake3_hash } => {
                assert_eq!(id, 42);
                assert!(blake3_hash.starts_with("af1349b9"));
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn test_peer_message_ensure_blob_response_serialization() {
        let msg = PeerMessage::EnsureBlobResponse {
            id: 42,
            available: true,
            error: None,
        };

        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"ensure_blob_response""#));
        assert!(json.contains(r#""available":true"#));
        // error should be omitted when None
        assert!(!json.contains("error"));

        let msg_with_error = PeerMessage::EnsureBlobResponse {
            id: 1,
            available: false,
            error: Some("not found".to_string()),
        };
        let json2 = serde_json::to_string(&msg_with_error).unwrap();
        assert!(json2.contains(r#""error":"not found""#));
    }

    #[test]
    fn test_peer_message_compute_blake3_round_trip() {
        let msg = PeerMessage::ComputeBlake3Request {
            id: 7,
            blob_id: "abc123".to_string(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains(r#""type":"compute_blake3_request""#));

        let resp = PeerMessage::ComputeBlake3Response {
            id: 7,
            blake3: Some("deadbeef".to_string()),
            error: None,
        };
        let json2 = serde_json::to_string(&resp).unwrap();
        assert!(json2.contains(r#""type":"compute_blake3_response""#));
        assert!(json2.contains(r#""blake3":"deadbeef""#));
    }

    /// verify wire format matches what midden/browser expects (snake_case tags)
    #[test]
    fn test_wire_format_compatibility_with_midden() {
        // midden sends: {"type":"ensure_blob_request","id":1,"blake3_hash":"..."}
        let midden_json = r#"{"type":"ensure_blob_request","id":1,"blake3_hash":"af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262"}"#;
        let parsed: PeerMessage = serde_json::from_str(midden_json).unwrap();
        match parsed {
            PeerMessage::EnsureBlobRequest { id, blake3_hash } => {
                assert_eq!(id, 1);
                assert_eq!(blake3_hash.len(), 64);
            }
            _ => panic!("should parse as EnsureBlobRequest"),
        }

        // hub responds: {"type":"ensure_blob_response","id":1,"available":true}
        let hub_response = PeerMessage::EnsureBlobResponse {
            id: 1,
            available: true,
            error: None,
        };
        let json = serde_json::to_string(&hub_response).unwrap();
        // browser expects snake_case type tag
        assert!(json.contains(r#""type":"ensure_blob_response""#));
    }
}
