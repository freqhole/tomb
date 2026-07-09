//! snatch: the generic blob-replication engine.
//!
//! watches for blob references an app-specific source knows about (automerge
//! doc scanning for tumulus, sql joins for grimoire, ...) and fetches any
//! blobs this node doesn't have yet from peers that do. genericized over two
//! seams the app implements:
//!
//! - [`BlobRefSource`]: where blob references live, and how to learn about
//!   changes to them. entirely app-specific (doc scanning, sql joins, ...).
//! - [`PeerProbeTransport`]: how to ask a specific peer "do you have this
//!   blake3" before spending a download slot on them. app-specific because
//!   the wire protocol for that question is app-specific (see
//!   [`crate::ensure::send_ensure_blob_request`] for one ready-made option).
//!
//! everything else is generic engine machinery: global + per-peer concurrency
//! limits, probe timeout, per-progress-event download inactivity timeout,
//! soft-delete-aware dedup, `TryReference` export + ingest, in-flight
//! tracking shared with [`crate::node`]'s gc-protect callback, and a peer
//! blob inventory fallback.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex as StdMutex, RwLock};
use std::time::Duration;

use async_trait::async_trait;
use futures::stream::{self, FuturesUnordered, StreamExt};
use futures::Stream;
use iroh_blobs::api::blobs::{ExportMode, ExportOptions};
use iroh_blobs::api::downloader::{DownloadProgressItem, Downloader};
use iroh_blobs::store::fs::FsStore;
use iroh_blobs::{Hash, HashAndFormat};
use tokio::sync::{broadcast, Mutex as TokioMutex, Semaphore};
use tokio_util::sync::CancellationToken;

use crate::blobz::{BlobStore, NewBlobMeta};
use crate::node::InFlightGuard;

// ---------------------------------------------------------------------------
// the app-implemented seams
// ---------------------------------------------------------------------------

/// a blob reference an app-specific [`BlobRefSource`] found while scanning
/// its own storage (an automerge doc, a sql row, ...).
#[derive(Debug, Clone)]
pub struct BlobDescriptor {
    pub blake3: String,
    pub filename: String,
    pub mime: String,
    pub size: u64,
    /// node id hex strings the source believes are likely to have this
    /// blob. probed in parallel; the first to confirm wins the download.
    pub candidate_peers: Vec<String>,
    /// an opaque handle the source can use to find its way back to whatever
    /// it was reading (a doc id, a row id, ...) when [`BlobRefSource::on_snatched`]
    /// fires.
    pub source_ref: String,
}

/// where an app's blob references live, and how it learns about changes to
/// them. entirely app-specific - tumulus scans automerge docs for file
/// widgets, grimoire would join sql tables. the engine never inspects a doc
/// or a row directly; it only ever sees [`BlobDescriptor`]s.
#[async_trait]
pub trait BlobRefSource: Send + Sync {
    /// every doc (or equivalent top-level unit) id the source currently
    /// knows about. used for [`SnatchEngine::scan_and_snatch`]'s boot
    /// catch-up sweep.
    async fn all_doc_ids(&self) -> Vec<String>;

    /// subscribe to change notifications. the engine debounces bursts of
    /// changes for the same doc id (see [`SnatchEngine::run`]) rather than
    /// re-scanning on every single event.
    fn subscribe_changes(&self) -> broadcast::Receiver<String>;

    /// read one doc (or equivalent unit) and return every blob reference it
    /// contains, resolved as far as the source is able (candidate peers,
    /// filename, mime, size). the engine itself does the "do we already
    /// have this" check.
    async fn extract_from_doc(&self, doc_id: &str) -> Vec<BlobDescriptor>;

    /// called after a blob has been successfully downloaded and ingested,
    /// so the source can record that this node now has it (tumulus writes
    /// `local_node_id` into the widget doc's `snatchedBy` list, for
    /// example). `local_node_id` is the engine's own node id.
    async fn on_snatched(&self, descriptor: &BlobDescriptor, local_node_id: &str);
}

/// errors [`PeerProbeTransport::probe`] can return.
#[derive(Debug, thiserror::Error)]
pub enum ProbeError {
    #[error("connection failed: {0}")]
    Connection(String),

    #[error("protocol error: {0}")]
    Protocol(String),
}

/// how to ask a specific peer whether it has a blob, before spending a
/// download slot on them. app-specific because the wire protocol for this
/// question is app-specific - [`crate::ensure::send_ensure_blob_request`] is
/// one ready-made option a `PeerProbeTransport` impl can call into.
#[async_trait]
pub trait PeerProbeTransport: Send + Sync {
    async fn probe(&self, peer_node_id: &str, blake3: &str) -> Result<bool, ProbeError>;
}

// ---------------------------------------------------------------------------
// engine errors
// ---------------------------------------------------------------------------

#[derive(Debug, thiserror::Error)]
pub enum SnatchError {
    #[error("blob has no blake3 hash")]
    NoBlake3,

    #[error("no candidate peers to probe")]
    NoPeers,

    #[error("no peer has the requested blob")]
    NoPeerHasBlob,

    #[error("probe timed out")]
    ProbeTimeout,

    #[error("invalid blake3 hash: {0}")]
    InvalidHash(String),

    #[error("invalid node id: {0}")]
    InvalidNodeId(String),

    #[error("download failed: {0}")]
    DownloadFailed(String),

    #[error("download timed out")]
    DownloadTimeout,

    #[error("failed to ingest blob: {0}")]
    Ingest(String),

    #[error("no downloader attached: the node has no live endpoint right now")]
    NoDownloader,
}

// ---------------------------------------------------------------------------
// engine options
// ---------------------------------------------------------------------------

/// tunables for [`SnatchEngine`]. the defaults match the limits skein's
/// `snatch.rs` shipped with; tests shrink the timeouts/debounce so the
/// suite runs fast without changing the mechanics being tested.
#[derive(Debug, Clone)]
pub struct SnatchEngineOptions {
    /// max concurrent snatch operations (probe + download + ingest) across
    /// all peers.
    pub max_concurrent_snatches: usize,
    /// max concurrent downloads from a single peer.
    pub max_per_peer_downloads: usize,
    /// timeout for probing all candidate peers for one blob.
    pub probe_timeout: Duration,
    /// timeout for a *gap* between download progress events, not a
    /// whole-transfer wall-clock budget - resets on every event so large or
    /// slow transfers aren't killed just for taking a while.
    pub download_inactivity_timeout: Duration,
    /// how long to wait for more changes to the same doc id before acting
    /// on it, in [`SnatchEngine::run`]'s change-driven loop.
    pub debounce: Duration,
}

impl Default for SnatchEngineOptions {
    fn default() -> Self {
        Self {
            max_concurrent_snatches: 20,
            max_per_peer_downloads: 4,
            probe_timeout: Duration::from_secs(15),
            download_inactivity_timeout: Duration::from_secs(120),
            debounce: Duration::from_secs(3),
        }
    }
}

// ---------------------------------------------------------------------------
// SnatchEngine
// ---------------------------------------------------------------------------

/// the generic blob-replication engine. holds `Arc<dyn BlobStore>` (never a
/// concrete store type) plus the app-provided [`BlobRefSource`]/
/// [`PeerProbeTransport`] impls.
pub struct SnatchEngine<S: BlobRefSource, T: PeerProbeTransport> {
    blobz: Arc<dyn BlobStore>,
    /// shared with whatever attaches/detaches endpoints on the engine's
    /// owning `StorageNode` (see `crate::node::StorageNode::attach_endpoint`/
    /// `detach_endpoint`) so a `SnatchEngine` built once keeps working
    /// across the node's endpoint being stopped and restarted, rather than
    /// going stale. `None` means no live endpoint right now.
    downloader: Arc<RwLock<Option<Downloader>>>,
    fs_store: &'static FsStore,
    /// shared with [`crate::node::StorageNode`]'s gc-protect callback (pass
    /// the same `Arc` to both) so a blob mid-download is never swept before
    /// it's exported into `blobz`.
    in_flight: Arc<StdMutex<HashSet<Hash>>>,
    local_node_id: String,
    source: S,
    transport: T,
    options: SnatchEngineOptions,
    peer_semaphores: TokioMutex<HashMap<String, Arc<Semaphore>>>,
    /// peers known (from some out-of-band signal, e.g. a blob-offer gossip
    /// message) to have specific blobs. consulted only when a descriptor
    /// arrives with no `candidate_peers` of its own. populated externally
    /// via [`SnatchEngine::offer_peer_blobs`] - the engine never fills this
    /// in on its own.
    peer_blob_inventory: StdMutex<HashMap<String, HashSet<String>>>,
}

impl<S: BlobRefSource, T: PeerProbeTransport> SnatchEngine<S, T> {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        blobz: Arc<dyn BlobStore>,
        downloader: Arc<RwLock<Option<Downloader>>>,
        fs_store: &'static FsStore,
        in_flight: Arc<StdMutex<HashSet<Hash>>>,
        local_node_id: impl Into<String>,
        source: S,
        transport: T,
        options: SnatchEngineOptions,
    ) -> Self {
        Self {
            blobz,
            downloader,
            fs_store,
            in_flight,
            local_node_id: local_node_id.into(),
            source,
            transport,
            options,
            peer_semaphores: TokioMutex::new(HashMap::new()),
            peer_blob_inventory: StdMutex::new(HashMap::new()),
        }
    }

    /// record that `peer_node_id` is believed to have `blake3_hashes`. the
    /// app's own blob-offer handling (e.g. a gossip response listing a
    /// peer's blobs) is expected to call this; the engine consults it only
    /// as a fallback when a [`BlobDescriptor`] arrives with no candidate
    /// peers of its own.
    pub fn offer_peer_blobs(
        &self,
        peer_node_id: &str,
        blake3_hashes: impl IntoIterator<Item = String>,
    ) {
        if let Ok(mut inventory) = self.peer_blob_inventory.lock() {
            inventory
                .entry(peer_node_id.to_string())
                .or_default()
                .extend(blake3_hashes);
        }
    }

    /// scan every doc the source knows about, resolve missing blobs, and
    /// snatch them concurrently. used for [`SnatchEngine::run`]'s boot
    /// catch-up and available standalone for a manual/cli-triggered sweep.
    /// returns the number of blobs successfully snatched.
    pub async fn scan_and_snatch(&self) -> usize {
        let doc_ids = self.source.all_doc_ids().await;
        if doc_ids.is_empty() {
            return 0;
        }

        let mut all_descriptors = Vec::new();
        for doc_id in &doc_ids {
            all_descriptors.extend(self.source.extract_from_doc(doc_id).await);
        }

        let missing = self.resolve_missing(all_descriptors).await;
        self.snatch_all(&missing).await
    }

    /// run the change-driven loop until `cancel` fires.
    ///
    /// on boot, performs one full [`Self::scan_and_snatch`] so persisted
    /// references that never got their blobs snatched (e.g. the node was
    /// killed mid-transfer last run) get caught up. after that, only
    /// doc-change notifications drive work; bursts of changes to the same
    /// doc id are debounced (see [`SnatchEngineOptions::debounce`]) so a
    /// flurry of rapid edits triggers one extraction pass, not one per edit.
    pub async fn run(&self, cancel: CancellationToken) {
        tracing::info!("snatch engine: change-driven loop starting");

        tokio::select! {
            _ = cancel.cancelled() => return,
            count = self.scan_and_snatch() => {
                if count > 0 {
                    tracing::info!(snatched = count, "boot-time snatch caught up missing blobs");
                }
            }
        }

        let mut rx = self.source.subscribe_changes();
        let mut pending: HashMap<String, tokio::time::Instant> = HashMap::new();

        loop {
            let deadline = pending.values().min().copied();
            let wait_for_deadline = async {
                match deadline {
                    Some(d) => tokio::time::sleep_until(d).await,
                    None => std::future::pending::<()>().await,
                }
            };

            tokio::select! {
                _ = cancel.cancelled() => {
                    tracing::info!("snatch engine: shutting down");
                    return;
                }
                _ = wait_for_deadline => {
                    let now = tokio::time::Instant::now();
                    let ready: Vec<String> = pending
                        .iter()
                        .filter(|(_, deadline)| **deadline <= now)
                        .map(|(doc_id, _)| doc_id.clone())
                        .collect();
                    for doc_id in ready {
                        pending.remove(&doc_id);
                        let count = self.snatch_doc(&doc_id).await;
                        if count > 0 {
                            tracing::info!(
                                doc_id = %doc_id,
                                snatched = count,
                                "snatched blobs after debounced doc change"
                            );
                        }
                    }
                }
                msg = rx.recv() => {
                    match msg {
                        Ok(doc_id) => {
                            pending.insert(doc_id, tokio::time::Instant::now() + self.options.debounce);
                        }
                        Err(broadcast::error::RecvError::Lagged(skipped)) => {
                            tracing::warn!(skipped, "doc-change channel lagged; running full scan");
                            pending.clear();
                            tokio::select! {
                                _ = cancel.cancelled() => return,
                                _ = self.scan_and_snatch() => {}
                            }
                        }
                        Err(broadcast::error::RecvError::Closed) => {
                            tracing::info!("doc-change channel closed");
                            return;
                        }
                    }
                }
            }
        }
    }

    /// extract + resolve + snatch missing blobs for a single doc id. shared
    /// by the debounced dispatch in [`Self::run`].
    async fn snatch_doc(&self, doc_id: &str) -> usize {
        let descriptors = self.source.extract_from_doc(doc_id).await;
        let missing = self.resolve_missing(descriptors).await;
        self.snatch_all(&missing).await
    }

    /// drop descriptors with no blake3, and descriptors we already have -
    /// via `get_any`, so a soft-deleted blob is never re-snatched (an admin
    /// soft-deleting a blob must not have it immediately resurrected by the
    /// next scan).
    async fn resolve_missing(&self, descriptors: Vec<BlobDescriptor>) -> Vec<BlobDescriptor> {
        let mut missing = Vec::with_capacity(descriptors.len());
        for descriptor in descriptors {
            if descriptor.blake3.is_empty() {
                continue;
            }
            if self.check_blob_exists(&descriptor.blake3).await {
                continue;
            }
            missing.push(descriptor);
        }
        missing
    }

    /// snatch a batch of descriptors concurrently (up to
    /// `max_concurrent_snatches`). returns how many succeeded.
    async fn snatch_all(&self, descriptors: &[BlobDescriptor]) -> usize {
        if descriptors.is_empty() {
            return 0;
        }

        let snatched = AtomicUsize::new(0);
        stream::iter(descriptors.iter())
            .for_each_concurrent(Some(self.options.max_concurrent_snatches), |descriptor| {
                let snatched = &snatched;
                async move {
                    match self.snatch_descriptor(descriptor).await {
                        Ok(()) => {
                            snatched.fetch_add(1, Ordering::Relaxed);
                            tracing::info!(
                                blake3 = trunc(&descriptor.blake3),
                                filename = %descriptor.filename,
                                "blob snatched successfully"
                            );
                        }
                        Err(e) => {
                            tracing::debug!(
                                blake3 = trunc(&descriptor.blake3),
                                error = %e,
                                "snatch attempt failed"
                            );
                        }
                    }
                }
            })
            .await;
        snatched.load(Ordering::Relaxed)
    }

    /// snatch one blob: pick candidate peers, probe them, download from the
    /// first that confirms, ingest into `blobz`, and notify the source.
    async fn snatch_descriptor(&self, descriptor: &BlobDescriptor) -> Result<(), SnatchError> {
        if descriptor.blake3.is_empty() {
            return Err(SnatchError::NoBlake3);
        }

        // double-check local availability - may have been snatched by
        // another concurrent cycle since `resolve_missing` ran.
        if self.check_blob_exists(&descriptor.blake3).await {
            return Ok(());
        }

        let target_peers = self.target_peers_for(descriptor);
        if target_peers.is_empty() {
            return Err(SnatchError::NoPeers);
        }

        let provider = self.probe_peers(&descriptor.blake3, &target_peers).await?;
        self.download_blob(&descriptor.blake3, &provider).await?;
        self.ingest_blob(descriptor).await?;
        self.source
            .on_snatched(descriptor, &self.local_node_id)
            .await;

        Ok(())
    }

    /// candidate peers for a descriptor: prefer the source's own list; fall
    /// back to the externally-fed peer blob inventory when the source had
    /// none.
    fn target_peers_for(&self, descriptor: &BlobDescriptor) -> Vec<String> {
        let from_candidates: Vec<String> = descriptor
            .candidate_peers
            .iter()
            .filter(|peer| peer.as_str() != self.local_node_id)
            .cloned()
            .collect();
        if !from_candidates.is_empty() {
            return from_candidates;
        }

        match self.peer_blob_inventory.lock() {
            Ok(inventory) => inventory
                .iter()
                .filter(|(peer, hashes)| {
                    hashes.contains(&descriptor.blake3) && peer.as_str() != self.local_node_id
                })
                .map(|(peer, _)| peer.clone())
                .collect(),
            Err(_) => Vec::new(),
        }
    }

    /// probe candidate peers in parallel via the app-provided transport;
    /// return the first that confirms availability.
    async fn probe_peers(&self, blake3: &str, peers: &[String]) -> Result<String, SnatchError> {
        if peers.is_empty() {
            return Err(SnatchError::NoPeers);
        }

        let mut probes = FuturesUnordered::new();
        for peer in peers {
            let peer = peer.clone();
            probes.push(async move {
                let result = self.transport.probe(&peer, blake3).await;
                (peer, result)
            });
        }

        let race = async {
            while let Some((peer, result)) = probes.next().await {
                match result {
                    Ok(true) => return Some(peer),
                    Ok(false) => {}
                    Err(e) => {
                        tracing::debug!(peer = trunc(&peer), error = %e, "probe failed");
                    }
                }
            }
            None
        };

        match tokio::time::timeout(self.options.probe_timeout, race).await {
            Ok(Some(peer)) => Ok(peer),
            Ok(None) => Err(SnatchError::NoPeerHasBlob),
            Err(_) => Err(SnatchError::ProbeTimeout),
        }
    }

    /// get or create a per-peer download semaphore, capped at
    /// `max_per_peer_downloads`.
    async fn peer_semaphore(&self, peer_id: &str) -> Arc<Semaphore> {
        let mut map = self.peer_semaphores.lock().await;
        Arc::clone(
            map.entry(peer_id.to_string())
                .or_insert_with(|| Arc::new(Semaphore::new(self.options.max_per_peer_downloads))),
        )
    }

    /// download a blob via iroh-blobs verified transfer and export it
    /// straight to `blobz`'s canonical content-addressed path (no full
    /// in-memory buffer, regardless of blob size).
    async fn download_blob(
        &self,
        blake3_hash: &str,
        provider_node_id: &str,
    ) -> Result<(), SnatchError> {
        // check first: no live endpoint means no point parsing the hash or
        // reserving a semaphore slot.
        let downloader = self
            .downloader
            .read()
            .unwrap()
            .clone()
            .ok_or(SnatchError::NoDownloader)?;

        let hash: Hash = blake3_hash
            .parse()
            .map_err(|e| SnatchError::InvalidHash(format!("{e}")))?;
        let node_id: iroh::EndpointId = provider_node_id
            .parse()
            .map_err(|e| SnatchError::InvalidNodeId(format!("{e}")))?;
        let hash_and_format = HashAndFormat::raw(hash);

        // in-flight before anything else, released on every exit path
        // (success, error, or the guard simply dropping at function end) -
        // shared with `crate::node`'s gc-protect callback so this hash is
        // never swept mid-download.
        let _in_flight_guard = InFlightGuard::new(Arc::clone(&self.in_flight), hash);

        let semaphore = self.peer_semaphore(provider_node_id).await;
        let _permit = semaphore
            .acquire()
            .await
            .map_err(|_| SnatchError::DownloadFailed("peer semaphore closed".into()))?;

        let progress = downloader.download(hash_and_format, [node_id]);
        let stream = progress
            .stream()
            .await
            .map_err(|e| SnatchError::DownloadFailed(format!("stream: {e}")))?;
        consume_download_progress(
            stream,
            self.options.download_inactivity_timeout,
            blake3_hash,
        )
        .await?;

        let target = self
            .blobz
            .prepare_canonical_path(blake3_hash)
            .await
            .map_err(|e| SnatchError::DownloadFailed(format!("prepare blobz path: {e}")))?;
        // TryReference renames the fs store's data file to the blobz
        // canonical path (same filesystem => no copy; EXDEV falls back to
        // copy). the fs store then tracks it as External and keeps serving
        // it for p2p.
        self.fs_store
            .blobs()
            .export_with_opts(ExportOptions {
                hash,
                mode: ExportMode::TryReference,
                target: target.clone(),
            })
            .await
            .map_err(|e| SnatchError::DownloadFailed(format!("export to blobz path: {e}")))?;

        Ok(())
    }

    /// register blob metadata in `blobz`. the bytes must already be at the
    /// canonical path (written by `download_blob` via
    /// `prepare_canonical_path` + the fs store export above); no re-hashing
    /// or full buffer needed.
    async fn ingest_blob(&self, descriptor: &BlobDescriptor) -> Result<(), SnatchError> {
        let meta = NewBlobMeta {
            filename: if descriptor.filename.is_empty() {
                None
            } else {
                Some(descriptor.filename.clone())
            },
            mime: Some(if descriptor.mime.is_empty() {
                "application/octet-stream".to_string()
            } else {
                descriptor.mime.clone()
            }),
            ..Default::default()
        };
        self.blobz
            .register_ingested(&descriptor.blake3, meta)
            .await
            .map_err(|e| SnatchError::Ingest(e.to_string()))?;
        Ok(())
    }

    /// whether a blob already exists locally, including soft-deleted rows -
    /// `get_any` (not `get`) so a soft-deleted blob is treated as present
    /// and never re-downloaded, which would resurrect it.
    async fn check_blob_exists(&self, blake3: &str) -> bool {
        if blake3.is_empty() {
            return false;
        }
        matches!(self.blobz.get_any(blake3).await, Ok(Some(_)))
    }
}

// ---------------------------------------------------------------------------
// free functions
// ---------------------------------------------------------------------------

/// truncate a string for logging (first 16 chars).
fn trunc(s: &str) -> &str {
    if s.len() > 16 {
        &s[..16]
    } else {
        s
    }
}

/// consume an iroh-blobs download progress stream, erroring out if the
/// transfer reports an error or if too long a gap passes between events.
/// generic over the stream so it can be driven by a synthetic stream in
/// tests, not just a real `DownloadProgress::stream()`.
async fn consume_download_progress<St>(
    mut stream: St,
    inactivity_timeout: Duration,
    blake3_label: &str,
) -> Result<(), SnatchError>
where
    St: Stream<Item = DownloadProgressItem> + Unpin,
{
    let mut had_error = false;
    let mut last_error: Option<String> = None;
    let mut event_count: u32 = 0;

    loop {
        let maybe_event = tokio::time::timeout(inactivity_timeout, stream.next())
            .await
            .map_err(|_| SnatchError::DownloadTimeout)?;
        let event = match maybe_event {
            Some(e) => e,
            None => break,
        };
        event_count += 1;
        match &event {
            DownloadProgressItem::Error(e) => {
                had_error = true;
                last_error = Some(format!("{e:?}"));
                tracing::warn!(
                    blake3 = trunc(blake3_label),
                    error = ?e,
                    event_index = event_count,
                    "download progress: error event"
                );
            }
            DownloadProgressItem::DownloadError => {
                had_error = true;
                last_error = Some("download error".to_string());
                tracing::warn!(
                    blake3 = trunc(blake3_label),
                    event_index = event_count,
                    "download progress: download error event"
                );
            }
            other => {
                tracing::debug!(
                    blake3 = trunc(blake3_label),
                    event = ?other,
                    event_index = event_count,
                    "download progress event"
                );
            }
        }
    }

    if had_error {
        return Err(SnatchError::DownloadFailed(
            last_error.unwrap_or_else(|| "unknown error".to_string()),
        ));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blobz::SqliteBlobStore;
    use std::sync::atomic::AtomicUsize as TestAtomicUsize;

    // -- mock BlobRefSource ---------------------------------------------

    #[derive(Clone)]
    struct MockSource(Arc<MockSourceState>);

    struct MockSourceState {
        docs: StdMutex<HashMap<String, Vec<BlobDescriptor>>>,
        extract_calls: TestAtomicUsize,
        on_snatched_calls: StdMutex<Vec<String>>,
        changes: broadcast::Sender<String>,
    }

    impl MockSource {
        fn new() -> Self {
            let (changes, _rx) = broadcast::channel(16);
            Self(Arc::new(MockSourceState {
                docs: StdMutex::new(HashMap::new()),
                extract_calls: TestAtomicUsize::new(0),
                on_snatched_calls: StdMutex::new(Vec::new()),
                changes,
            }))
        }

        fn set_doc(&self, doc_id: &str, descriptors: Vec<BlobDescriptor>) {
            self.0
                .docs
                .lock()
                .unwrap()
                .insert(doc_id.to_string(), descriptors);
        }

        fn push_change(&self, doc_id: &str) {
            let _ = self.0.changes.send(doc_id.to_string());
        }

        fn extract_call_count(&self) -> usize {
            self.0.extract_calls.load(Ordering::Relaxed)
        }

        fn on_snatched_calls(&self) -> Vec<String> {
            self.0.on_snatched_calls.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl BlobRefSource for MockSource {
        async fn all_doc_ids(&self) -> Vec<String> {
            self.0.docs.lock().unwrap().keys().cloned().collect()
        }

        fn subscribe_changes(&self) -> broadcast::Receiver<String> {
            self.0.changes.subscribe()
        }

        async fn extract_from_doc(&self, doc_id: &str) -> Vec<BlobDescriptor> {
            self.0.extract_calls.fetch_add(1, Ordering::Relaxed);
            self.0
                .docs
                .lock()
                .unwrap()
                .get(doc_id)
                .cloned()
                .unwrap_or_default()
        }

        async fn on_snatched(&self, descriptor: &BlobDescriptor, local_node_id: &str) {
            self.0
                .on_snatched_calls
                .lock()
                .unwrap()
                .push(format!("{}:{}", descriptor.blake3, local_node_id));
        }
    }

    // -- mock PeerProbeTransport ------------------------------------------

    #[derive(Clone, Copy)]
    enum ProbeOutcome {
        Available,
        Unavailable,
        Err,
    }

    #[derive(Clone)]
    struct MockTransport(Arc<MockTransportState>);

    struct MockTransportState {
        outcomes: StdMutex<HashMap<String, ProbeOutcome>>,
        delays: StdMutex<HashMap<String, Duration>>,
        calls: StdMutex<Vec<String>>,
    }

    impl MockTransport {
        fn new() -> Self {
            Self(Arc::new(MockTransportState {
                outcomes: StdMutex::new(HashMap::new()),
                delays: StdMutex::new(HashMap::new()),
                calls: StdMutex::new(Vec::new()),
            }))
        }

        fn set(&self, peer: &str, outcome: ProbeOutcome) {
            self.0
                .outcomes
                .lock()
                .unwrap()
                .insert(peer.to_string(), outcome);
        }

        fn set_delay(&self, peer: &str, delay: Duration) {
            self.0
                .delays
                .lock()
                .unwrap()
                .insert(peer.to_string(), delay);
        }

        fn call_count(&self) -> usize {
            self.0.calls.lock().unwrap().len()
        }

        fn calls(&self) -> Vec<String> {
            self.0.calls.lock().unwrap().clone()
        }
    }

    #[async_trait]
    impl PeerProbeTransport for MockTransport {
        async fn probe(&self, peer_node_id: &str, _blake3: &str) -> Result<bool, ProbeError> {
            self.0.calls.lock().unwrap().push(peer_node_id.to_string());
            let delay = self.0.delays.lock().unwrap().get(peer_node_id).copied();
            if let Some(delay) = delay {
                tokio::time::sleep(delay).await;
            }
            let outcome = self
                .0
                .outcomes
                .lock()
                .unwrap()
                .get(peer_node_id)
                .copied()
                .unwrap_or(ProbeOutcome::Unavailable);
            match outcome {
                ProbeOutcome::Available => Ok(true),
                ProbeOutcome::Unavailable => Ok(false),
                ProbeOutcome::Err => Err(ProbeError::Connection("mock failure".into())),
            }
        }
    }

    /// a transport that panics if probed at all - used to prove dedup skips
    /// probing entirely for blobs the store already has.
    struct PanicIfProbedTransport;

    #[async_trait]
    impl PeerProbeTransport for PanicIfProbedTransport {
        async fn probe(&self, peer_node_id: &str, blake3: &str) -> Result<bool, ProbeError> {
            panic!("probe should never be called for an already-present blob (peer={peer_node_id}, blake3={blake3})");
        }
    }

    // -- test fixtures -----------------------------------------------------

    async fn test_endpoint() -> iroh::Endpoint {
        iroh::Endpoint::builder(iroh::endpoint::presets::Minimal)
            .relay_mode(iroh::RelayMode::Disabled)
            .bind()
            .await
            .expect("bind test endpoint")
    }

    struct EngineDeps {
        blobz: Arc<dyn BlobStore>,
        downloader: Arc<RwLock<Option<Downloader>>>,
        fs_store: &'static FsStore,
        endpoint: iroh::Endpoint,
    }

    async fn engine_deps(data_dir: &std::path::Path) -> EngineDeps {
        let pool = crate::db::open_in_memory().await;
        let blobz: Arc<dyn BlobStore> = Arc::new(SqliteBlobStore::new(pool, data_dir));

        let fs_dir = data_dir.join("iroh-blobs");
        tokio::fs::create_dir_all(&fs_dir).await.unwrap();
        let fs_store: &'static FsStore = Box::leak(Box::new(
            FsStore::load(fs_dir.join("blobs.db")).await.unwrap(),
        ));

        let endpoint = test_endpoint().await;
        let downloader = Downloader::new(fs_store, &endpoint);

        EngineDeps {
            blobz,
            downloader: Arc::new(RwLock::new(Some(downloader))),
            fs_store,
            endpoint,
        }
    }

    fn descriptor(blake3: &str, candidate_peers: &[&str]) -> BlobDescriptor {
        BlobDescriptor {
            blake3: blake3.to_string(),
            filename: "test.txt".to_string(),
            mime: "text/plain".to_string(),
            size: 42,
            candidate_peers: candidate_peers.iter().map(|s| s.to_string()).collect(),
            source_ref: "doc-1".to_string(),
        }
    }

    fn short_options() -> SnatchEngineOptions {
        SnatchEngineOptions {
            max_concurrent_snatches: 20,
            max_per_peer_downloads: 4,
            probe_timeout: Duration::from_millis(200),
            download_inactivity_timeout: Duration::from_millis(200),
            debounce: Duration::from_millis(30),
        }
    }

    // -- soft-delete dedup ---------------------------------------------

    #[tokio::test]
    async fn soft_deleted_blob_is_never_reprobed_or_resnatched() {
        let tmp = tempfile::tempdir().unwrap();
        let deps = engine_deps(tmp.path()).await;
        let record = deps
            .blobz
            .insert(b"already have this", NewBlobMeta::default())
            .await
            .unwrap();
        deps.blobz
            .soft_delete(std::slice::from_ref(&record.blake3), "tester")
            .await
            .unwrap();

        let source = MockSource::new();
        source.set_doc("doc-1", vec![descriptor(&record.blake3, &["peer-b"])]);
        let transport = PanicIfProbedTransport;

        let engine = SnatchEngine::new(
            deps.blobz,
            deps.downloader,
            deps.fs_store,
            Arc::new(StdMutex::new(HashSet::new())),
            "local-node",
            source.clone(),
            transport,
            short_options(),
        );

        let snatched = engine.scan_and_snatch().await;
        assert_eq!(snatched, 0);
        assert!(source.on_snatched_calls().is_empty());

        deps.endpoint.close().await;
    }

    #[tokio::test]
    async fn already_present_blob_is_skipped_without_probing() {
        let tmp = tempfile::tempdir().unwrap();
        let deps = engine_deps(tmp.path()).await;
        let record = deps
            .blobz
            .insert(b"present already", NewBlobMeta::default())
            .await
            .unwrap();

        let source = MockSource::new();
        source.set_doc("doc-1", vec![descriptor(&record.blake3, &["peer-b"])]);
        let transport = PanicIfProbedTransport;

        let engine = SnatchEngine::new(
            deps.blobz,
            deps.downloader,
            deps.fs_store,
            Arc::new(StdMutex::new(HashSet::new())),
            "local-node",
            source,
            transport,
            short_options(),
        );

        assert_eq!(engine.scan_and_snatch().await, 0);
        deps.endpoint.close().await;
    }

    // -- probe-then-download ordering (mock transport only, no real transfer) --

    #[tokio::test]
    async fn probe_returns_first_peer_that_confirms_availability() {
        let tmp = tempfile::tempdir().unwrap();
        let deps = engine_deps(tmp.path()).await;

        let source = MockSource::new();
        let transport = MockTransport::new();
        transport.set("peer-a", ProbeOutcome::Unavailable);
        transport.set("peer-b", ProbeOutcome::Available);
        // peer-b resolves slightly slower, proving the engine doesn't just
        // take the first entry in the candidate list.
        transport.set_delay("peer-b", Duration::from_millis(20));

        let engine = SnatchEngine::new(
            deps.blobz,
            deps.downloader,
            deps.fs_store,
            Arc::new(StdMutex::new(HashSet::new())),
            "local-node",
            source,
            transport.clone(),
            short_options(),
        );

        let peers = vec!["peer-a".to_string(), "peer-b".to_string()];
        let provider = engine.probe_peers("some-blake3", &peers).await.unwrap();
        assert_eq!(provider, "peer-b");
        assert_eq!(transport.call_count(), 2);

        deps.endpoint.close().await;
    }

    #[tokio::test]
    async fn probe_timeout_fires_when_no_peer_responds_in_time() {
        let tmp = tempfile::tempdir().unwrap();
        let deps = engine_deps(tmp.path()).await;

        let source = MockSource::new();
        let transport = MockTransport::new();
        transport.set("peer-a", ProbeOutcome::Available);
        transport.set_delay("peer-a", Duration::from_secs(5));

        let mut options = short_options();
        options.probe_timeout = Duration::from_millis(20);

        let engine = SnatchEngine::new(
            deps.blobz,
            deps.downloader,
            deps.fs_store,
            Arc::new(StdMutex::new(HashSet::new())),
            "local-node",
            source,
            transport,
            options,
        );

        let peers = vec!["peer-a".to_string()];
        let result = engine.probe_peers("some-blake3", &peers).await;
        assert!(matches!(result, Err(SnatchError::ProbeTimeout)));

        deps.endpoint.close().await;
    }

    #[tokio::test]
    async fn no_peer_has_the_blob_yields_no_peer_has_blob_error() {
        let tmp = tempfile::tempdir().unwrap();
        let deps = engine_deps(tmp.path()).await;

        let source = MockSource::new();
        source.set_doc("doc-1", vec![descriptor("deadbeef", &["peer-a", "peer-b"])]);
        let transport = MockTransport::new();
        transport.set("peer-a", ProbeOutcome::Unavailable);
        transport.set("peer-b", ProbeOutcome::Err);

        let engine = SnatchEngine::new(
            deps.blobz,
            deps.downloader,
            deps.fs_store,
            Arc::new(StdMutex::new(HashSet::new())),
            "local-node",
            source.clone(),
            transport.clone(),
            short_options(),
        );

        // full-path wiring proof (source -> target peers -> probe -> no
        // download attempted) without any real network transfer.
        assert_eq!(engine.scan_and_snatch().await, 0);
        assert!(source.on_snatched_calls().is_empty());
        assert_eq!(transport.calls().len(), 2);

        deps.endpoint.close().await;
    }

    // -- peer blob inventory fallback -------------------------------------

    #[tokio::test]
    async fn peer_blob_inventory_fallback_used_when_no_candidate_peers() {
        let tmp = tempfile::tempdir().unwrap();
        let deps = engine_deps(tmp.path()).await;

        let source = MockSource::new();
        let transport = MockTransport::new();
        transport.set("peer-from-inventory", ProbeOutcome::Unavailable);

        let engine = SnatchEngine::new(
            deps.blobz,
            deps.downloader,
            deps.fs_store,
            Arc::new(StdMutex::new(HashSet::new())),
            "local-node",
            source,
            transport.clone(),
            short_options(),
        );

        // no candidate_peers on the descriptor - engine must fall back to
        // the externally-fed inventory, not skip probing entirely.
        engine.offer_peer_blobs("peer-from-inventory", ["some-blake3".to_string()]);
        let d = descriptor("some-blake3", &[]);
        let target_peers = engine.target_peers_for(&d);
        assert_eq!(target_peers, vec!["peer-from-inventory".to_string()]);

        let result = engine.snatch_descriptor(&d).await;
        assert!(matches!(result, Err(SnatchError::NoPeerHasBlob)));
        assert_eq!(transport.calls(), vec!["peer-from-inventory".to_string()]);

        deps.endpoint.close().await;
    }

    #[tokio::test]
    async fn no_candidates_and_empty_inventory_yields_no_peers_error() {
        let tmp = tempfile::tempdir().unwrap();
        let deps = engine_deps(tmp.path()).await;

        let source = MockSource::new();
        let transport = MockTransport::new();

        let engine = SnatchEngine::new(
            deps.blobz,
            deps.downloader,
            deps.fs_store,
            Arc::new(StdMutex::new(HashSet::new())),
            "local-node",
            source,
            transport.clone(),
            short_options(),
        );

        let d = descriptor("some-blake3", &[]);
        let result = engine.snatch_descriptor(&d).await;
        assert!(matches!(result, Err(SnatchError::NoPeers)));
        assert_eq!(transport.call_count(), 0);

        deps.endpoint.close().await;
    }

    // -- no downloader attached ---------------------------------------------

    #[tokio::test]
    async fn snatch_without_an_attached_downloader_surfaces_no_downloader_error() {
        let tmp = tempfile::tempdir().unwrap();
        let deps = engine_deps(tmp.path()).await;
        // simulate the owning StorageNode's endpoint having been detached
        // (e.g. the user stopped it) after this engine was constructed.
        *deps.downloader.write().unwrap() = None;

        let source = MockSource::new();
        let transport = MockTransport::new();
        transport.set("peer-a", ProbeOutcome::Available);

        let engine = SnatchEngine::new(
            deps.blobz,
            deps.downloader,
            deps.fs_store,
            Arc::new(StdMutex::new(HashSet::new())),
            "local-node",
            source,
            transport,
            short_options(),
        );

        let d = descriptor(
            "0000000000000000000000000000000000000000000000000000000000000000",
            &["peer-a"],
        );
        let result = engine.snatch_descriptor(&d).await;
        assert!(
            matches!(result, Err(SnatchError::NoDownloader)),
            "expected NoDownloader, got {result:?}"
        );

        deps.endpoint.close().await;
    }

    // -- per-peer semaphore -------------------------------------------------

    #[tokio::test]
    async fn per_peer_semaphore_is_shared_across_calls_and_capped() {
        let tmp = tempfile::tempdir().unwrap();
        let deps = engine_deps(tmp.path()).await;

        let source = MockSource::new();
        let transport = MockTransport::new();
        let engine = SnatchEngine::new(
            deps.blobz,
            deps.downloader,
            deps.fs_store,
            Arc::new(StdMutex::new(HashSet::new())),
            "local-node",
            source,
            transport,
            short_options(),
        );

        let sem_a1 = engine.peer_semaphore("peer-x").await;
        let sem_a2 = engine.peer_semaphore("peer-x").await;
        assert!(
            Arc::ptr_eq(&sem_a1, &sem_a2),
            "same peer must reuse the same semaphore"
        );
        assert_eq!(sem_a1.available_permits(), 4);

        let sem_b = engine.peer_semaphore("peer-y").await;
        assert!(
            !Arc::ptr_eq(&sem_a1, &sem_b),
            "different peers get independent semaphores"
        );

        // cap: 4 permits max_per_peer_downloads - a 5th must not be
        // immediately available.
        let mut permits = Vec::new();
        for _ in 0..4 {
            permits.push(
                sem_a1
                    .clone()
                    .try_acquire_owned()
                    .expect("permit within cap"),
            );
        }
        assert!(
            sem_a1.clone().try_acquire_owned().is_err(),
            "5th concurrent download must be blocked"
        );

        drop(permits);
        assert!(
            sem_a1.clone().try_acquire_owned().is_ok(),
            "releasing a permit frees a slot"
        );

        deps.endpoint.close().await;
    }

    // -- in-flight tracking shared with node's gc-protect -------------------

    #[tokio::test]
    async fn in_flight_set_is_shared_with_the_caller_for_gc_protection() {
        let tmp = tempfile::tempdir().unwrap();
        let deps = engine_deps(tmp.path()).await;

        // the caller (production: StorageNode::init) constructs this Arc
        // and shares it with both the gc protect callback and the engine.
        let in_flight = Arc::new(StdMutex::new(HashSet::new()));

        let source = MockSource::new();
        let transport = MockTransport::new();
        let _engine = SnatchEngine::new(
            deps.blobz,
            deps.downloader,
            deps.fs_store,
            Arc::clone(&in_flight),
            "local-node",
            source,
            transport,
            short_options(),
        );

        let hash = Hash::new(b"some content");
        {
            let _guard = InFlightGuard::new(Arc::clone(&in_flight), hash);
            assert!(in_flight.lock().unwrap().contains(&hash));
        }
        assert!(!in_flight.lock().unwrap().contains(&hash));

        deps.endpoint.close().await;
    }

    // -- debounce ------------------------------------------------------

    #[tokio::test]
    async fn rapid_doc_changes_are_debounced_into_one_extraction_pass() {
        let tmp = tempfile::tempdir().unwrap();
        let deps = engine_deps(tmp.path()).await;

        let source = MockSource::new();
        source.set_doc("doc-1", vec![]);
        let transport = MockTransport::new();

        let mut options = short_options();
        options.debounce = Duration::from_millis(40);

        let engine = Arc::new(SnatchEngine::new(
            deps.blobz,
            deps.downloader,
            deps.fs_store,
            Arc::new(StdMutex::new(HashSet::new())),
            "local-node",
            source.clone(),
            transport,
            options,
        ));

        let cancel = CancellationToken::new();
        let run_engine = Arc::clone(&engine);
        let run_cancel = cancel.clone();
        let handle = tokio::spawn(async move { run_engine.run(run_cancel).await });

        // give the boot-time scan_and_snatch a moment to complete (doc-1 is
        // already present, so all_doc_ids sees it immediately).
        tokio::time::sleep(Duration::from_millis(20)).await;
        let after_boot = source.extract_call_count();

        // three rapid changes to the same doc id must coalesce into one
        // additional extraction pass, not three.
        source.push_change("doc-1");
        source.push_change("doc-1");
        source.push_change("doc-1");
        tokio::time::sleep(Duration::from_millis(120)).await;

        cancel.cancel();
        handle.await.unwrap();

        assert_eq!(source.extract_call_count(), after_boot + 1);

        deps.endpoint.close().await;
    }

    // -- download inactivity timeout (pure, no iroh at all) -----------------

    #[tokio::test]
    async fn consume_download_progress_times_out_on_stall() {
        let stream = Box::pin(futures::stream::unfold(0u32, |state| async move {
            if state == 0 {
                Some((DownloadProgressItem::Progress(1), 1))
            } else {
                std::future::pending::<()>().await;
                unreachable!()
            }
        }));
        let result = consume_download_progress(stream, Duration::from_millis(30), "deadbeef").await;
        assert!(matches!(result, Err(SnatchError::DownloadTimeout)));
    }

    #[tokio::test]
    async fn consume_download_progress_tolerates_gaps_shorter_than_the_timeout() {
        // 4 events, 30ms apart (120ms total) - longer than the 100ms
        // inactivity timeout as a *whole*, but every individual gap stays
        // under it. proves the timeout resets per event, not a
        // whole-transfer wall-clock budget.
        let stream = Box::pin(futures::stream::unfold(4u32, |remaining| async move {
            if remaining == 0 {
                None
            } else {
                tokio::time::sleep(Duration::from_millis(30)).await;
                Some((
                    DownloadProgressItem::Progress(remaining as u64),
                    remaining - 1,
                ))
            }
        }));
        let result =
            consume_download_progress(stream, Duration::from_millis(100), "deadbeef").await;
        assert!(
            result.is_ok(),
            "gaps under the inactivity timeout must not fail the transfer"
        );
    }

    #[tokio::test]
    async fn consume_download_progress_surfaces_download_error_events() {
        let stream = futures::stream::iter(vec![
            DownloadProgressItem::Progress(1),
            DownloadProgressItem::DownloadError,
        ]);
        let result =
            consume_download_progress(stream, Duration::from_millis(200), "deadbeef").await;
        assert!(matches!(result, Err(SnatchError::DownloadFailed(_))));
    }

    // -- misc ------------------------------------------------------------

    #[test]
    fn snatch_error_display() {
        assert_eq!(SnatchError::NoBlake3.to_string(), "blob has no blake3 hash");
        assert_eq!(
            SnatchError::NoPeers.to_string(),
            "no candidate peers to probe"
        );
        assert_eq!(
            SnatchError::DownloadFailed("timeout".to_string()).to_string(),
            "download failed: timeout"
        );
    }

    #[test]
    fn trunc_truncates_long_strings_only() {
        assert_eq!(trunc("abcdefghijklmnopqrstuvwxyz"), "abcdefghijklmnop");
        assert_eq!(trunc("short"), "short");
        assert_eq!(trunc(""), "");
    }
}
