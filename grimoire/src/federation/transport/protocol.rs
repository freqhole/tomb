//! protocol types for peer-to-peer communication
//!
//! uses a proxy pattern - peers send HTTP-like requests that get
//! forwarded to the local freqhole server. this avoids having to
//! manually wrap every API endpoint.

use serde::{Deserialize, Serialize};

/// ALPN protocol identifier for freqhole peer connections
pub const FREQHOLE_ALPN: &[u8] = b"freqhole/1";

/// messages that can be sent between peers
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PeerMessage {
    /// HTTP proxy request - forwarded to local server
    ProxyRequest {
        /// request id for correlation
        id: u64,
        /// HTTP method (GET, POST, PUT, DELETE, etc.)
        method: String,
        /// URL path (e.g., "/api/music/songs")
        path: String,
        /// optional request body (JSON)
        body: Option<String>,
    },

    /// HTTP proxy response
    ProxyResponse {
        /// request id for correlation
        id: u64,
        /// HTTP status code
        status: u16,
        /// response body
        body: String,
    },

    /// request blob stream by blob_id
    /// response will be BlobStreamResponse followed by raw bytes
    BlobStreamRequest {
        /// request id for correlation
        id: u64,
        /// blob_id to stream
        blob_id: String,
    },

    /// blob stream response header - raw bytes follow
    BlobStreamResponse {
        /// request id for correlation
        id: u64,
        /// blob size in bytes (if known)
        size: Option<u64>,
        /// mime type (if known)
        content_type: Option<String>,
        /// error message if blob not found
        error: Option<String>,
    },

    /// request to upload a blob
    /// header is length-prefixed JSON, followed by raw bytes
    BlobUploadRequest {
        /// request id for correlation
        id: u64,
        /// original filename (for metadata extraction)
        filename: String,
        /// content type (mime)
        content_type: String,
        /// total size in bytes
        size: u64,
    },

    /// blob upload response (sent after receiving full blob)
    BlobUploadResponse {
        /// request id for correlation
        id: u64,
        /// created blob_id (if successful)
        blob_id: Option<String>,
        /// job_id for import processing
        job_id: Option<String>,
        /// error message if upload failed
        error: Option<String>,
        /// full server response body for client parsing
        body: Option<String>,
    },
}
