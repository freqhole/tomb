//! midden: browser WASM client for freqhole P2P federation
//!
//! uses iroh to connect to freqhole peers from the browser.
//! accepts either plain node_id or full endpoint address JSON with relay/IP hints.

use iroh::endpoint::{Connection, RecvStream, SendStream};
use iroh::{Endpoint, EndpointAddr, PublicKey, SecretKey};
use js_sys::Uint8Array;
use serde::{Deserialize, Serialize};
use tracing::info;
use tracing::level_filters::LevelFilter;
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
#[wasm_bindgen]
pub struct MiddenNode {
    endpoint: Endpoint,
    secret_key_bytes: [u8; 32],
}

#[wasm_bindgen]
impl MiddenNode {
    /// create a new node with random identity
    /// waits for relay connection before returning
    pub async fn create() -> Result<MiddenNode, JsError> {
        info!("creating midden node with random identity...");

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

        info!("creating midden node from existing key...");
        Self::create_with_secret_key(bytes).await
    }

    /// internal: create node with given secret key bytes
    async fn create_with_secret_key(bytes: [u8; 32]) -> Result<MiddenNode, JsError> {
        let secret_key = SecretKey::from_bytes(&bytes);

        // create endpoint with freqhole ALPN
        let endpoint = Endpoint::builder()
            .secret_key(secret_key)
            .alpns(vec![FREQHOLE_ALPN.to_vec()])
            .bind()
            .await
            .map_err(to_js_err)?;

        // wait for relay connection
        endpoint.online().await;

        let node_id = endpoint.secret_key().public().to_string();
        info!("midden node ready: {}", &node_id[..16]);

        Ok(MiddenNode {
            endpoint,
            secret_key_bytes: bytes,
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
        let node_id_short = &addr.id.to_string()[..16];

        info!("proxy {} {} to {}", method, path, node_id_short);

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
        let node_id_short = &addr.id.to_string()[..16];

        info!(
            "fetch blob {} from {}",
            &blob_id[..16.min(blob_id.len())],
            node_id_short
        );

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

                let expected_size = size.unwrap_or(0);
                info!("receiving {} bytes", expected_size);

                // read all blob data
                let data: Vec<u8> = recv
                    .read_to_end(100 * 1024 * 1024) // 100MB max
                    .await
                    .map_err(to_js_err)?;

                info!("received {} bytes", data.len());

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
        let node_id_short = &addr.id.to_string()[..16];

        info!(
            "fetch blob (w/progress) {} from {}",
            &blob_id[..16.min(blob_id.len())],
            node_id_short
        );

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
                info!("receiving {} bytes (with progress)", total_size);

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

                info!("received {} bytes", data.len());

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
        let node_id_short = &addr.id.to_string()[..16];

        info!("fetch hello image from {}", node_id_short);

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
                size,
                content_type,
                error,
                ..
            } => {
                if let Some(err) = error {
                    return Err(JsError::new(&err));
                }

                let expected_size = size.unwrap_or(0);
                info!("receiving server image {} bytes", expected_size);

                // read all image data
                let data: Vec<u8> = recv
                    .read_to_end(10 * 1024 * 1024) // 10MB max for server image
                    .await
                    .map_err(to_js_err)?;

                info!("received {} bytes", data.len());

                Ok(BlobResult { data, content_type })
            }
            _ => Err(JsError::new("unexpected response type")),
        }
    }

    /// upload a blob to a peer
    /// peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
    /// returns UploadResult with blob_id and job_id on success
    pub async fn upload_blob(
        &self,
        peer_addr: &str,
        filename: &str,
        content_type: &str,
        data: &[u8],
    ) -> Result<UploadResult, JsError> {
        let addr = parse_peer_addr(peer_addr).map_err(|e| JsError::new(&e))?;
        let node_id_short = &addr.id.to_string()[..16];

        info!(
            "upload blob {} ({} bytes) to {}",
            filename,
            data.len(),
            node_id_short
        );

        // connect to peer
        let conn = self.connect_to_peer(&addr).await?;

        let (mut send, mut recv): (SendStream, RecvStream) =
            conn.open_bi().await.map_err(to_js_err)?;

        // send length-prefixed header
        let request = PeerMessage::BlobUploadRequest {
            id: 1,
            filename: filename.to_string(),
            content_type: content_type.to_string(),
            size: data.len() as u64,
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

        info!("upload sent, waiting for response");

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

                info!(
                    "upload complete: blob_id={:?}, job_id={:?}",
                    blob_id, job_id
                );
                Ok(UploadResult {
                    blob_id,
                    job_id,
                    body,
                })
            }
            _ => Err(JsError::new("unexpected response type")),
        }
    }
}

fn to_js_err<E: std::fmt::Display>(e: E) -> JsError {
    JsError::new(&e.to_string())
}
