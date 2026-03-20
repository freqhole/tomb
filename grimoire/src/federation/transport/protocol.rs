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
        /// optional association metadata (entity_type, entity_id, is_primary)
        associate_with: Option<serde_json::Value>,
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

    /// request server image (public, no auth required)
    /// used during "add remote" flow before user is authenticated
    HelloImageRequest {
        /// request id for correlation
        id: u64,
    },

    /// server image response header - raw bytes follow
    /// same streaming format as BlobStreamResponse
    HelloImageResponse {
        /// request id for correlation
        id: u64,
        /// image size in bytes (if known)
        size: Option<u64>,
        /// mime type (if known)
        content_type: Option<String>,
        /// error message if image not configured
        error: Option<String>,
    },

    /// request to ensure a blob is loaded into FsStore by blake3 hash
    /// used by clients before attempting iroh-blobs download
    EnsureBlobRequest {
        /// request id for correlation
        id: u64,
        /// blake3 hash of blob to ensure (64 hex chars)
        blake3_hash: String,
    },

    /// response indicating whether blob is now available
    EnsureBlobResponse {
        /// request id for correlation
        id: u64,
        /// true if blob is now available in FsStore
        available: bool,
        /// error message if lookup/load failed
        error: Option<String>,
    },

    /// request to compute blake3 hash for a blob (by blob_id/sha256)
    /// used by clients before verified streaming when blake3 not in API response
    ComputeBlake3Request {
        /// request id for correlation
        id: u64,
        /// blob_id (sha256) to compute blake3 for
        blob_id: String,
    },

    /// response with computed blake3 hash
    ComputeBlake3Response {
        /// request id for correlation
        id: u64,
        /// computed blake3 hash (64 hex chars) if successful
        blake3: Option<String>,
        /// error message if computation failed
        error: Option<String>,
    },
}
