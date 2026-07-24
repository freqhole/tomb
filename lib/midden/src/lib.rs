//! midden: browser WASM client for freqhole P2P federation
//!
//! uses iroh to connect to freqhole peers from the browser.
//! accepts either plain node_id or full endpoint address JSON with relay/IP hints.
//!
//! supports two protocols:
//! - freqhole/1: custom protocol for API requests and small blob streaming
//! - freqhole-blobz: iroh-blobs protocol for verified streaming of audio files

use bao_tree::ChunkRanges;
use indexmap::IndexMap;
// the opfs store backs the wasm build; on native it is only exercised by
// the unit tests (via the in-memory storage shim)
#[cfg(any(target_arch = "wasm32", test))]
mod opfs_store;
use iroh::endpoint::presets;
use iroh::endpoint::{Connection, RecvStream, SendStream};
use iroh::protocol::ProtocolHandler;
use iroh::{Endpoint, EndpointAddr, PublicKey, SecretKey};
use iroh_blobs::api::downloader::Downloader;
use iroh_blobs::api::Store;
use iroh_blobs::api::TempTag;
use iroh_blobs::provider::events::{
    AbortReason, ConnectMode, EventMask, EventSender, ProviderMessage, RequestMode,
};
use iroh_blobs::store::{GcConfig, ProtectCb, ProtectOutcome};
use iroh_blobs::{BlobsProtocol, Hash, HashAndFormat};
use js_sys::{Function as JsFunction, Uint8Array};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::{Arc, Mutex};
use tracing::level_filters::LevelFilter;
use tracing::{debug, info, warn};
use tracing_subscriber_wasm::MakeConsoleWriter;
use wasm_bindgen::{prelude::wasm_bindgen, JsError, JsValue};

mod radio;

/// ALPN protocol identifier (must match grimoire's FREQHOLE_ALPN)
const FREQHOLE_ALPN: &[u8] = b"freqhole/1";

/// ALPN for automerge-repo document sync (used by skein canvas P2P)
const AUTOMERGE_ALPN: &[u8] = b"iroh/automerge-repo/1";

/// ALPN for friend requests, profile sharing, and presence heartbeat (used by skein social layer)
const FRIENDZ_ALPN: &[u8] = b"freqhole-friendz/1";

/// ALPN for admin command dispatch (must match grimoire's ADMIN_ALPN)
const ADMIN_ALPN: &[u8] = b"freqhole-admin/1";

/// ALPN for job-event subscriptions (must match grimoire's EVENTS_ALPN)
const EVENTS_ALPN: &[u8] = b"freqhole-events/1";

/// default wall-clock ceiling for a single dial in `open_bi`. iroh otherwise
/// retries discovery internally for ~2 minutes when a peer isn't reachable yet;
/// a bounded failure lets callers retry (or surface an error) promptly. can be
/// overridden per node via the optional `connect_timeout_ms` constructor arg.
const DEFAULT_CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// resolve an optional caller-supplied connect timeout (in ms) to a Duration,
/// falling back to DEFAULT_CONNECT_TIMEOUT when omitted or zero.
fn resolve_connect_timeout(connect_timeout_ms: Option<u32>) -> std::time::Duration {
    match connect_timeout_ms {
        Some(ms) if ms > 0 => std::time::Duration::from_millis(ms as u64),
        _ => DEFAULT_CONNECT_TIMEOUT,
    }
}

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
    ApiRequest {
        id: u64,
        method: String,
        path: String,
        body: Option<String>,
    },
    ApiResponse {
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

/// response from api_request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiResponse {
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
///
/// also holds the parent `Connection` handle, purely to keep the QUIC
/// connection alive for as long as this stream is alive: iroh/quinn tears
/// a connection down once its last `Connection` handle is dropped, and
/// neither `accept()` nor `open_bi()` keep any other handle around after
/// handing a `BiStream` to JS. without this field, the connection was
/// dropped (and the peer's in-flight read failed with "connection lost")
/// the moment `accept()`/`open_bi()` returned - often before a response
/// written moments later on the same stream even finished flushing.
#[wasm_bindgen]
pub struct BiStream {
    send: RefCell<Option<SendStream>>,
    recv: RefCell<Option<RecvStream>>,
    peer_node_id: String,
    alpn: String,
    // never read directly - held purely so the connection stays alive for
    // as long as this stream does. see the struct doc comment above.
    _connection: Connection,
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
    ///
    /// after `finish()` we await `stopped()` so the peer's ack is observed
    /// before this method returns. without this, JS callers that drop /
    /// `close()` the stream immediately after `write_raw_and_finish` can
    /// race the QUIC flush -- the peer's `read_to_end` then errors with
    /// "connection lost" mid-payload because the in-flight frames are
    /// torn down with the connection. matters most for large payloads
    /// (e.g. base64-encoded blob bodies in `api_response`).
    pub async fn write_raw_and_finish(&self, data: &[u8]) -> Result<(), JsError> {
        let mut send = self
            .send
            .borrow_mut()
            .take()
            .ok_or_else(|| JsError::new("send stream busy or closed"))?;

        let result = async {
            send.write_all(data).await.map_err(to_js_err)?;
            send.finish().map_err(to_js_err)?;
            // wait for the peer to ack / reset; ignore result, this is a
            // best-effort flush barrier, not a correctness check.
            let _ = send.stopped().await;
            Ok::<(), JsError>(())
        }
        .await;

        // put stream back even on error
        *self.send.borrow_mut() = Some(send);

        result
    }

    /// write a newline-delimited utf-8 line.
    ///
    /// appends `\n` if not already present, then writes. used for the ndjson
    /// framing the `freqhole-events/1` protocol speaks.
    pub async fn write_line(&self, line: &str) -> Result<(), JsError> {
        let mut send = self
            .send
            .borrow_mut()
            .take()
            .ok_or_else(|| JsError::new("send stream busy or closed"))?;

        let mut bytes = line.as_bytes().to_vec();
        if !bytes.ends_with(b"\n") {
            bytes.push(b'\n');
        }

        let result = send.write_all(&bytes).await.map_err(to_js_err);

        *self.send.borrow_mut() = Some(send);
        result
    }

    /// read a newline-terminated utf-8 line.
    ///
    /// returns the line WITHOUT the trailing `\n`. returns null on clean
    /// stream close (EOF before any bytes). used for ndjson framing.
    pub async fn read_line(&self) -> Result<JsValue, JsError> {
        let mut recv = self
            .recv
            .borrow_mut()
            .take()
            .ok_or_else(|| JsError::new("recv stream busy or closed"))?;

        // hand-rolled read-until-newline so we don't drag in a BufReader
        let mut buf: Vec<u8> = Vec::with_capacity(256);
        let mut byte = [0u8; 1];
        let result: Result<Option<String>, JsError> = loop {
            match recv.read_exact(&mut byte).await {
                Ok(()) => {
                    if byte[0] == b'\n' {
                        break Ok(Some(String::from_utf8_lossy(&buf).into_owned()));
                    }
                    buf.push(byte[0]);
                }
                Err(e) => {
                    let err_str = e.to_string();
                    let clean_eof = err_str.contains("finished")
                        || err_str.contains("closed")
                        || err_str.contains("eof");
                    if clean_eof {
                        // partial line at EOF: surface it if non-empty, otherwise null
                        if buf.is_empty() {
                            break Ok(None);
                        } else {
                            break Ok(Some(String::from_utf8_lossy(&buf).into_owned()));
                        }
                    }
                    break Err(to_js_err(e));
                }
            }
        };

        *self.recv.borrow_mut() = Some(recv);

        match result {
            Ok(Some(line)) => Ok(JsValue::from_str(&line)),
            Ok(None) => Ok(JsValue::NULL),
            Err(e) => Err(e),
        }
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

/// opfs store selftest — runs the full import/export round trip against
/// real OPFS through the real iroh-blobs api. worker context required
/// (sync access handles). wasm-only debug helper, used for manual
/// debugging from the blob worker, not from automated tests.
#[cfg(target_family = "wasm")]
#[wasm_bindgen]
pub async fn opfs_store_selftest() -> Result<String, JsError> {
    opfs_store::selftest().await.map_err(|e| JsError::new(&e))
}

/// persistence selftest: blobs + tags survive a store shutdown/reopen over
/// the same OPFS directory. worker context required. wasm-only debug
/// helper, used for manual debugging from the blob worker.
#[cfg(target_family = "wasm")]
#[wasm_bindgen]
pub async fn opfs_store_selftest_persistence() -> Result<String, JsError> {
    opfs_store::selftest_persistence()
        .await
        .map_err(|e| JsError::new(&e))
}

/// incremental blake3 hasher for streaming uploads — feed fixed-size chunks
/// via update() and read the final hex hash from finalize(). lets JS hash a
/// File while streaming it (file.stream() reader loop) instead of holding
/// the whole payload in memory for a one-shot hash_blake3().
#[wasm_bindgen]
pub struct Blake3Hasher {
    inner: blake3::Hasher,
}

#[wasm_bindgen]
impl Blake3Hasher {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Blake3Hasher {
        Blake3Hasher {
            inner: blake3::Hasher::new(),
        }
    }

    /// absorb the next chunk of data.
    pub fn update(&mut self, chunk: &[u8]) {
        self.inner.update(chunk);
    }

    /// finish and return the hash as a 64-char hex string. the hasher can
    /// keep absorbing after this (blake3 finalize is non-destructive), but
    /// callers should treat the session as done.
    pub fn finalize(&self) -> String {
        self.inner.finalize().to_hex().to_string()
    }
}

impl Default for Blake3Hasher {
    fn default() -> Self {
        Self::new()
    }
}

/// adapter: tokio mpsc receiver -> Stream, for feeding add_stream.
/// (tokio_stream::wrappers::ReceiverStream without the extra dependency.)
struct ReceiverStream<T>(tokio::sync::mpsc::Receiver<T>);

impl<T> n0_future::Stream for ReceiverStream<T> {
    type Item = T;
    fn poll_next(
        self: std::pin::Pin<&mut Self>,
        cx: &mut std::task::Context<'_>,
    ) -> std::task::Poll<Option<T>> {
        self.get_mut().0.poll_recv(cx)
    }
}

/// chunked import session — the streaming counterpart to import_blob.
///
/// created via MiddenNode::start_import(). JS feeds fixed-size chunks with
/// push() (backpressured: the promise resolves only once the chunk is
/// queued), then finish() completes the import and returns the blake3 hash.
/// the wasm boundary never sees the whole payload at once; the store's
/// ImportByteStream machinery computes the bao tree incrementally.
///
/// the finished blob is pinned in the node's active_tags (same as
/// import_blob) until release_blob() is called.
#[wasm_bindgen]
pub struct ImportSession {
    sender: RefCell<Option<tokio::sync::mpsc::Sender<std::io::Result<bytes::Bytes>>>>,
    result_rx: RefCell<Option<tokio::sync::oneshot::Receiver<Result<TempTag, String>>>>,
    active_tags: Arc<Mutex<IndexMap<Hash, TempTag>>>,
}

#[wasm_bindgen]
impl ImportSession {
    /// queue the next chunk. resolves once the chunk has been accepted by
    /// the import stream (bounded channel — this is the backpressure point).
    pub async fn push(&self, chunk: &[u8]) -> Result<(), JsError> {
        // clone the sender out of the RefCell so no borrow is held across await
        let sender = self
            .sender
            .borrow()
            .clone()
            .ok_or_else(|| JsError::new("import session already finished or aborted"))?;
        sender
            .send(Ok(bytes::Bytes::copy_from_slice(chunk)))
            .await
            .map_err(|_| JsError::new("import task ended unexpectedly"))?;
        Ok(())
    }

    /// signal end-of-stream, wait for the import to complete, pin the
    /// resulting blob, and return its blake3 hash as a hex string.
    pub async fn finish(&self) -> Result<String, JsError> {
        // drop the sender — end-of-stream for the import task
        self.sender.borrow_mut().take();
        let rx = self
            .result_rx
            .borrow_mut()
            .take()
            .ok_or_else(|| JsError::new("finish already called or session aborted"))?;
        let tt = rx
            .await
            .map_err(|_| JsError::new("import task dropped before completing"))?
            .map_err(|e| JsError::new(&e))?;
        let hash = tt.hash();
        if let Ok(mut tags) = self.active_tags.lock() {
            tags.insert(hash, tt);
        }
        Ok(hash.to_hex().to_string())
    }

    /// abort the import. any partially-imported data is left to GC.
    pub fn abort(&self) {
        if let Some(tx) = self.sender.borrow_mut().take() {
            // best-effort: fail the import stream fast instead of letting it
            // complete as a truncated-but-valid blob
            let _ = tx.try_send(Err(std::io::Error::other("import aborted")));
        }
        self.result_rx.borrow_mut().take();
    }
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

/// per-hash allow-list for blob gets: maps a blob's blake3 hash to the set of
/// peer node ids (hex strings) allowed to fetch it. a hash with no entry in
/// this map is unrestricted (served to anyone) — this keeps default behavior
/// unchanged unless a hash is explicitly restricted.
///
/// PROTOTYPE NOTE: this is a stopgap, hardcoded allow-list plumbed in from
/// JS via `MiddenNode::restrict_blob_to_peers`. it is NOT the real canvas-ACL
/// integration.
type BlobAcl = Rc<RefCell<HashMap<Hash, HashSet<String>>>>;

/// true if `peer` (already resolved to a hex node id string, or `None` if we
/// couldn't identify the requester) may fetch `hash` under `acl`.
fn blob_request_allowed(acl: &BlobAcl, hash: &Hash, peer: Option<&str>) -> bool {
    match acl.borrow().get(hash) {
        // no ACL entry for this hash at all: unrestricted (matches the
        // permissive default — see BlobAcl's doc comment above).
        None => true,
        Some(allowed) => match peer {
            Some(peer) => allowed.contains(peer),
            // request came in on a connection whose endpoint id we never
            // resolved (shouldn't happen in practice, since iroh
            // authenticates the remote endpoint id at the QUIC/TLS layer
            // before any application data flows) — fail closed.
            None => false,
        },
    }
}

/// build an `EventSender` that intercepts `iroh_blobs`' connect/get/get_many
/// events and gates them against `acl`.
///
/// this is the extension point `iroh_blobs::BlobsProtocol::new(&store, events)`
/// exposes for exactly this purpose (see `examples/limit.rs` in the
/// `iroh-blobs` crate for the upstream reference implementation this
/// mirrors). a connection is never rejected outright here — we only learn
/// which hash is being requested once a get/get_many request comes in, so
/// gating happens per-request, keyed by the requester's endpoint id
/// (recorded from the `ClientConnected` event and looked up by connection id).
fn build_gated_blobs_events(acl: BlobAcl) -> EventSender {
    let mask = EventMask {
        connected: ConnectMode::Intercept,
        get: RequestMode::Intercept,
        get_many: RequestMode::Intercept,
        ..EventMask::DEFAULT
    };
    let (tx, mut rx) = EventSender::channel(32, mask);
    let connections: Rc<RefCell<HashMap<u64, String>>> = Rc::new(RefCell::new(HashMap::new()));

    wasm_bindgen_futures::spawn_local(async move {
        while let Some(msg) = rx.recv().await {
            match msg {
                ProviderMessage::ClientConnected(msg) => {
                    if let Some(endpoint_id) = msg.endpoint_id {
                        connections
                            .borrow_mut()
                            .insert(msg.connection_id, endpoint_id.to_string());
                    }
                    // always accept the connection itself — gating happens
                    // per-request below, once we know which hash is asked for.
                    msg.tx.send(Ok(())).await.ok();
                }
                ProviderMessage::ConnectionClosed(msg) => {
                    connections.borrow_mut().remove(&msg.connection_id);
                }
                ProviderMessage::GetRequestReceived(msg) => {
                    let peer = connections.borrow().get(&msg.connection_id).cloned();
                    let hash = msg.request.hash;
                    let allowed = blob_request_allowed(&acl, &hash, peer.as_deref());
                    if !allowed {
                        warn!(
                            "blob-acl: denied get request for {} from peer {:?}",
                            hash, peer
                        );
                    }
                    let res = if allowed {
                        Ok(())
                    } else {
                        Err(AbortReason::Permission)
                    };
                    msg.tx.send(res).await.ok();
                }
                ProviderMessage::GetManyRequestReceived(msg) => {
                    let peer = connections.borrow().get(&msg.connection_id).cloned();
                    let allowed = msg
                        .request
                        .hashes
                        .iter()
                        .all(|hash| blob_request_allowed(&acl, hash, peer.as_deref()));
                    if !allowed {
                        warn!("blob-acl: denied get_many request from peer {:?}", peer);
                    }
                    let res = if allowed {
                        Ok(())
                    } else {
                        Err(AbortReason::Permission)
                    };
                    msg.tx.send(res).await.ok();
                }
                _ => {}
            }
        }
    });

    tx
}

/// browser P2P node for freqhole federation
///
/// supports two protocols:
/// - freqhole/1: API requests and small blob streaming
/// - iroh-blobs: verified streaming for audio files
#[wasm_bindgen]
pub struct MiddenNode {
    endpoint: Endpoint,
    secret_key_bytes: [u8; 32],
    // iroh-blobs components
    blobs_store: Store,
    blobs_downloader: Downloader,
    blobs_protocol: BlobsProtocol,
    /// active TempTags keyed by blob hash — prevents GC of imported blobs
    /// until release_blob() drops the tag. Arc<Mutex> so ImportSession and
    /// the gc protect callback (Send + Sync required) can share it. no
    /// eviction cap: gc protection (protected_hashes + active_tags via the
    /// protect callback) covers in-flight downloads, and imported blobs
    /// stay pinned until release_blob() is called.
    #[wasm_bindgen(skip)]
    pub active_tags: Arc<Mutex<IndexMap<Hash, TempTag>>>,
    /// hashes currently being downloaded/streamed; protected from GC sweeps.
    /// downloader does not auto-create TempTags, so without this an in-flight
    /// download can be wiped by the periodic GC between download-stream-end
    /// and reader.read, leaving an empty bitfield and a hung await_completion.
    protected_hashes: Arc<Mutex<HashSet<Hash>>>,
    /// per-hash blob-get allow-list, see `BlobAcl`'s doc comment. PROTOTYPE:
    /// a stopgap gate, not the real canvas-ACL integration.
    #[wasm_bindgen(skip)]
    pub blob_acl: BlobAcl,
    /// guards against starting the blob server accept loop more than once
    blob_server_running: RefCell<bool>,
    /// wall-clock ceiling for a single dial in `open_bi` (see DEFAULT_CONNECT_TIMEOUT).
    connect_timeout: std::time::Duration,
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

/// protect callback covering BOTH protection sources: `protected_hashes`
/// (in-flight downloads, RAII-guarded) and `active_tags` (imported blobs
/// pinned until release_blob). needed for the opfs store, whose GLOBAL-scope
/// temp tags are untracked (iroh-blobs' TagDrop is crate-private) — without
/// this, gc would sweep pinned imports.
#[cfg(target_family = "wasm")]
fn make_protect_cb(
    protected_hashes: Arc<Mutex<HashSet<Hash>>>,
    active_tags: Arc<Mutex<IndexMap<Hash, TempTag>>>,
) -> opfs_store::ProtectCb {
    Arc::new(move |live: &mut HashSet<Hash>| {
        if let Ok(set) = protected_hashes.lock() {
            live.extend(set.iter().copied());
        }
        if let Ok(tags) = active_tags.lock() {
            live.extend(tags.keys().copied());
        }
        Box::pin(async move { opfs_store::ProtectOutcome::Continue })
    })
}

/// build the node's blob store: persistent OPFS-backed when a directory is
/// given and OPFS is available (worker context), otherwise in-memory. both
/// get gc with the combined protect callback (in-flight downloads + pinned
/// imports).
async fn build_blobs_store(
    opfs_store_dir: Option<String>,
    protected_hashes: Arc<Mutex<HashSet<Hash>>>,
    active_tags: Arc<Mutex<IndexMap<Hash, TempTag>>>,
) -> Store {
    #[cfg(target_family = "wasm")]
    if let Some(dir) = &opfs_store_dir {
        match opfs_store::OpfsStore::new(
            dir,
            Some(opfs_store::GcOptions {
                interval: std::time::Duration::from_secs(30),
                add_protected: Some(make_protect_cb(
                    protected_hashes.clone(),
                    active_tags.clone(),
                )),
            }),
        )
        .await
        {
            Ok(store) => {
                info!("using persistent opfs blob store: {dir}");
                return store.clone_store();
            }
            Err(e) => {
                warn!("opfs blob store unavailable ({e}), falling back to in-memory");
            }
        }
    }
    #[cfg(not(target_family = "wasm"))]
    let _ = &opfs_store_dir;

    // in-memory fallback: same protection sources via the mem gc config
    let _ = &active_tags; // mem store pins via TempTags natively; keep the combined cb anyway
    let mem_store =
        iroh_blobs::store::mem::MemStore::new_with_opts(iroh_blobs::store::mem::Options {
            gc_config: Some(make_gc_config(protected_hashes)),
        });
    mem_store.as_ref().clone()
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

/// cooperative cancellation for in-flight downloads (pause/cancel from JS).
/// the download loops select on `cancelled()` between progress events —
/// cancellation takes effect at the next event boundary, and the partial
/// data stays in the store, so a later download of the same hash resumes
/// from the persisted bitfield (only missing ranges transfer).
#[wasm_bindgen]
pub struct CancelToken {
    flag: Arc<std::sync::atomic::AtomicBool>,
    notify: Arc<tokio::sync::Notify>,
}

#[wasm_bindgen]
impl CancelToken {
    #[wasm_bindgen(constructor)]
    pub fn new() -> CancelToken {
        CancelToken {
            flag: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            notify: Arc::new(tokio::sync::Notify::new()),
        }
    }

    /// request cancellation. idempotent.
    pub fn cancel(&self) {
        self.flag.store(true, std::sync::atomic::Ordering::SeqCst);
        self.notify.notify_waiters();
    }

    pub fn is_cancelled(&self) -> bool {
        self.flag.load(std::sync::atomic::Ordering::SeqCst)
    }

    /// return a new CancelToken sharing the same cancellation state.
    /// needed because passing a wasm class by value consumes the JS handle —
    /// callers keep the original and pass a clone into download calls.
    pub fn clone_token(&self) -> CancelToken {
        CancelToken {
            flag: self.flag.clone(),
            notify: self.notify.clone(),
        }
    }
}

impl Default for CancelToken {
    fn default() -> Self {
        Self::new()
    }
}

impl CancelToken {
    /// resolves when cancel() is called (or immediately if already cancelled)
    async fn cancelled(&self) {
        while !self.is_cancelled() {
            self.notify.notified().await;
        }
    }
}

/// error message used for cancelled downloads — JS matches on this to
/// distinguish a deliberate pause from a genuine failure.
const DOWNLOAD_CANCELLED_MSG: &str = "download cancelled";

/// options bag for `MiddenNode::create_with_options`, the single canonical
/// constructor. build one, set whichever fields are needed, and pass it in:
///
/// ```js
/// const opts = new MiddenNodeOptions();
/// opts.opfs_store_dir = "midden-blob-store";
/// opts.connect_timeout_ms = 5000;
/// const node = await MiddenNode.create_with_options(opts);
/// ```
///
/// `create`/`create_from_key`/`create_with_alpns` remain as deprecated
/// wrappers over this constructor for existing callers (spume, playlistz).
#[wasm_bindgen]
#[derive(Default)]
pub struct MiddenNodeOptions {
    #[wasm_bindgen(skip)]
    pub secret_key: Option<Vec<u8>>,
    #[wasm_bindgen(skip)]
    pub extra_alpns: Option<Vec<String>>,
    #[wasm_bindgen(skip)]
    pub opfs_store_dir: Option<String>,
    #[wasm_bindgen(skip)]
    pub connect_timeout_ms: Option<u32>,
}

#[wasm_bindgen]
impl MiddenNodeOptions {
    #[wasm_bindgen(constructor)]
    pub fn new() -> MiddenNodeOptions {
        Self::default()
    }

    /// the node's secret key (32 raw bytes). omit (or pass null/undefined)
    /// to generate a random identity.
    #[wasm_bindgen(getter = secret_key)]
    pub fn get_secret_key(&self) -> Option<Uint8Array> {
        self.secret_key.as_deref().map(Uint8Array::from)
    }

    #[wasm_bindgen(setter = secret_key)]
    pub fn set_secret_key(&mut self, key: Option<Uint8Array>) {
        self.secret_key = key.map(|k| k.to_vec());
    }

    /// additional ALPN protocols to register beyond the default set.
    #[wasm_bindgen(getter = extra_alpns)]
    pub fn get_extra_alpns(&self) -> Option<Vec<String>> {
        self.extra_alpns.clone()
    }

    #[wasm_bindgen(setter = extra_alpns)]
    pub fn set_extra_alpns(&mut self, alpns: Option<Vec<String>>) {
        self.extra_alpns = alpns;
    }

    /// when given, blobs persist in an OPFS-backed store under this
    /// directory (worker context required); otherwise (or when OPFS is
    /// unavailable) an in-memory store is used.
    #[wasm_bindgen(getter = opfs_store_dir)]
    pub fn get_opfs_store_dir(&self) -> Option<String> {
        self.opfs_store_dir.clone()
    }

    #[wasm_bindgen(setter = opfs_store_dir)]
    pub fn set_opfs_store_dir(&mut self, dir: Option<String>) {
        self.opfs_store_dir = dir;
    }

    /// per-dial timeout (ms) for `open_bi`/`connect` (defaults to 10s).
    #[wasm_bindgen(getter = connect_timeout_ms)]
    pub fn get_connect_timeout_ms(&self) -> Option<u32> {
        self.connect_timeout_ms
    }

    #[wasm_bindgen(setter = connect_timeout_ms)]
    pub fn set_connect_timeout_ms(&mut self, ms: Option<u32>) {
        self.connect_timeout_ms = ms;
    }
}

#[wasm_bindgen]
impl MiddenNode {
    /// create a node from an options bag. this is the single canonical
    /// constructor — `create`/`create_from_key`/`create_with_alpns` below
    /// are deprecated wrappers kept for existing callers (spume, playlistz).
    pub async fn create_with_options(options: MiddenNodeOptions) -> Result<MiddenNode, JsError> {
        let bytes = match options.secret_key {
            Some(key) => {
                if key.len() != 32 {
                    return Err(JsError::new("secret key must be exactly 32 bytes"));
                }
                let mut b = [0u8; 32];
                b.copy_from_slice(&key);
                b
            }
            None => {
                let mut b = [0u8; 32];
                getrandom::getrandom(&mut b).map_err(|e| JsError::new(&e.to_string()))?;
                b
            }
        };

        Self::create_with_secret_key(
            bytes,
            options.extra_alpns.unwrap_or_default(),
            options.opfs_store_dir,
            options.connect_timeout_ms,
        )
        .await
    }

    /// create a new node with random identity, an in-memory blob store, and
    /// the default ALPN set. waits for relay connection before returning.
    ///
    /// deprecated: use `create_with_options` instead.
    ///
    /// `connect_timeout_ms` is an optional per-dial timeout for `open_bi`
    /// (defaults to 10s when omitted/undefined).
    pub async fn create(connect_timeout_ms: Option<u32>) -> Result<MiddenNode, JsError> {
        let mut options = MiddenNodeOptions::new();
        options.connect_timeout_ms = connect_timeout_ms;
        Self::create_with_options(options).await
    }

    /// create a node from existing secret key bytes (for persistence)
    /// key_bytes must be exactly 32 bytes.
    ///
    /// deprecated: use `create_with_options` instead.
    ///
    /// `connect_timeout_ms` is an optional per-dial timeout for `open_bi`
    /// (defaults to 10s when omitted/undefined).
    pub async fn create_from_key(
        key_bytes: &[u8],
        connect_timeout_ms: Option<u32>,
    ) -> Result<MiddenNode, JsError> {
        if key_bytes.len() != 32 {
            return Err(JsError::new("secret key must be exactly 32 bytes"));
        }

        let mut options = MiddenNodeOptions::new();
        options.secret_key = Some(key_bytes.to_vec());
        options.connect_timeout_ms = connect_timeout_ms;
        Self::create_with_options(options).await
    }

    /// create a node from existing secret key with additional ALPN protocols.
    ///
    /// deprecated: use `create_with_options` instead.
    ///
    /// `extra_alpns` is a JS array of strings (e.g. ["iroh/automerge-repo/1"]).
    /// the node always registers the default ALPN set plus whatever extra ALPNs are given.
    ///
    /// `connect_timeout_ms` is an optional per-dial timeout for `open_bi`
    /// (defaults to 10s when omitted/undefined).
    pub async fn create_with_alpns(
        key_bytes: &[u8],
        extra_alpns: &js_sys::Array,
        connect_timeout_ms: Option<u32>,
    ) -> Result<MiddenNode, JsError> {
        if key_bytes.len() != 32 {
            return Err(JsError::new("secret key must be exactly 32 bytes"));
        }

        // collect extra ALPNs from JS array
        let mut alpns = Vec::new();
        for i in 0..extra_alpns.length() {
            let alpn_str = extra_alpns
                .get(i)
                .as_string()
                .ok_or_else(|| JsError::new("each ALPN must be a string"))?;
            alpns.push(alpn_str);
        }

        let mut options = MiddenNodeOptions::new();
        options.secret_key = Some(key_bytes.to_vec());
        options.extra_alpns = Some(alpns);
        options.connect_timeout_ms = connect_timeout_ms;
        Self::create_with_options(options).await
    }

    /// internal: create node with given secret key bytes, extra ALPNs, an
    /// optional blob-store directory, and an optional connect timeout.
    async fn create_with_secret_key(
        bytes: [u8; 32],
        extra_alpns: Vec<String>,
        opfs_store_dir: Option<String>,
        connect_timeout_ms: Option<u32>,
    ) -> Result<MiddenNode, JsError> {
        let secret_key = SecretKey::from_bytes(&bytes);

        // default registered ALPN set stays the base set; skein-specific
        // ALPNs are never registered by default, only via extra_alpns.
        let mut alpns = vec![
            FREQHOLE_ALPN.to_vec(),
            AUTOMERGE_ALPN.to_vec(),
            FRIENDZ_ALPN.to_vec(),
            ADMIN_ALPN.to_vec(),
            EVENTS_ALPN.to_vec(),
            iroh_blobs::ALPN.to_vec(),
        ];
        for alpn in extra_alpns {
            alpns.push(alpn.into_bytes());
        }

        // use N0 preset for relay + DNS discovery (peers can find each other)
        let endpoint = Endpoint::builder(presets::N0)
            .secret_key(secret_key)
            .alpns(alpns)
            .bind()
            .await
            .map_err(to_js_err)?;

        // setup iroh-blobs store + gc. periodic gc keeps memory bounded; the
        // combined protect callback (protected_hashes + active_tags) keeps
        // in-flight downloads and pinned imports alive.
        let protected_hashes = Arc::new(Mutex::new(HashSet::new()));
        let active_tags: Arc<Mutex<IndexMap<Hash, TempTag>>> =
            Arc::new(Mutex::new(IndexMap::new()));
        let blobs_store = build_blobs_store(
            opfs_store_dir,
            protected_hashes.clone(),
            active_tags.clone(),
        )
        .await;
        let blobs_downloader = Downloader::new(&blobs_store, &endpoint);
        let blob_acl: BlobAcl = Rc::new(RefCell::new(HashMap::new()));
        let blobs_protocol = BlobsProtocol::new(
            &blobs_store,
            Some(build_gated_blobs_events(blob_acl.clone())),
        );

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
            active_tags,
            protected_hashes,
            blob_acl,
            blob_server_running: RefCell::new(false),
            connect_timeout: resolve_connect_timeout(connect_timeout_ms),
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

    /// get our full endpoint address as JSON (node_id + relay url + any direct addrs).
    ///
    /// after `online()` has resolved this includes the home relay url, which is
    /// enough for a remote peer to dial us directly via the relay without doing
    /// a pkarr/DNS discovery lookup first. pass the returned string straight to
    /// `open_bi`/`connect` on the other side - `parse_peer_addr` accepts this
    /// same JSON shape. avoids the discovery propagation race on fresh boots.
    pub fn node_addr(&self) -> Result<String, JsError> {
        serde_json::to_string(&self.endpoint.addr()).map_err(to_js_err)
    }

    /// PROTOTYPE: restrict a blob (by blake3 hex hash) so only the given
    /// peer node ids may fetch it over the `iroh-blobs/*` ALPN. a hash with
    /// no restriction registered is served to anyone (today's default
    /// behavior, unchanged) — calling this is what opts a specific hash
    /// into gating.
    ///
    /// this is a stopgap/demo hook, not the real canvas-ACL integration: it
    /// has to be called explicitly, from JS, with an already-resolved list
    /// of allowed peer node ids for this one hash.
    pub fn restrict_blob_to_peers(
        &self,
        blake3_hash: &str,
        peer_node_ids: &js_sys::Array,
    ) -> Result<(), JsError> {
        let hash: Hash = blake3_hash
            .parse()
            .map_err(|e| JsError::new(&format!("invalid blake3 hash: {}", e)))?;

        let mut allowed = HashSet::new();
        for i in 0..peer_node_ids.length() {
            let peer_id = peer_node_ids
                .get(i)
                .as_string()
                .ok_or_else(|| JsError::new("each peer node id must be a string"))?;
            allowed.insert(peer_id);
        }

        self.blob_acl.borrow_mut().insert(hash, allowed);
        Ok(())
    }

    /// PROTOTYPE: remove a hash's restriction, returning it to the default
    /// (served to anyone) state.
    pub fn clear_blob_restriction(&self, blake3_hash: &str) -> Result<(), JsError> {
        let hash: Hash = blake3_hash
            .parse()
            .map_err(|e| JsError::new(&format!("invalid blake3 hash: {}", e)))?;
        self.blob_acl.borrow_mut().remove(&hash);
        Ok(())
    }

    /// open a bidirectional stream to a peer on a specific ALPN.
    ///
    /// `peer_addr` can be a plain node_id hex string or a full endpoint
    /// address JSON (same format as api_request). `alpn` is the protocol
    /// to negotiate (e.g. "iroh/automerge-repo/1").
    ///
    /// returns a BiStream for length-delimited message exchange.
    pub async fn open_bi(&self, peer_addr: &str, alpn: &str) -> Result<BiStream, JsError> {
        let addr = parse_peer_addr(peer_addr).map_err(|e| JsError::new(&e))?;
        let alpn_bytes = alpn.as_bytes();

        // bound the connect attempt with a wall-clock timeout. without an addr
        // hint iroh falls back to pkarr/DNS discovery, which can spin internally
        // for ~2 minutes when the peer isn't discoverable yet. n0_future::time
        // works under wasm (it drives browser timers), so this fires reliably
        // even while iroh is busy polling - unlike a JS setTimeout race, which
        // gets starved by the wasm microtask loop. a bounded failure lets the
        // caller retry instead of hanging.
        let conn = n0_future::time::timeout(
            self.connect_timeout,
            self.endpoint.connect(addr.clone(), alpn_bytes),
        )
        .await
        .map_err(|_| JsError::new("connect timed out"))?
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
            _connection: conn,
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
    ///
    /// a single incoming attempt failing during the TLS handshake (e.g. the
    /// peer aborts mid-handshake - normal during connection-path racing, or
    /// a peer that redials before noticing an earlier attempt is still
    /// live) does not end this call: it's logged and the loop moves on to
    /// the next queued incoming connection. propagating that failure to the
    /// caller instead would surface as a JS-level error on every accept()
    /// call, forcing the caller through a full error-handling/backoff cycle
    /// (see `IrohNetworkAdapter`'s accept loop) before the next, perfectly
    /// good, already-queued connection is even looked at - under a burst of
    /// aborted handshakes this can visibly stall new connections from ever
    /// completing.
    pub async fn accept(&self) -> Result<JsValue, JsError> {
        loop {
            // wait for the next incoming connection
            let incoming = match self.endpoint.accept().await {
                Some(incoming) => incoming,
                None => return Ok(JsValue::NULL), // endpoint closed
            };

            // accept the connection (completes TLS handshake). a failure
            // here is a single bad connection attempt, not an endpoint-wide
            // problem - log it and keep accepting.
            let conn = match incoming.await {
                Ok(conn) => conn,
                Err(e) => {
                    warn!("accept: incoming connection failed during handshake: {}", e);
                    continue;
                }
            };

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

            // the peer completed the handshake but then closed before
            // opening its first stream (or the connection died right
            // after) - same reasoning as above, this is a single bad
            // attempt, not a reason to fail the whole accept() call.
            let (send, recv) = match conn.accept_bi().await {
                Ok(streams) => streams,
                Err(e) => {
                    warn!(
                        "accept: connection from {} closed before opening a stream: {}",
                        &peer_node_id[..std::cmp::min(16, peer_node_id.len())],
                        e
                    );
                    continue;
                }
            };

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
                _connection: conn,
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
    pub async fn api_request(
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
        let request = PeerMessage::ApiRequest {
            id: 1,
            method: method.to_string(),
            path: path.to_string(),
            body,
        };
        let bytes = serde_json::to_vec(&request).map_err(to_js_err)?;
        send.write_all(&bytes).await.map_err(to_js_err)?;
        send.finish().map_err(to_js_err)?;

        // read response (no length prefix, read to end). cap is generous
        // because api_request is the fallback path for blob data (audio/
        // image) when verified iroh-blobs streaming fails. base64 inflation
        // means a 96MB cap covers ~70MB of raw audio, which fits typical
        // album-length mp3s. for anything larger the verified path must work.
        let response_bytes: Vec<u8> = recv
            .read_to_end(128 * 1024 * 1024)
            .await
            .map_err(to_js_err)?;
        let response: PeerMessage = serde_json::from_slice(&response_bytes).map_err(to_js_err)?;

        match response {
            PeerMessage::ApiResponse { status, body, .. } => {
                let result = ApiResponse { status, body };
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

        // protect from gc for the whole download+read lifecycle
        let _guard = ProtectGuard::new(self.protected_hashes.clone(), hash);

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

    /// download a blob with progress reporting via JS callback
    ///
    /// same as download_verified but calls on_progress(fraction) where
    /// fraction is bytes_received / total_size (0.0 to 1.0).
    /// total_size should come from the caller's known size field.
    /// `cancel`: optional cooperative cancellation (pause) — see
    /// download_verified_streaming for the semantics.
    pub async fn download_verified_with_progress(
        &self,
        peer_addr: &str,
        blake3_hash: &str,
        total_size: f64,
        on_progress: &JsFunction,
        cancel: Option<CancelToken>,
    ) -> Result<Uint8Array, JsError> {
        let addr = parse_peer_addr(peer_addr).map_err(|e| JsError::new(&e))?;

        let hash: Hash = blake3_hash
            .parse()
            .map_err(|e| JsError::new(&format!("invalid blake3 hash: {}", e)))?;

        // protect from gc for the whole download+read lifecycle
        let _guard = ProtectGuard::new(self.protected_hashes.clone(), hash);

        let hash_and_format = HashAndFormat::raw(hash);
        let progress = self.blobs_downloader.download(hash_and_format, [addr.id]);

        use iroh_blobs::api::downloader::DownloadProgressItem;
        use n0_future::StreamExt;

        let mut stream = progress
            .stream()
            .await
            .map_err(|e| JsError::new(&format!("download stream failed: {}", e)))?;

        let mut had_error = false;
        let mut last_error: Option<String> = None;

        loop {
            // cooperative cancellation between progress events. the partial
            // stays in the store and the hash is pinned so gc won't sweep it
            // before a resume.
            let event = if let Some(token) = &cancel {
                tokio::select! {
                    event = stream.next() => event,
                    _ = token.cancelled() => {
                        if let Ok(mut set) = self.protected_hashes.lock() {
                            set.insert(hash);
                        }
                        return Err(JsError::new(DOWNLOAD_CANCELLED_MSG));
                    }
                }
            } else {
                stream.next().await
            };
            let Some(event) = event else { break };
            match &event {
                DownloadProgressItem::Progress(bytes) => {
                    if total_size > 0.0 {
                        let fraction = (*bytes as f64 / total_size).min(1.0);
                        let _ = on_progress.call1(&JsValue::NULL, &JsValue::from_f64(fraction));
                    }
                }
                DownloadProgressItem::Error(e) => {
                    had_error = true;
                    last_error = Some(format!("{:?}", e));
                }
                DownloadProgressItem::DownloadError => {
                    had_error = true;
                    last_error = Some("download error".to_string());
                }
                _ => {}
            }
        }

        if had_error {
            return Err(JsError::new(&format!(
                "download failed: {}",
                last_error.unwrap_or_else(|| "unknown error".to_string())
            )));
        }

        let bytes = self
            .blobs_store
            .get_bytes(hash)
            .await
            .map_err(|e| JsError::new(&format!("failed to read blob from store: {}", e)))?;

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
        cancel: Option<CancelToken>,
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

        // on cancellation: keep the partial protected past the guard's drop
        // so gc can't sweep it before the user resumes
        let cancel_cleanup = |protected: &Arc<Mutex<HashSet<Hash>>>| {
            if let Ok(mut set) = protected.lock() {
                set.insert(hash);
            }
        };

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
        loop {
            // cooperative cancellation between progress events. dropping
            // `stream` stops the downloader task at its next send.
            let event = if let Some(token) = &cancel {
                tokio::select! {
                    event = stream.next() => event,
                    _ = token.cancelled() => {
                        debug!("download_verified_streaming: cancelled for {} after {} bytes", short, last_dl_bytes);
                        cancel_cleanup(&self.protected_hashes);
                        return Err(JsError::new(DOWNLOAD_CANCELLED_MSG));
                    }
                }
            } else {
                stream.next().await
            };
            let Some(event) = event else { break };
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
            // pause can land during the read-out phase too
            if let Some(token) = &cancel {
                if token.is_cancelled() {
                    debug!(
                        "download_verified_streaming: cancelled during read for {} after {} bytes",
                        short, total_read
                    );
                    cancel_cleanup(&self.protected_hashes);
                    return Err(JsError::new(DOWNLOAD_CANCELLED_MSG));
                }
            }
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
    /// ensure_blob to load it, then retries. a deliberate cancellation is NOT
    /// retried — it propagates immediately with the "download cancelled" message.
    pub async fn download_verified_streaming_with_ensure(
        &self,
        peer_addr: &str,
        blake3_hash: &str,
        total_size: f64,
        on_chunk: &JsFunction,
        on_progress: &JsFunction,
        cancel: Option<CancelToken>,
    ) -> Result<f64, JsError> {
        let cancel_ref = cancel.as_ref();
        match self
            .download_verified_streaming(
                peer_addr,
                blake3_hash,
                total_size,
                on_chunk,
                on_progress,
                cancel_ref.map(|t| t.clone_token()),
            )
            .await
        {
            Ok(n) => return Ok(n),
            Err(e) => {
                // deliberate pause/cancel: do NOT fall into ensure+retry
                if cancel_ref.map(|t| t.is_cancelled()).unwrap_or(false) {
                    return Err(e);
                }
                // first attempt failed (often: blob not yet in peer's store).
                // log the cause then retry via ensure_blob so that genuine
                // failures (bad hash, transport error) aren't silently masked.
                warn!(
                    "download_verified_streaming_with_ensure: first attempt failed for {}, calling ensure_blob: {:?}",
                    &blake3_hash[..16.min(blake3_hash.len())],
                    e
                );
                let _ = on_progress.call1(&JsValue::NULL, &JsValue::from_f64(0.0));
            }
        }

        let available = self.ensure_blob(peer_addr, blake3_hash).await?;
        if !available {
            return Err(JsError::new(&format!(
                "blob {} not available on peer",
                &blake3_hash[..16.min(blake3_hash.len())]
            )));
        }

        self.download_verified_streaming(
            peer_addr,
            blake3_hash,
            total_size,
            on_chunk,
            on_progress,
            cancel_ref.map(|t| t.clone_token()),
        )
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

    /// download with ensure + retry and progress reporting.
    ///
    /// tries download first; if blob not in peer's FsStore, calls ensure_blob
    /// then retries. progress callback receives fraction (0.0 to 1.0).
    /// `cancel`: optional cooperative cancellation (pause) — a deliberate
    /// cancellation is NOT retried, it propagates immediately.
    ///
    /// NOTE: any failure on the first attempt triggers this same
    /// ensure-then-retry fallback, not just the "blob not in FsStore yet"
    /// case the fallback was designed for. for a large blob, the first
    /// attempt can stream a substantial fraction of the bytes (driving
    /// `on_progress` most/all of the way to 1.0) before failing late, so the
    /// caller-visible symptom is a full 0->100% progress cycle that silently
    /// restarts from 0 for a second full cycle. logging the first attempt's
    /// error and explicitly resetting progress to 0 here makes this restart
    /// visible/diagnosable instead of looking like a silent glitch.
    pub async fn download_verified_with_ensure_progress(
        &self,
        peer_addr: &str,
        blake3_hash: &str,
        total_size: f64,
        on_progress: &JsFunction,
        cancel: Option<CancelToken>,
    ) -> Result<Uint8Array, JsError> {
        let cancel_ref = cancel.as_ref();
        // first attempt
        match self
            .download_verified_with_progress(
                peer_addr,
                blake3_hash,
                total_size,
                on_progress,
                cancel_ref.map(|t| t.clone_token()),
            )
            .await
        {
            Ok(data) => return Ok(data),
            Err(e) => {
                // deliberate pause/cancel: do NOT fall into ensure+retry
                if cancel_ref.map(|t| t.is_cancelled()).unwrap_or(false) {
                    return Err(e);
                }
                // retry with ensure_blob (normal for first download, but
                // also the fallback for a late failure after a partial or
                // full transfer — see the doc comment above).
                warn!(
                    "first download_verified attempt for {} failed ({:?}), \
                     retrying after ensure_blob (progress will restart from 0)",
                    &blake3_hash[..16.min(blake3_hash.len())],
                    e
                );
                let _ = on_progress.call1(&JsValue::NULL, &JsValue::from_f64(0.0));
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

        // retry verified download with progress
        self.download_verified_with_progress(
            peer_addr,
            blake3_hash,
            total_size,
            on_progress,
            cancel_ref.map(|t| t.clone_token()),
        )
        .await
    }

    /// pin a hash so gc won't sweep it (e.g. a paused partial download).
    /// idempotent. pair with unprotect_blob when the partial is resumed to
    /// completion or discarded.
    pub fn protect_blob(&self, blake3_hash: &str) -> Result<(), JsError> {
        let hash: Hash = blake3_hash
            .parse()
            .map_err(|e| JsError::new(&format!("invalid blake3 hash: {}", e)))?;
        if let Ok(mut set) = self.protected_hashes.lock() {
            set.insert(hash);
        }
        Ok(())
    }

    /// remove a gc pin added by protect_blob (or by a cancelled download).
    pub fn unprotect_blob(&self, blake3_hash: &str) -> Result<(), JsError> {
        let hash: Hash = blake3_hash
            .parse()
            .map_err(|e| JsError::new(&format!("invalid blake3 hash: {}", e)))?;
        if let Ok(mut set) = self.protected_hashes.lock() {
            set.remove(&hash);
        }
        Ok(())
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

    /// full pipeline from blob_id with progress reporting.
    ///
    /// computes blake3 on demand, then uses verified download with progress.
    /// returns [data: Uint8Array, blake3: string].
    pub async fn download_verified_by_id_progress(
        &self,
        peer_addr: &str,
        blob_id: &str,
        total_size: f64,
        on_progress: &JsFunction,
    ) -> Result<js_sys::Array, JsError> {
        let blake3 = self
            .compute_blake3(peer_addr, blob_id)
            .await?
            .ok_or_else(|| JsError::new("blob not found on peer"))?;

        let data = self
            .download_verified_with_ensure_progress(
                peer_addr,
                &blake3,
                total_size,
                on_progress,
                None,
            )
            .await?;

        let result = js_sys::Array::new();
        result.push(&data.into());
        result.push(&JsValue::from_str(&blake3));
        Ok(result)
    }

    /// begin a chunked import — the streaming counterpart to import_blob for
    /// payloads that shouldn't be materialized as one contiguous &[u8] across
    /// the wasm boundary. see ImportSession for the push/finish protocol.
    pub fn start_import(&self) -> ImportSession {
        // small bound: each queued chunk is typically ~1MB from JS, so the
        // channel holds at most a few MB while providing real backpressure.
        let (tx, rx) = tokio::sync::mpsc::channel::<std::io::Result<bytes::Bytes>>(4);
        let (result_tx, result_rx) = tokio::sync::oneshot::channel::<Result<TempTag, String>>();

        let store = self.blobs_store.clone();
        wasm_bindgen_futures::spawn_local(async move {
            let progress = store.blobs().add_stream(ReceiverStream(rx)).await;
            let res = progress
                .temp_tag()
                .await
                .map_err(|e| format!("chunked import failed: {:?}", e));
            // receiver dropped (abort) => temp tag dropped => gc reclaims
            let _ = result_tx.send(res);
        });

        ImportSession {
            sender: RefCell::new(Some(tx)),
            result_rx: RefCell::new(Some(result_rx)),
            active_tags: self.active_tags.clone(),
        }
    }

    /// import raw bytes into the iroh-blobs store, returning the blake3 hash.
    /// this makes the blob available for verified download by peers.
    /// the blob stays in the store as long as its TempTag is held in active_tags.
    /// call release_blob() to allow GC.
    #[wasm_bindgen]
    pub async fn import_blob(&self, data: &[u8]) -> Result<String, JsError> {
        // check active_tags first to avoid the expensive add_bytes + bao computation
        let hash_bytes = blake3::hash(data);
        let hash = Hash::from_bytes(*hash_bytes.as_bytes());

        {
            let tags = self
                .active_tags
                .lock()
                .map_err(|_| JsError::new("tags lock"))?;
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

        // no eviction cap: gc protection (protected_hashes + active_tags via
        // the protect callback) covers in-flight downloads, and imported
        // blobs stay pinned until release_blob().
        if let Ok(mut tags) = self.active_tags.lock() {
            tags.insert(hash, tt);
        }
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

        // pin until release_blob() (no eviction cap — see import_blob)
        if let Ok(mut tags) = self.active_tags.lock() {
            tags.insert(hash, tt);
        }

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
            let tags = self
                .active_tags
                .lock()
                .map_err(|_| JsError::new("tags lock"))?;
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

        // pin until release_blob() (no eviction cap — see import_blob)
        if let Ok(mut tags) = self.active_tags.lock() {
            tags.insert(hash, tt);
        }

        Ok(hash.to_hex().to_string())
    }

    /// release a blob's TempTag, allowing the store to garbage-collect it.
    /// blake3_hash should be the 64-char hex string returned by import_blob.
    #[wasm_bindgen]
    pub fn release_blob(&self, blake3_hash: &str) -> Result<(), JsError> {
        let hash: Hash = blake3_hash
            .parse()
            .map_err(|_| JsError::new("invalid blake3 hash"))?;
        if let Ok(mut tags) = self.active_tags.lock() {
            tags.shift_remove(&hash);
        }
        Ok(())
    }

    /// return the number of blobs currently held in the store via active TempTags.
    #[wasm_bindgen]
    pub fn active_blob_count(&self) -> usize {
        self.active_tags.lock().map(|t| t.len()).unwrap_or(0)
    }

    /// check whether a blob with the given blake3 hash is currently held in the store
    /// via an active TempTag. avoids expensive OPFS read + bao recomputation when the
    /// blob is already loaded.
    #[wasm_bindgen]
    pub fn has_active_blob(&self, blake3_hash: &str) -> bool {
        let hash: Hash = match blake3_hash.parse() {
            Ok(h) => h,
            Err(_) => return false,
        };
        self.active_tags
            .lock()
            .map(|t| t.contains_key(&hash))
            .unwrap_or(false)
    }

    /// check whether a COMPLETE blob with this hash exists in the blob store
    /// itself — with the persistent opfs store this is true across reloads,
    /// even when no TempTag pins it. lets serving paths skip re-imports
    /// entirely.
    #[wasm_bindgen]
    pub async fn has_complete_blob(&self, blake3_hash: &str) -> bool {
        let hash: Hash = match blake3_hash.parse() {
            Ok(h) => h,
            Err(_) => return false,
        };
        matches!(
            self.blobs_store.blobs().status(hash).await,
            Ok(iroh_blobs::api::blobs::BlobStatus::Complete { .. })
        )
    }
}

fn to_js_err<E: std::fmt::Display>(e: E) -> JsError {
    JsError::new(&e.to_string())
}
