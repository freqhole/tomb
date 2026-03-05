//! protocol message types and constants

use serde::{Deserialize, Serialize};

/// ALPN protocol identifier for ruhroh connections
pub const RUHROH_ALPN: &[u8] = b"ruhroh/1";

/// Protocol messages - JSON serialized over iroh streams
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum RuhrohMessage {
    /// Simple chat message (legacy/debug)
    Chat { from: String, text: String },
    /// HTTP proxy request
    ProxyRequest {
        id: u64,
        method: String,
        path: String,
        body: Option<String>,
    },
    /// HTTP proxy response
    ProxyResponse { id: u64, status: u16, body: String },
    /// Request a blob by freqhole blob_id - peer will look up file and create iroh ticket
    BlobRequest { id: u64, blob_id: String },
    /// Response with iroh-blobs ticket for fetching
    BlobResponse {
        id: u64,
        ticket: Option<String>,
        error: Option<String>,
    },
    /// Request blob bytes directly (for WASM clients without iroh-blobs)
    BlobStreamRequest { id: u64, blob_id: String },
    /// Response header before streaming blob bytes
    BlobStreamResponse {
        id: u64,
        size: Option<u64>,
        content_type: Option<String>,
        error: Option<String>,
    },
}
