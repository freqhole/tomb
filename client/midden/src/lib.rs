//! midden: browser WASM client for freqhole P2P federation
//!
//! uses iroh to connect to freqhole peers from the browser.
//! accepts either plain node_id or full endpoint address JSON with relay/IP hints.
//!
//! supports two protocols:
//! - freqhole/1: custom protocol for API proxying and small blob streaming
//! - freqhole-blobz: iroh-blobs protocol for verified streaming of audio files

use bao_tree::ChunkRanges;
use indexmap::IndexMap;
use iroh::endpoint::presets;
use iroh::endpoint::{Connection, RecvStream, SendStream};
use iroh::protocol::ProtocolHandler;
use iroh::{Endpoint, EndpointAddr, PublicKey, SecretKey};
use iroh_blobs::api::downloader::Downloader;
use iroh_blobs::api::Store;
use iroh_blobs::api::TempTag;
use iroh_blobs::store::GcConfig;
use iroh_blobs::{BlobsProtocol, Hash, HashAndFormat};
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

/// result from fetching the server hello image from a peer
#[wasm_bindgen]
pub struct HelloImageResult {
    data: Vec<u8>,
    content_type: Option<String>,
}

#[wasm_bindgen]
impl HelloImageResult {
    #[wasm_bindgen(getter)]
    pub fn data(&self) -> Uint8Array {
        Uint8Array::from(&self.data[..])
    }

    #[wasm_bindgen(getter)]
    pub fn content_type(&self) -> Option<String> {
        self.content_type.clone()
    }
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

/// compute the blake3 hash of the given bytes and return as a hex string.
/// this runs entirely in the browser — no network call needed.
#[wasm_bindgen]
pub fn hash_blake3(data: &[u8]) -> String {
    blake3::hash(data).to_hex().to_string()
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
    blobs_protocol: BlobsProtocol,
    /// active TempTags keyed by blob hash — prevents GC of imported blobs.
    /// capped at 3 entries; oldest evicted when full.
    #[wasm_bindgen(skip)]
    pub active_tags: RefCell<IndexMap<Hash, TempTag>>,
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
                iroh_blobs::ALPN.to_vec(),
            ])
            .bind()
            .await
            .map_err(to_js_err)?;

        // setup iroh-blobs with MemStore + GC (blobs served on-demand from OPFS,
        // GC reclaims memory after TempTags are dropped)
        let mem_store =
            iroh_blobs::store::mem::MemStore::new_with_opts(iroh_blobs::store::mem::Options {
                gc_config: Some(GcConfig {
                    interval: std::time::Duration::from_secs(30),
                    add_protected: None,
                }),
            });
        let blobs_downloader = Downloader::new(&mem_store, &endpoint);
        let blobs_store = mem_store.as_ref().clone();
        let blobs_protocol = BlobsProtocol::new(&blobs_store, None);

        // wait for relay connection
        endpoint.online().await;

        let node_id = endpoint.secret_key().public().to_string();
        info!("midden node ready: {}", &node_id[..16]);

        Ok(MiddenNode {
            endpoint,
            secret_key_bytes: bytes,
            blobs_store,
            blobs_downloader,
            blobs_protocol,
            active_tags: RefCell::new(IndexMap::new()),
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
            iroh_blobs::ALPN.to_vec(),
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

        let mem_store =
            iroh_blobs::store::mem::MemStore::new_with_opts(iroh_blobs::store::mem::Options {
                gc_config: Some(GcConfig {
                    interval: std::time::Duration::from_secs(30),
                    add_protected: None,
                }),
            });
        let blobs_downloader = Downloader::new(&mem_store, &endpoint);
        let blobs_store = mem_store.as_ref().clone();
        let blobs_protocol = BlobsProtocol::new(&blobs_store, None);

        endpoint.online().await;

        let node_id = endpoint.secret_key().public().to_string();
        info!("midden node ready (with extra ALPNs): {}", &node_id[..16]);

        Ok(MiddenNode {
            endpoint,
            secret_key_bytes: bytes,
            blobs_store,
            blobs_downloader,
            blobs_protocol,
            active_tags: RefCell::new(IndexMap::new()),
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
        loop {
            // wait for the next incoming connection
            let incoming = match self.endpoint.accept().await {
                Some(incoming) => incoming,
                None => return Ok(JsValue::NULL), // endpoint closed
            };

            // accept the connection (completes TLS handshake)
            let conn = incoming.await.map_err(to_js_err)?;

            // extract ALPN before deciding how to handle
            let alpn_bytes = conn.alpn().to_vec();

            // iroh-blobs connections are handled entirely in Rust —
            // spawn the BlobsProtocol handler and loop back to accept more
            if alpn_bytes == iroh_blobs::ALPN {
                let blobs = self.blobs_protocol.clone();
                let peer_id = conn.remote_id().to_string();
                info!(
                    "accepting iroh-blobs connection from {}",
                    &peer_id[..std::cmp::min(16, peer_id.len())]
                );
                wasm_bindgen_futures::spawn_local(async move {
                    if let Err(e) = blobs.accept(conn).await {
                        warn!("iroh-blobs accept error: {}", e);
                    }
                });
                continue; // loop back to accept the next connection
            }

            // for other ALPNs, return a BiStream to JS as before
            let alpn = String::from_utf8_lossy(&alpn_bytes).to_string();
            let peer_node_id = conn.remote_id().to_string();

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

            return Ok(stream.into());
        }
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

    /// fetch server image from a peer (public, no auth required)
    /// used during "add remote" flow before user is authenticated
    /// peer_addr can be plain node_id or full endpoint JSON with relay/IP hints
    pub async fn fetch_hello_image(&self, peer_addr: &str) -> Result<HelloImageResult, JsError> {
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

                Ok(HelloImageResult { data, content_type })
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

    /// import raw bytes into the iroh-blobs store, returning the blake3 hash.
    /// this makes the blob available for verified download by peers.
    /// the blob stays in the store as long as its TempTag is held in active_tags.
    /// call release_blob() to allow GC, or it will be evicted when the map exceeds 3 entries.
    #[wasm_bindgen]
    pub async fn import_blob(&self, data: &[u8]) -> Result<String, JsError> {
        // check active_tags first to avoid the expensive add_bytes + bao computation
        let hash_bytes = blake3::hash(data);
        let hash = Hash::from_bytes(*hash_bytes.as_bytes());

        {
            let tags = self.active_tags.borrow();
            if tags.contains_key(&hash) {
                return Ok(hash.to_hex().to_string());
            }
        }

        let bytes_data = bytes::Bytes::from(data.to_vec());
        let tt = self
            .blobs_store
            .blobs()
            .add_bytes(bytes_data)
            .temp_tag()
            .await
            .map_err(|e| JsError::new(&format!("failed to import blob: {}", e)))?;

        let mut tags = self.active_tags.borrow_mut();

        // cap at 3 entries — evict oldest before inserting the 4th.
        // blobs are served on-demand from OPFS; small cap keeps memory bounded.
        // GC (30s interval) reclaims MemStore memory after TempTags are dropped.
        if tags.len() >= 3 {
            let evict_key = *tags.keys().next().unwrap();
            tags.shift_remove(&evict_key);
        }

        tags.insert(hash, tt);
        Ok(hash.to_hex().to_string())
    }

    /// import raw bytes into the iroh-blobs store, returning both the blake3 hash
    /// AND the bao-encoded bytes. the bao bytes can be cached in OPFS and later
    /// fed to `import_bao` to skip the expensive bao tree recomputation on re-import.
    ///
    /// returns a JS object: `{ hash: string, bao: Uint8Array }`
    #[wasm_bindgen]
    pub async fn import_blob_and_export_bao(&self, data: &[u8]) -> Result<JsValue, JsError> {
        let hash_bytes = blake3::hash(data);
        let hash = Hash::from_bytes(*hash_bytes.as_bytes());
        let hash_str = hash.to_hex().to_string();

        // import the blob (computes bao tree internally)
        let bytes_data = bytes::Bytes::from(data.to_vec());
        let tt = self
            .blobs_store
            .blobs()
            .add_bytes(bytes_data)
            .temp_tag()
            .await
            .map_err(|e| JsError::new(&format!("failed to import blob: {}", e)))?;

        // export the bao-encoded stream (data + tree interleaved).
        // this is the format accepted by import_bao_bytes for re-import.
        let bao_bytes = self
            .blobs_store
            .blobs()
            .export_bao(hash, ChunkRanges::all())
            .bao_to_vec()
            .await
            .map_err(|e| JsError::new(&format!("failed to export bao: {}", e)))?;

        // store TempTag (with eviction)
        let mut tags = self.active_tags.borrow_mut();
        if tags.len() >= 3 {
            let evict_key = *tags.keys().next().unwrap();
            tags.shift_remove(&evict_key);
        }
        tags.insert(hash, tt);

        // return { hash, bao } to JS
        let bao_array = Uint8Array::new_with_length(bao_bytes.len() as u32);
        bao_array.copy_from(&bao_bytes);

        let result = js_sys::Object::new();
        js_sys::Reflect::set(&result, &"hash".into(), &hash_str.into())
            .map_err(|_| JsError::new("failed to set hash on result object"))?;
        js_sys::Reflect::set(&result, &"bao".into(), &bao_array.into())
            .map_err(|_| JsError::new("failed to set bao on result object"))?;
        Ok(result.into())
    }

    /// import a blob from its pre-computed bao-encoded bytes, skipping the
    /// expensive bao tree computation. `blake3_hash` is the 64-char hex hash,
    /// `bao_data` is the bao-encoded bytes previously returned by
    /// `import_blob_and_export_bao`.
    ///
    /// uses `import_bao_bytes` (iroh-blobs internal API) to feed the pre-computed
    /// bao stream directly into the store, then creates a global TempTag via
    /// `Tags::temp_tag` to prevent GC.
    #[wasm_bindgen]
    pub async fn import_bao(&self, blake3_hash: &str, bao_data: &[u8]) -> Result<String, JsError> {
        let hash: Hash = blake3_hash
            .parse()
            .map_err(|_| JsError::new("invalid blake3 hash"))?;

        // check active_tags first — no need to re-import
        {
            let tags = self.active_tags.borrow();
            if tags.contains_key(&hash) {
                return Ok(hash.to_hex().to_string());
            }
        }

        // import the bao-encoded bytes (data + outboard tree interleaved).
        // this skips the bao tree computation that add_bytes() would do.
        let bao_bytes = bytes::Bytes::from(bao_data.to_vec());
        self.blobs_store
            .blobs()
            .import_bao_bytes(hash, ChunkRanges::all(), bao_bytes)
            .await
            .map_err(|e| JsError::new(&format!("failed to import bao: {}", e)))?;

        // create a global-scope TempTag to prevent GC.
        // Tags::temp_tag creates a TempTag independent of any Batch scope,
        // so it survives as long as we hold it in active_tags.
        let tt = self
            .blobs_store
            .tags()
            .temp_tag(HashAndFormat::raw(hash))
            .await
            .map_err(|e| JsError::new(&format!("failed to create temp tag: {}", e)))?;

        // store TempTag (with eviction)
        let mut tags = self.active_tags.borrow_mut();
        if tags.len() >= 3 {
            let evict_key = *tags.keys().next().unwrap();
            tags.shift_remove(&evict_key);
        }
        tags.insert(hash, tt);

        Ok(hash.to_hex().to_string())
    }

    /// release a blob's TempTag, allowing the store to garbage-collect it.
    /// blake3_hash should be the 64-char hex string returned by import_blob.
    #[wasm_bindgen]
    pub fn release_blob(&self, blake3_hash: &str) -> Result<(), JsError> {
        let hash: Hash = blake3_hash
            .parse()
            .map_err(|_| JsError::new("invalid blake3 hash"))?;
        self.active_tags.borrow_mut().shift_remove(&hash);
        Ok(())
    }

    /// return the number of blobs currently held in the store via active TempTags.
    #[wasm_bindgen]
    pub fn active_blob_count(&self) -> usize {
        self.active_tags.borrow().len()
    }

    /// check whether a blob with the given blake3 hash is currently held in the MemStore
    /// via an active TempTag. avoids expensive OPFS read + bao recomputation when the
    /// blob is already loaded.
    #[wasm_bindgen]
    pub fn has_active_blob(&self, blake3_hash: &str) -> bool {
        let hash: Hash = match blake3_hash.parse() {
            Ok(h) => h,
            Err(_) => return false,
        };
        self.active_tags.borrow().contains_key(&hash)
    }
}

fn to_js_err<E: std::fmt::Display>(e: E) -> JsError {
    JsError::new(&e.to_string())
}
