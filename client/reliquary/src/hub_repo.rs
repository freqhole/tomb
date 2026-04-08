//! hub_repo — custom automerge sync handler for JS automerge-repo messages.
//!
//! replaces samod for processing incoming sync messages from the JS
//! automerge-repo v2.x client. the JS side sends CBOR-encoded messages over
//! iroh QUIC streams with 4-byte big-endian length-delimited framing.
//!
//! message shapes (CBOR maps):
//!
//! - `sync`:            `{ type, senderId, targetId, documentId, data }`
//! - `request`:         `{ type, senderId, targetId, documentId, data }`
//! - `ephemeral`:       `{ type, senderId, targetId, documentId, data, count, sessionId }`
//! - `doc-unavailable`: `{ type, senderId, targetId, documentId }`
//!
//! the `data` field contains raw automerge sync message bytes. framing matches
//! `tokio_util::codec::LengthDelimitedCodec` defaults (`[4-byte BE len][payload]`).

use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use automerge::sync::SyncDoc;
use tokio::sync::{broadcast, RwLock};

// ---------------------------------------------------------------------------
// CBOR message types (incoming)
// ---------------------------------------------------------------------------

/// top-level envelope for all messages arriving from JS automerge-repo.
#[derive(Debug, serde::Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum RepoMessage {
    Sync(SyncMessage),
    Request(SyncMessage),
    Ephemeral(EphemeralMessage),
    DocUnavailable(DocUnavailableMessage),
}

/// payload for `sync` and `request` message types.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncMessage {
    pub sender_id: String,
    pub target_id: String,
    pub document_id: String,
    #[serde(with = "serde_bytes")]
    pub data: Vec<u8>,
}

/// payload for `ephemeral` messages (currently ignored by the hub).
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EphemeralMessage {
    pub sender_id: String,
    pub target_id: String,
    pub document_id: String,
    #[serde(with = "serde_bytes")]
    pub data: Vec<u8>,
    pub count: u64,
    pub session_id: String,
}

/// payload for `doc-unavailable` messages.
#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocUnavailableMessage {
    pub sender_id: String,
    pub target_id: String,
    pub document_id: String,
}

// ---------------------------------------------------------------------------
// CBOR message types (outgoing)
// ---------------------------------------------------------------------------

/// sync response sent back to the JS peer.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResponse {
    #[serde(rename = "type")]
    pub msg_type: String,
    pub sender_id: String,
    pub target_id: String,
    pub document_id: String,
    #[serde(with = "serde_bytes")]
    pub data: Vec<u8>,
}

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

/// errors specific to hub_repo operations.
#[derive(Debug, thiserror::Error)]
pub enum HubRepoError {
    #[error("storage error: {0}")]
    Storage(#[from] sqlx::Error),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

// ---------------------------------------------------------------------------
// DocHandle — lightweight synchronized access to an automerge document
// ---------------------------------------------------------------------------

/// lightweight handle for synchronized access to an automerge document.
#[derive(Clone)]
pub struct DocHandle {
    doc_id: String,
    doc: Arc<RwLock<automerge::Automerge>>,
}

impl DocHandle {
    pub fn document_id(&self) -> &str {
        &self.doc_id
    }

    /// synchronous read access to the document (runs closure while holding
    /// read lock). blocks the current thread — call from `spawn_blocking`.
    pub fn with_document<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&automerge::Automerge) -> R,
    {
        let doc = self.doc.blocking_read();
        f(&*doc)
    }

    /// synchronous mutable access for transact operations. blocks the current
    /// thread — call from `spawn_blocking`.
    pub fn with_document_mut<F, R>(&self, f: F) -> R
    where
        F: FnOnce(&mut automerge::Automerge) -> R,
    {
        let mut doc = self.doc.blocking_write();
        f(&mut *doc)
    }
}

// ---------------------------------------------------------------------------
// PeerInfo
// ---------------------------------------------------------------------------

/// metadata about a currently connected peer.
#[derive(Debug, Clone)]
pub struct PeerInfo {
    pub peer_id: String,
    pub connected_at: std::time::Instant,
}

// ---------------------------------------------------------------------------
// HubDocStorage — sqlite persistence for raw automerge doc bytes
// ---------------------------------------------------------------------------

/// sqlite-backed persistence for automerge documents managed by hub_repo.
///
/// uses a `hub_docs` table (separate from the samod `samod_kv` table) so both
/// systems can coexist during the transition period.
pub struct HubDocStorage {
    pool: sqlx::SqlitePool,
}

impl HubDocStorage {
    /// create a new storage instance backed by the given sqlite database file.
    ///
    /// creates the database and `hub_docs` table if they don't already exist.
    pub async fn new(db_path: &Path) -> Result<Self, sqlx::Error> {
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(db_path)
            .create_if_missing(true);

        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS hub_docs (\
                doc_id TEXT PRIMARY KEY, \
                data BLOB NOT NULL, \
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))\
            )",
        )
        .execute(&pool)
        .await?;

        Ok(Self { pool })
    }

    /// load raw automerge bytes for a document.
    pub async fn load_doc(&self, doc_id: &str) -> Option<Vec<u8>> {
        sqlx::query_scalar::<_, Vec<u8>>("SELECT data FROM hub_docs WHERE doc_id = ?")
            .bind(doc_id)
            .fetch_optional(&self.pool)
            .await
            .ok()
            .flatten()
    }

    /// persist raw automerge bytes for a document (insert or replace).
    pub async fn save_doc(&self, doc_id: &str, data: &[u8]) {
        if let Err(e) =
            sqlx::query("INSERT OR REPLACE INTO hub_docs (doc_id, data, updated_at) VALUES (?, ?, datetime('now'))")
                .bind(doc_id)
                .bind(data)
                .execute(&self.pool)
                .await
        {
            tracing::warn!(doc_id, error = %e, "failed to save doc");
        }
    }

    /// load all known document IDs (used on startup to reload persisted docs).
    pub async fn load_all_doc_ids(&self) -> Vec<String> {
        sqlx::query_scalar::<_, String>("SELECT doc_id FROM hub_docs")
            .fetch_all(&self.pool)
            .await
            .unwrap_or_default()
    }
}

// ---------------------------------------------------------------------------
// HubRepo — the main sync handler
// ---------------------------------------------------------------------------

/// custom automerge sync handler that processes incoming CBOR-encoded messages
/// from JS automerge-repo peers over iroh QUIC streams.
///
/// all fields are wrapped in `Arc` so the struct is cheaply cloneable.
#[derive(Clone)]
pub struct HubRepo {
    /// all automerge documents, keyed by document ID string.
    documents: Arc<RwLock<HashMap<String, Arc<RwLock<automerge::Automerge>>>>>,
    /// per-(peer, document) sync states (ephemeral, not persisted).
    sync_states: Arc<RwLock<HashMap<(String, String), automerge::sync::State>>>,
    /// sqlite storage backend for document persistence.
    storage: Arc<HubDocStorage>,
    /// hub's own peer ID (the iroh node_id hex string).
    peer_id: String,
    /// broadcast channel to notify waiters when a document becomes available
    /// or is updated.
    doc_notify: broadcast::Sender<String>,
    /// currently connected peers.
    connected_peers: Arc<RwLock<HashMap<String, PeerInfo>>>,
}

impl HubRepo {
    /// create a new hub repo, loading any previously persisted documents from
    /// the sqlite database at `db_path`.
    pub async fn new(
        peer_id: String,
        db_path: &Path,
    ) -> Result<Self, Box<dyn std::error::Error + Send + Sync>> {
        let storage = Arc::new(HubDocStorage::new(db_path).await?);
        let (doc_notify, _) = broadcast::channel(64);

        // reload previously persisted documents
        let documents: Arc<RwLock<HashMap<String, Arc<RwLock<automerge::Automerge>>>>> =
            Arc::new(RwLock::new(HashMap::new()));

        let doc_ids = storage.load_all_doc_ids().await;
        for doc_id in doc_ids {
            if let Some(bytes) = storage.load_doc(&doc_id).await {
                match automerge::Automerge::load(&bytes) {
                    Ok(doc) => {
                        documents
                            .write()
                            .await
                            .insert(doc_id.clone(), Arc::new(RwLock::new(doc)));
                        tracing::info!(doc_id, "loaded persisted doc");
                    }
                    Err(e) => {
                        tracing::warn!(doc_id, error = %e, "failed to load persisted doc, skipping");
                    }
                }
            }
        }

        Ok(Self {
            documents,
            sync_states: Arc::new(RwLock::new(HashMap::new())),
            storage,
            peer_id,
            doc_notify,
            connected_peers: Arc::new(RwLock::new(HashMap::new())),
        })
    }

    /// find a document by ID. returns `None` if not available locally.
    pub async fn find(&self, doc_id: &str) -> Option<DocHandle> {
        let docs = self.documents.read().await;
        docs.get(doc_id).map(|doc| DocHandle {
            doc_id: doc_id.to_string(),
            doc: Arc::clone(doc),
        })
    }

    /// wait for a document to appear (either already exists or arrives via
    /// sync). returns `None` on timeout.
    pub async fn wait_for_doc(
        &self,
        doc_id: &str,
        timeout: std::time::Duration,
    ) -> Option<DocHandle> {
        // check if already available
        if let Some(handle) = self.find(doc_id).await {
            return Some(handle);
        }

        // subscribe and wait for the target document to arrive
        let mut rx = self.doc_notify.subscribe();
        let target = doc_id.to_string();
        let this = self.clone();

        tokio::time::timeout(timeout, async move {
            loop {
                match rx.recv().await {
                    Ok(id) if id == target => {
                        return this.find(&target).await;
                    }
                    Ok(_) => continue,
                    Err(_) => return None,
                }
            }
        })
        .await
        .ok()
        .flatten()
    }

    /// get or create a document for a given ID. used when we receive sync
    /// messages for a doc we don't have yet.
    async fn get_or_create_doc(&self, doc_id: &str) -> Arc<RwLock<automerge::Automerge>> {
        // fast path: read lock
        {
            let docs = self.documents.read().await;
            if let Some(doc) = docs.get(doc_id) {
                return Arc::clone(doc);
            }
        }

        // slow path: write lock, double-check, then create
        let mut docs = self.documents.write().await;
        if let Some(doc) = docs.get(doc_id) {
            return Arc::clone(doc);
        }

        let doc = Arc::new(RwLock::new(automerge::Automerge::new()));
        docs.insert(doc_id.to_string(), Arc::clone(&doc));
        tracing::info!(doc_id, "created new doc for incoming sync");

        // notify waiters that a new document appeared
        let _ = self.doc_notify.send(doc_id.to_string());
        doc
    }

    /// handle an incoming sync/request message from a peer.
    ///
    /// applies the incoming automerge sync message, generates a response if the
    /// local document has changes to send back, and persists the document
    /// asynchronously.
    ///
    /// returns the encoded response sync message bytes, or `None` if there is
    /// nothing to send back.
    pub async fn handle_sync_message(
        &self,
        peer_id: &str,
        doc_id: &str,
        sync_message_bytes: &[u8],
    ) -> Option<Vec<u8>> {
        let doc_arc = self.get_or_create_doc(doc_id).await;
        let mut doc = doc_arc.write().await;

        // get or create the sync state for this (peer, document) pair
        let key = (peer_id.to_string(), doc_id.to_string());
        let mut sync_states = self.sync_states.write().await;
        let sync_state = sync_states
            .entry(key)
            .or_insert_with(automerge::sync::State::new);

        // decode the incoming automerge sync message
        let incoming = match automerge::sync::Message::decode(sync_message_bytes) {
            Ok(msg) => msg,
            Err(e) => {
                tracing::warn!(
                    peer_id,
                    doc_id,
                    error = %e,
                    "failed to decode automerge sync message"
                );
                return None;
            }
        };

        // apply the message to our document
        if let Err(e) = doc.receive_sync_message(sync_state, incoming) {
            tracing::warn!(
                peer_id,
                doc_id,
                error = %e,
                "failed to apply automerge sync message"
            );
            return None;
        }

        // notify waiters on every successful receive (doc may now have content)
        let _ = self.doc_notify.send(doc_id.to_string());

        // generate a response message if we have changes to send back
        let response = doc.generate_sync_message(sync_state);

        // persist the document asynchronously after receiving sync
        let save_bytes = doc.save();
        let storage = Arc::clone(&self.storage);
        let doc_id_owned = doc_id.to_string();
        tokio::spawn(async move {
            storage.save_doc(&doc_id_owned, &save_bytes).await;
        });

        response.map(|msg: automerge::sync::Message| msg.encode())
    }

    /// process a full connection: read length-delimited frames, decode CBOR,
    /// handle sync, and send responses.
    ///
    /// this is the main entry point called when accepting a new peer
    /// connection over iroh QUIC.
    pub async fn handle_connection<S>(&self, peer_id_str: String, stream: S)
    where
        S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send + 'static,
    {
        use futures::SinkExt;
        use futures::StreamExt;
        use tokio_util::codec::{Framed, LengthDelimitedCodec};

        // track the peer
        {
            let mut peers = self.connected_peers.write().await;
            peers.insert(
                peer_id_str.clone(),
                PeerInfo {
                    peer_id: peer_id_str.clone(),
                    connected_at: std::time::Instant::now(),
                },
            );
        }
        tracing::info!(peer = %peer_id_str, "hub_repo: peer connected");

        // frame the stream with 4-byte big-endian length-delimited codec
        let codec = LengthDelimitedCodec::builder()
            .big_endian()
            .length_field_length(4)
            .new_codec();
        let mut framed = Framed::new(stream, codec);

        let hub_peer_id = self.peer_id.clone();

        loop {
            let frame = match framed.next().await {
                Some(Ok(frame)) => frame,
                Some(Err(e)) => {
                    tracing::warn!(peer = %peer_id_str, error = %e, "hub_repo: frame read error");
                    break;
                }
                None => {
                    tracing::info!(peer = %peer_id_str, "hub_repo: stream closed");
                    break;
                }
            };

            // decode CBOR envelope
            let message: RepoMessage = match ciborium::from_reader(frame.as_ref()) {
                Ok(msg) => msg,
                Err(e) => {
                    tracing::warn!(
                        peer = %peer_id_str,
                        error = %e,
                        bytes = frame.len(),
                        "hub_repo: failed to decode CBOR message"
                    );
                    continue;
                }
            };

            match message {
                RepoMessage::Sync(msg) | RepoMessage::Request(msg) => {
                    tracing::debug!(
                        peer = %peer_id_str,
                        doc_id = %msg.document_id,
                        data_len = msg.data.len(),
                        "hub_repo: received sync message"
                    );

                    if let Some(response_bytes) = self
                        .handle_sync_message(&peer_id_str, &msg.document_id, &msg.data)
                        .await
                    {
                        let response = SyncResponse {
                            msg_type: "sync".to_string(),
                            sender_id: hub_peer_id.clone(),
                            target_id: msg.sender_id.clone(),
                            document_id: msg.document_id.clone(),
                            data: response_bytes,
                        };

                        let mut buf = Vec::new();
                        if let Err(e) = ciborium::into_writer(&response, &mut buf) {
                            tracing::warn!(
                                peer = %peer_id_str,
                                error = %e,
                                "hub_repo: failed to encode CBOR response"
                            );
                            continue;
                        }

                        if let Err(e) = framed.send(bytes::Bytes::from(buf)).await {
                            tracing::warn!(
                                peer = %peer_id_str,
                                error = %e,
                                "hub_repo: failed to send sync response"
                            );
                            break;
                        }

                        tracing::debug!(
                            peer = %peer_id_str,
                            doc_id = %msg.document_id,
                            "hub_repo: sent sync response"
                        );
                    }
                }

                RepoMessage::Ephemeral(msg) => {
                    tracing::debug!(
                        peer = %peer_id_str,
                        doc_id = %msg.document_id,
                        count = msg.count,
                        "hub_repo: received ephemeral message (ignored)"
                    );
                }

                RepoMessage::DocUnavailable(msg) => {
                    tracing::info!(
                        peer = %peer_id_str,
                        doc_id = %msg.document_id,
                        "hub_repo: peer says doc unavailable"
                    );
                }
            }
        }

        // untrack the peer and clean up per-peer sync states
        {
            let mut peers = self.connected_peers.write().await;
            peers.remove(&peer_id_str);
        }
        {
            let mut states = self.sync_states.write().await;
            states.retain(|(p, _), _| p != &peer_id_str);
        }
        tracing::info!(peer = %peer_id_str, "hub_repo: peer disconnected, cleaned up sync states");
    }

    /// number of currently connected peers.
    pub async fn connected_peer_count(&self) -> usize {
        self.connected_peers.read().await.len()
    }

    /// list of currently connected peer IDs.
    pub async fn connected_peer_ids(&self) -> Vec<String> {
        self.connected_peers.read().await.keys().cloned().collect()
    }

    /// number of documents currently held by the hub repo.
    pub async fn document_count(&self) -> usize {
        self.documents.read().await.len()
    }

    /// the hub's own peer ID (iroh node_id hex string).
    pub fn peer_id(&self) -> &str {
        &self.peer_id
    }
}
