//! P2P tauri commands for native iroh transport
//!
//! provides tauri IPC commands for making P2P requests to remote peers
//! using the server's federation endpoint. used by TauriTransport.ts.

use serde::{Deserialize, Serialize};
use std::path::Path;

/// response from p2p_proxy_request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2pResponse {
    pub status: u16,
    pub body: String,
}

/// blob response with base64 data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2pBlobResponse {
    /// base64-encoded blob data
    pub data: String,
    pub content_type: Option<String>,
    pub size: u64,
}

/// upload response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2pUploadResponse {
    pub blob_id: Option<String>,
    pub job_id: Option<String>,
    /// full server response body for client parsing
    pub body: Option<String>,
}

/// initialize P2P client endpoint for outbound connections
///
/// must be called after the server starts and grimoire config is available.
/// this creates an iroh endpoint in the Tauri app process for making
/// outbound P2P connections to remote peers.
///
/// safe to call multiple times (e.g., after server restart) - clears any
/// existing endpoint first.
pub async fn init_p2p_client(config_path: &Path) -> Result<(), String> {
    // clear any existing endpoint first (safe to call even if none exists)
    grimoire::federation::p2p_client::clear_federation_endpoint();

    // initialize grimoire config from server config (ignore if already initialized)
    let _ = grimoire::config::init_config(Some(config_path.to_path_buf()));

    // check if federation is enabled
    let config = grimoire::config::get_config();
    let federation_enabled = config
        .federation
        .as_ref()
        .map(|f| f.enabled)
        .unwrap_or(false);

    if !federation_enabled {
        eprintln!("[p2p] federation not enabled in config, skipping P2P client init");
        return Ok(());
    }

    // create endpoint for outbound P2P connections
    // (we don't need the accept loop since we're client-only)
    eprintln!("[p2p] initializing P2P client endpoint...");

    let endpoint = grimoire::federation::transport::FederationEndpoint::new()
        .await
        .map_err(|e| format!("failed to create P2P endpoint: {}", e))?;

    let node_id = endpoint.node_id();
    eprintln!("[p2p] P2P client endpoint ready, node_id: {}", node_id);

    // register endpoint for P2P client operations
    grimoire::federation::p2p_client::set_federation_endpoint(endpoint.endpoint());

    eprintln!("[p2p] P2P client initialized successfully");
    Ok(())
}

/// check if P2P client is available (federation endpoint initialized)
#[tauri::command]
pub fn p2p_is_available() -> bool {
    grimoire::federation::p2p_client::is_endpoint_available()
}

/// get the server's node_id for P2P
#[tauri::command]
pub fn p2p_get_node_id() -> Result<String, String> {
    grimoire::federation::p2p_client::get_node_id().map_err(|e| e.to_string())
}

/// send an API request to a remote peer via P2P
///
/// peer_addr: node_id (64 hex chars) or full endpoint JSON
/// method: HTTP method (GET, POST, etc)
/// path: API path (e.g., /api/music/songs)
/// body: optional JSON body for POST/PUT requests
#[tauri::command]
pub async fn p2p_proxy_request(
    peer_addr: String,
    method: String,
    path: String,
    body: Option<String>,
) -> Result<P2pResponse, String> {
    let response =
        grimoire::federation::p2p_client::proxy_request(&peer_addr, &method, &path, body)
            .await
            .map_err(|e| e.to_string())?;

    Ok(P2pResponse {
        status: response.status,
        body: response.body,
    })
}

/// fetch a blob from a remote peer via P2P
///
/// returns base64-encoded data (since tauri can't easily pass raw bytes)
#[tauri::command]
pub async fn p2p_fetch_blob(peer_addr: String, blob_id: String) -> Result<P2pBlobResponse, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let blob = grimoire::federation::p2p_client::fetch_blob(&peer_addr, &blob_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(P2pBlobResponse {
        data: STANDARD.encode(&blob.data),
        content_type: blob.content_type,
        size: blob.size,
    })
}

/// fetch server image from a remote peer via P2P (public, no auth required)
///
/// used during "add remote" flow before user is authenticated.
/// returns base64-encoded data (since tauri can't easily pass raw bytes)
#[tauri::command]
pub async fn p2p_fetch_hello_image(peer_addr: String) -> Result<P2pBlobResponse, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let blob = grimoire::federation::p2p_client::fetch_hello_image(&peer_addr)
        .await
        .map_err(|e| e.to_string())?;

    Ok(P2pBlobResponse {
        data: STANDARD.encode(&blob.data),
        content_type: blob.content_type,
        size: blob.size,
    })
}

/// close connection to a specific peer (removes from cache)
#[tauri::command]
pub fn p2p_close_connection(peer_addr: String) -> Result<(), String> {
    grimoire::federation::p2p_client::close_connection(&peer_addr).map_err(|e| e.to_string())
}

/// close all P2P client connections
#[tauri::command]
pub fn p2p_close_all_connections() {
    grimoire::federation::p2p_client::close_all_connections();
}

/// upload a blob to a remote peer via P2P
///
/// data: base64-encoded blob data (since tauri can't easily pass raw bytes)
#[tauri::command]
pub async fn p2p_upload_blob(
    peer_addr: String,
    filename: String,
    content_type: String,
    data: String,
) -> Result<P2pUploadResponse, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    // decode base64 data
    let bytes = STANDARD
        .decode(&data)
        .map_err(|e| format!("failed to decode base64 data: {}", e))?;

    let result =
        grimoire::federation::p2p_client::upload_blob(&peer_addr, &filename, &content_type, &bytes)
            .await
            .map_err(|e| e.to_string())?;

    Ok(P2pUploadResponse {
        blob_id: result.blob_id,
        job_id: result.job_id,
        body: result.body,
    })
}
