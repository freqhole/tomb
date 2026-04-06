//! midden: browser WASM client for freqhole P2P federation
//!
//! uses iroh to connect to freqhole peers from the browser.
//! accepts either plain node_id or full endpoint address JSON with relay/IP hints.
//!
//! supports two protocols:
//! - freqhole/1: custom protocol for API proxying and small blob streaming
//! - freqhole-blobz: iroh-blobs protocol for verified streaming of audio files

use iroh::endpoint::presets;
use iroh::endpoint::{Connection, RecvStream, SendStream};
use iroh::{Endpoint, EndpointAddr, PublicKey, SecretKey};
use iroh_blobs::api::downloader::Downloader;
use iroh_blobs::api::Store;
use iroh_blobs::{Hash, HashAndFormat};
use js_sys::Uint8Array;
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use tracing::level_filters::LevelFilter;
use tracing::{info, warn};
use tracing_subscriber_wasm::MakeConsoleWriter;
use wasm_bindgen::{prelude::wasm_bindgen, JsError, JsValue};

/// ALPN protocol identifier (must match grimoire's FREQHOLE_ALPN)
const FREQHOLE_ALPN: &[u8] = b"freqhole/1";

/// ALPN for automerge-repo document sync (used by skein canvas P2P)
const AUTOMERGE_ALPN: &[u8] = b"iroh/automerge-repo/1";

/// ALPN for friend requests, profile sharing, and presence heartbeat (used by skein social layer)
const FRIENDZ_ALPN: &[u8] = b"freqhole-friendz/1";

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

/// a bidirectional QUIC stream for length-delimited message exchange.
///
/// wraps an iroh (SendStream, RecvStream) pair. messages are framed with
/// a 4-byte big-endian u32 length prefix, matching `LengthDelimitedCodec`
/// from tokio-util.
///
/// the send and recv halves use RefCell<Option<...>> so that async read
/// and write operations can proceed concurrently (safe because WASM is
/// single-threaded).
#[wasm_bindgen]
pub struct BiStream {
    send: RefCell<Option<SendStream>>,
    recv: RefCell<Option<RecvStream>>,
    peer_node_id: String,
    alpn: String,
}

#[wasm_bindgen]
impl BiStream {
    /// the remote peer's node ID (iroh public key as hex string).
    pub fn peer_node_id(&self) -> String {
        self.peer_node_id.clone()
    }

    /// the ALPN protocol this stream was established on.
    pub fn alpn(&self) -> String {
        self.alpn.clone()
    }

    /// write a length-delimited message.
    ///
    /// writes a 4-byte big-endian u32 length prefix followed by the payload.
    /// this matches the `LengthDelimitedCodec` framing used by the
    /// iroh-automerge-repo example.
    pub async fn write_message(&self, data: &[u8]) -> Result<(), JsError> {
        let mut send = self
            .send
            .borrow_mut()
            .take()
            .ok_or_else(|| JsError::new("send stream busy or closed"))?;

        let len = data.len() as u32;
        let result = async {
            send.write_all(&len.to_be_bytes())
                .await
                .map_err(to_js_err)?;
            send.write_all(data).await.map_err(to_js_err)?;
            Ok::<(), JsError>(())
        }
        .await;

        // always put the send stream back (unless it errored fatally)
        *self.send.borrow_mut() = Some(send);

        result
    }

    /// read a length-delimited message.
    ///
    /// reads a 4-byte big-endian u32 length prefix, then reads that many
    /// bytes of payload. returns the payload as a Uint8Array.
    ///
    /// returns null (JsValue::NULL) if the stream has been closed cleanly
    /// by the remote peer (EOF on the length prefix read).
    pub async fn read_message(&self) -> Result<JsValue, JsError> {
        let mut recv = self
            .recv
            .borrow_mut()
            .take()
            .ok_or_else(|| JsError::new("recv stream busy or closed"))?;

        // read 4-byte length prefix
        let mut len_buf = [0u8; 4];
        let read_result = recv.read_exact(&mut len_buf).await;

        match read_result {
            Ok(()) => {}
            Err(e) => {
                // put stream back before returning
                *self.recv.borrow_mut() = Some(recv);

                // check if this is a clean stream close (FinishedEarly with 0 bytes)
                let err_str = e.to_string();
                if err_str.contains("finished")
                    || err_str.contains("closed")
                    || err_str.contains("eof")
                {
                    return Ok(JsValue::NULL);
                }
                return Err(to_js_err(e));
            }
        }

        let len = u32::from_be_bytes(len_buf) as usize;

        // sanity check: reject absurdly large messages (256 MB)
        if len > 256 * 1024 * 1024 {
            *self.recv.borrow_mut() = Some(recv);
            return Err(JsError::new(&format!("message too large: {} bytes", len)));
        }

        let mut buf = vec![0u8; len];
        let payload_result = recv.read_exact(&mut buf).await;

        // put stream back
        *self.recv.borrow_mut() = Some(recv);

        match payload_result {
            Ok(()) => Ok(Uint8Array::from(&buf[..]).into()),
            Err(e) => Err(to_js_err(e)),
        }
    }

    /// read all remaining bytes from the recv stream (no length prefix).
    ///
    /// reads until the remote peer finishes the stream or `max_size` bytes
    /// are read. this matches grimoire's `read_to_end()` framing where
    /// the message is terminated by the sender calling `finish()`.
    pub async fn read_to_end(&self, max_size: u32) -> Result<JsValue, JsError> {
        let mut recv = self
            .recv
            .borrow_mut()
            .take()
            .ok_or_else(|| JsError::new("recv stream busy or closed"))?;

        let result = recv.read_to_end(max_size as usize).await;

        // put stream back
        *self.recv.borrow_mut() = Some(recv);

        match result {
            Ok(bytes) => Ok(Uint8Array::from(&bytes[..]).into()),
            Err(e) => {
                let err_str = e.to_string();
                if err_str.contains("finished")
                    || err_str.contains("closed")
                    || err_str.contains("eof")
                {
                    // clean close — return empty array
                    return Ok(Uint8Array::new_with_length(0).into());
                }
                Err(to_js_err(e))
            }
        }
    }

    /// write raw bytes without a length prefix, then finish the send stream.
    ///
    /// this matches grimoire's `send_response()` framing where the message
    /// is terminated by calling `finish()` on the send stream. the receiver
    /// uses `read_to_end()` to read all bytes.
    pub async fn write_raw_and_finish(&self, data: &[u8]) -> Result<(), JsError> {
        let mut send = self
            .send
            .borrow_mut()
            .take()
            .ok_or_else(|| JsError::new("send stream busy or closed"))?;

        let result = async {
            send.write_all(data).await.map_err(to_js_err)?;
            send.finish().map_err(to_js_err)?;
            Ok::<(), JsError>(())
        }
        .await;

        // put stream back even on error
        *self.send.borrow_mut() = Some(send);

        result
    }

    /// close the stream.
    ///
    /// finishes the send half and drops both halves.
    pub fn close(&self) {
        if let Some(mut send) = self.send.borrow_mut().take() {
            // finish() signals intent to close — returns Result which we discard
            let _ = send.finish();
        }
        // drop the recv half
        self.recv.borrow_mut().take();
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
/// supports two protocols:
/// - freqhole/1: API proxying and small blob streaming
/// - iroh-blobs: verified streaming for audio files
#[wasm_bindgen]
pub struct MiddenNode {
    endpoint: Endpoint,
    secret_key_bytes: [u8; 32],
    // iroh-blobs components
    blobs_store: Store,
    blobs_downloader: Downloader,
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
        let endpoint = Endpoint::builder(presets::N0)
            .secret_key(secret_key)
            .alpns(vec![
                FREQHOLE_ALPN.to_vec(),
                AUTOMERGE_ALPN.to_vec(),
                FRIENDZ_ALPN.to_vec(),
            ])
            .bind()
            .await
            .map_err(to_js_err)?;

        // setup iroh-blobs with MemStore (no persistence in browser)
        let mem_store = iroh_blobs::store::mem::MemStore::default();
        let blobs_downloader = Downloader::new(&mem_store, &endpoint);
        let blobs_store = mem_store.as_ref().clone();

        // wait for relay connection
        endpoint.online().await;

        let node_id = endpoint.secret_key().public().to_string();
        info!("midden node ready: {}", &node_id[..16]);

        Ok(MiddenNode {
            endpoint,
            secret_key_bytes: bytes,
            blobs_store,
            blobs_downloader,
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

    /// create a node from existing secret key with additional ALPN protocols.
    ///
    /// `extra_alpns` is a JS array of strings (e.g. ["iroh/automerge-repo/1"]).
    /// the node always registers "freqhole/1" plus whatever extra ALPNs are given.
    pub async fn create_with_alpns(
        key_bytes: &[u8],
        extra_alpns: &js_sys::Array,
    ) -> Result<MiddenNode, JsError> {
        if key_bytes.len() != 32 {
            return Err(JsError::new("secret key must be exactly 32 bytes"));
        }

        let mut bytes = [0u8; 32];
        bytes.copy_from_slice(key_bytes);

        // collect extra ALPNs from JS array
        let mut alpns = vec![
            FREQHOLE_ALPN.to_vec(),
            AUTOMERGE_ALPN.to_vec(),
            FRIENDZ_ALPN.to_vec(),
        ];
        for i in 0..extra_alpns.length() {
            let alpn_str = extra_alpns
                .get(i)
                .as_string()
                .ok_or_else(|| JsError::new("each ALPN must be a string"))?;
            alpns.push(alpn_str.into_bytes());
        }

        let secret_key = SecretKey::from_bytes(&bytes);

        let endpoint = Endpoint::builder(presets::N0)
            .secret_key(secret_key)
            .alpns(alpns)
            .bind()
            .await
            .map_err(to_js_err)?;

        let mem_store = iroh_blobs::store::mem::MemStore::default();
        let blobs_downloader = Downloader::new(&mem_store, &endpoint);
        let blobs_store = mem_store.as_ref().clone();

        endpoint.online().await;

        let node_id = endpoint.secret_key().public().to_string();
        info!("midden node ready (with extra ALPNs): {}", &node_id[..16]);

        Ok(MiddenNode {
            endpoint,
            secret_key_bytes: bytes,
            blobs_store,
            blobs_downloader,
        })
    }

    /// open a bidirectional stream to a peer on a specific ALPN.
    ///
    /// `peer_addr` can be a plain node_id hex string or a full endpoint
    /// address JSON (same format as proxy_request). `alpn` is the protocol
    /// to negotiate (e.g. "iroh/automerge-repo/1").
    ///
    /// returns a BiStream for length-delimited message exchange.
    pub async fn open_bi(&self, peer_addr: &str, alpn: &str) -> Result<BiStream, JsError> {
        let addr = parse_peer_addr(peer_addr).map_err(|e| JsError::new(&e))?;
        let alpn_bytes = alpn.as_bytes();

        let conn = self
            .endpoint
            .connect(addr.clone(), alpn_bytes)
            .await
            .map_err(to_js_err)?;

        let (send, recv) = conn.open_bi().await.map_err(to_js_err)?;

        // iroh 0.97: Connection::remote_id() returns EndpointId (= PublicKey)
        let peer_node_id = conn.remote_id().to_string();

        info!(
            "opened bi stream to {} on ALPN {}",
            &peer_node_id[..std::cmp::min(16, peer_node_id.len())],
            alpn
        );

        Ok(BiStream {
            send: RefCell::new(Some(send)),
            recv: RefCell::new(Some(recv)),
            peer_node_id,
            alpn: alpn.to_string(),
        })
    }

    /// accept the next incoming connection and bidirectional stream.
    ///
    /// blocks until an incoming connection arrives on any registered ALPN.
    /// returns a BiStream with the peer's node ID and the negotiated ALPN.
    ///
    /// returns null (JsValue::NULL) if the endpoint has been closed.
    ///
    /// the caller should check `stream.alpn()` to route the connection
    /// to the appropriate handler.
    pub async fn accept(&self) -> Result<JsValue, JsError> {
        // wait for the next incoming connection
        let incoming = match self.endpoint.accept().await {
            Some(incoming) => incoming,
            None => return Ok(JsValue::NULL), // endpoint closed
        };

        // accept the connection (completes TLS handshake).
        // iroh 0.97: Incoming implements IntoFuture, so .await directly
        // yields Result<Connection, ConnectingError>.
        let conn = incoming.await.map_err(to_js_err)?;

        // extract connection metadata
        // iroh 0.97: Connection::alpn() returns &[u8]
        let alpn = String::from_utf8_lossy(conn.alpn()).to_string();
        // iroh 0.97: Connection::remote_id() returns EndpointId (= PublicKey)
        let peer_node_id = conn.remote_id().to_string();

        // accept one bidirectional stream from this connection
        let (send, recv) = conn.accept_bi().await.map_err(to_js_err)?;

        info!(
            "accepted bi stream from {} on ALPN {}",
            &peer_node_id[..std::cmp::min(16, peer_node_id.len())],
            &alpn
        );

        let stream = BiStream {
            send: RefCell::new(Some(send)),
            recv: RefCell::new(Some(recv)),
            peer_node_id,
            alpn,
        };

        Ok(stream.into())
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
        use n0_future::StreamExt;

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
}

fn to_js_err<E: std::fmt::Display>(e: E) -> JsError {
    JsError::new(&e.to_string())
}
