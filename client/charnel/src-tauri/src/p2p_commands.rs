//! P2P tauri commands for native iroh transport
//!
//! provides tauri IPC commands for making P2P requests to remote peers
//! using the server's federation endpoint. used by TauriTransport.ts.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Mutex;

use crate::spume_bridge::notify_peer_offline;

/// storage for the FederationEndpoint - Router needs to stay alive
static FEDERATION_ENDPOINT_HANDLE: Mutex<
    Option<grimoire::federation::transport::FederationEndpoint>,
> = Mutex::new(None);

/// store the federation endpoint so the Router stays alive
fn store_federation_endpoint(endpoint: grimoire::federation::transport::FederationEndpoint) {
    let mut guard = FEDERATION_ENDPOINT_HANDLE.lock().unwrap();
    *guard = Some(endpoint);
}

/// clear the stored federation endpoint (call before init or on stop)
pub async fn clear_federation_endpoint_handle() {
    let endpoint = {
        let mut guard = FEDERATION_ENDPOINT_HANDLE.lock().unwrap();
        guard.take()
    };
    if let Some(ep) = endpoint {
        ep.close().await;
    }
}

/// check if an error message indicates a connection failure (peer likely offline)
fn is_connection_error(error_msg: &str) -> bool {
    let lower = error_msg.to_lowercase();
    lower.contains("failed to connect")
        || lower.contains("connection refused")
        || lower.contains("connection reset")
        || lower.contains("connection closed")
        || lower.contains("timed out")
        || lower.contains("timeout")
        || lower.contains("unreachable")
        || lower.contains("no route")
}

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

/// blob response with base64 data and computed blake3 hash
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2pBlobWithBlake3Response {
    /// base64-encoded blob data
    pub data: String,
    pub content_type: Option<String>,
    pub size: u64,
    /// computed blake3 hash (for caching)
    pub blake3: String,
}

/// upload response
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct P2pUploadResponse {
    pub blob_id: Option<String>,
    pub job_id: Option<String>,
    /// full server response body for client parsing
    pub body: Option<String>,
}

/// initialize P2P endpoint for both inbound and outbound connections
///
/// must be called after the server starts and grimoire config is available.
/// this creates an iroh endpoint in the Tauri app process for:
/// - making outbound P2P connections to remote peers
/// - accepting incoming P2P connections (dispatched to offal)
///
/// safe to call multiple times (e.g., after server restart) - clears any
/// existing endpoint first.
pub async fn init_p2p_client(config_path: &Path) -> Result<(), String> {
    // clear any existing endpoint first (safe to call even if none exists)
    clear_federation_endpoint_handle().await;
    grimoire::federation::p2p_client::clear_federation_endpoint().await;

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
        // eprintln!("[p2p] federation not enabled in config, skipping P2P init");
        return Ok(());
    }

    // check if knocking is enabled or peers exist (determines if we accept incoming)
    let knocking_enabled = config
        .federation
        .as_ref()
        .map(|f| f.knocking_enabled)
        .unwrap_or(false);

    eprintln!("[p2p] initializing P2P endpoint...");

    let mut endpoint = grimoire::federation::transport::FederationEndpoint::new()
        .await
        .map_err(|e| format!("failed to create P2P endpoint: {}", e))?;

    let node_id = endpoint.node_id();
    eprintln!("[p2p] P2P endpoint ready, node_id: {}", node_id);

    // start router for incoming connections if knocking enabled or peers exist
    let service = grimoire::users::UserService::new();
    let has_peers = service.has_peer_nodes().await;

    if knocking_enabled || has_peers {
        eprintln!(
            "[p2p] starting router (knocking={}, has_peers={})",
            knocking_enabled, has_peers
        );
        endpoint
            .start_router()
            .await
            .map_err(|e| format!("failed to start P2P router: {}", e))?;
    }

    // register endpoint for P2P client operations (stores reference for outbound)
    grimoire::federation::p2p_client::set_federation_endpoint(endpoint.endpoint());

    // store the FederationEndpoint so the Router stays alive
    store_federation_endpoint(endpoint);

    eprintln!("[p2p] P2P endpoint initialized successfully");
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
    app_handle: tauri::AppHandle,
    peer_addr: String,
    method: String,
    path: String,
    body: Option<String>,
) -> Result<P2pResponse, String> {
    let response =
        grimoire::federation::p2p_client::proxy_request(&peer_addr, &method, &path, body)
            .await
            .map_err(|e| {
                let error_msg = e.to_string();
                // emit peer-offline event for connection failures
                if is_connection_error(&error_msg) {
                    let _ = notify_peer_offline(&app_handle, &peer_addr, &error_msg);
                }
                error_msg
            })?;

    Ok(P2pResponse {
        status: response.status,
        body: response.body,
    })
}

/// fetch a blob from a remote peer via P2P
///
/// returns base64-encoded data (since tauri can't easily pass raw bytes)
#[tauri::command]
pub async fn p2p_fetch_blob(
    app_handle: tauri::AppHandle,
    peer_addr: String,
    blob_id: String,
) -> Result<P2pBlobResponse, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let blob = grimoire::federation::p2p_client::fetch_blob(&peer_addr, &blob_id)
        .await
        .map_err(|e| {
            let error_msg = e.to_string();
            if is_connection_error(&error_msg) {
                let _ = notify_peer_offline(&app_handle, &peer_addr, &error_msg);
            }
            error_msg
        })?;

    Ok(P2pBlobResponse {
        data: STANDARD.encode(&blob.data),
        content_type: blob.content_type,
        size: blob.size,
    })
}

/// fetch a blob from a remote peer via iroh-blobs verified streaming
///
/// uses blake3 content hash for cryptographic verification.
/// if blob not in peer's FsStore, automatically calls ensure_blob then retries.
/// returns base64-encoded data (since tauri can't easily pass raw bytes)
#[tauri::command]
pub async fn p2p_fetch_blob_verified(
    app_handle: tauri::AppHandle,
    peer_addr: String,
    blake3_hash: String,
) -> Result<P2pBlobResponse, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    // use fetch_blob_verified_with_ensure which handles on-demand loading
    let data =
        grimoire::federation::p2p_client::fetch_blob_verified_with_ensure(&peer_addr, &blake3_hash)
            .await
            .map_err(|e| {
                let error_msg = e.to_string();
                if is_connection_error(&error_msg) {
                    let _ = notify_peer_offline(&app_handle, &peer_addr, &error_msg);
                }
                error_msg
            })?;

    Ok(P2pBlobResponse {
        data: STANDARD.encode(&data),
        content_type: Some("audio/mpeg".to_string()), // iroh-blobs doesn't track content type
        size: data.len() as u64,
    })
}

/// fetch a blob from a remote peer via iroh-blobs verified streaming with on-demand blake3
///
/// use this when the client doesn't have the blake3 hash yet.
/// computes blake3 on the server, then uses verified streaming.
/// returns base64-encoded data and the computed blake3 hash.
#[tauri::command]
pub async fn p2p_fetch_blob_verified_by_id(
    app_handle: tauri::AppHandle,
    peer_addr: String,
    blob_id: String,
) -> Result<P2pBlobWithBlake3Response, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let (data, blake3) =
        grimoire::federation::p2p_client::fetch_blob_verified_by_id(&peer_addr, &blob_id)
            .await
            .map_err(|e| {
                let error_msg = e.to_string();
                if is_connection_error(&error_msg) {
                    let _ = notify_peer_offline(&app_handle, &peer_addr, &error_msg);
                }
                error_msg
            })?;

    Ok(P2pBlobWithBlake3Response {
        data: STANDARD.encode(&data),
        content_type: Some("audio/mpeg".to_string()),
        size: data.len() as u64,
        blake3,
    })
}

/// fetch server image from a remote peer via P2P (public, no auth required)
///
/// used during "add remote" flow before user is authenticated.
/// returns base64-encoded data (since tauri can't easily pass raw bytes)
#[tauri::command]
pub async fn p2p_fetch_hello_image(
    app_handle: tauri::AppHandle,
    peer_addr: String,
) -> Result<P2pBlobResponse, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let blob = grimoire::federation::p2p_client::fetch_hello_image(&peer_addr)
        .await
        .map_err(|e| {
            let error_msg = e.to_string();
            if is_connection_error(&error_msg) {
                let _ = notify_peer_offline(&app_handle, &peer_addr, &error_msg);
            }
            error_msg
        })?;

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
/// associate_with: optional JSON with entity association metadata
#[tauri::command]
pub async fn p2p_upload_blob(
    app_handle: tauri::AppHandle,
    peer_addr: String,
    filename: String,
    content_type: String,
    data: String,
    associate_with: Option<serde_json::Value>,
) -> Result<P2pUploadResponse, String> {
    use base64::{engine::general_purpose::STANDARD, Engine};

    // decode base64 data
    let bytes = STANDARD
        .decode(&data)
        .map_err(|e| format!("failed to decode base64 data: {}", e))?;

    let result = grimoire::federation::p2p_client::upload_blob(
        &peer_addr,
        &filename,
        &content_type,
        &bytes,
        associate_with,
    )
    .await
    .map_err(|e| {
        let error_msg = e.to_string();
        if is_connection_error(&error_msg) {
            let _ = notify_peer_offline(&app_handle, &peer_addr, &error_msg);
        }
        error_msg
    })?;

    Ok(P2pUploadResponse {
        blob_id: result.blob_id,
        job_id: result.job_id,
        body: result.body,
    })
}
