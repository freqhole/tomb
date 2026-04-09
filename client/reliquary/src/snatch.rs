//! blob snatching — watches automerge docs for file widgets, fetches blobs from peers.
//!
//! the snatcher scans ALL automerge documents in the hub repo for file widgets
//! that reference blobs the hub doesn't have locally. docs without a `widgets`
//! map are skipped cheaply. for each missing blob, it probes canvas peers via
//! `ensure_blob_request` over `freqhole/1`, downloads the blob via iroh-blobs
//! verified transfer, and ingests it into grimoire's `media_blobz` + `blob_data`
//! storage.
//!
//! scanning is triggered reactively via doc change notifications from hub_repo
//! (debounced 3s). no periodic timer — the snatcher only runs when docs change.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use futures::stream::{self, StreamExt};
use iroh::Endpoint;
use iroh_blobs::api::downloader::Downloader;
use iroh_blobs::{Hash, HashAndFormat};
use tokio::sync::{Mutex, Semaphore};

use crate::freqhole::{PeerMessage, FREQHOLE_ALPN};

/// timeout for a single ensure_blob probe to a peer (seconds).
const PROBE_TIMEOUT_SECS: u64 = 15;

/// timeout for a blob download via iroh-blobs (seconds).
const DOWNLOAD_TIMEOUT_SECS: u64 = 120;

/// max concurrent snatch operations (probe + download + ingest).
const MAX_CONCURRENT_SNATCHES: usize = 20;

/// max concurrent downloads from a single peer.
const MAX_PER_PEER_DOWNLOADS: usize = 4;

// ---------------------------------------------------------------------------
// blob reference — extracted from file widget state docs
// ---------------------------------------------------------------------------

/// a reference to a blob discovered in a canvas file widget.
#[derive(Debug, Clone)]
pub struct BlobRef {
    /// the canvas doc ID this widget belongs to.
    pub canvas_doc_id: String,
    /// the automerge doc ID of the file widget state.
    pub widget_doc_id: String,
    /// media blob ID (usually sha256) from the widget state.
    pub blob_id: String,
    /// blake3 content hash for verified download.
    pub blake3: String,
    /// original filename.
    pub filename: String,
    /// MIME type.
    pub mime: String,
    /// file size in bytes.
    pub size: u64,
    /// node IDs that have snatched this blob (from widget state doc).
    pub snatched_by: Vec<String>,
}

// ---------------------------------------------------------------------------
// blob snatcher
// ---------------------------------------------------------------------------

/// scans automerge docs for file widget blob references and fetches missing blobs.
///
/// instead of relying on a curated "tracked canvases" set, the snatcher scans
/// ALL docs in the hub repo. docs without a `widgets` map are skipped cheaply.
/// it also subscribes to doc change notifications for near-instant snatching
/// when new file attachments arrive via automerge sync.
///
/// downloads are parallelized: up to `MAX_CONCURRENT_SNATCHES` (20) blobs at
/// once, with a per-peer limit of `MAX_PER_PEER_DOWNLOADS` (4) to avoid
/// hammering any single peer.
pub struct BlobSnatcher {
    /// hub repo for reading automerge docs.
    repo: crate::hub_repo::HubRepo,
    /// iroh endpoint for connecting to peers.
    endpoint: Endpoint,
    /// iroh-blobs downloader for verified transfers.
    downloader: Downloader,
    /// hub's own node ID string (to exclude from peer lists).
    local_node_id: String,
    /// notify handle used to trigger an immediate scan from outside the loop.
    scan_trigger: Arc<tokio::sync::Notify>,
    /// per-peer download semaphores (limit concurrent downloads to a single peer).
    peer_semaphores: Arc<Mutex<HashMap<String, Arc<Semaphore>>>>,
    /// peer blob inventory — maps peer node ID → set of blake3 hashes they have.
    /// populated by BlobOffer responses via the hub service. used as fallback
    /// when snatchedBy is empty for a blob.
    peer_blob_inventory: Arc<Mutex<HashMap<String, HashSet<String>>>>,
}

impl BlobSnatcher {
    /// create a new blob snatcher.
    pub fn new(
        repo: crate::hub_repo::HubRepo,
        endpoint: Endpoint,
        downloader: Downloader,
        local_node_id: String,
        scan_trigger: Arc<tokio::sync::Notify>,
        peer_blob_inventory: Arc<Mutex<HashMap<String, HashSet<String>>>>,
    ) -> Self {
        Self {
            repo,
            endpoint,
            downloader,
            local_node_id,
            scan_trigger,
            peer_semaphores: Arc::new(Mutex::new(HashMap::new())),
            peer_blob_inventory,
        }
    }

    /// return a clone of the scan trigger handle so callers can wake the loop.
    pub fn scan_trigger(&self) -> Arc<tokio::sync::Notify> {
        Arc::clone(&self.scan_trigger)
    }

    /// get or create a per-peer download semaphore (capped at MAX_PER_PEER_DOWNLOADS).
    async fn peer_semaphore(&self, peer_id: &str) -> Arc<Semaphore> {
        let mut map = self.peer_semaphores.lock().await;
        map.entry(peer_id.to_string())
            .or_insert_with(|| Arc::new(Semaphore::new(MAX_PER_PEER_DOWNLOADS)))
            .clone()
    }

    /// run the scan loop until the token is cancelled.
    ///
    /// only wakes when doc changes trigger a scan (via `scan_trigger.notified()`).
    /// no periodic timer — if you need a full rescan, use the CLI command or
    /// trigger it manually via the notify handle.
    pub async fn run_scan_loop(&self, cancel: tokio_util::sync::CancellationToken) {
        tracing::info!("blob snatcher scan loop started (reactive only, no periodic timer)");

        loop {
            // wait for a doc-change trigger or cancellation — no timer
            tokio::select! {
                _ = cancel.cancelled() => {
                    tracing::info!("blob snatcher scan loop shutting down");
                    break;
                }
                _ = self.scan_trigger.notified() => {
                    tracing::info!("doc-change blob snatch scan triggered");
                }
            }

            // run the scan itself with cancel awareness — if ctrl+c fires
            // mid-scan (e.g. during a 15s probe or 120s download), we bail
            // immediately instead of blocking shutdown
            tokio::select! {
                _ = cancel.cancelled() => {
                    tracing::info!("blob snatcher scan loop shutting down");
                    break;
                }
                count = self.scan_and_snatch() => {
                    if count > 0 {
                        tracing::info!(snatched = count, "blob snatch cycle completed");
                    }
                }
            }
        }
    }

    /// scan all docs for missing blobs and snatch them concurrently.
    ///
    /// iterates every automerge doc in the hub repo, reads each to find file
    /// widgets, reads each file widget's state doc to extract blob references,
    /// checks grimoire for local availability, and snatches any missing blobs
    /// from canvas peers.
    ///
    /// downloads run concurrently (up to MAX_CONCURRENT_SNATCHES) with
    /// per-peer download limits (MAX_PER_PEER_DOWNLOADS).
    ///
    /// returns the number of blobs successfully snatched.
    pub async fn scan_and_snatch(&self) -> usize {
        let doc_ids = self.repo.all_doc_ids().await;

        tracing::debug!(
            doc_count = doc_ids.len(),
            "blob snatcher: starting scan cycle (scanning all docs)"
        );

        if doc_ids.is_empty() {
            return 0;
        }

        let mut all_refs = Vec::new();
        let mut all_peers: Vec<String> = Vec::new();

        for doc_id in &doc_ids {
            let (refs, peers) = self.scan_canvas_resolved(doc_id).await;
            all_refs.extend(refs);
            for p in peers {
                if !all_peers.contains(&p) {
                    all_peers.push(p);
                }
            }
        }

        if all_refs.is_empty() {
            return 0;
        }

        tracing::info!(
            missing = all_refs.len(),
            peers = all_peers.len(),
            max_concurrent = MAX_CONCURRENT_SNATCHES,
            per_peer_limit = MAX_PER_PEER_DOWNLOADS,
            "found missing blobs, starting parallel snatch"
        );

        let snatched = AtomicUsize::new(0);

        stream::iter(all_refs.iter())
            .for_each_concurrent(Some(MAX_CONCURRENT_SNATCHES), |blob_ref| {
                let snatched = &snatched;
                let all_peers = &all_peers;
                async move {
                    match self.snatch_blob(blob_ref, all_peers).await {
                        Ok(()) => {
                            snatched.fetch_add(1, Ordering::Relaxed);
                            tracing::info!(
                                blake3 = trunc(&blob_ref.blake3),
                                filename = %blob_ref.filename,
                                "blob snatched successfully"
                            );
                        }
                        Err(e) => {
                            tracing::warn!(
                                blake3 = trunc(&blob_ref.blake3),
                                filename = %blob_ref.filename,
                                error = %e,
                                "failed to snatch blob"
                            );
                        }
                    }
                }
            })
            .await;

        snatched.load(Ordering::Relaxed)
    }

    /// scan a canvas and resolve file widget state docs into full BlobRefs.
    ///
    /// handles the two-level doc read:
    /// 1. read canvas doc -> find file widgets -> get their docIds
    /// 2. for each docId, find/read the widget state doc -> extract blob refs
    /// 3. filter out blobs we already have in grimoire
    async fn scan_canvas_resolved(&self, canvas_doc_id: &str) -> (Vec<BlobRef>, Vec<String>) {
        let (placeholder_refs, peers) = self.scan_canvas_for_widgets(canvas_doc_id).await;

        if placeholder_refs.is_empty() {
            return (Vec::new(), peers);
        }

        let mut resolved_refs = Vec::new();

        for placeholder in &placeholder_refs {
            let widget_doc_id_str = &placeholder.widget_doc_id;

            // find the widget state doc in the repo
            let whandle = match self.repo.find(widget_doc_id_str).await {
                Some(h) => h,
                None => {
                    tracing::info!(
                        widget_doc_id = widget_doc_id_str,
                        "widget state doc not found in hub repo"
                    );
                    continue;
                }
            };

            // read the widget state doc (blocking — with_document is sync)
            let canvas_id = canvas_doc_id.to_string();
            let wdoc_id = widget_doc_id_str.clone();
            let ref_result = tokio::task::spawn_blocking(move || {
                read_widget_state(&whandle, &canvas_id, &wdoc_id)
            })
            .await;

            match ref_result {
                Ok(Some(blob_ref)) => {
                    // skip if blake3 is empty (can't snatch without it)
                    if blob_ref.blake3.is_empty() {
                        tracing::info!(
                            widget_doc_id = widget_doc_id_str,
                            "widget has no blake3 hash, skipping"
                        );
                        continue;
                    }

                    // check if we already have this blob in grimoire
                    let already_have = check_blob_exists(&blob_ref).await;

                    if !already_have {
                        tracing::info!(
                            blake3 = trunc(&blob_ref.blake3),
                            filename = %blob_ref.filename,
                            "found missing blob in file widget"
                        );
                        resolved_refs.push(blob_ref);
                    }
                }
                Ok(None) => {
                    // widget has no blob reference yet (empty/new widget)
                }
                Err(e) => {
                    tracing::warn!(
                        widget_doc_id = widget_doc_id_str,
                        error = %e,
                        "spawn_blocking failed for widget state read"
                    );
                }
            }
        }

        (resolved_refs, peers)
    }

    /// read a canvas doc to find file widget docIds and peer node IDs.
    ///
    /// returns placeholder BlobRefs (only widget_doc_id populated) plus
    /// the list of peer node IDs from the canvas.
    async fn scan_canvas_for_widgets(&self, canvas_doc_id: &str) -> (Vec<BlobRef>, Vec<String>) {
        // find the canvas doc in the repo
        let handle = match self.repo.find(canvas_doc_id).await {
            Some(h) => h,
            None => {
                tracing::info!(doc_id = canvas_doc_id, "canvas doc not found in hub repo");
                return (Vec::new(), Vec::new());
            }
        };

        // read the canvas doc to find file widgets and peers (sync)
        let local_node_id = self.local_node_id.clone();
        let canvas_doc_id_owned = canvas_doc_id.to_string();

        let result = tokio::task::spawn_blocking(move || {
            read_canvas_for_file_widgets(&handle, &canvas_doc_id_owned, &local_node_id)
        })
        .await;

        match result {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(doc_id = canvas_doc_id, error = %e, "spawn_blocking failed");
                (Vec::new(), Vec::new())
            }
        }
    }

    /// snatch a single blob: probe peers, download, ingest into grimoire.
    async fn snatch_blob(&self, blob_ref: &BlobRef, peers: &[String]) -> Result<(), SnatchError> {
        if blob_ref.blake3.is_empty() {
            return Err(SnatchError::NoBlake3);
        }

        // double-check local availability (may have been snatched by another cycle)
        if check_blob_exists(blob_ref).await {
            tracing::debug!(
                blake3 = trunc(&blob_ref.blake3),
                "blob appeared locally, skipping"
            );
            return Ok(());
        }

        // determine which peers to probe:
        // 1. prefer snatchedBy (peers that confirmed they have this blob)
        // 2. fall back to peer blob inventory (from BlobOffer gossip responses)
        // 3. if neither has info, skip (hub should not blindly probe all peers)
        let target_peers: Vec<String> = if !blob_ref.snatched_by.is_empty() {
            // filter snatchedBy to peers that are also in the canvas peer list
            blob_ref
                .snatched_by
                .iter()
                .filter(|node_id| peers.contains(node_id) && node_id.as_str() != self.local_node_id)
                .cloned()
                .collect()
        } else {
            // no snatchedBy — check peer blob inventory from BlobOffer responses
            let inventory = self.peer_blob_inventory.lock().await;
            let mut from_inventory: Vec<String> = Vec::new();
            for (peer_id, hashes) in inventory.iter() {
                if hashes.contains(&blob_ref.blake3)
                    && peer_id != &self.local_node_id
                    && peers.contains(peer_id)
                {
                    from_inventory.push(peer_id.clone());
                }
            }
            if from_inventory.is_empty() {
                tracing::debug!(
                    blake3 = trunc(&blob_ref.blake3),
                    filename = %blob_ref.filename,
                    "no snatchedBy entries and no peer inventory matches, skipping"
                );
                return Err(SnatchError::NoPeers);
            }
            tracing::info!(
                blake3 = trunc(&blob_ref.blake3),
                peers_from_inventory = from_inventory.len(),
                "using peer blob inventory (no snatchedBy)"
            );
            from_inventory
        };

        if target_peers.is_empty() {
            tracing::debug!(
                blake3 = trunc(&blob_ref.blake3),
                snatched_by_count = blob_ref.snatched_by.len(),
                "target peers empty after filtering, skipping"
            );
            return Err(SnatchError::NoPeers);
        }

        // probe targeted peers to find one that has the blob
        let provider = self.probe_peers(&blob_ref.blake3, &target_peers).await?;

        tracing::info!(
            blake3 = trunc(&blob_ref.blake3),
            provider = trunc(&provider),
            "downloading blob from peer"
        );

        // download via iroh-blobs verified transfer
        let data = self.download_blob(&blob_ref.blake3, &provider).await?;

        tracing::info!(
            blake3 = trunc(&blob_ref.blake3),
            size = data.len(),
            "blob downloaded, ingesting into grimoire"
        );

        // ingest into grimoire
        self.ingest_blob(blob_ref, data).await?;

        // mark ourselves in the widget state doc's snatchedBy list
        self.mark_snatched(&blob_ref.widget_doc_id).await;

        Ok(())
    }

    /// write the hub's node ID into a widget state doc's snatchedBy list.
    async fn mark_snatched(&self, widget_doc_id: &str) {
        let handle = match self.repo.find(widget_doc_id).await {
            Some(h) => h,
            None => {
                tracing::warn!(widget_doc_id, "cannot mark snatched: widget doc not found");
                return;
            }
        };

        let local_id = self.local_node_id.clone();
        let wdoc_id = widget_doc_id.to_string();

        let result = tokio::task::spawn_blocking(move || {
            handle.with_document_mut(|doc| {
                use automerge::ReadDoc;

                // get or create snatchedBy list
                let list_id = match doc.get(automerge::ROOT, "snatchedBy") {
                    Ok(Some((automerge::Value::Object(automerge::ObjType::List), id))) => id,
                    _ => {
                        // create the list via transact
                        match doc.transact::<_, _, automerge::AutomergeError>(|tx| {
                            use automerge::transaction::Transactable;
                            Ok(tx.put_object(
                                automerge::ROOT,
                                "snatchedBy",
                                automerge::ObjType::List,
                            )?)
                        }) {
                            Ok(result) => result.result,
                            Err(e) => {
                                tracing::warn!(error = ?e, "failed to create snatchedBy list");
                                return;
                            }
                        }
                    }
                };

                // check if already in the list
                let len = doc.length(&list_id);
                for i in 0..len {
                    if let Ok(Some((v, _))) = doc.get(&list_id, i as usize) {
                        if v.to_str() == Some(&local_id) {
                            tracing::debug!(widget_doc_id = %wdoc_id, "already in snatchedBy");
                            return;
                        }
                    }
                }

                // append our node ID via transact
                match doc.transact::<_, _, automerge::AutomergeError>(|tx| {
                    use automerge::transaction::Transactable;
                    tx.insert(&list_id, len as usize, local_id.as_str())?;
                    Ok(())
                }) {
                    Ok(_) => {
                        tracing::info!(
                            widget_doc_id = %wdoc_id,
                            node_id = trunc(&local_id),
                            "added self to snatchedBy"
                        );
                    }
                    Err(e) => {
                        tracing::warn!(error = ?e, "failed to add node ID to snatchedBy");
                    }
                }
            });
        })
        .await;

        if let Err(e) = result {
            tracing::warn!(error = %e, "spawn_blocking failed for mark_snatched");
        }
    }

    /// probe peers in parallel to find one that has the blob.
    ///
    /// sends `ensure_blob_request` to each peer over `freqhole/1`.
    /// returns the node ID of the first peer that responds `available: true`.
    async fn probe_peers(
        &self,
        blake3_hash: &str,
        peers: &[String],
    ) -> Result<String, SnatchError> {
        if peers.is_empty() {
            return Err(SnatchError::NoPeers);
        }

        tracing::info!(
            hash = trunc(blake3_hash),
            peer_count = peers.len(),
            "probing peers for blob"
        );

        // probe all peers in parallel, take first success
        let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(1);

        let mut handles = Vec::new();
        for peer_id in peers {
            let endpoint = self.endpoint.clone();
            let blake3 = blake3_hash.to_string();
            let peer = peer_id.clone();
            let tx = tx.clone();

            let handle = tokio::spawn(async move {
                match probe_single_peer(&endpoint, &peer, &blake3).await {
                    Ok(true) => {
                        let _ = tx.send(peer).await;
                    }
                    Ok(false) => {
                        tracing::info!(peer = trunc(&peer), "peer doesn't have blob");
                    }
                    Err(e) => {
                        tracing::debug!(
                            peer = trunc(&peer),
                            error = %e,
                            "probe failed"
                        );
                    }
                }
            });
            handles.push(handle);
        }

        // drop our sender so rx closes when all probes finish
        drop(tx);

        // wait for first available response or all probes to finish
        let result = tokio::time::timeout(Duration::from_secs(PROBE_TIMEOUT_SECS), rx.recv()).await;

        // cancel remaining probes
        for h in handles {
            h.abort();
        }

        match result {
            Ok(Some(peer)) => Ok(peer),
            Ok(None) => Err(SnatchError::NoPeerHasBlob),
            Err(_) => Err(SnatchError::ProbeTimeout),
        }
    }

    /// download a blob via iroh-blobs verified transfer.
    async fn download_blob(
        &self,
        blake3_hash: &str,
        provider_node_id: &str,
    ) -> Result<Vec<u8>, SnatchError> {
        let hash: Hash = blake3_hash
            .parse()
            .map_err(|e| SnatchError::InvalidHash(format!("{e}")))?;

        let node_id: iroh::PublicKey = provider_node_id
            .parse()
            .map_err(|e| SnatchError::InvalidNodeId(format!("{e}")))?;

        let hash_and_format = HashAndFormat::raw(hash);

        // acquire per-peer download semaphore (limits to MAX_PER_PEER_DOWNLOADS per peer)
        let sem = self.peer_semaphore(provider_node_id).await;
        let _permit = sem
            .acquire()
            .await
            .map_err(|_| SnatchError::DownloadFailed("peer semaphore closed".into()))?;

        // start the download
        let progress = self.downloader.download(hash_and_format, [node_id]);

        // consume the progress stream, watching for errors
        let stream_result = tokio::time::timeout(
            Duration::from_secs(DOWNLOAD_TIMEOUT_SECS),
            consume_download_progress(progress, blake3_hash),
        )
        .await
        .map_err(|_| SnatchError::DownloadTimeout)?;

        stream_result?;

        tracing::debug!(
            blake3 = trunc(blake3_hash),
            "download stream completed, reading blob from store"
        );

        // read the downloaded blob from the store
        let fs_store = grimoire::blobz::get_blobs_store()
            .await
            .map_err(|e| SnatchError::StoreRead(format!("failed to get FsStore: {e}")))?;
        let bytes = match fs_store.get_bytes(hash).await {
            Ok(b) => b,
            Err(e) => {
                tracing::error!(
                    blake3 = trunc(blake3_hash),
                    error = %e,
                    error_debug = ?e,
                    hash = %hash,
                    "store.get_bytes failed after download — blob may not have been persisted"
                );
                return Err(SnatchError::StoreRead(format!("{e}")));
            }
        };

        tracing::debug!(
            blake3 = trunc(blake3_hash),
            size = bytes.len(),
            "blob read from store successfully"
        );

        Ok(bytes.to_vec())
    }

    /// ingest downloaded blob data into grimoire's media_blobz + blob_data.
    async fn ingest_blob(&self, blob_ref: &BlobRef, data: Vec<u8>) -> Result<(), SnatchError> {
        // compute sha256 for grimoire's primary content addressing
        let sha256 = {
            use sha2::Digest;
            let mut hasher = sha2::Sha256::new();
            hasher.update(&data);
            format!("{:x}", hasher.finalize())
        };

        // check again by sha256 (race condition guard)
        if grimoire::media_blobz::get_media_blob_by_sha256(&sha256)
            .await
            .is_ok()
        {
            tracing::debug!(
                sha256 = trunc(&sha256),
                "blob appeared in grimoire during download"
            );
            return Ok(());
        }

        // create the media blob entry in grimoire
        let request = grimoire::media_blobz::CreateMediaBlobRequest {
            sha256: sha256.clone(),
            size: Some(blob_ref.size as i64),
            mime: if blob_ref.mime.is_empty() {
                Some("application/octet-stream".to_string())
            } else {
                Some(blob_ref.mime.clone())
            },
            source_client_id: None,
            local_path: None,
            filename: if blob_ref.filename.is_empty() {
                None
            } else {
                Some(blob_ref.filename.clone())
            },
            parent_blob_id: None,
            blob_type: None,
            metadata: serde_json::Value::Object(serde_json::Map::new()),
            created_by: None,
            data: Some(grimoire::Bytes::from(data)),
            width: None,
            height: None,
            blake3: Some(blob_ref.blake3.clone()),
        };

        let blob = grimoire::media_blobz::create_media_blob(request)
            .await
            .map_err(|e| SnatchError::Ingest(format!("{e}")))?;

        tracing::info!(
            id = %blob.id,
            sha256 = trunc(&sha256),
            blake3 = trunc(&blob_ref.blake3),
            filename = %blob_ref.filename,
            size = blob_ref.size,
            "blob ingested into grimoire"
        );

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// errors
// ---------------------------------------------------------------------------

/// errors that can occur during blob snatching.
#[derive(Debug, thiserror::Error)]
pub enum SnatchError {
    #[error("blob has no blake3 hash")]
    NoBlake3,

    #[error("no canvas peers to probe")]
    NoPeers,

    #[error("no peer has the requested blob")]
    NoPeerHasBlob,

    #[error("probe timed out")]
    ProbeTimeout,

    #[error("invalid blake3 hash: {0}")]
    InvalidHash(String),

    #[error("invalid node ID: {0}")]
    InvalidNodeId(String),

    #[error("download failed: {0}")]
    DownloadFailed(String),

    #[error("download timed out")]
    DownloadTimeout,

    #[error("failed to read blob from store: {0}")]
    StoreRead(String),

    #[error("failed to ingest blob: {0}")]
    Ingest(String),

    #[error("connection failed: {0}")]
    Connection(String),

    #[error("protocol error: {0}")]
    Protocol(String),
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

/// check whether a blob already exists in grimoire (by blake3 or blob_id/sha256).
async fn check_blob_exists(blob_ref: &BlobRef) -> bool {
    if !blob_ref.blake3.is_empty() {
        if grimoire::media_blobz::get_media_blob_by_blake3(&blob_ref.blake3)
            .await
            .is_ok()
        {
            return true;
        }
    }

    if !blob_ref.blob_id.is_empty() {
        if grimoire::media_blobz::get_media_blob_by_sha256(&blob_ref.blob_id)
            .await
            .is_ok()
        {
            return true;
        }
    }

    false
}

/// send `ensure_blob_request` to a single peer over `freqhole/1`.
///
/// returns `true` if the peer has the blob and it's now available for download.
async fn probe_single_peer(
    endpoint: &Endpoint,
    peer_node_id: &str,
    blake3_hash: &str,
) -> Result<bool, SnatchError> {
    let node_id: iroh::PublicKey = peer_node_id
        .parse()
        .map_err(|e| SnatchError::InvalidNodeId(format!("{e}")))?;

    let addr = iroh::EndpointAddr::from(node_id);

    let conn = endpoint
        .connect(addr, FREQHOLE_ALPN)
        .await
        .map_err(|e| SnatchError::Connection(format!("{e}")))?;

    let (mut send, mut recv) = conn
        .open_bi()
        .await
        .map_err(|e| SnatchError::Connection(format!("open_bi: {e}")))?;

    // send ensure request
    let request = PeerMessage::EnsureBlobRequest {
        id: 1,
        blake3_hash: blake3_hash.to_string(),
    };
    let bytes = serde_json::to_vec(&request)
        .map_err(|e| SnatchError::Protocol(format!("serialize: {e}")))?;
    send.write_all(&bytes)
        .await
        .map_err(|e| SnatchError::Protocol(format!("write: {e}")))?;
    send.finish()
        .map_err(|e| SnatchError::Protocol(format!("finish: {e}")))?;

    // read response
    let response_bytes = recv
        .read_to_end(64 * 1024)
        .await
        .map_err(|e| SnatchError::Protocol(format!("read: {e}")))?;

    let response: PeerMessage = serde_json::from_slice(&response_bytes)
        .map_err(|e| SnatchError::Protocol(format!("deserialize: {e}")))?;

    match response {
        PeerMessage::EnsureBlobResponse {
            available, error, ..
        } => {
            if let Some(err) = error {
                tracing::debug!(
                    peer = trunc(peer_node_id),
                    error = %err,
                    "ensure_blob error"
                );
                return Ok(false);
            }
            Ok(available)
        }
        _ => Err(SnatchError::Protocol(
            "unexpected response type".to_string(),
        )),
    }
}

/// consume the iroh-blobs download progress stream, returning an error if
/// the download fails.
async fn consume_download_progress(
    progress: iroh_blobs::api::downloader::DownloadProgress,
    blake3_label: &str,
) -> Result<(), SnatchError> {
    use futures::StreamExt;
    use iroh_blobs::api::downloader::DownloadProgressItem;

    let mut stream = progress
        .stream()
        .await
        .map_err(|e| SnatchError::DownloadFailed(format!("stream: {e}")))?;

    let mut had_error = false;
    let mut last_error: Option<String> = None;
    let mut event_count: u32 = 0;

    while let Some(event) = stream.next().await {
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

    tracing::debug!(
        blake3 = trunc(blake3_label),
        event_count,
        had_error,
        "download progress stream finished"
    );

    if had_error {
        return Err(SnatchError::DownloadFailed(
            last_error.unwrap_or_else(|| "unknown error".to_string()),
        ));
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// automerge doc reading (sync — runs in spawn_blocking)
// ---------------------------------------------------------------------------

/// read a canvas automerge doc to find file widget docIds and peer node IDs.
///
/// returns placeholder BlobRefs (only canvas_doc_id + widget_doc_id populated)
/// plus the list of peer node IDs from the canvas peers map.
fn read_canvas_for_file_widgets(
    handle: &crate::hub_repo::DocHandle,
    canvas_doc_id: &str,
    local_node_id: &str,
) -> (Vec<BlobRef>, Vec<String>) {
    use automerge::ReadDoc;

    let mut widget_doc_ids: Vec<String> = Vec::new();
    let mut peers: Vec<String> = Vec::new();

    handle.with_document(|doc| {
        // skip deleted canvases
        if let Ok(Some((automerge::Value::Scalar(s), _))) = doc.get(automerge::ROOT, "deleted") {
            if s.as_ref() == &automerge::ScalarValue::Boolean(true) {
                return;
            }
        }

        // extract peer node IDs from the "peers" map
        if let Ok(Some((_, peers_obj))) = doc.get(automerge::ROOT, "peers") {
            for key in doc.keys(&peers_obj) {
                let node_id = key.to_string();
                if node_id != local_node_id && !node_id.is_empty() {
                    peers.push(node_id);
                }
            }
        }

        // find file widgets in the "widgets" map
        if let Ok(Some((_, widgets_obj))) = doc.get(automerge::ROOT, "widgets") {
            for key in doc.keys(&widgets_obj) {
                let key_str: &str = &key;
                if let Ok(Some((_, widget_obj))) = doc.get(&widgets_obj, key_str) {
                    // check widget type
                    let widget_type = read_str(doc, &widget_obj, "type");
                    if widget_type != "file" {
                        continue;
                    }

                    // get the docId pointing to the file widget state doc
                    let doc_id = read_str(doc, &widget_obj, "docId");
                    if !doc_id.is_empty() {
                        widget_doc_ids.push(doc_id);
                    }
                }
            }
        }
    });

    if widget_doc_ids.is_empty() {
        tracing::trace!(
            canvas = canvas_doc_id,
            file_widgets = 0,
            peers = peers.len(),
            "scanned canvas for file widgets"
        );
    } else {
        tracing::info!(
            canvas = canvas_doc_id,
            file_widgets = widget_doc_ids.len(),
            peers = peers.len(),
            "scanned canvas for file widgets"
        );
    }

    // return placeholder BlobRefs — only widget_doc_id is filled in.
    // the caller resolves each widget doc into a full BlobRef.
    let placeholder_refs: Vec<BlobRef> = widget_doc_ids
        .into_iter()
        .map(|wid| BlobRef {
            canvas_doc_id: canvas_doc_id.to_string(),
            widget_doc_id: wid,
            blob_id: String::new(),
            blake3: String::new(),
            filename: String::new(),
            mime: String::new(),
            size: 0,
            snatched_by: Vec::new(),
        })
        .collect();

    (placeholder_refs, peers)
}

/// read a file widget state doc to extract blob reference fields.
fn read_widget_state(
    handle: &crate::hub_repo::DocHandle,
    canvas_doc_id: &str,
    widget_doc_id: &str,
) -> Option<BlobRef> {
    let mut result: Option<BlobRef> = None;

    handle.with_document(|doc| {
        use automerge::ReadDoc;

        let blob_id = read_str(doc, &automerge::ROOT, "blobId");
        let blake3 = read_str(doc, &automerge::ROOT, "blake3");

        // skip widgets with no blob reference
        if blob_id.is_empty() && blake3.is_empty() {
            return;
        }

        // read snatchedBy — an automerge list of string node IDs
        let snatched_by = {
            let mut items = Vec::new();
            if let Ok(Some((automerge::Value::Object(automerge::ObjType::List), list_id))) =
                doc.get(automerge::ROOT, "snatchedBy")
            {
                for i in 0..doc.length(&list_id) {
                    if let Ok(Some((v, _))) = doc.get(&list_id, i as usize) {
                        if let Some(s) = v.to_str() {
                            items.push(s.to_string());
                        }
                    }
                }
            }
            items
        };

        result = Some(BlobRef {
            canvas_doc_id: canvas_doc_id.to_string(),
            widget_doc_id: widget_doc_id.to_string(),
            blob_id,
            blake3,
            filename: read_str(doc, &automerge::ROOT, "filename"),
            mime: read_str(doc, &automerge::ROOT, "mime"),
            size: read_u64(doc, &automerge::ROOT, "size"),
            snatched_by,
        });
    });

    result
}

/// helper: read a string field from an automerge object.
/// handles both scalar strings and Text objects (JS automerge stores strings as Text).
fn read_str(doc: &automerge::Automerge, obj: &automerge::ObjId, key: &str) -> String {
    use automerge::ReadDoc;
    match doc.get(obj, key) {
        Ok(Some((automerge::Value::Object(automerge::ObjType::Text), text_id))) => {
            doc.text(&text_id).unwrap_or_default()
        }
        Ok(Some((v, _))) => v.to_str().map(|s| s.to_string()).unwrap_or_default(),
        _ => String::new(),
    }
}

/// helper: read a u64 field from an automerge object.
fn read_u64(doc: &automerge::Automerge, obj: &automerge::ObjId, key: &str) -> u64 {
    use automerge::ReadDoc;
    doc.get(obj, key)
        .ok()
        .flatten()
        .and_then(|(v, _)| v.to_u64())
        .unwrap_or(0)
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_blob_ref_defaults() {
        let br = BlobRef {
            canvas_doc_id: "abc".to_string(),
            widget_doc_id: "def".to_string(),
            blob_id: String::new(),
            blake3: String::new(),
            filename: "test.txt".to_string(),
            mime: "text/plain".to_string(),
            size: 42,
            snatched_by: Vec::new(),
        };
        assert_eq!(br.size, 42);
        assert!(br.blake3.is_empty());
    }

    #[test]
    fn test_snatch_error_display() {
        let e = SnatchError::NoBlake3;
        assert_eq!(e.to_string(), "blob has no blake3 hash");

        let e = SnatchError::NoPeers;
        assert_eq!(e.to_string(), "no canvas peers to probe");

        let e = SnatchError::DownloadFailed("timeout".to_string());
        assert_eq!(e.to_string(), "download failed: timeout");
    }

    #[test]
    fn test_trunc() {
        assert_eq!(trunc("abcdefghijklmnopqrstuvwxyz"), "abcdefghijklmnop");
        assert_eq!(trunc("short"), "short");
        assert_eq!(trunc(""), "");
    }

    #[test]
    fn test_check_empty_blob_ref() {
        // blob ref with no identifiers should not crash trunc
        let br = BlobRef {
            canvas_doc_id: String::new(),
            widget_doc_id: String::new(),
            blob_id: String::new(),
            blake3: String::new(),
            filename: String::new(),
            mime: String::new(),
            size: 0,
            snatched_by: Vec::new(),
        };
        assert_eq!(trunc(&br.blake3), "");
        assert_eq!(trunc(&br.blob_id), "");
    }
}
