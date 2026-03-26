//! midden: browser WASM client for freqhole P2P federation
//!
//! uses iroh to connect to freqhole peers from the browser.
//! accepts either plain node_id or full endpoint address JSON with relay/IP hints.
//!
//! supports three protocols:
//! - freqhole/1: custom protocol for API proxying and small blob streaming
//! - freqhole-blobz: iroh-blobs protocol for verified streaming of audio files
//! - /iroh-gossip/1: iroh-gossip for pub/sub messaging channels

use bytes::Bytes;
use iroh::endpoint::presets;
use iroh::endpoint::{Connection, RecvStream, SendStream};
use iroh::protocol::Router;
use iroh::{Endpoint, EndpointAddr, PublicKey, SecretKey};
use iroh_blobs::api::downloader::Downloader;
use iroh_blobs::api::Store;
use iroh_blobs::{Hash, HashAndFormat};
use iroh_gossip::Gossip;
use iroh_gossip::TopicId;
use js_sys::Uint8Array;
use n0_future::StreamExt;
use serde::{Deserialize, Serialize};
use tracing::level_filters::LevelFilter;
use tracing::{info, warn};
use tracing_subscriber_wasm::MakeConsoleWriter;
use wasm_bindgen::{prelude::wasm_bindgen, JsError, JsValue};

/// ALPN protocol identifier (must match grimoire's FREQHOLE_ALPN)
const FREQHOLE_ALPN: &[u8] = b"freqhole/1";

/// protocol messages (must match grimoire's PeerMessage)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum PeerMessage {
    ProxyRequest {
        id: u64,
        method: String,
        path: String,
        body: Option<String>,
    },
    ProxyResponse {
        id: u64,
        status: u16,
        body: String,
    },
    BlobStreamRequest {
        id: u64,
        blob_id: String,
    },
    BlobStreamResponse {
        id: u64,
        size: Option<u64>,
        content_type: Option<String>,
        error: Option<String>,
    },
    BlobUploadRequest {
        id: u64,
        filename: String,
        content_type: String,
        size: u64,
        associate_with: Option<serde_json::Value>,
    },
    BlobUploadResponse {
        id: u64,
        blob_id: Option<String>,
        job_id: Option<String>,
        error: Option<String>,
        body: Option<String>,
    },
    HelloImageRequest {
        id: u64,
    },
    HelloImageResponse {
        id: u64,
        size: Option<u64>,
        content_type: Option<String>,
        error: Option<String>,
    },
    EnsureBlobRequest {
        id: u64,
        blake3_hash: String,
    },
    EnsureBlobResponse {
        id: u64,
        available: bool,
        error: Option<String>,
    },
    /// request to compute blake3 hash for a blob (by blob_id/sha256)
    /// used before verified streaming when blake3 not in API response
    ComputeBlake3Request {
        id: u64,
        blob_id: String,
    },
    /// response with computed blake3 hash
    ComputeBlake3Response {
        id: u64,
        blake3: Option<String>,
        error: Option<String>,
    },
}

/// response from proxy_request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyResponse {
    pub status: u16,
    pub body: String,
}

/// upload result
#[wasm_bindgen]
pub struct UploadResult {
    blob_id: Option<String>,
    job_id: Option<String>,
    /// full server response body for client parsing
    body: Option<String>,
}

#[wasm_bindgen]
impl UploadResult {
    /// get the created blob_id (if successful)
    pub fn blob_id(&self) -> Option<String> {
        self.blob_id.clone()
    }

    /// get the import job_id
    pub fn job_id(&self) -> Option<String> {
        self.job_id.clone()
    }

    /// get the full server response body (for Zod validation)
    pub fn body(&self) -> Option<String> {
        self.body.clone()
    }
}

/// blob fetch result
#[wasm_bindgen]
pub struct BlobResult {
    data: Vec<u8>,
    content_type: Option<String>,
}

#[wasm_bindgen]
impl BlobResult {
    /// get blob data as Uint8Array
    pub fn data(&self) -> Uint8Array {
        Uint8Array::from(&self.data[..])
    }

    /// get blob size in bytes
    pub fn size(&self) -> u32 {
        self.data.len() as u32
    }

    /// get content type (if known)
    pub fn content_type(&self) -> Option<String> {
        self.content_type.clone()
    }
}

#[wasm_bindgen(start)]
fn start() {
    console_error_panic_hook::set_once();

    tracing_subscriber::fmt()
        .with_max_level(LevelFilter::INFO)
        .with_writer(MakeConsoleWriter::default().map_trace_level_to(tracing::Level::DEBUG))
        .without_time()
        .with_ansi(false)
        .init();

    info!("midden initialized");
}

/// parse peer address - accepts either:
/// - plain node_id (64 hex chars): "13a257b5367d6b5b7ceb67ec6246c3dafbe886af8ed429408cd7619c7a4787b1"
/// - full endpoint JSON: {"id":"...","addrs":[{"Relay":"..."},{"Ip":"..."}]}
fn parse_peer_addr(peer_addr: &str) -> Result<EndpointAddr, String> {
    let trimmed = peer_addr.trim();

    // try parsing as JSON endpoint address first
    if trimmed.starts_with('{') {
        return serde_json::from_str::<EndpointAddr>(trimmed)
            .map_err(|e| format!("invalid endpoint JSON: {}", e));
    }

    // otherwise treat as plain node_id
    let node_id: PublicKey = trimmed
        .parse()
        .map_err(|e| format!("invalid node_id: {}", e))?;

    // create EndpointAddr with empty addresses - iroh will use relay discovery
    Ok(EndpointAddr::from_parts(node_id, []))
}

/// browser P2P node for freqhole federation
///
/// supports three protocols:
/// - freqhole/1: API proxying and small blob streaming
/// - iroh-blobs: verified streaming for audio files
/// - iroh-gossip: pub/sub messaging for channels
#[wasm_bindgen]
pub struct MiddenNode {
    endpoint: Endpoint,
    secret_key_bytes: [u8; 32],
    // iroh-blobs components
    blobs_store: Store,
    blobs_downloader: Downloader,
    // iroh-gossip + router
    gossip: Gossip,
    #[allow(dead_code)]
    router: Router,
}

#[wasm_bindgen]
impl MiddenNode {
    /// create a new node with random identity
    /// waits for relay connection before returning
    pub async fn create() -> Result<MiddenNode, JsError> {
        // generate random secret key
        let mut bytes = [0u8; 32];
        getrandom::getrandom(&mut bytes).map_err(|e| JsError::new(&e.to_string()))?;

        Self::create_with_secret_key(bytes).await
    }

    /// create a node from existing secret key bytes (for persistence)
    /// key_bytes must be exactly 32 bytes
    pub async fn create_from_key(key_bytes: &[u8]) -> Result<MiddenNode, JsError> {
        if key_bytes.len() != 32 {
            return Err(JsError::new("secret key must be exactly 32 bytes"));
        }

        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(key_bytes);

        Self::create_with_secret_key(bytes).await
    }

    /// internal: create node with given secret key bytes
    async fn create_with_secret_key(bytes: [u8; 32]) -> Result<MiddenNode, JsError> {
        let secret_key = SecretKey::from_bytes(&bytes);

        // use N0 preset for relay + DNS discovery (peers can find each other)
        // don't set .alpns() — the Router manages accepted ALPNs
        let endpoint = Endpoint::builder(presets::N0)
            .secret_key(secret_key)
            .alpns(vec![FREQHOLE_ALPN.to_vec()])
            .bind()
            .await
            .map_err(to_js_err)?;

        // setup iroh-blobs with MemStore (no persistence in browser)
        let mem_store = iroh_blobs::store::mem::MemStore::default();
        let blobs_downloader = Downloader::new(&mem_store, &endpoint);
        let blobs_store = mem_store.as_ref().clone();

        // setup iroh-gossip (spawns background protocol tasks)
        let gossip = Gossip::builder().spawn(endpoint.clone());

        // router accepts incoming gossip connections from other peers
        let router = Router::builder(endpoint.clone())
            .accept(iroh_gossip::ALPN, gossip.clone())
            .spawn();

        // wait for relay connection
        endpoint.online().await;

        let node_id = endpoint.secret_key().public().to_string();
        info!("midden node ready: {} (gossip enabled)", &node_id[..16]);

        Ok(MiddenNode {
            endpoint,
            secret_key_bytes: bytes,
            blobs_store,
            blobs_downloader,
            gossip,
            router,
        })
    }

    /// get the secret key bytes for persistence (32 bytes)
    /// store this in IndexedDB to maintain the same identity across sessions
    pub fn secret_key(&self) -> Uint8Array {
        Uint8Array::from(&self.secret_key_bytes[..])
    }

    /// get our node_id (iroh public key)
    pub fn node_id(&self) -> String {
        self.endpoint.secret_key().public().to_string()
    }

    /// connect to a peer
    /// iroh handles connection caching/reuse internally
    async fn connect_to_peer(&self, addr: &EndpointAddr) -> Result<Connection, JsError> {
        let conn = self
            .endpoint
            .connect(addr.clone(), FREQHOLE_ALPN)
            .await
            .map_err(to_js_err)?;
        Ok(conn)
    }

    /// send an API request to a peer
    /// peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
    pub async fn proxy_request(
        &self,
        peer_addr: &str,
        method: &str,
        path: &str,
        body: Option<String>,
    ) -> Result<JsValue, JsError> {
        let addr = parse_peer_addr(peer_addr).map_err(|e| JsError::new(&e))?;

        let conn = self.connect_to_peer(&addr).await?;

        let (mut send, mut recv): (SendStream, RecvStream) =
            conn.open_bi().await.map_err(to_js_err)?;

        // send request
        let request = PeerMessage::ProxyRequest {
            id: 1,
            method: method.to_string(),
            path: path.to_string(),
            body,
        };
        let bytes = serde_json::to_vec(&request).map_err(to_js_err)?;
        send.write_all(&bytes).await.map_err(to_js_err)?;
        send.finish().map_err(to_js_err)?;

        // read response (no length prefix, read to end)
        let response_bytes: Vec<u8> = recv
            .read_to_end(10 * 1024 * 1024)
            .await
            .map_err(to_js_err)?;
        let response: PeerMessage = serde_json::from_slice(&response_bytes).map_err(to_js_err)?;

        match response {
            PeerMessage::ProxyResponse { status, body, .. } => {
                let result = ProxyResponse { status, body };
                Ok(serde_wasm_bindgen::to_value(&result)?)
            }
            _ => Err(JsError::new("unexpected response type")),
        }
    }

    /// fetch a blob from a peer
    /// peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
    /// returns BlobResult with data and metadata
    pub async fn fetch_blob(&self, peer_addr: &str, blob_id: &str) -> Result<BlobResult, JsError> {
        let addr = parse_peer_addr(peer_addr).map_err(|e| JsError::new(&e))?;

        // connect to peer
        let conn = self.connect_to_peer(&addr).await?;

        let (mut send, mut recv): (SendStream, RecvStream) =
            conn.open_bi().await.map_err(to_js_err)?;

        // send request
        let request = PeerMessage::BlobStreamRequest {
            id: 1,
            blob_id: blob_id.to_string(),
        };
        let bytes = serde_json::to_vec(&request).map_err(to_js_err)?;
        send.write_all(&bytes).await.map_err(to_js_err)?;
        send.finish().map_err(to_js_err)?;

        // read length-prefixed header
        let mut len_buf = [0u8; 4];
        recv.read_exact(&mut len_buf).await.map_err(to_js_err)?;
        let header_len = u32::from_be_bytes(len_buf) as usize;

        let mut header_buf = vec![0u8; header_len];
        recv.read_exact(&mut header_buf).await.map_err(to_js_err)?;

        let response: PeerMessage = serde_json::from_slice(&header_buf).map_err(to_js_err)?;

        match response {
            PeerMessage::BlobStreamResponse {
                size: _,
                content_type,
                error,
                ..
            } => {
                if let Some(err) = error {
                    return Err(JsError::new(&err));
                }

                // read all blob data
                let data: Vec<u8> = recv
                    .read_to_end(100 * 1024 * 1024) // 100MB max
                    .await
                    .map_err(to_js_err)?;

                Ok(BlobResult { data, content_type })
            }
            _ => Err(JsError::new("unexpected response type")),
        }
    }

    /// fetch a blob from a peer with progress callback
    /// callback is called with (received_bytes, total_bytes) as arguments
    /// if total_bytes is 0, the size is unknown
    pub async fn fetch_blob_with_progress(
        &self,
        peer_addr: &str,
        blob_id: &str,
        on_progress: &js_sys::Function,
    ) -> Result<BlobResult, JsError> {
        let addr = parse_peer_addr(peer_addr).map_err(|e| JsError::new(&e))?;

        // connect to peer
        let conn = self.connect_to_peer(&addr).await?;

        let (mut send, mut recv): (SendStream, RecvStream) =
            conn.open_bi().await.map_err(to_js_err)?;

        // send request
        let request = PeerMessage::BlobStreamRequest {
            id: 1,
            blob_id: blob_id.to_string(),
        };
        let bytes = serde_json::to_vec(&request).map_err(to_js_err)?;
        send.write_all(&bytes).await.map_err(to_js_err)?;
        send.finish().map_err(to_js_err)?;

        // read length-prefixed header
        let mut len_buf = [0u8; 4];
        recv.read_exact(&mut len_buf).await.map_err(to_js_err)?;
        let header_len = u32::from_be_bytes(len_buf) as usize;

        let mut header_buf = vec![0u8; header_len];
        recv.read_exact(&mut header_buf).await.map_err(to_js_err)?;

        let response: PeerMessage = serde_json::from_slice(&header_buf).map_err(to_js_err)?;

        match response {
            PeerMessage::BlobStreamResponse {
                size,
                content_type,
                error,
                ..
            } => {
                if let Some(err) = error {
                    return Err(JsError::new(&err));
                }

                let total_size = size.unwrap_or(0);

                // read in chunks with progress callback
                let chunk_size = 64 * 1024; // 64KB chunks
                let mut data = Vec::with_capacity(total_size as usize);
                let mut received: u64 = 0;

                loop {
                    let mut chunk = vec![0u8; chunk_size];
                    let bytes_read = recv.read(&mut chunk).await.map_err(to_js_err)?;

                    if let Some(n) = bytes_read {
                        if n == 0 {
                            break;
                        }
                        data.extend_from_slice(&chunk[..n]);
                        received += n as u64;

                        // call progress callback
                        let this = JsValue::null();
                        let received_js = JsValue::from_f64(received as f64);
                        let total_js = JsValue::from_f64(total_size as f64);
                        let _ = on_progress.call2(&this, &received_js, &total_js);
                    } else {
                        // stream closed
                        break;
                    }
                }

                Ok(BlobResult { data, content_type })
            }
            _ => Err(JsError::new("unexpected response type")),
        }
    }

    /// fetch server image from a peer (public, no auth required)
    /// used during "add remote" flow before user is authenticated
    /// peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
    pub async fn fetch_hello_image(&self, peer_addr: &str) -> Result<BlobResult, JsError> {
        let addr = parse_peer_addr(peer_addr).map_err(|e| JsError::new(&e))?;

        // connect to peer
        let conn = self.connect_to_peer(&addr).await?;

        let (mut send, mut recv): (SendStream, RecvStream) =
            conn.open_bi().await.map_err(to_js_err)?;

        // send request
        let request = PeerMessage::HelloImageRequest { id: 1 };
        let bytes = serde_json::to_vec(&request).map_err(to_js_err)?;
        send.write_all(&bytes).await.map_err(to_js_err)?;
        send.finish().map_err(to_js_err)?;

        // read length-prefixed header
        let mut len_buf = [0u8; 4];
        recv.read_exact(&mut len_buf).await.map_err(to_js_err)?;
        let header_len = u32::from_be_bytes(len_buf) as usize;

        let mut header_buf = vec![0u8; header_len];
        recv.read_exact(&mut header_buf).await.map_err(to_js_err)?;

        let response: PeerMessage = serde_json::from_slice(&header_buf).map_err(to_js_err)?;

        match response {
            PeerMessage::HelloImageResponse {
                size: _,
                content_type,
                error,
                ..
            } => {
                if let Some(err) = error {
                    return Err(JsError::new(&err));
                }

                // read all image data
                let data: Vec<u8> = recv
                    .read_to_end(10 * 1024 * 1024) // 10MB max for server image
                    .await
                    .map_err(to_js_err)?;

                Ok(BlobResult { data, content_type })
            }
            _ => Err(JsError::new("unexpected response type")),
        }
    }

    /// upload a blob to a peer
    /// peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
    /// associate_with: optional JSON string with entity association metadata
    /// returns UploadResult with blob_id and job_id on success
    pub async fn upload_blob(
        &self,
        peer_addr: &str,
        filename: &str,
        content_type: &str,
        data: &[u8],
        associate_with: Option<String>,
    ) -> Result<UploadResult, JsError> {
        let addr = parse_peer_addr(peer_addr).map_err(|e| JsError::new(&e))?;

        // connect to peer
        let conn = self.connect_to_peer(&addr).await?;

        let (mut send, mut recv): (SendStream, RecvStream) =
            conn.open_bi().await.map_err(to_js_err)?;

        // parse associate_with if provided
        let associate_with_value: Option<serde_json::Value> = associate_with
            .as_ref()
            .and_then(|s| serde_json::from_str(s).ok());

        // send length-prefixed header
        let request = PeerMessage::BlobUploadRequest {
            id: 1,
            filename: filename.to_string(),
            content_type: content_type.to_string(),
            size: data.len() as u64,
            associate_with: associate_with_value,
        };
        let header_bytes = serde_json::to_vec(&request).map_err(to_js_err)?;
        let header_len = header_bytes.len() as u32;

        // write length prefix
        send.write_all(&header_len.to_be_bytes())
            .await
            .map_err(to_js_err)?;
        // write header
        send.write_all(&header_bytes).await.map_err(to_js_err)?;
        // write blob data
        send.write_all(data).await.map_err(to_js_err)?;
        send.finish().map_err(to_js_err)?;

        // read response (no length prefix, read to end)
        let response_bytes: Vec<u8> = recv.read_to_end(1024 * 1024).await.map_err(to_js_err)?;

        let response: PeerMessage = serde_json::from_slice(&response_bytes).map_err(to_js_err)?;

        match response {
            PeerMessage::BlobUploadResponse {
                blob_id,
                job_id,
                error,
                body,
                ..
            } => {
                if let Some(err) = error {
                    return Err(JsError::new(&err));
                }

                Ok(UploadResult {
                    blob_id,
                    job_id,
                    body,
                })
            }
            _ => Err(JsError::new("unexpected response type")),
        }
    }

    /// download a blob using iroh-blobs verified streaming
    ///
    /// this is the preferred method for audio files - provides:
    /// - verified streaming (each chunk is cryptographically verified)
    /// - resume support (can restart interrupted transfers)
    /// - efficient parallel chunk fetching
    ///
    /// peer_addr: plain node_id or full endpoint JSON
    /// blake3_hash: the blake3 hash of the blob (64 hex chars)
    pub async fn download_verified(
        &self,
        peer_addr: &str,
        blake3_hash: &str,
    ) -> Result<Uint8Array, JsError> {
        let addr = parse_peer_addr(peer_addr).map_err(|e| JsError::new(&e))?;

        // parse blake3 hash
        let hash: Hash = blake3_hash
            .parse()
            .map_err(|e| JsError::new(&format!("invalid blake3 hash: {}", e)))?;

        // create hash_and_format for download
        let hash_and_format = HashAndFormat::raw(hash);

        // download the blob - use peer's node_id for discovery
        let progress = self.blobs_downloader.download(hash_and_format, [addr.id]);

        // get progress stream and log events
        use iroh_blobs::api::downloader::DownloadProgressItem;

        let mut stream = progress
            .stream()
            .await
            .map_err(|e| JsError::new(&format!("download stream failed: {}", e)))?;

        let mut had_error = false;
        let mut last_error: Option<String> = None;

        while let Some(event) = stream.next().await {
            match &event {
                DownloadProgressItem::TryProvider { .. } => {}
                DownloadProgressItem::ProviderFailed { .. } => {}
                DownloadProgressItem::PartComplete { .. } => {}
                DownloadProgressItem::Progress(_bytes) => {
                    // progress logging disabled - too noisy
                }
                DownloadProgressItem::Error(e) => {
                    had_error = true;
                    last_error = Some(format!("{:?}", e));
                }
                DownloadProgressItem::DownloadError => {
                    had_error = true;
                    last_error = Some("download error".to_string());
                }
            }
        }

        if had_error {
            return Err(JsError::new(&format!(
                "download failed: {}",
                last_error.unwrap_or_else(|| "unknown error".to_string())
            )));
        }

        // read the blob from store
        let bytes = self
            .blobs_store
            .get_bytes(hash)
            .await
            .map_err(|e| JsError::new(&format!("failed to read blob from store: {}", e)))?;

        // convert to Uint8Array
        let array = Uint8Array::new_with_length(bytes.len() as u32);
        array.copy_from(&bytes);
        Ok(array)
    }

    /// ensure a blob is loaded into the peer's FsStore by blake3 hash
    ///
    /// call this before retrying download_verified if the first attempt fails.
    /// the server will look up the file by blake3 hash and add it to FsStore.
    ///
    /// returns true if blob is now available, false if not found.
    pub async fn ensure_blob(&self, peer_addr: &str, blake3_hash: &str) -> Result<bool, JsError> {
        let addr = parse_peer_addr(peer_addr).map_err(|e| JsError::new(&e))?;

        // connect to peer
        let conn = self.connect_to_peer(&addr).await?;

        let (mut send, mut recv): (SendStream, RecvStream) =
            conn.open_bi().await.map_err(to_js_err)?;

        // send ensure request
        let request = PeerMessage::EnsureBlobRequest {
            id: 1,
            blake3_hash: blake3_hash.to_string(),
        };
        let bytes = serde_json::to_vec(&request).map_err(to_js_err)?;
        send.write_all(&bytes).await.map_err(to_js_err)?;
        send.finish().map_err(to_js_err)?;

        // read response
        let response_bytes = recv.read_to_end(64 * 1024).await.map_err(to_js_err)?;

        let response: PeerMessage = serde_json::from_slice(&response_bytes).map_err(to_js_err)?;

        match response {
            PeerMessage::EnsureBlobResponse {
                available, error, ..
            } => {
                if let Some(err) = error {
                    warn!("ensure_blob error: {}", err);
                    return Ok(false);
                }
                Ok(available)
            }
            _ => Err(JsError::new("unexpected response type")),
        }
    }

    /// download a blob using iroh-blobs with automatic ensure + retry
    ///
    /// tries download_verified first. if blob not in peer's FsStore,
    /// calls ensure_blob to load it, then retries.
    pub async fn download_verified_with_ensure(
        &self,
        peer_addr: &str,
        blake3_hash: &str,
    ) -> Result<Uint8Array, JsError> {
        // first attempt
        match self.download_verified(peer_addr, blake3_hash).await {
            Ok(data) => return Ok(data),
            Err(_e) => {
                // retry with ensure_blob (normal for first download)
            }
        }

        // ensure blob is loaded into FsStore
        let available = self.ensure_blob(peer_addr, blake3_hash).await?;
        if !available {
            return Err(JsError::new(&format!(
                "blob {} not available on peer",
                &blake3_hash[..16.min(blake3_hash.len())]
            )));
        }

        // retry verified download
        self.download_verified(peer_addr, blake3_hash).await
    }

    /// compute blake3 hash for a blob on demand
    ///
    /// use this when the client doesn't have the blake3 hash yet (not in API response).
    /// the server will compute the hash, save it to the database, and add the file
    /// to FsStore for verified streaming.
    ///
    /// returns the blake3 hash (64 hex chars) if successful, null if blob not found.
    pub async fn compute_blake3(
        &self,
        peer_addr: &str,
        blob_id: &str,
    ) -> Result<Option<String>, JsError> {
        let addr = parse_peer_addr(peer_addr).map_err(|e| JsError::new(&e))?;

        // connect to peer
        let conn = self.connect_to_peer(&addr).await?;

        let (mut send, mut recv): (SendStream, RecvStream) =
            conn.open_bi().await.map_err(to_js_err)?;

        // send compute request
        let request = PeerMessage::ComputeBlake3Request {
            id: 1,
            blob_id: blob_id.to_string(),
        };
        let bytes = serde_json::to_vec(&request).map_err(to_js_err)?;
        send.write_all(&bytes).await.map_err(to_js_err)?;
        send.finish().map_err(to_js_err)?;

        // read response
        let response_bytes = recv.read_to_end(64 * 1024).await.map_err(to_js_err)?;

        let response: PeerMessage = serde_json::from_slice(&response_bytes).map_err(to_js_err)?;

        match response {
            PeerMessage::ComputeBlake3Response { blake3, error, .. } => {
                if let Some(err) = error {
                    // info only for non-expected errors
                    warn!("compute_blake3 error: {}", err);
                    return Ok(None);
                }
                if let Some(ref _hash) = blake3 {
                    // computed blake3 - silent success
                }
                Ok(blake3)
            }
            _ => Err(JsError::new("unexpected response type")),
        }
    }

    /// download a blob by blob_id using verified streaming with on-demand blake3
    ///
    /// use this when the client doesn't have the blake3 hash yet (not in API response).
    /// computes blake3 on the server, then uses iroh-blobs verified streaming.
    ///
    /// returns (blob_data, blake3_hash) for caching the hash for future requests.
    pub async fn download_verified_by_id(
        &self,
        peer_addr: &str,
        blob_id: &str,
    ) -> Result<js_sys::Array, JsError> {
        let blob_id_short = &blob_id[..16.min(blob_id.len())];

        // compute blake3 on demand
        let blake3 = self
            .compute_blake3(peer_addr, blob_id)
            .await?
            .ok_or_else(|| JsError::new(&format!("blob {} not found on peer", blob_id_short)))?;

        // use verified streaming (with ensure fallback)
        let data = self
            .download_verified_with_ensure(peer_addr, &blake3)
            .await?;

        // return [data, blake3] as JS array
        let result = js_sys::Array::new();
        result.push(&data);
        result.push(&JsValue::from_str(&blake3));
        Ok(result)
    }

    // --- gossip methods ---

    /// subscribe to a gossip topic and wait until joined (at least one peer connected)
    ///
    /// topic_hex: 32-byte topic id as 64 hex chars
    /// bootstrap_peers: JSON array of node_id strings (peers already in the topic)
    ///
    /// returns a GossipHandle for sending/receiving on this topic
    pub async fn gossip_join(
        &self,
        topic_hex: &str,
        bootstrap_peers_json: &str,
    ) -> Result<GossipHandle, JsError> {
        let topic_id = parse_topic_id(topic_hex)?;

        // parse bootstrap peer node_ids
        let peer_strs: Vec<String> =
            serde_json::from_str(bootstrap_peers_json).map_err(to_js_err)?;
        let bootstrap: Vec<iroh::EndpointId> = peer_strs
            .iter()
            .map(|s| s.parse::<PublicKey>().map(iroh::EndpointId::from))
            .collect::<Result<Vec<_>, _>>()
            .map_err(to_js_err)?;

        let topic = self
            .gossip
            .subscribe_and_join(topic_id, bootstrap)
            .await
            .map_err(to_js_err)?;

        let (sender, receiver) = topic.split();

        info!(
            "joined gossip topic {}",
            &topic_hex[..16.min(topic_hex.len())]
        );

        Ok(GossipHandle { sender, receiver })
    }

    /// subscribe to a gossip topic without waiting for peers
    ///
    /// useful when you're the first peer (no bootstrap needed).
    /// returns a GossipHandle immediately.
    pub async fn gossip_subscribe(
        &self,
        topic_hex: &str,
        bootstrap_peers_json: &str,
    ) -> Result<GossipHandle, JsError> {
        let topic_id = parse_topic_id(topic_hex)?;

        let peer_strs: Vec<String> =
            serde_json::from_str(bootstrap_peers_json).map_err(to_js_err)?;
        let bootstrap: Vec<iroh::EndpointId> = peer_strs
            .iter()
            .map(|s| s.parse::<PublicKey>().map(iroh::EndpointId::from))
            .collect::<Result<Vec<_>, _>>()
            .map_err(to_js_err)?;

        let topic = self
            .gossip
            .subscribe(topic_id, bootstrap)
            .await
            .map_err(to_js_err)?;

        let (sender, receiver) = topic.split();

        info!(
            "subscribed to gossip topic {}",
            &topic_hex[..16.min(topic_hex.len())]
        );

        Ok(GossipHandle { sender, receiver })
    }
}

/// handle for a subscribed gossip topic
///
/// holds sender and receiver halves. dropping this leaves the topic.
#[wasm_bindgen]
pub struct GossipHandle {
    sender: iroh_gossip::api::GossipSender,
    receiver: iroh_gossip::api::GossipReceiver,
}

#[wasm_bindgen]
impl GossipHandle {
    /// broadcast a message to all peers in the topic
    pub async fn broadcast(&self, message: &[u8]) -> Result<(), JsError> {
        self.sender
            .broadcast(Bytes::copy_from_slice(message))
            .await
            .map_err(to_js_err)
    }

    /// receive the next event from the topic
    ///
    /// returns a JSON string with the event:
    /// - {"type":"received","content":<base64>,"from":"<node_id>"}
    /// - {"type":"neighbor_up","node_id":"<node_id>"}
    /// - {"type":"neighbor_down","node_id":"<node_id>"}
    /// - {"type":"lagged"}
    /// - null if the topic is closed
    pub async fn recv(&mut self) -> Result<JsValue, JsError> {
        use iroh_gossip::api::Event;

        match self.receiver.next().await {
            Some(Ok(event)) => {
                let json = match event {
                    Event::Received(msg) => {
                        let content_b64 =
                            base64_encode(&msg.content);
                        let from = msg.delivered_from.to_string();
                        serde_json::json!({
                            "type": "received",
                            "content": content_b64,
                            "from": from
                        })
                    }
                    Event::NeighborUp(id) => {
                        serde_json::json!({
                            "type": "neighbor_up",
                            "node_id": id.to_string()
                        })
                    }
                    Event::NeighborDown(id) => {
                        serde_json::json!({
                            "type": "neighbor_down",
                            "node_id": id.to_string()
                        })
                    }
                    Event::Lagged => {
                        serde_json::json!({ "type": "lagged" })
                    }
                };
                Ok(serde_wasm_bindgen::to_value(&json).map_err(to_js_err)?)
            }
            Some(Err(e)) => Err(to_js_err(e)),
            None => Ok(JsValue::NULL),
        }
    }
}

fn to_js_err<E: std::fmt::Display>(e: E) -> JsError {
    JsError::new(&e.to_string())
}

/// parse a 64-char hex string into a TopicId (32 bytes)
fn parse_topic_id(hex: &str) -> Result<TopicId, JsError> {
    let bytes = hex::decode(hex).map_err(|e| JsError::new(&format!("invalid topic hex: {}", e)))?;
    if bytes.len() != 32 {
        return Err(JsError::new("topic id must be 32 bytes (64 hex chars)"));
    }
    let mut arr = [0u8; 32];
    arr.copy_from_slice(&bytes);
    Ok(TopicId::from(arr))
}

/// simple base64 encoding (no padding) for gossip message content
fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[((n >> 18) & 63) as usize] as char);
        result.push(CHARS[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARS[((n >> 6) & 63) as usize] as char);
        }
        if chunk.len() > 2 {
            result.push(CHARS[(n & 63) as usize] as char);
        }
    }
    result
}
