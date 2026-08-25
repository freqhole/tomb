//! peer connection wrapper
//!
//! wraps an iroh connection with helper methods for our protocol.

use crate::config::get_config;
use crate::error::{GrimoireError, GrimoireResult};
use crate::federation::transport::protocol::PeerMessage;
use iroh::PublicKey;
use std::sync::atomic::{AtomicU64, Ordering};
use tracing::debug;

/// api response from a peer
#[derive(Debug, Clone)]
pub struct ApiResponse {
    pub status: u16,
    pub body: String,
}

/// info about a blob being streamed from a peer
#[derive(Debug, Clone)]
pub struct BlobStreamInfo {
    pub blob_id: String,
    pub size: u64,
    pub content_type: Option<String>,
}

/// outcome of an ensure_blob call to a peer
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EnsureBlobOutcome {
    /// peer has the blob loaded in FsStore and ready to serve
    Available,
    /// peer doesn't have a media_blob row for this blake3 (or local file missing)
    NotAvailable,
    /// peer refused because we're not a registered federation peer.
    /// caller should create a knock request to request access.
    Unauthorized,
}

/// wrapper around an iroh connection to a peer
pub struct PeerConnection {
    conn: iroh::endpoint::Connection,
    peer_id: PublicKey,
    request_id: AtomicU64,
}

impl PeerConnection {
    /// create a new peer connection wrapper
    pub fn new(conn: iroh::endpoint::Connection, peer_id: PublicKey) -> Self {
        Self {
            conn,
            peer_id,
            request_id: AtomicU64::new(1),
        }
    }

    /// get the peer's node_id
    pub fn peer_id(&self) -> PublicKey {
        self.peer_id
    }

    /// check if the connection is still open
    pub fn is_open(&self) -> bool {
        self.conn.close_reason().is_none()
    }

    /// get next request id
    fn next_request_id(&self) -> u64 {
        self.request_id.fetch_add(1, Ordering::SeqCst)
    }

    /// send an api request and receive the response
    ///
    /// this is the main method for making API calls to a peer's freqhole server.
    pub async fn api_request(
        &self,
        method: &str,
        path: &str,
        body: Option<String>,
    ) -> GrimoireResult<ApiResponse> {
        let id = self.next_request_id();
        let msg = PeerMessage::ApiRequest {
            id,
            method: method.to_string(),
            path: path.to_string(),
            body,
        };

        let response = self.send_message(&msg).await?;

        match response {
            PeerMessage::ApiResponse {
                id: resp_id,
                status,
                body,
            } => {
                if resp_id != id {
                    return Err(response_id_mismatch(id, resp_id));
                }
                Ok(ApiResponse { status, body })
            }
            _ => Err(unexpected_response("api request")),
        }
    }

    /// request server image stream (public, no auth required)
    ///
    /// returns image metadata and a reader for the raw bytes.
    /// used during "add remote" flow before user is authenticated.
    pub async fn stream_hello_image(
        &self,
    ) -> GrimoireResult<(BlobStreamInfo, iroh::endpoint::RecvStream)> {
        let id = self.next_request_id();
        let (mut send, mut recv) =
            self.conn
                .open_bi()
                .await
                .map_err(|e| GrimoireError::FederationApiError {
                    message: format!("failed to open stream: {}", e),
                })?;

        // send hello image request
        let msg = PeerMessage::HelloImageRequest { id };
        let msg_bytes = serde_json::to_vec(&msg).map_err(GrimoireError::Serialization)?;

        send.write_all(&msg_bytes)
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to write request: {}", e),
            })?;
        send.finish()
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to finish send: {}", e),
            })?;

        // read response header - length-prefixed JSON
        let mut len_bytes = [0u8; 4];
        recv.read_exact(&mut len_bytes)
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to read response length: {}", e),
            })?;
        let len = u32::from_be_bytes(len_bytes) as usize;

        if len > 64 * 1024 {
            // an oversized length prefix means the peer's framing is broken
            // or malicious - not something a retry of the same stream fixes.
            return Err(GrimoireError::PeerProtocolMismatch {
                reason: format!("hello image header too large: {} bytes", len),
            });
        }

        let mut resp_bytes = vec![0u8; len];
        recv.read_exact(&mut resp_bytes)
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to read response header: {}", e),
            })?;

        let response: PeerMessage =
            serde_json::from_slice(&resp_bytes).map_err(GrimoireError::Serialization)?;

        match response {
            PeerMessage::HelloImageResponse {
                id: resp_id,
                size,
                content_type,
                error,
                error_type: _,
            } => {
                if resp_id != id {
                    return Err(response_id_mismatch(id, resp_id));
                }
                if let Some(err) = error {
                    // peer explicitly told us it can't serve a hello image -
                    // permanent for this peer, not a network hiccup.
                    return Err(GrimoireError::PeerRejected {
                        peer_id: self.peer_id.to_string(),
                        reason: format!("hello image error: {}", err),
                    });
                }
                let info = BlobStreamInfo {
                    blob_id: "hello-image".to_string(),
                    size: size.unwrap_or(0),
                    content_type,
                };
                // remaining bytes come from recv stream
                Ok((info, recv))
            }
            _ => Err(unexpected_response("hello image")),
        }
    }

    /// ensure a blob is loaded into the peer's FsStore by blake3 hash
    ///
    /// this should be called before attempting iroh-blobs download if the
    /// first attempt fails. the server will look up the file by blake3 hash
    /// and add it to FsStore for verified streaming.
    ///
    /// returns `EnsureBlobOutcome::Available` if the blob is now in FsStore,
    /// `NotAvailable` if the peer has no media_blob row for this blake3,
    /// or `Unauthorized` if the peer refused because we're not a registered
    /// federation peer (caller should create a knock request).
    pub async fn ensure_blob(&self, blake3_hash: &str) -> GrimoireResult<EnsureBlobOutcome> {
        let id = self.next_request_id();
        let msg = PeerMessage::EnsureBlobRequest {
            id,
            blake3_hash: blake3_hash.to_string(),
        };

        let response = self.send_message(&msg).await?;

        match response {
            PeerMessage::EnsureBlobResponse {
                id: resp_id,
                available,
                error,
                error_type,
            } => {
                if resp_id != id {
                    return Err(response_id_mismatch(id, resp_id));
                }
                if let Some(err) = error {
                    debug!(
                        "ensure_blob error for {}: {}",
                        &blake3_hash[..16.min(blake3_hash.len())],
                        err
                    );
                    // distinguish "unauthorized" so the caller can knock. checks
                    // the structured error_type field (populated by handler.rs)
                    // instead of sniffing the human-readable error message.
                    if error_type.as_deref() == Some("unauthorized") {
                        return Ok(EnsureBlobOutcome::Unauthorized);
                    }
                    // NOTE: everything else still collapses to NotAvailable
                    // here - splitting "peer never had this blob" from "peer
                    // had it but the local file is missing" requires
                    // blobz::ensure_blob_by_blake3 (grimoire/src/blobz/blake3.rs)
                    // to return more than a bare bool, which is out of scope
                    // for this pass (see docs/error-handling-tasks.md).
                    return Ok(EnsureBlobOutcome::NotAvailable);
                }
                Ok(if available {
                    EnsureBlobOutcome::Available
                } else {
                    EnsureBlobOutcome::NotAvailable
                })
            }
            _ => Err(unexpected_response("ensure blob")),
        }
    }

    /// compute blake3 hash for a blob on demand
    ///
    /// use this when the client doesn't have the blake3 hash yet (not in API response).
    /// the server will compute the hash, save it to the database, and add the file
    /// to FsStore for verified streaming.
    ///
    /// returns the blake3 hash if successful, None if blob not found.
    pub async fn compute_blake3(&self, blob_id: &str) -> GrimoireResult<Option<String>> {
        let id = self.next_request_id();
        let msg = PeerMessage::ComputeBlake3Request {
            id,
            blob_id: blob_id.to_string(),
        };

        let response = self.send_message(&msg).await?;

        match response {
            PeerMessage::ComputeBlake3Response {
                id: resp_id,
                blake3,
                error,
                error_type: _,
            } => {
                if resp_id != id {
                    return Err(response_id_mismatch(id, resp_id));
                }
                if let Some(err) = error {
                    debug!(
                        "compute_blake3 error for {}: {}",
                        &blob_id[..16.min(blob_id.len())],
                        err
                    );
                    return Ok(None);
                }
                Ok(blake3)
            }
            _ => Err(unexpected_response("compute blake3")),
        }
    }

    /// send a message and receive the response
    async fn send_message(&self, msg: &PeerMessage) -> GrimoireResult<PeerMessage> {
        let (mut send, mut recv) =
            self.conn
                .open_bi()
                .await
                .map_err(|e| GrimoireError::FederationApiError {
                    message: format!("failed to open stream: {}", e),
                })?;

        // serialize and send - a failure here is a bug in our own outgoing
        // data, not a network issue, so it's not retryable.
        let msg_bytes = serde_json::to_vec(msg).map_err(GrimoireError::Serialization)?;

        debug!("sending {} bytes to {}", msg_bytes.len(), self.peer_id);

        send.write_all(&msg_bytes)
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to write message: {}", e),
            })?;
        send.finish()
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to finish send: {}", e),
            })?;

        // read response - use configured max message size
        let max_size = get_config()
            .federation
            .as_ref()
            .map(|f| f.max_message_size_bytes())
            .unwrap_or(10 * 1024 * 1024);
        let resp_bytes =
            recv.read_to_end(max_size)
                .await
                .map_err(|e| GrimoireError::FederationApiError {
                    message: format!("failed to read response: {}", e),
                })?;

        debug!("received {} bytes from {}", resp_bytes.len(), self.peer_id);

        // a malformed response means the peer sent us something our
        // protocol can't understand - not retryable by resending.
        let response: PeerMessage =
            serde_json::from_slice(&resp_bytes).map_err(GrimoireError::Serialization)?;

        Ok(response)
    }

    /// close the connection
    pub fn close(&self, error_code: u32, reason: &str) {
        self.conn.close(error_code.into(), reason.as_bytes());
    }
}

/// a peer responded with a request id that doesn't match ours - a protocol
/// violation, not a network blip. permanent, not retryable.
fn response_id_mismatch(expected: u64, got: u64) -> GrimoireError {
    GrimoireError::PeerProtocolMismatch {
        reason: format!("response id mismatch: expected {}, got {}", expected, got),
    }
}

/// a peer responded with a `PeerMessage` variant we didn't ask for - a
/// protocol violation, not a network blip. permanent, not retryable.
fn unexpected_response(request_kind: &str) -> GrimoireError {
    GrimoireError::PeerProtocolMismatch {
        reason: format!("unexpected response type for {}", request_kind),
    }
}
