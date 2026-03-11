//! P2P client functions for outbound peer connections
//!
//! provides functions to make API requests and fetch blobs from remote peers
//! using the server's federation endpoint. this is used by:
//! - tauri app (via tauri commands) for native P2P transport
//! - server routes for HTTP-based P2P proxy
//!
//! the endpoint must be initialized via `set_federation_endpoint()` before use.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock, RwLock};

use iroh::{Endpoint, EndpointAddr, PublicKey};
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

use crate::error::{GrimoireError, GrimoireResult};
use crate::federation::transport::{PeerConnection, FREQHOLE_ALPN};

/// global federation endpoint for P2P client operations
static FEDERATION_ENDPOINT: OnceLock<Arc<Endpoint>> = OnceLock::new();

/// cached peer connections (expensive to create due to NAT traversal)
static PEER_CONNECTIONS: OnceLock<RwLock<HashMap<PublicKey, Arc<PeerConnection>>>> =
    OnceLock::new();

/// response from a P2P proxy request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2pProxyResponse {
    pub status: u16,
    pub body: String,
}

/// blob data with metadata
#[derive(Debug, Clone)]
pub struct P2pBlobData {
    pub data: Vec<u8>,
    pub content_type: Option<String>,
    pub size: u64,
}

/// upload result with blob and job ids
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2pUploadResult {
    pub blob_id: Option<String>,
    pub job_id: Option<String>,
    /// full server response body for client parsing
    pub body: Option<String>,
}

/// set the federation endpoint for client operations
///
/// call this after creating the federation endpoint in the server.
/// subsequent calls will be ignored (endpoint is set once).
pub fn set_federation_endpoint(endpoint: &Endpoint) {
    let _ = FEDERATION_ENDPOINT.set(Arc::new(endpoint.clone()));
    let _ = PEER_CONNECTIONS.set(RwLock::new(HashMap::new()));
    info!("P2P client endpoint initialized");
}

/// check if the federation endpoint is available for client operations
pub fn is_endpoint_available() -> bool {
    FEDERATION_ENDPOINT.get().is_some()
}

/// get the endpoint, returning error if not initialized
fn get_endpoint() -> GrimoireResult<Arc<Endpoint>> {
    FEDERATION_ENDPOINT
        .get()
        .cloned()
        .ok_or_else(|| GrimoireError::FederationApiError {
            message: "federation endpoint not initialized".to_string(),
        })
}

/// parse peer address string to get PublicKey
///
/// accepts either:
/// - plain node_id (64 hex chars): "13a257b5..."
/// - full endpoint JSON: {"id":"...","addrs":[...]}
pub fn parse_peer_address(peer_addr: &str) -> GrimoireResult<EndpointAddr> {
    let trimmed = peer_addr.trim();

    // try parsing as JSON endpoint address first
    if trimmed.starts_with('{') {
        serde_json::from_str::<EndpointAddr>(trimmed).map_err(|e| {
            GrimoireError::FederationApiError {
                message: format!("invalid endpoint JSON: {}", e),
            }
        })
    } else {
        // parse as plain node_id
        let node_id: PublicKey =
            trimmed
                .parse()
                .map_err(|e| GrimoireError::FederationApiError {
                    message: format!("invalid node_id: {}", e),
                })?;

        // create EndpointAddr with empty addresses - iroh uses relay discovery
        Ok(EndpointAddr::from_parts(node_id, []))
    }
}

/// get or create a connection to a peer
///
/// connections are cached to avoid NAT traversal overhead on every request.
async fn get_or_connect(
    endpoint: &Endpoint,
    addr: &EndpointAddr,
) -> GrimoireResult<Arc<PeerConnection>> {
    let peer_id = addr.id;

    // check cache first
    if let Some(connections) = PEER_CONNECTIONS.get() {
        let connections_read =
            connections
                .read()
                .map_err(|_| GrimoireError::FederationApiError {
                    message: "failed to acquire connection cache lock".to_string(),
                })?;

        if let Some(conn) = connections_read.get(&peer_id) {
            // verify connection is still open
            if conn.is_open() {
                debug!(
                    "reusing cached connection to {}",
                    &peer_id.to_string()[..16]
                );
                return Ok(conn.clone());
            }
        }
    }

    // need new connection
    let node_id_short = &peer_id.to_string()[..16];
    info!("connecting to peer {}...", node_id_short);

    let conn = endpoint
        .connect(addr.clone(), FREQHOLE_ALPN)
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("failed to connect to peer {}: {}", node_id_short, e),
        })?;

    let peer_conn = Arc::new(PeerConnection::new(conn, peer_id));

    // cache the connection
    if let Some(connections) = PEER_CONNECTIONS.get() {
        if let Ok(mut connections_write) = connections.write() {
            connections_write.insert(peer_id, peer_conn.clone());
        }
    }

    info!("connected to peer {}", node_id_short);
    Ok(peer_conn)
}

/// send an API request to a remote peer
///
/// uses the server's federation endpoint to connect to the peer and proxy
/// an HTTP-like request. returns the response status and body.
pub async fn proxy_request(
    peer_addr: &str,
    method: &str,
    path: &str,
    body: Option<String>,
) -> GrimoireResult<P2pProxyResponse> {
    let endpoint = get_endpoint()?;
    let addr = parse_peer_address(peer_addr)?;
    let node_id_short = &addr.id.to_string()[..16];

    debug!("P2P proxy {} {} to {}", method, path, node_id_short);

    let conn = get_or_connect(&endpoint, &addr).await?;
    let response = conn.proxy_request(method, path, body).await?;

    Ok(P2pProxyResponse {
        status: response.status,
        body: response.body,
    })
}

/// fetch a blob from a remote peer
///
/// streams the blob data and returns it along with metadata.
/// returns error if blob not found or connection fails.
pub async fn fetch_blob(peer_addr: &str, blob_id: &str) -> GrimoireResult<P2pBlobData> {
    let endpoint = get_endpoint()?;
    let addr = parse_peer_address(peer_addr)?;
    let node_id_short = &addr.id.to_string()[..16];
    let blob_id_short = &blob_id[..16.min(blob_id.len())];

    info!("fetching blob {} from {}", blob_id_short, node_id_short);

    let conn = get_or_connect(&endpoint, &addr).await?;
    let (info, mut stream) = conn.stream_blob(blob_id).await?;

    // read all blob data (100MB max)
    let data = stream.read_to_end(100 * 1024 * 1024).await.map_err(|e| {
        GrimoireError::FederationApiError {
            message: format!("failed to read blob data: {}", e),
        }
    })?;

    info!(
        "received {} bytes for blob {} from {}",
        data.len(),
        blob_id_short,
        node_id_short
    );

    Ok(P2pBlobData {
        data,
        content_type: info.content_type,
        size: info.size,
    })
}

/// upload a blob to a remote peer
///
/// sends the blob data to the peer's server for import.
/// returns blob_id and job_id on success.
pub async fn upload_blob(
    peer_addr: &str,
    filename: &str,
    content_type: &str,
    data: &[u8],
) -> GrimoireResult<P2pUploadResult> {
    let endpoint = get_endpoint()?;
    let addr = parse_peer_address(peer_addr)?;
    let node_id_short = &addr.id.to_string()[..16];

    info!(
        "uploading {} ({} bytes) to {}",
        filename,
        data.len(),
        node_id_short
    );

    let conn = get_or_connect(&endpoint, &addr).await?;
    let result = conn.upload_blob(filename, content_type, data).await?;

    info!(
        "upload complete: blob_id={:?}, job_id={:?}",
        result.blob_id, result.job_id
    );

    Ok(P2pUploadResult {
        blob_id: result.blob_id,
        job_id: result.job_id,
        body: result.body,
    })
}

/// get our node_id (for display/debugging)
pub fn get_node_id() -> GrimoireResult<String> {
    let endpoint = get_endpoint()?;
    Ok(endpoint.secret_key().public().to_string())
}

/// close a specific peer connection (removes from cache)
pub fn close_connection(peer_addr: &str) -> GrimoireResult<()> {
    let addr = parse_peer_address(peer_addr)?;

    if let Some(connections) = PEER_CONNECTIONS.get() {
        if let Ok(mut connections_write) = connections.write() {
            if let Some(conn) = connections_write.remove(&addr.id) {
                conn.close(0, "client requested close");
                info!("closed connection to {}", &addr.id.to_string()[..16]);
            }
        }
    }

    Ok(())
}

/// close all cached peer connections
pub fn close_all_connections() {
    if let Some(connections) = PEER_CONNECTIONS.get() {
        if let Ok(mut connections_write) = connections.write() {
            for (peer_id, conn) in connections_write.drain() {
                conn.close(0, "closing all connections");
                debug!("closed connection to {}", &peer_id.to_string()[..16]);
            }
        }
    }
    info!("closed all P2P client connections");
}
