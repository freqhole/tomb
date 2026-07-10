//! protocol types for peer-to-peer communication
//!
//! peers send api-shaped requests (method, path, body) that get dispatched
//! to the local freqhole server. this avoids having to manually wrap every
//! API endpoint in its own wire message.

use serde::{Deserialize, Serialize};

/// ALPN protocol identifier for freqhole peer connections
pub const FREQHOLE_ALPN: &[u8] = b"freqhole/1";

/// messages that can be sent between peers
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PeerMessage {
    /// api request - dispatched to the local server
    ApiRequest {
        /// request id for correlation
        id: u64,
        /// HTTP method (GET, POST, PUT, DELETE, etc.)
        method: String,
        /// URL path (e.g., "/api/music/songs")
        path: String,
        /// optional request body (JSON)
        body: Option<String>,
    },

    /// api response
    ApiResponse {
        /// request id for correlation
        id: u64,
        /// HTTP status code
        status: u16,
        /// response body
        body: String,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_request_serializes_with_api_request_tag() {
        let msg = PeerMessage::ApiRequest {
            id: 1,
            method: "GET".to_string(),
            path: "/api/music/songs".to_string(),
            body: None,
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"api_request\""));
        assert!(!json.contains("proxy_request"));

        let round_tripped: PeerMessage = serde_json::from_str(&json).unwrap();
        assert!(matches!(round_tripped, PeerMessage::ApiRequest { id, .. } if id == 1));
    }

    #[test]
    fn api_response_serializes_with_api_response_tag() {
        let msg = PeerMessage::ApiResponse {
            id: 1,
            status: 200,
            body: "{}".to_string(),
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"api_response\""));
        assert!(!json.contains("proxy_response"));

        let round_tripped: PeerMessage = serde_json::from_str(&json).unwrap();
        assert!(matches!(round_tripped, PeerMessage::ApiResponse { id, .. } if id == 1));
    }
}
