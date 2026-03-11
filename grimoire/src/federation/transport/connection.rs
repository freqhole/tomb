//! peer connection wrapper
//!
//! wraps an iroh connection with helper methods for our protocol.

use crate::config::get_config;
use crate::error::{GrimoireError, GrimoireResult};
use crate::federation::transport::protocol::PeerMessage;
use iroh::PublicKey;
use std::sync::atomic::{AtomicU64, Ordering};
use tracing::debug;

/// HTTP proxy response from a peer
#[derive(Debug, Clone)]
pub struct ProxyResponse {
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

/// upload result from a peer
#[derive(Debug, Clone)]
pub struct BlobUploadResult {
    pub blob_id: Option<String>,
    pub job_id: Option<String>,
    /// full server response body for client parsing
    pub body: Option<String>,
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

    /// send an HTTP proxy request and receive the response
    ///
    /// this is the main method for making API calls to a peer's freqhole server.
    pub async fn proxy_request(
        &self,
        method: &str,
        path: &str,
        body: Option<String>,
    ) -> GrimoireResult<ProxyResponse> {
        let id = self.next_request_id();
        let msg = PeerMessage::ProxyRequest {
            id,
            method: method.to_string(),
            path: path.to_string(),
            body,
        };

        let response = self.send_message(&msg).await?;

        match response {
            PeerMessage::ProxyResponse {
                id: resp_id,
                status,
                body,
            } => {
                if resp_id != id {
                    return Err(GrimoireError::FederationApiError {
                        message: format!("response id mismatch: expected {}, got {}", id, resp_id),
                    });
                }
                Ok(ProxyResponse { status, body })
            }
            _ => Err(GrimoireError::FederationApiError {
                message: "unexpected response type for proxy request".to_string(),
            }),
        }
    }

    /// request a blob stream by blob_id
    ///
    /// returns blob metadata and a reader for the raw bytes.
    /// caller is responsible for reading all bytes from the stream.
    pub async fn stream_blob(
        &self,
        blob_id: &str,
    ) -> GrimoireResult<(BlobStreamInfo, iroh::endpoint::RecvStream)> {
        let id = self.next_request_id();
        let (mut send, mut recv) =
            self.conn
                .open_bi()
                .await
                .map_err(|e| GrimoireError::FederationApiError {
                    message: format!("failed to open stream: {}", e),
                })?;

        // send blob stream request
        let msg = PeerMessage::BlobStreamRequest {
            id,
            blob_id: blob_id.to_string(),
        };
        let msg_bytes =
            serde_json::to_vec(&msg).map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to serialize request: {}", e),
            })?;

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
            return Err(GrimoireError::FederationApiError {
                message: format!("blob stream header too large: {} bytes", len),
            });
        }

        let mut resp_bytes = vec![0u8; len];
        recv.read_exact(&mut resp_bytes)
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to read response header: {}", e),
            })?;

        let response: PeerMessage =
            serde_json::from_slice(&resp_bytes).map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to parse response: {}", e),
            })?;

        match response {
            PeerMessage::BlobStreamResponse {
                id: resp_id,
                size,
                content_type,
                error,
            } => {
                if resp_id != id {
                    return Err(GrimoireError::FederationApiError {
                        message: format!("response id mismatch: expected {}, got {}", id, resp_id),
                    });
                }
                if let Some(err) = error {
                    return Err(GrimoireError::FederationApiError {
                        message: format!("blob stream error: {}", err),
                    });
                }
                let info = BlobStreamInfo {
                    blob_id: blob_id.to_string(),
                    size: size.unwrap_or(0),
                    content_type,
                };
                // remaining bytes come from recv stream
                Ok((info, recv))
            }
            _ => Err(GrimoireError::FederationApiError {
                message: "unexpected response type for blob stream".to_string(),
            }),
        }
    }

    /// upload a blob to the peer
    ///
    /// sends a length-prefixed header followed by raw blob bytes.
    /// returns upload result with blob_id and job_id.
    pub async fn upload_blob(
        &self,
        filename: &str,
        content_type: &str,
        data: &[u8],
    ) -> GrimoireResult<BlobUploadResult> {
        let id = self.next_request_id();
        let (mut send, mut recv) =
            self.conn
                .open_bi()
                .await
                .map_err(|e| GrimoireError::FederationApiError {
                    message: format!("failed to open stream: {}", e),
                })?;

        // build upload request header
        let msg = PeerMessage::BlobUploadRequest {
            id,
            filename: filename.to_string(),
            content_type: content_type.to_string(),
            size: data.len() as u64,
        };
        let header_bytes =
            serde_json::to_vec(&msg).map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to serialize upload header: {}", e),
            })?;

        debug!(
            "sending upload {} ({} bytes) to {}",
            filename,
            data.len(),
            self.peer_id
        );

        // write length-prefixed header
        let header_len = header_bytes.len() as u32;
        send.write_all(&header_len.to_be_bytes())
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to write header length: {}", e),
            })?;
        send.write_all(&header_bytes)
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to write header: {}", e),
            })?;

        // write raw blob data
        send.write_all(data)
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to write blob data: {}", e),
            })?;
        send.finish()
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to finish send: {}", e),
            })?;

        // read response
        let max_size = get_config()
            .federation
            .as_ref()
            .map(|f| f.max_message_size_bytes())
            .unwrap_or(10 * 1024 * 1024);
        let resp_bytes =
            recv.read_to_end(max_size)
                .await
                .map_err(|e| GrimoireError::FederationApiError {
                    message: format!("failed to read upload response: {}", e),
                })?;

        let response: PeerMessage =
            serde_json::from_slice(&resp_bytes).map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to parse upload response: {}", e),
            })?;

        match response {
            PeerMessage::BlobUploadResponse {
                id: resp_id,
                blob_id,
                job_id,
                error,
                body,
            } => {
                if resp_id != id {
                    return Err(GrimoireError::FederationApiError {
                        message: format!("response id mismatch: expected {}, got {}", id, resp_id),
                    });
                }
                if let Some(err) = error {
                    return Err(GrimoireError::FederationApiError {
                        message: format!("upload error: {}", err),
                    });
                }
                Ok(BlobUploadResult {
                    blob_id,
                    job_id,
                    body,
                })
            }
            _ => Err(GrimoireError::FederationApiError {
                message: "unexpected response type for upload".to_string(),
            }),
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

        // serialize and send
        let msg_bytes = serde_json::to_vec(msg).map_err(|e| GrimoireError::FederationApiError {
            message: format!("failed to serialize message: {}", e),
        })?;

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

        let response: PeerMessage =
            serde_json::from_slice(&resp_bytes).map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to parse response: {}", e),
            })?;

        Ok(response)
    }

    /// close the connection
    pub fn close(&self, error_code: u32, reason: &str) {
        self.conn.close(error_code.into(), reason.as_bytes());
    }
}
