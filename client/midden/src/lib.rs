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
use iroh_blobs::store::{GcConfig, ProtectCb, ProtectOutcome};
use iroh_blobs::{BlobsProtocol, Hash, HashAndFormat};
use js_sys::{Function as JsFunction, Uint8Array};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use tracing::level_filters::LevelFilter;
use tracing::{debug, info, warn};
use tracing_subscriber_wasm::MakeConsoleWriter;
use wasm_bindgen::{prelude::wasm_bindgen, JsError, JsValue};

/// ALPN protocol identifier (must match grimoire's FREQHOLE_ALPN)
const FREQHOLE_ALPN: &[u8] = b"freqhole/1";

/// ALPN for automerge-repo document sync (used by skein canvas P2P)
const AUTOMERGE_ALPN: &[u8] = b"iroh/automerge-repo/1";

/// ALPN for friend requests, profile sharing, and presence heartbeat (used by skein social layer)
const FRIENDZ_ALPN: &[u8] = b"freqhole-friendz/1";

/// ALPN for admin command dispatch (must match grimoire's ADMIN_ALPN)
const ADMIN_ALPN: &[u8] = b"freqhole-admin/1";

/// admin protocol messages (must match grimoire's AdminMessage)
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum AdminMessage {
    Request {
        id: u64,
        command: String,
        args: serde_json::Value,
    },
    Response {
        id: u64,
        success: bool,
        data: Option<serde_json::Value>,
        message: String,
        errors: Vec<serde_json::Value>,
    },
}

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
    /// hashes currently being downloaded/streamed; protected from GC sweeps.
    /// downloader does not auto-create TempTags, so without this an in-flight
    /// download can be wiped by the periodic GC between download-stream-end
    /// and reader.read, leaving an empty bitfield and a hung await_completion.
    protected_hashes: Arc<Mutex<HashSet<Hash>>>,
    /// guards against starting the blob server accept loop more than once
    blob_server_running: RefCell<bool>,
}

/// build a GcConfig that protects any hash present in `protected_hashes`
fn make_gc_config(protected_hashes: Arc<Mutex<HashSet<Hash>>>) -> GcConfig {
    let cb: ProtectCb = Arc::new(move |live: &mut HashSet<Hash>| {
        if let Ok(set) = protected_hashes.lock() {
            live.extend(set.iter().copied());
        }
        Box::pin(async move { ProtectOutcome::Continue })
    });
    GcConfig {
        interval: std::time::Duration::from_secs(30),
        add_protected: Some(cb),
    }
}

/// RAII guard: inserts a hash into the protected set on construction,
/// removes it on drop. used to keep an in-flight download alive across
/// the download → read phases without relying on TempTags.
struct ProtectGuard {
    protected: Arc<Mutex<HashSet<Hash>>>,
    hash: Hash,
}

impl ProtectGuard {
    fn new(protected: Arc<Mutex<HashSet<Hash>>>, hash: Hash) -> Self {
        if let Ok(mut set) = protected.lock() {
            set.insert(hash);
        }
        Self { protected, hash }
    }
}

impl Drop for ProtectGuard {
    fn drop(&mut self) {
        if let Ok(mut set) = self.protected.lock() {
            set.remove(&self.hash);
        }
    }
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
                ADMIN_ALPN.to_vec(),
                iroh_blobs::ALPN.to_vec(),
            ])
            .bind()
            .await
            .map_err(to_js_err)?;

        // setup iroh-blobs with MemStore + GC. periodic GC keeps memory bounded;
        // a protect callback (fed by `protected_hashes`) keeps in-flight downloads
        // alive until the read phase has drained them.
        let protected_hashes = Arc::new(Mutex::new(HashSet::new()));
        let mem_store =
            iroh_blobs::store::mem::MemStore::new_with_opts(iroh_blobs::store::mem::Options {
                gc_config: Some(make_gc_config(protected_hashes.clone())),
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
            protected_hashes,
            blob_server_running: RefCell::new(false),
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

        let protected_hashes = Arc::new(Mutex::new(HashSet::new()));
        let mem_store =
            iroh_blobs::store::mem::MemStore::new_with_opts(iroh_blobs::store::mem::Options {
                gc_config: Some(make_gc_config(protected_hashes.clone())),
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
            protected_hashes,
            blob_server_running: RefCell::new(false),
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

    /// start a background accept loop that handles incoming iroh-blobs connections.
    ///
    /// call this once after creating the node to allow remote peers to pull blobs
    /// from this node (e.g., for P2P music upload where the server pulls from browser).
    ///
    /// only handles iroh-blobs connections — other ALPNs are ignored (dropped).
    /// safe to call multiple times (subsequent calls are no-ops).
    ///
    /// WARNING: if you also call `accept()` from JS, both loops will compete for
    /// incoming connections and each will only see a subset. use one or the other,
    /// not both. freqhole uses `start_blob_server()`, skein uses `accept()`.
    ///
    /// NOTE: no application-level peer auth is applied here. iroh-blobs transfers
    /// are content-addressed (blake3 verified), so a peer can only download blobs
    /// they already know the hash of. peer filtering can be added later if needed.
    pub fn start_blob_server(&self) {
        let mut running = self.blob_server_running.borrow_mut();
        if *running {
            info!("blob server already running, skipping");
            return;
        }
        *running = true;

        let endpoint = self.endpoint.clone();
        let blobs = self.blobs_protocol.clone();

        info!("starting blob server accept loop");

        wasm_bindgen_futures::spawn_local(async move {
            loop {
                let incoming = match endpoint.accept().await {
                    Some(incoming) => incoming,
                    None => {
                        info!("blob server: endpoint closed, stopping accept loop");
                        break;
                    }
                };

                let conn = match incoming.await {
                    Ok(c) => c,
                    Err(e) => {
                        warn!("blob server: failed to accept connection: {}", e);
                        continue;
                    }
                };

                let alpn_bytes = conn.alpn().to_vec();

                if alpn_bytes == iroh_blobs::ALPN {
                    let peer_id = conn.remote_id().to_string();
                    info!(
                        "blob server: accepting iroh-blobs connection from {}",
                        &peer_id[..std::cmp::min(16, peer_id.len())]
                    );
                    let blobs = blobs.clone();
                    wasm_bindgen_futures::spawn_local(async move {
                        if let Err(e) = blobs.accept(conn).await {
                            warn!("blob server: iroh-blobs handler error: {}", e);
                        }
                    });
                } else {
                    let alpn = String::from_utf8_lossy(&alpn_bytes);
                    debug!("blob server: ignoring connection on ALPN: {}", alpn);
                    // drop the connection - not for us
                }
            }
        });
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

        // read response (no length prefix, read to end). cap is generous
        // because proxy_request is the fallback path for blob data (audio/
        // image) when verified iroh-blobs streaming fails. base64 inflation
        // means a 96MB cap covers ~70MB of raw audio, which fits typical
        // album-length mp3s. for anything larger the verified path must work.
        let response_bytes: Vec<u8> = recv
            .read_to_end(128 * 1024 * 1024)
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

    /// dispatch a typed admin command to a peer over the freqhole-admin/1 ALPN.
    ///
    /// `args` is a JSON string (the literal `"null"` is accepted for no-payload
    /// commands). returns a JS object envelope `{ success, message, data, errors }`
    /// matching the wire format. validation of `data` against the per-command
    /// schema happens in the spume `AdminClient`.
    pub async fn proxy_admin(
        &self,
        peer_addr: &str,
        command: &str,
        args: &str,
    ) -> Result<JsValue, JsError> {
        info!(
            "[admin-p2p] proxy_admin start: peer={} command={}",
            peer_addr, command
        );
        let addr = parse_peer_addr(peer_addr).map_err(|e| JsError::new(&e))?;

        let parsed_args: serde_json::Value = serde_json::from_str(args)
            .map_err(|e| JsError::new(&format!("invalid args json: {e}")))?;

        // open admin alpn connection
        let conn = self
            .endpoint
            .connect(addr.clone(), ADMIN_ALPN)
            .await
            .map_err(to_js_err)?;
        info!("[admin-p2p] proxy_admin connected to {}", addr.id);

        let (mut send, mut recv): (SendStream, RecvStream) =
            conn.open_bi().await.map_err(to_js_err)?;

        let request = AdminMessage::Request {
            id: 1,
            command: command.to_string(),
            args: parsed_args,
        };
        let bytes = serde_json::to_vec(&request).map_err(to_js_err)?;
        info!("[admin-p2p] proxy_admin sending {} bytes", bytes.len());
        send.write_all(&bytes).await.map_err(to_js_err)?;
        send.finish().map_err(to_js_err)?;

        // read response (no length prefix). 16 MiB cap for large list responses.
        let response_bytes: Vec<u8> = recv
            .read_to_end(16 * 1024 * 1024)
            .await
            .map_err(to_js_err)?;
        info!(
            "[admin-p2p] proxy_admin read {} bytes",
            response_bytes.len()
        );
        let response: AdminMessage = serde_json::from_slice(&response_bytes).map_err(to_js_err)?;

        match response {
            AdminMessage::Response {
                success,
                data,
                message,
                errors,
                ..
            } => {
                let data_kind = match &data {
                    Some(serde_json::Value::Array(a)) => format!("array[{}]", a.len()),
                    Some(serde_json::Value::Null) | None => "none".to_string(),
                    Some(_) => "object".to_string(),
                };
                info!(
                    "[admin-p2p] proxy_admin got response: success={} data={} message={}",
                    success, data_kind, message
                );
                let envelope = serde_json::json!({
                    "success": success,
                    "message": message,
                    "data": data,
                    "errors": errors,
                });
                // serialize_maps_as_objects: otherwise `Value::Object` becomes a JS `Map`
                // which has no `.success` property, and the spume side rejects the shape.
                let serializer =
                    serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true);
                Ok(envelope.serialize(&serializer)?)
            }
            _ => Err(JsError::new("unexpected admin response type")),
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

    /// download a verified blob and stream chunks to JS via callback
    ///
    /// this is the preferred path for large blobs (audio files). instead of
    /// materializing the full blob in wasm linear memory (which fails around
    /// 32MB+ due to allocator pressure on a single contiguous Bytes), this:
    ///
    /// 1. downloads the blob into MemStore using the verified iroh-blobs path
    /// 2. opens a streaming reader and pulls chunks
    /// 3. delivers each chunk to the JS callback as a Uint8Array
    ///
    /// JS side accumulates chunks (e.g. into a Blob via array of BlobParts) and
    /// can release each chunk as it goes. wasm peak memory stays bounded by
    /// chunk_size + the original MemStore copy.
    ///
    /// callback signature: `on_chunk(chunk: Uint8Array, offset: u64) -> void`
    /// progress callback: `on_progress(fraction: f64) -> void`
    ///
    /// returns total bytes streamed.
    pub async fn download_verified_streaming(
        &self,
        peer_addr: &str,
        blake3_hash: &str,
        total_size: f64,
        on_chunk: &JsFunction,
        on_progress: &JsFunction,
    ) -> Result<f64, JsError> {
        use iroh_blobs::api::downloader::DownloadProgressItem;
        use n0_future::StreamExt;
        use tokio::io::AsyncReadExt;

        let addr = parse_peer_addr(peer_addr).map_err(|e| JsError::new(&e))?;
        let hash: Hash = blake3_hash
            .parse()
            .map_err(|e| JsError::new(&format!("invalid blake3 hash: {}", e)))?;

        let short = &blake3_hash[..16.min(blake3_hash.len())];
        debug!(
            "download_verified_streaming: START hash={} total_size={} peer={}",
            short,
            total_size,
            &addr.id.to_string()[..16]
        );

        // protect this hash from GC for the entire download+read lifecycle.
        // without this, periodic GC can wipe the entry between download-stream-end
        // and reader.read, leaving an empty bitfield and a hung await_completion.
        // _guard removes the hash on drop (success, error, or panic).
        let _guard = ProtectGuard::new(self.protected_hashes.clone(), hash);

        // step 1: download into MemStore (verified)
        let hash_and_format = HashAndFormat::raw(hash);
        let progress = self.blobs_downloader.download(hash_and_format, [addr.id]);
        let mut stream = progress
            .stream()
            .await
            .map_err(|e| JsError::new(&format!("download stream failed: {}", e)))?;

        let mut had_error = false;
        let mut last_error: Option<String> = None;
        let mut last_dl_bytes: u64 = 0;

        let mut event_count: u64 = 0;
        let mut last_log_bytes: u64 = 0;
        while let Some(event) = stream.next().await {
            event_count += 1;
            match &event {
                DownloadProgressItem::Progress(bytes) => {
                    last_dl_bytes = *bytes;
                    // log every ~2 MB of progress so we can see if the stream stalls
                    if *bytes >= last_log_bytes + 2 * 1024 * 1024 || *bytes < last_log_bytes {
                        debug!(
                            "download_verified_streaming: progress for {} -> {} bytes (event #{})",
                            short, bytes, event_count
                        );
                        last_log_bytes = *bytes;
                    }
                    if total_size > 0.0 {
                        // first half of progress bar = download, second half = read
                        let fraction = (*bytes as f64 / total_size * 0.5).min(0.5);
                        let _ = on_progress.call1(&JsValue::NULL, &JsValue::from_f64(fraction));
                    }
                }
                DownloadProgressItem::Error(e) => {
                    had_error = true;
                    last_error = Some(format!("{:?}", e));
                    warn!(
                        "download_verified_streaming: download error for {} after {} bytes (event #{}): {:?}",
                        short, last_dl_bytes, event_count, e
                    );
                }
                DownloadProgressItem::DownloadError => {
                    had_error = true;
                    last_error = Some("download error".to_string());
                    warn!(
                        "download_verified_streaming: DownloadError for {} after {} bytes (event #{})",
                        short, last_dl_bytes, event_count
                    );
                }
                other => {
                    debug!(
                        "download_verified_streaming: event #{} for {} (dl={} bytes): {:?}",
                        event_count, short, last_dl_bytes, other
                    );
                }
            }
        }
        debug!(
            "download_verified_streaming: download stream ended for {} after {} events ({} bytes, had_error={})",
            short, event_count, last_dl_bytes, had_error
        );

        if had_error {
            return Err(JsError::new(&format!(
                "download failed: {}",
                last_error.unwrap_or_else(|| "unknown error".to_string())
            )));
        }

        debug!(
            "download_verified_streaming: download phase complete for {} (downloaded={} bytes), observing bitfield",
            short, last_dl_bytes
        );

        // step 1.5: observe bitfield to confirm blob is actually complete in the store.
        // download stream may signal complete before the chunk processor flushes the
        // final entries into MemStore, leaving the entry incomplete when we try to read.
        match self.blobs_store.observe(hash).await {
            Ok(bitfield) => {
                debug!(
                    "download_verified_streaming: bitfield for {}: size={} complete={} ranges={:?}",
                    short,
                    bitfield.size(),
                    bitfield.is_complete(),
                    bitfield.ranges
                );
                if !bitfield.is_complete() {
                    warn!(
                        "download_verified_streaming: bitfield NOT complete for {}, awaiting completion",
                        short
                    );
                    match self.blobs_store.observe(hash).await_completion().await {
                        Ok(bf) => debug!(
                            "download_verified_streaming: bitfield COMPLETED for {} size={}",
                            short,
                            bf.size()
                        ),
                        Err(e) => {
                            warn!(
                                "download_verified_streaming: await_completion FAILED for {}: {:?}",
                                short, e
                            );
                            return Err(JsError::new(&format!(
                                "bitfield never completed for {}: {:?}",
                                short, e
                            )));
                        }
                    }
                }
            }
            Err(e) => {
                warn!(
                    "download_verified_streaming: observe FAILED for {}: {:?}",
                    short, e
                );
            }
        }

        debug!("download_verified_streaming: opening reader for {}", short);

        // step 2: open streaming reader and pull chunks to JS
        const CHUNK_SIZE: usize = 256 * 1024; // 256 KB chunks
        let mut reader = self.blobs_store.reader(hash);
        let mut buf = vec![0u8; CHUNK_SIZE];
        let mut total_read: u64 = 0;
        let mut chunks_sent: u64 = 0;

        loop {
            let n = match reader.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) => {
                    // io::Error from BlobReader wraps the inner api::Error as a string
                    // via io::Error::other(format!(...)). Display loses the inner io::Error
                    // message, so log Debug too in case it surfaces more detail.
                    let disp = format!("{}", e);
                    let dbg = format!("{:?}", e);
                    let kind = format!("{:?}", e.kind());
                    let inner = e
                        .get_ref()
                        .map(|i| format!("{:?}", i))
                        .unwrap_or_else(|| "<no inner>".to_string());
                    let mut chain = disp.clone();
                    let mut src: Option<&dyn std::error::Error> = std::error::Error::source(&e);
                    while let Some(s) = src {
                        chain.push_str(&format!(" -> {}", s));
                        src = s.source();
                    }
                    warn!(
                        "download_verified_streaming: reader.read FAILED for {} after {} bytes ({} chunks)\n  display: {}\n  debug: {}\n  kind: {}\n  inner: {}\n  chain: {}",
                        short, total_read, chunks_sent, disp, dbg, kind, inner, chain
                    );
                    return Err(JsError::new(&format!(
                        "blob reader failed at offset {} kind={} display={} inner={}",
                        total_read, kind, disp, inner
                    )));
                }
            };

            // copy chunk to JS Uint8Array and invoke callback
            let chunk = Uint8Array::new_with_length(n as u32);
            chunk.copy_from(&buf[..n]);
            let offset_val = JsValue::from_f64(total_read as f64);
            on_chunk
                .call2(&JsValue::NULL, &chunk, &offset_val)
                .map_err(|e| JsError::new(&format!("on_chunk callback failed: {:?}", e)))?;

            total_read += n as u64;
            chunks_sent += 1;

            if total_size > 0.0 {
                let fraction = (0.5 + (total_read as f64 / total_size) * 0.5).min(1.0);
                let _ = on_progress.call1(&JsValue::NULL, &JsValue::from_f64(fraction));
            }
        }

        debug!(
            "download_verified_streaming: COMPLETE for {} ({} bytes in {} chunks)",
            short, total_read, chunks_sent
        );

        Ok(total_read as f64)
    }

    /// streaming download with auto ensure+retry. first attempts the streaming
    /// download; if the verified download fails (blob not in peer's store), calls
    /// ensure_blob to load it, then retries.
    pub async fn download_verified_streaming_with_ensure(
        &self,
        peer_addr: &str,
        blake3_hash: &str,
        total_size: f64,
        on_chunk: &JsFunction,
        on_progress: &JsFunction,
    ) -> Result<f64, JsError> {
        match self
            .download_verified_streaming(peer_addr, blake3_hash, total_size, on_chunk, on_progress)
            .await
        {
            Ok(n) => return Ok(n),
            Err(e) => {
                // first attempt failed (often: blob not yet in peer's store).
                // log the cause then retry via ensure_blob so that genuine
                // failures (bad hash, transport error) aren't silently masked.
                warn!(
                    "download_verified_streaming_with_ensure: first attempt failed for {}, calling ensure_blob: {:?}",
                    &blake3_hash[..16.min(blake3_hash.len())],
                    e
                );
            }
        }

        let available = self.ensure_blob(peer_addr, blake3_hash).await?;
        if !available {
            return Err(JsError::new(&format!(
                "blob {} not available on peer",
                &blake3_hash[..16.min(blake3_hash.len())]
            )));
        }

        self.download_verified_streaming(peer_addr, blake3_hash, total_size, on_chunk, on_progress)
            .await
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
            Err(e) => {
                warn!(
                    "download_verified_with_ensure: first attempt failed for {}, calling ensure_blob: {:?}",
                    &blake3_hash[..16.min(blake3_hash.len())],
                    e
                );
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
