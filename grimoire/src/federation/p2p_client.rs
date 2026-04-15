//! P2P client functions for outbound peer connections
//!
//! provides functions to make API requests and fetch blobs from remote peers
//! using the server's federation endpoint. this is used by:
//! - tauri app (via tauri commands) for native P2P transport
//! - server routes for HTTP-based P2P proxy
//!
//! the endpoint must be initialized via `set_federation_endpoint()` before use.
//!
//! blob fetching uses iroh-blobs protocol with blake3 verified streaming
//! via `fetch_blob_verified` and related functions.

use std::sync::{Arc, Mutex};

use iroh::{Endpoint, EndpointAddr, PublicKey};
use iroh_blobs::api::downloader::Downloader;
use iroh_blobs::api::Store;
use iroh_blobs::{Hash, HashAndFormat};
use serde::{Deserialize, Serialize};
use tracing::{debug, info};

use crate::error::{GrimoireError, GrimoireResult};
use crate::federation::transport::{PeerConnection, FREQHOLE_ALPN};

/// global federation endpoint for P2P client operations
static FEDERATION_ENDPOINT: Mutex<Option<Arc<Endpoint>>> = Mutex::new(None);

/// iroh-blobs store and downloader for verified blob fetching
static BLOBS_STATE: Mutex<Option<BlobsState>> = Mutex::new(None);

/// state for iroh-blobs verified downloads
struct BlobsState {
    store: Store,
    downloader: Downloader,
}

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

/// set the federation endpoint for client operations
///
/// call this after creating the federation endpoint in the server.
/// can be called multiple times (e.g., after restart).
/// also initializes the iroh-blobs downloader for verified blob fetching.
pub fn set_federation_endpoint(endpoint: &Endpoint) {
    // set endpoint
    {
        let mut guard = FEDERATION_ENDPOINT.lock().unwrap();
        *guard = Some(Arc::new(endpoint.clone()));
    }

    // initialize iroh-blobs downloader with MemStore (no persistence on client)
    // blobs are returned to JS which caches in Cache API
    let mem_store = iroh_blobs::store::mem::MemStore::default();
    let downloader = Downloader::new(&mem_store, endpoint);
    let store = mem_store.as_ref().clone();

    {
        let mut guard = BLOBS_STATE.lock().unwrap();
        *guard = Some(BlobsState { store, downloader });
    }

    info!("P2P client endpoint and blobs downloader initialized");
}

/// clear and close the federation endpoint
///
/// actually closes the iroh endpoint (which stops the accept loop),
/// then clears the global so a new one can be created.
/// also clears the iroh-blobs downloader state.
pub async fn clear_federation_endpoint() {
    // clear blobs state first
    {
        let mut guard = BLOBS_STATE.lock().unwrap();
        *guard = None;
    }

    // take the endpoint out of the global while holding the lock briefly
    let endpoint = {
        let mut guard = FEDERATION_ENDPOINT.lock().unwrap();
        guard.take()
    };

    // close the endpoint outside the lock (close is async)
    if let Some(ep) = endpoint {
        info!("closing P2P endpoint...");
        ep.close().await;
        info!("P2P endpoint closed");
    }
}

/// check if the federation endpoint is available for client operations
pub fn is_endpoint_available() -> bool {
    FEDERATION_ENDPOINT.lock().unwrap().is_some()
}

/// get the endpoint arc for external use (status monitoring, etc)
///
/// returns error if not initialized
pub fn get_endpoint_arc() -> GrimoireResult<Arc<Endpoint>> {
    FEDERATION_ENDPOINT
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| GrimoireError::FederationApiError {
            message: "federation endpoint not initialized".to_string(),
        })
}

/// get the endpoint, returning error if not initialized
fn get_endpoint() -> GrimoireResult<Arc<Endpoint>> {
    get_endpoint_arc()
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

/// connect to a peer
///
/// iroh handles connection caching/reuse internally, so we just call connect()
/// each time and let iroh decide whether to reuse an existing connection.
async fn connect_to_peer(
    endpoint: &Endpoint,
    addr: &EndpointAddr,
) -> GrimoireResult<PeerConnection> {
    let peer_id = addr.id;
    let node_id_short = &peer_id.to_string()[..16];

    debug!("connecting to peer {}...", node_id_short);

    let conn = endpoint
        .connect(addr.clone(), FREQHOLE_ALPN)
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("failed to connect to peer {}: {}", node_id_short, e),
        })?;

    debug!("connected to peer {}", node_id_short);
    Ok(PeerConnection::new(conn, peer_id))
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

    let conn = connect_to_peer(&endpoint, &addr).await?;
    let response = conn.proxy_request(method, path, body).await?;

    Ok(P2pProxyResponse {
        status: response.status,
        body: response.body,
    })
}

/// fetch a blob from a remote peer using iroh-blobs verified streaming
///
/// uses blake3 content hash for cryptographic verification.
/// returns error if hash not found, verification fails, or connection fails.
///
/// blake3_hash: the blake3 hash of the blob (64 hex chars)
pub async fn fetch_blob_verified(peer_addr: &str, blake3_hash: &str) -> GrimoireResult<Vec<u8>> {
    let (store, hash, hash_short, node_id_short) =
        download_blob_to_store(peer_addr, blake3_hash).await?;

    // read the blob from store
    let bytes = store
        .get_bytes(hash)
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("failed to read blob from store: {}", e),
        })?;

    info!(
        "received {} verified bytes for blob {} from {}",
        bytes.len(),
        hash_short,
        node_id_short
    );

    Ok(bytes.to_vec())
}

/// fetch a blob and export directly to a file path without loading into memory.
///
/// uses iroh-blobs verified streaming to download, then exports from FsStore
/// to the target path. suitable for large files where memory is a concern.
///
/// returns the size in bytes of the exported file.
pub async fn fetch_blob_verified_to_file(
    peer_addr: &str,
    blake3_hash: &str,
    target: &std::path::Path,
) -> GrimoireResult<u64> {
    let (store, hash, hash_short, node_id_short) =
        download_blob_to_store(peer_addr, blake3_hash).await?;

    // export from store directly to target file (no memory buffering)
    store
        .blobs()
        .export(hash, target)
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("failed to export blob to file: {}", e),
        })?;

    let metadata =
        tokio::fs::metadata(target)
            .await
            .map_err(|e| GrimoireError::FederationApiError {
                message: format!("failed to read exported file metadata: {}", e),
            })?;

    info!(
        "exported {} bytes for blob {} from {} to {}",
        metadata.len(),
        hash_short,
        node_id_short,
        target.display()
    );

    Ok(metadata.len())
}

/// download a blob into the local iroh-blobs store via verified streaming.
///
/// shared implementation used by both `fetch_blob_verified` (reads into memory)
/// and `fetch_blob_verified_to_file` (exports to disk).
async fn download_blob_to_store(
    peer_addr: &str,
    blake3_hash: &str,
) -> GrimoireResult<(iroh_blobs::api::Store, Hash, String, String)> {
    let addr = parse_peer_address(peer_addr)?;
    let node_id_short = addr.id.to_string()[..16].to_string();
    let hash_short = blake3_hash[..16.min(blake3_hash.len())].to_string();

    info!(
        "fetching verified blob {} from {} (addr: {})",
        hash_short, node_id_short, peer_addr,
    );

    // get blobs state (downloader + store)
    let (downloader, store) = {
        let guard = BLOBS_STATE.lock().unwrap();
        let state = guard
            .as_ref()
            .ok_or_else(|| GrimoireError::FederationApiError {
                message: "blobs downloader not initialized".to_string(),
            })?;
        (state.downloader.clone(), state.store.clone())
    };

    // parse blake3 hash
    let hash: Hash = blake3_hash
        .parse()
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("invalid blake3 hash: {}", e),
        })?;

    // create hash_and_format for download
    let hash_and_format = HashAndFormat::raw(hash);

    // download the blob using iroh-blobs protocol
    use futures_util::StreamExt;
    use iroh_blobs::api::downloader::DownloadProgressItem;

    let progress = downloader.download(hash_and_format, [addr.id]);
    let mut stream = progress
        .stream()
        .await
        .map_err(|e| GrimoireError::FederationApiError {
            message: format!("download stream failed: {}", e),
        })?;

    debug!(
        "iroh-blobs: download stream created for {}, consuming progress events...",
        hash_short
    );

    // consume progress stream, check for errors
    let mut had_error = false;
    let mut last_error: Option<String> = None;

    while let Some(event) = stream.next().await {
        match event {
            DownloadProgressItem::Error(e) => {
                had_error = true;
                last_error = Some(format!("{:?}", e));
                tracing::error!("iroh-blobs: download error for {}: {:?}", hash_short, e);
            }
            DownloadProgressItem::DownloadError => {
                had_error = true;
                last_error = Some("download error".to_string());
                tracing::error!("iroh-blobs: generic download error for {}", hash_short);
            }
            DownloadProgressItem::PartComplete { .. } => {
                debug!("iroh-blobs: part complete for {}", hash_short);
            }
            _ => {
                debug!("iroh-blobs: progress event for {}", hash_short);
            }
        }
    }

    debug!(
        "iroh-blobs: download stream completed for {} (had_error: {})",
        hash_short, had_error
    );

    if had_error {
        return Err(GrimoireError::FederationApiError {
            message: format!(
                "verified download failed: {}",
                last_error.unwrap_or_else(|| "unknown error".to_string())
            ),
        });
    }

    Ok((store, hash, hash_short, node_id_short))
}

/// ensure a blob is loaded into a remote peer's FsStore
///
/// calls the peer's ensure_blob endpoint which looks up the file by blake3 hash
/// and adds it to FsStore for verified streaming. use this before retrying
/// iroh-blobs download if the first attempt fails.
///
/// returns true if blob is now available, false if not found.
pub async fn ensure_blob(peer_addr: &str, blake3_hash: &str) -> GrimoireResult<bool> {
    let endpoint = get_endpoint()?;
    let addr = parse_peer_address(peer_addr)?;
    let node_id_short = &addr.id.to_string()[..16];
    let hash_short = &blake3_hash[..16.min(blake3_hash.len())];

    debug!(
        "ensuring blob {} is in FsStore on {}",
        hash_short, node_id_short
    );

    let conn = connect_to_peer(&endpoint, &addr).await?;
    let available = conn.ensure_blob(blake3_hash).await?;

    if available {
        info!(
            "ensure_blob: {} now available on {}",
            hash_short, node_id_short
        );
    } else {
        debug!("ensure_blob: {} not found on {}", hash_short, node_id_short);
    }

    Ok(available)
}

/// compute blake3 hash for a blob on demand
///
/// use this when the client doesn't have the blake3 hash yet (not in API response).
/// the server will compute the hash, save it to the database, and add the file
/// to FsStore for verified streaming.
///
/// returns Some(blake3_hash) if successful, None if blob not found.
pub async fn compute_blake3(peer_addr: &str, blob_id: &str) -> GrimoireResult<Option<String>> {
    let endpoint = get_endpoint()?;
    let addr = parse_peer_address(peer_addr)?;
    let node_id_short = &addr.id.to_string()[..16];
    let blob_id_short = &blob_id[..16.min(blob_id.len())];

    debug!(
        "computing blake3 for {} on {}",
        blob_id_short, node_id_short
    );

    let conn = connect_to_peer(&endpoint, &addr).await?;
    let blake3 = conn.compute_blake3(blob_id).await?;

    if let Some(ref hash) = blake3 {
        info!(
            "compute_blake3: {} -> {} on {}",
            blob_id_short,
            &hash[..16],
            node_id_short
        );
    } else {
        debug!(
            "compute_blake3: {} not found on {}",
            blob_id_short, node_id_short
        );
    }

    Ok(blake3)
}

/// fetch a blob using verified streaming with on-demand loading
///
/// tries iroh-blobs first. if blob not in FsStore, calls ensure_blob
/// to load it, then retries. this handles blobs that haven't been
/// backfilled to FsStore yet.
///
/// timeout: max time to wait for ensure + retry (suggested: 5 seconds)
pub async fn fetch_blob_verified_with_ensure(
    peer_addr: &str,
    blake3_hash: &str,
) -> GrimoireResult<Vec<u8>> {
    info!(
        "fetch_blob_verified_with_ensure: starting for {} from {}",
        &blake3_hash[..16.min(blake3_hash.len())],
        &peer_addr[..16.min(peer_addr.len())],
    );

    // first attempt - might fail if blob not in FsStore
    match fetch_blob_verified(peer_addr, blake3_hash).await {
        Ok(data) => return Ok(data),
        Err(e) => {
            let hash_short = &blake3_hash[..16.min(blake3_hash.len())];
            debug!(
                "verified download failed for {}, trying ensure: {}",
                hash_short, e
            );
        }
    }

    // ensure blob is loaded into FsStore
    let available = ensure_blob(peer_addr, blake3_hash).await?;

    info!(
        "fetch_blob_verified_with_ensure: ensure_blob returned {} for {}",
        available,
        &blake3_hash[..16.min(blake3_hash.len())],
    );

    if !available {
        return Err(GrimoireError::FederationApiError {
            message: format!(
                "blob {} not available on peer",
                &blake3_hash[..16.min(blake3_hash.len())]
            ),
        });
    }

    // retry verified download
    info!(
        "fetch_blob_verified_with_ensure: retrying verified download for {}",
        &blake3_hash[..16.min(blake3_hash.len())],
    );

    fetch_blob_verified(peer_addr, blake3_hash).await
}

/// fetch a blob to a file using verified streaming with on-demand loading.
///
/// like `fetch_blob_verified_with_ensure` but exports directly to a file
/// instead of loading into memory. suitable for large uploads.
///
/// returns the size in bytes of the exported file.
pub async fn fetch_blob_verified_to_file_with_ensure(
    peer_addr: &str,
    blake3_hash: &str,
    target: &std::path::Path,
) -> GrimoireResult<u64> {
    info!(
        "fetch_blob_verified_to_file_with_ensure: starting for {} from {}",
        &blake3_hash[..16.min(blake3_hash.len())],
        &peer_addr[..16.min(peer_addr.len())],
    );

    // first attempt
    match fetch_blob_verified_to_file(peer_addr, blake3_hash, target).await {
        Ok(size) => return Ok(size),
        Err(e) => {
            let hash_short = &blake3_hash[..16.min(blake3_hash.len())];
            debug!(
                "verified download to file failed for {}, trying ensure: {}",
                hash_short, e
            );
        }
    }

    // ensure blob is loaded into FsStore
    let available = ensure_blob(peer_addr, blake3_hash).await?;

    info!(
        "fetch_blob_verified_to_file_with_ensure: ensure_blob returned {} for {}",
        available,
        &blake3_hash[..16.min(blake3_hash.len())],
    );

    if !available {
        return Err(GrimoireError::FederationApiError {
            message: format!(
                "blob {} not available on peer",
                &blake3_hash[..16.min(blake3_hash.len())]
            ),
        });
    }

    // retry
    info!(
        "fetch_blob_verified_to_file_with_ensure: retrying for {}",
        &blake3_hash[..16.min(blake3_hash.len())],
    );

    fetch_blob_verified_to_file(peer_addr, blake3_hash, target).await
}

/// fetch a blob by blob_id using verified streaming with on-demand blake3 computation
///
/// use this when the client doesn't have the blake3 hash yet (not in API response).
/// computes blake3 on demand via the server, then uses verified streaming.
///
/// returns the blob data and the computed blake3 hash (for caching).
pub async fn fetch_blob_verified_by_id(
    peer_addr: &str,
    blob_id: &str,
) -> GrimoireResult<(Vec<u8>, String)> {
    let blob_id_short = &blob_id[..16.min(blob_id.len())];

    // compute blake3 on demand
    let blake3 = compute_blake3(peer_addr, blob_id).await?.ok_or_else(|| {
        GrimoireError::FederationApiError {
            message: format!("blob {} not found on peer", blob_id_short),
        }
    })?;

    // now use verified streaming
    let data = fetch_blob_verified_with_ensure(peer_addr, &blake3).await?;

    Ok((data, blake3))
}

/// fetch server image from a remote peer (public, no auth required)
///
/// used during "add remote" flow before user is authenticated.
/// returns error if server has no image configured or connection fails.
pub async fn fetch_hello_image(peer_addr: &str) -> GrimoireResult<P2pBlobData> {
    let endpoint = get_endpoint()?;
    let addr = parse_peer_address(peer_addr)?;
    let node_id_short = &addr.id.to_string()[..16];

    info!("fetching hello image from {}", node_id_short);

    let conn = connect_to_peer(&endpoint, &addr).await?;
    let (info, mut stream) = conn.stream_hello_image().await?;

    // read all image data (10MB max for server image)
    let data = stream.read_to_end(10 * 1024 * 1024).await.map_err(|e| {
        GrimoireError::FederationApiError {
            message: format!("failed to read image data: {}", e),
        }
    })?;

    info!(
        "received {} bytes for hello image from {}",
        data.len(),
        node_id_short
    );

    Ok(P2pBlobData {
        data,
        content_type: info.content_type,
        size: info.size,
    })
}

/// get our node_id (for display/debugging)
pub fn get_node_id() -> GrimoireResult<String> {
    let endpoint = get_endpoint()?;
    Ok(endpoint.secret_key().public().to_string())
}

/// close a specific peer connection
///
/// note: iroh manages connections internally, so this is a no-op.
/// kept for API compatibility.
pub fn close_connection(_peer_addr: &str) -> GrimoireResult<()> {
    // iroh handles connection lifecycle - nothing to do here
    Ok(())
}

/// close all peer connections
///
/// note: iroh manages connections internally, so this is a no-op.
/// kept for API compatibility.
pub fn close_all_connections() {
    // iroh handles connection lifecycle - nothing to do here
    debug!("close_all_connections called (no-op, iroh manages connections)");
}
