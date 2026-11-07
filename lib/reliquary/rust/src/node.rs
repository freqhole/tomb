//! StorageNode: the reusable iroh-blobs `FsStore` + gc-protect + downloader
//! bundle.
//!
//! combines an `FsStore`, gc-protect callback, and `Downloader` into a single
//! builder-configured struct. app wiring stays out of this module: endpoint
//! construction, ALPN registration, router building, which access gate to use,
//! and snatch engine startup are all consumer concerns.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex as StdMutex, RwLock};
use std::time::Duration;

use iroh::endpoint::Connection;
use iroh::protocol::{AcceptError, ProtocolHandler};
use iroh::Endpoint;
use iroh_blobs::api::blobs::{AddPathOptions, ExportMode, ExportOptions, ImportMode};
use iroh_blobs::api::downloader::Downloader;
use iroh_blobs::provider::events::EventSender;
use iroh_blobs::store::fs::{options::Options, FsStore};
use iroh_blobs::store::{GcConfig, ProtectCb, ProtectOutcome};
use iroh_blobs::{BlobFormat, BlobsProtocol, Hash};

use crate::blobz::{BlobStore, BlobStoreError};

const DEFAULT_GC_INTERVAL: Duration = Duration::from_secs(3600);
const PROTECT_REFRESH_INTERVAL: Duration = Duration::from_secs(600);
/// how long [`StorageNode::check_local_store`] waits for the store to answer.
/// a single tag lookup, so anything near this is a stalled store, not load.
const LOCAL_STORE_PROBE_TIMEOUT: Duration = Duration::from_secs(5);
/// tag name looked up by [`StorageNode::check_local_store`]. never created -
/// the probe only cares whether the store answers, not what it answers.
const LOCAL_STORE_PROBE_TAG: &[u8] = b"reliquary-local-store-probe";

#[derive(Debug, thiserror::Error)]
pub enum NodeError {
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),

    #[error("fs store error: {0}")]
    FsStore(String),

    #[error("blob store error: {0}")]
    BlobStore(#[from] BlobStoreError),

    /// the iroh-blobs store stopped answering requests (shut down, or its
    /// internal database task died). it can't be revived in-process - the
    /// app has to restart.
    #[error("local blob store is unavailable: {0}")]
    StoreUnavailable(String),
}

/// options controlling [`StorageNode::init`].
#[derive(Debug, Clone)]
pub struct StorageNodeOptions {
    /// enable the background gc cycle (protect-callback + periodic sweep).
    /// tests typically disable this (see `testing::make_storage_node`).
    pub gc_enabled: bool,
    /// how often the gc sweep runs, when enabled.
    pub gc_interval: Duration,
    /// on init, `add_path` every existing blobz row into the iroh-blobs
    /// store so it's immediately servable over `iroh-blobs/*`, without
    /// waiting for a peer to first trigger an ensure/ingest.
    pub prewarm: bool,
    /// the directory name (joined onto data_dir) the iroh-blobs FsStore lives
    /// under. defaults to "freqhole-blobz" - override this if a consumer
    /// wants a different on-disk layout, but the default deliberately avoids
    /// leaking the underlying iroh dependency's name into application data
    /// directories that outlive any particular transport choice.
    pub blobs_dir_name: String,
}

impl Default for StorageNodeOptions {
    fn default() -> Self {
        Self {
            gc_enabled: true,
            gc_interval: DEFAULT_GC_INTERVAL,
            prewarm: false,
            blobs_dir_name: "freqhole-blobz".to_string(),
        }
    }
}

/// the reusable iroh-blobs storage bundle: `FsStore` + gc protection +
/// an attachable downloader. holds `Arc<dyn BlobStore>` (never a concrete
/// store type) so it composes with any `BlobStore` implementation.
///
/// local blob storage (`fs_store`, `blobz`) works with no endpoint at all -
/// [`StorageNode::init_local`] boots a node fully offline, or before a
/// consuming app has any identity/keypair yet. a downloader is bound (or
/// rebound) separately via [`StorageNode::attach_endpoint`], any number of
/// times over the node's life, so a consuming app can stop and restart its
/// endpoint without ever needing a new `StorageNode`.
pub struct StorageNode {
    /// the underlying iroh-blobs store. `'static` because `BlobsProtocol` and
    /// `Downloader` both want it - each `StorageNode::init_local` call
    /// leaks one `Box<FsStore>` (fine: one per long-running process, or one
    /// per test tempdir).
    ///
    /// shared by every router/downloader for the node's whole life, so never
    /// call `fs_store.shutdown()` directly - use [`StorageNode::shutdown`],
    /// and only when the owning process is exiting.
    pub fs_store: &'static FsStore,
    /// the blobz metadata + canonical-file store this node exports
    /// downloaded blobs into.
    pub blobz: Arc<dyn BlobStore>,
    pub references: crate::references::ReferenceRepair,
    /// iroh-blobs downloader for verified transfers from peers, if a live
    /// endpoint is currently attached. `None` before any endpoint has ever
    /// been attached, or after [`StorageNode::detach_endpoint`]. use
    /// [`StorageNode::downloader`] to read the current value and
    /// [`StorageNode::attach_endpoint`]/[`StorageNode::detach_endpoint`] to
    /// change it.
    downloader: Arc<RwLock<Option<Downloader>>>,
    /// hashes currently mid-download. shared with the gc protect callback
    /// so an in-progress download is never swept before it's exported into
    /// `blobz`. also shared with `snatch::SnatchEngine` for the same reason.
    pub in_flight: Arc<StdMutex<HashSet<Hash>>>,
    protect_refresh: Option<tokio::task::JoinHandle<()>>,
    /// set once [`StorageNode::shutdown`] runs, so later calls are no-ops
    /// and [`StorageNode::check_local_store`] can answer without a probe.
    shut_down: AtomicBool,
}

impl StorageNode {
    /// boot the local-only half of a storage node: load (or create) the
    /// iroh-blobs `FsStore` under `<data_dir>/<opts.blobs_dir_name>/`, wire
    /// up gc protection (if enabled), and optionally pre-warm the store
    /// with every existing blobz row. no downloader is attached yet, so
    /// this works fully offline or before a consuming app has any
    /// identity/endpoint at all - call [`StorageNode::attach_endpoint`]
    /// once a live endpoint becomes available.
    pub async fn init_local(
        data_dir: &Path,
        blobz: Arc<dyn BlobStore>,
        opts: StorageNodeOptions,
    ) -> Result<Self, NodeError> {
        let path = data_dir.join(&opts.blobs_dir_name);
        tokio::fs::create_dir_all(&path).await?;

        let in_flight: Arc<StdMutex<HashSet<Hash>>> = Arc::new(StdMutex::new(HashSet::new()));

        let mut store_opts = Options::new(&path);
        let mut protect_refresh = None;

        if opts.gc_enabled {
            // protected-hash cache: refreshed periodically by a background
            // task. None = never refreshed yet -> the callback aborts the gc
            // cycle rather than sweeping blind.
            let protected: Arc<RwLock<Option<HashSet<Hash>>>> = Arc::new(RwLock::new(None));

            let protected_bg = Arc::clone(&protected);
            let blobz_bg = Arc::clone(&blobz);
            protect_refresh = Some(tokio::spawn(async move {
                loop {
                    match blobz_bg.list_all_iroh_hashes().await {
                        Ok(hex_hashes) => {
                            let mut set = HashSet::new();
                            for hex in &hex_hashes {
                                if let Ok(h) = hex.parse::<Hash>() {
                                    set.insert(h);
                                }
                            }
                            if let Ok(mut guard) = protected_bg.write() {
                                *guard = Some(set);
                            }
                            tracing::debug!(
                                count = hex_hashes.len(),
                                "gc protect: refreshed protected hashes from blobz"
                            );
                        }
                        Err(e) => {
                            tracing::warn!(
                                error = %e,
                                "gc protect: failed to refresh protected hashes from blobz"
                            );
                        }
                    }
                    tokio::time::sleep(PROTECT_REFRESH_INTERVAL).await;
                }
            }));

            let in_flight_cb = Arc::clone(&in_flight);
            let protect_cb: ProtectCb = Arc::new(move |live: &mut HashSet<Hash>| {
                let p = Arc::clone(&protected);
                let inf = Arc::clone(&in_flight_cb);
                Box::pin(async move {
                    match p.read() {
                        Ok(guard) => match guard.as_ref() {
                            None => {
                                tracing::debug!(
                                    "gc protect: protected set not yet initialized, aborting cycle"
                                );
                                return ProtectOutcome::Abort;
                            }
                            Some(set) => {
                                live.extend(set.iter().cloned());
                            }
                        },
                        Err(_) => return ProtectOutcome::Abort,
                    }
                    // also protect blobs that are mid-download.
                    if let Ok(inf_guard) = inf.lock() {
                        live.extend(inf_guard.iter().cloned());
                    }
                    ProtectOutcome::Continue
                })
            });

            store_opts.gc = Some(GcConfig {
                interval: opts.gc_interval,
                add_protected: Some(protect_cb),
            });
        }

        let fs_store: &'static FsStore = Box::leak(Box::new(
            FsStore::load_with_opts(path.join("blobs.db"), store_opts)
                .await
                .map_err(|e| NodeError::FsStore(e.to_string()))?,
        ));

        let node = Self {
            fs_store,
            blobz,
            references: crate::references::ReferenceRepair::default(),
            downloader: Arc::new(RwLock::new(None)),
            in_flight,
            protect_refresh,
            shut_down: AtomicBool::new(false),
        };

        if opts.prewarm {
            node.prewarm().await?;
        }

        Ok(node)
    }

    /// bind (or rebind) a downloader to a live endpoint. safe to call
    /// repeatedly over the node's lifetime - e.g. after a consuming app's
    /// user stops and restarts their endpoint/identity - and replaces
    /// whatever downloader was previously attached, if any.
    pub fn attach_endpoint(&self, endpoint: &Endpoint) {
        let new_downloader = Downloader::new(self.fs_store, endpoint);
        *self.downloader.write().unwrap() = Some(new_downloader);
    }

    /// detach the current downloader (e.g. the endpoint was stopped). local
    /// blob storage keeps working; anything needing a downloader should
    /// treat [`StorageNode::downloader`] returning `None` as "no live
    /// endpoint right now".
    pub fn detach_endpoint(&self) {
        *self.downloader.write().unwrap() = None;
    }

    /// the current downloader, if an endpoint is attached right now.
    /// `Downloader` is a cheap, cloneable handle - call this fresh at point
    /// of use rather than caching the result across a potential
    /// attach/detach/reattach cycle.
    pub fn downloader(&self) -> Option<Downloader> {
        self.downloader.read().unwrap().clone()
    }

    /// the actual shared cell backing [`StorageNode::downloader`], not a
    /// point-in-time clone. a consumer that outlives a single read (e.g.
    /// [`crate::snatch::SnatchEngine`]) should hold this cell rather than
    /// wrapping its own separate `RwLock`, so it observes every future
    /// [`StorageNode::attach_endpoint`]/[`StorageNode::detach_endpoint`]
    /// call on this same node instead of going stale.
    pub fn downloader_cell(&self) -> Arc<RwLock<Option<Downloader>>> {
        Arc::clone(&self.downloader)
    }

    /// convenience for callers who always have an endpoint at construction
    /// time and never stop/restart it (e.g. a headless daemon): exactly
    /// [`StorageNode::init_local`] followed immediately by
    /// [`StorageNode::attach_endpoint`].
    pub async fn init(
        data_dir: &Path,
        blobz: Arc<dyn BlobStore>,
        endpoint: &Endpoint,
        opts: StorageNodeOptions,
    ) -> Result<Self, NodeError> {
        let node = Self::init_local(data_dir, blobz, opts).await?;
        node.attach_endpoint(endpoint);
        Ok(node)
    }

    /// `add_path` every existing (non-soft-deleted) blobz row into the
    /// iroh-blobs store, so it's immediately servable over `iroh-blobs/*`
    /// without waiting for a peer to trigger an ensure/ingest first.
    async fn prewarm(&self) -> Result<(), NodeError> {
        const PAGE_SIZE: i64 = 200;
        let mut offset: i64 = 0;
        loop {
            let (records, total) = self.blobz.list(PAGE_SIZE, offset).await?;
            if records.is_empty() {
                break;
            }
            let fetched = records.len() as i64;
            for record in &records {
                let path = self.blobz.path_for(record);
                let hash = record
                    .blake3
                    .parse::<Hash>()
                    .map_err(|e| NodeError::FsStore(e.to_string()))?;
                if let Err(e) = self.references.ensure(self.fs_store, hash, &path).await {
                    tracing::warn!(
                        blake3 = %record.blake3,
                        path = %path.display(),
                        error = %e,
                        "prewarm: failed to add existing blob to iroh-blobs store"
                    );
                }
            }
            offset += fetched;
            if (offset as u64) >= total {
                break;
            }
        }
        Ok(())
    }

    /// build an `iroh-blobs/*` protocol handler, optionally gated via an
    /// `EventSender` (see `crate::gate::build_gated_blobs_events`).
    ///
    /// returns [`SharedBlobsProtocol`] rather than a bare `BlobsProtocol`:
    /// iroh-blobs' own handler shuts its store down whenever the router it's
    /// registered on shuts down, which would kill this node's shared store
    /// for every later router (e.g. after an endpoint restart).
    pub fn blobs_protocol(&self, events: Option<EventSender>) -> SharedBlobsProtocol {
        SharedBlobsProtocol(BlobsProtocol::new(self.fs_store, events))
    }

    /// cleanly shut down the shared store, flushing any batched writes to
    /// disk. call this once, only from the owning process's exit path - the
    /// store can't be reopened afterwards, so every later store operation on
    /// this node fails. repeat calls are no-ops.
    pub async fn shutdown(&self) -> Result<(), NodeError> {
        if self.shut_down.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        if let Some(handle) = &self.protect_refresh {
            handle.abort();
        }
        self.detach_endpoint();
        self.fs_store
            .shutdown()
            .await
            .map_err(|e| NodeError::FsStore(e.to_string()))
    }

    /// check that the shared store still answers requests. returns
    /// [`NodeError::StoreUnavailable`] if it was shut down or stopped
    /// responding with an error. a probe that merely times out is treated as
    /// healthy (a busy store, not a dead one), so this never falsely reports
    /// an outage.
    pub async fn check_local_store(&self) -> Result<(), NodeError> {
        if self.shut_down.load(Ordering::SeqCst) {
            return Err(NodeError::StoreUnavailable(
                "the store was shut down".to_string(),
            ));
        }
        match tokio::time::timeout(
            LOCAL_STORE_PROBE_TIMEOUT,
            self.fs_store.tags().get(LOCAL_STORE_PROBE_TAG),
        )
        .await
        {
            Ok(Ok(_)) => Ok(()),
            Ok(Err(e)) => Err(NodeError::StoreUnavailable(e.to_string())),
            Err(_) => {
                tracing::warn!(
                    timeout_secs = LOCAL_STORE_PROBE_TIMEOUT.as_secs(),
                    "local store probe timed out; assuming the store is busy, not down"
                );
                Ok(())
            }
        }
    }

    /// raii guard: inserts `hash` into the in-flight set on construction,
    /// removes it on drop. share this between the gc protect callback and
    /// anything mid-download (the snatch engine, an ensure handler, ...) so
    /// a blob is never swept while it's being fetched.
    pub fn in_flight_guard(&self, hash: Hash) -> InFlightGuard {
        InFlightGuard::new(Arc::clone(&self.in_flight), hash)
    }
}

impl Drop for StorageNode {
    fn drop(&mut self) {
        if let Some(handle) = self.protect_refresh.take() {
            handle.abort();
        }
    }
}

/// `iroh-blobs/*` handler for a [`StorageNode`]'s shared store. forwards
/// every connection to iroh-blobs' `BlobsProtocol`, but does nothing on
/// router shutdown - the store outlives any single router, so only
/// [`StorageNode::shutdown`] may close it.
#[derive(Debug, Clone)]
pub struct SharedBlobsProtocol(BlobsProtocol);

impl ProtocolHandler for SharedBlobsProtocol {
    async fn accept(&self, conn: Connection) -> Result<(), AcceptError> {
        self.0.accept(conn).await
    }
}

/// raii guard that inserts a hash into an in-flight set on construction and
/// removes it when dropped. ensures a gc protect callback never sweeps a
/// blob that is mid-download, regardless of which exit path the download
/// takes (success, error, or cancellation).
pub struct InFlightGuard {
    set: Arc<StdMutex<HashSet<Hash>>>,
    hash: Hash,
}

impl InFlightGuard {
    pub fn new(set: Arc<StdMutex<HashSet<Hash>>>, hash: Hash) -> Self {
        if let Ok(mut guard) = set.lock() {
            guard.insert(hash);
        }
        Self { set, hash }
    }
}

impl Drop for InFlightGuard {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.set.lock() {
            guard.remove(&self.hash);
        }
    }
}

/// export a hash from `fs_store`'s internal storage to `blobz`'s canonical
/// content-addressed path by reference (rename when possible; `TryReference`
/// falls back to a copy across filesystem boundaries, e.g. `EXDEV`). the
/// fs store keeps tracking the file (now `DataLocation::External`) and
/// continues serving it for P2P; only the outboard tree stays duplicated.
///
/// returns the canonical path the bytes now live at. callers still need to
/// call `blobz.register_ingested(...)` to record the metadata row.
pub async fn export_try_reference(
    fs_store: &FsStore,
    hash: Hash,
    blobz: &Arc<dyn BlobStore>,
) -> Result<PathBuf, NodeError> {
    let blake3_hex = hash.to_string();
    let target = blobz.prepare_canonical_path(&blake3_hex).await?;
    if tokio::fs::try_exists(&target).await? {
        let actual = crate::hash_file(&target)
            .await
            .map_err(|e| NodeError::FsStore(e.to_string()))?;
        if actual != hash.to_hex().as_str() {
            return Err(NodeError::FsStore(format!(
                "export target contains different bytes; refusing to overwrite {}",
                target.display()
            )));
        }
        crate::references::ReferenceRepair::default()
            .ensure(fs_store, hash, &target)
            .await
            .map_err(|e| NodeError::FsStore(e.to_string()))?;
        return Ok(target);
    }
    let parent = target
        .parent()
        .ok_or_else(|| std::io::Error::other("export has no parent"))?;
    // upstream export can replace its target. isolate it, then publish without clobbering.
    // retain staging on failure/cancellation: export may have moved the store's only copy.
    let staging = tempfile::Builder::new()
        .prefix(".freqhole-export-")
        .disable_cleanup(true)
        .tempdir_in(parent)?;
    let staged_target = staging.path().join("media");
    let result = async {
        if let Err(error) = fs_store
            .blobs()
            .export_with_opts(ExportOptions {
                hash,
                mode: ExportMode::TryReference,
                target: staged_target.clone(),
            })
            .await
        {
            tracing::warn!(%hash, %error, "path export failed; retrying through verified reader");
            crate::references::export_from_reader(fs_store, hash, &staged_target)
                .await
                .map_err(|e| NodeError::FsStore(format!("export to blobz path: {e}")))?;
        }
        tokio::fs::File::open(&staged_target)
            .await?
            .sync_all()
            .await?;
        let mut staged = tempfile::TempPath::try_from_path(&staged_target)?;
        staged.disable_cleanup(true);
        staged.persist_noclobber(&target).map_err(|e| e.error)?;
        #[cfg(unix)]
        tokio::fs::File::open(parent).await?.sync_all().await?;
        crate::references::ReferenceRepair::default()
            .ensure(fs_store, hash, &target)
            .await
            .map_err(|e| NodeError::FsStore(e.to_string()))
    }
    .await;
    if let Err(error) = result {
        tracing::warn!(
            staging = %staging.path().display(),
            %error,
            "export failed; retaining staging files for recovery"
        );
        return Err(error);
    }
    staging.close()?;
    Ok(target)
}

/// import a file already on disk (e.g. a blobz-managed canonical file) into
/// `fs_store` by reference (no copy) so it becomes servable over
/// `iroh-blobs/*`. the inverse of [`export_try_reference`].
pub async fn import_try_reference(fs_store: &FsStore, path: &Path) -> Result<Hash, NodeError> {
    let tag_info = fs_store
        .blobs()
        .add_path_with_opts(AddPathOptions {
            path: path.to_path_buf(),
            format: BlobFormat::Raw,
            mode: ImportMode::TryReference,
        })
        .await
        .map_err(|e| NodeError::FsStore(format!("import by reference: {e}")))?;
    Ok(tag_info.hash)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blobz::{NewBlobMeta, SqliteBlobStore};

    async fn test_endpoint() -> Endpoint {
        Endpoint::builder(iroh::endpoint::presets::Minimal)
            .relay_mode(iroh::RelayMode::Disabled)
            .clear_ip_transports()
            .bind_addr("127.0.0.1:0")
            .unwrap()
            .bind()
            .await
            .expect("bind test endpoint")
    }

    async fn test_blobz(data_dir: &Path) -> Arc<dyn BlobStore> {
        let pool = crate::db::open_in_memory().await;
        Arc::new(SqliteBlobStore::new(pool, data_dir))
    }

    #[tokio::test]
    async fn init_with_gc_disabled_boots_a_usable_store() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let blobz = test_blobz(tmp.path()).await;
        let endpoint = test_endpoint().await;

        let node = StorageNode::init(
            tmp.path(),
            blobz,
            &endpoint,
            StorageNodeOptions {
                gc_enabled: false,
                ..Default::default()
            },
        )
        .await
        .expect("init storage node");

        let tag = node
            .fs_store
            .blobs()
            .add_bytes(b"hello storage node".to_vec())
            .await
            .expect("add bytes");
        let bytes = node
            .fs_store
            .blobs()
            .get_bytes(tag.hash)
            .await
            .expect("get bytes");
        assert_eq!(&bytes[..], b"hello storage node");

        assert!(tmp.path().join("freqhole-blobz").exists());
        endpoint.close().await;
    }

    #[tokio::test]
    async fn init_local_honors_a_custom_blobs_dir_name() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let blobz = test_blobz(tmp.path()).await;

        let _node = StorageNode::init_local(
            tmp.path(),
            blobz,
            StorageNodeOptions {
                gc_enabled: false,
                blobs_dir_name: "custom-blobz".to_string(),
                ..Default::default()
            },
        )
        .await
        .expect("init_local storage node with a custom blobs dir name");

        assert!(tmp.path().join("custom-blobz").exists());
        assert!(!tmp.path().join("freqhole-blobz").exists());
    }

    #[tokio::test]
    async fn in_flight_guard_tracks_and_releases_hash() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let blobz = test_blobz(tmp.path()).await;
        let endpoint = test_endpoint().await;

        let node = StorageNode::init(
            tmp.path(),
            blobz,
            &endpoint,
            StorageNodeOptions {
                gc_enabled: false,
                ..Default::default()
            },
        )
        .await
        .expect("init storage node");

        let hash = Hash::new(b"some content");
        {
            let _guard = node.in_flight_guard(hash);
            assert!(node.in_flight.lock().unwrap().contains(&hash));
        }
        assert!(!node.in_flight.lock().unwrap().contains(&hash));
        endpoint.close().await;
    }

    #[tokio::test]
    async fn downloader_cell_is_shared_not_cloned() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let blobz = test_blobz(tmp.path()).await;

        let node = StorageNode::init_local(
            tmp.path(),
            blobz,
            StorageNodeOptions {
                gc_enabled: false,
                ..Default::default()
            },
        )
        .await
        .expect("init_local storage node");

        // a second holder (standing in for a consumer like SnatchEngine)
        // grabs its own handle to the node's real cell, not a copy of it.
        let holder_cell = node.downloader_cell();
        assert!(holder_cell.read().unwrap().is_none());

        let endpoint = test_endpoint().await;
        node.attach_endpoint(&endpoint);

        // the holder observes the attach through its own handle, without
        // ever calling back into the node.
        assert!(holder_cell.read().unwrap().is_some());

        node.detach_endpoint();
        assert!(holder_cell.read().unwrap().is_none());

        endpoint.close().await;
    }

    #[tokio::test]
    async fn prewarm_adds_every_existing_blobz_row_to_the_fs_store() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let blobz = test_blobz(tmp.path()).await;
        blobz
            .insert(b"blob one", NewBlobMeta::default())
            .await
            .expect("insert blob one");
        blobz
            .insert(b"blob two", NewBlobMeta::default())
            .await
            .expect("insert blob two");

        let endpoint = test_endpoint().await;
        let node = StorageNode::init(
            tmp.path(),
            blobz,
            &endpoint,
            StorageNodeOptions {
                gc_enabled: false,
                prewarm: true,
                ..Default::default()
            },
        )
        .await
        .expect("init storage node with prewarm");

        let hash_one = Hash::new(b"blob one");
        let hash_two = Hash::new(b"blob two");
        assert!(node.fs_store.blobs().has(hash_one).await.unwrap());
        assert!(node.fs_store.blobs().has(hash_two).await.unwrap());
        endpoint.close().await;
    }

    #[tokio::test]
    async fn export_try_reference_round_trips_into_blobz() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let blobz = test_blobz(tmp.path()).await;
        let endpoint = test_endpoint().await;

        let node = StorageNode::init(
            tmp.path(),
            Arc::clone(&blobz),
            &endpoint,
            StorageNodeOptions {
                gc_enabled: false,
                ..Default::default()
            },
        )
        .await
        .expect("init storage node");

        let payload = b"exported via try-reference".to_vec();
        let tag = node
            .fs_store
            .blobs()
            .add_bytes(payload.clone())
            .await
            .expect("add bytes to fs store");

        let target = export_try_reference(node.fs_store, tag.hash, &blobz)
            .await
            .expect("export_try_reference");
        assert!(target.exists());

        let record = blobz
            .register_ingested(&tag.hash.to_string(), NewBlobMeta::default())
            .await
            .expect("register_ingested");
        assert_eq!(record.size, payload.len() as u64);

        let on_disk = tokio::fs::read(&target).await.expect("read exported file");
        assert_eq!(on_disk, payload);
        endpoint.close().await;
    }

    #[tokio::test]
    async fn import_try_reference_makes_an_external_file_servable() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let blobz = test_blobz(tmp.path()).await;
        let endpoint = test_endpoint().await;

        let node = StorageNode::init(
            tmp.path(),
            blobz,
            &endpoint,
            StorageNodeOptions {
                gc_enabled: false,
                ..Default::default()
            },
        )
        .await
        .expect("init storage node");

        let src_dir = tempfile::tempdir().expect("src tempdir");
        let src_path = src_dir.path().join("external.bin");
        let payload = b"already on disk elsewhere".to_vec();
        tokio::fs::write(&src_path, &payload).await.unwrap();

        let hash = import_try_reference(node.fs_store, &src_path)
            .await
            .expect("import_try_reference");
        assert!(node.fs_store.blobs().has(hash).await.unwrap());
        let bytes = node.fs_store.blobs().get_bytes(hash).await.unwrap();
        assert_eq!(&bytes[..], &payload[..]);
        endpoint.close().await;
    }

    #[tokio::test]
    async fn init_local_works_fully_offline_with_no_endpoint_attached() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let blobz = test_blobz(tmp.path()).await;

        let node = StorageNode::init_local(
            tmp.path(),
            blobz,
            StorageNodeOptions {
                gc_enabled: false,
                ..Default::default()
            },
        )
        .await
        .expect("init_local storage node");

        assert!(
            node.downloader().is_none(),
            "no endpoint has been attached yet"
        );

        // local blob storage keeps working with no endpoint at all.
        let tag = node
            .fs_store
            .blobs()
            .add_bytes(b"local storage, no endpoint yet".to_vec())
            .await
            .expect("add bytes works offline");
        let bytes = node
            .fs_store
            .blobs()
            .get_bytes(tag.hash)
            .await
            .expect("get bytes works offline");
        assert_eq!(&bytes[..], b"local storage, no endpoint yet");
    }

    /// proves the scenario motivating the attach/detach api: a `StorageNode`
    /// built via `init_local` (no endpoint yet), then attached to a real
    /// endpoint for a real transfer, detached (endpoint stopped), and
    /// reattached to a *brand new* endpoint for another real transfer -
    /// exactly the stop/restart cycle a consuming app's user can trigger.
    #[tokio::test]
    #[serial_test::serial(iroh_net)]
    async fn detach_and_reattach_endpoint_survives_across_a_brand_new_endpoint() {
        use iroh::address_lookup::MemoryLookup;
        use iroh::protocol::Router;
        use iroh_blobs::HashAndFormat;

        // peer a: a full storage node serving iroh-blobs/* on a real,
        // long-lived localhost endpoint. only peer b's endpoint gets
        // stopped and restarted in this test.
        let tmp_a = tempfile::tempdir().expect("tempdir");
        let blobz_a = test_blobz(tmp_a.path()).await;
        let endpoint_a = test_endpoint().await;
        let node_a = StorageNode::init(
            tmp_a.path(),
            blobz_a,
            &endpoint_a,
            StorageNodeOptions {
                gc_enabled: false,
                ..Default::default()
            },
        )
        .await
        .expect("init peer a");

        let tag_one = node_a
            .fs_store
            .blobs()
            .add_bytes(b"first payload, downloaded before detach".to_vec())
            .await
            .expect("add bytes one on peer a");

        let router_a = Router::builder(endpoint_a)
            .accept(iroh_blobs::ALPN, node_a.blobs_protocol(None))
            .spawn();
        let addr_a = router_a.endpoint().addr();

        // peer b: the node under test. built with init_local, no endpoint
        // at all yet - the scenario of an app with local storage but no
        // identity/keypair set up.
        let tmp_b = tempfile::tempdir().expect("tempdir");
        let blobz_b = test_blobz(tmp_b.path()).await;
        let node_b = StorageNode::init_local(
            tmp_b.path(),
            blobz_b,
            StorageNodeOptions {
                gc_enabled: false,
                ..Default::default()
            },
        )
        .await
        .expect("init_local peer b");

        assert!(
            node_b.downloader().is_none(),
            "peer b has no endpoint attached yet"
        );

        // local storage already works before any endpoint exists.
        let local_tag = node_b
            .fs_store
            .blobs()
            .add_bytes(b"peer b's own local blob, no endpoint needed".to_vec())
            .await
            .expect("local add_bytes works before any endpoint");
        assert!(node_b.fs_store.blobs().has(local_tag.hash).await.unwrap());

        // first attach: bind a real endpoint and confirm a real transfer
        // from peer a succeeds.
        let discovery_b1 = MemoryLookup::new();
        discovery_b1.add_endpoint_info(addr_a.clone());
        let endpoint_b1 = Endpoint::builder(iroh::endpoint::presets::Minimal)
            .relay_mode(iroh::RelayMode::Disabled)
            .clear_ip_transports()
            .bind_addr("127.0.0.1:0")
            .unwrap()
            .address_lookup(discovery_b1)
            .bind()
            .await
            .expect("bind endpoint b1");

        node_b.attach_endpoint(&endpoint_b1);
        assert!(
            node_b.downloader().is_some(),
            "downloader present after first attach"
        );

        node_b
            .downloader()
            .expect("downloader attached")
            .download(HashAndFormat::raw(tag_one.hash), [addr_a.id])
            .await
            .expect("download blob one over endpoint b1");
        assert!(
            node_b.fs_store.blobs().has(tag_one.hash).await.unwrap(),
            "peer b has blob one after the first attach's transfer"
        );
        endpoint_b1.close().await;

        // detach: no live endpoint, but everything downloaded/stored so
        // far stays readable.
        node_b.detach_endpoint();
        assert!(
            node_b.downloader().is_none(),
            "downloader cleared after detach"
        );
        assert!(
            node_b.fs_store.blobs().has(tag_one.hash).await.unwrap(),
            "already-downloaded blob still readable while detached"
        );

        // reattach to a BRAND NEW endpoint - simulates the user stopping
        // and restarting their identity/endpoint - and confirm a second,
        // different transfer still works against the new one.
        let tag_two = node_a
            .fs_store
            .blobs()
            .add_bytes(b"second payload, downloaded after reattach".to_vec())
            .await
            .expect("add bytes two on peer a");

        let discovery_b2 = MemoryLookup::new();
        discovery_b2.add_endpoint_info(addr_a.clone());
        let endpoint_b2 = Endpoint::builder(iroh::endpoint::presets::Minimal)
            .relay_mode(iroh::RelayMode::Disabled)
            .clear_ip_transports()
            .bind_addr("127.0.0.1:0")
            .unwrap()
            .address_lookup(discovery_b2)
            .bind()
            .await
            .expect("bind endpoint b2");

        node_b.attach_endpoint(&endpoint_b2);
        assert!(
            node_b.downloader().is_some(),
            "downloader present after reattach to a new endpoint"
        );

        node_b
            .downloader()
            .expect("downloader attached")
            .download(HashAndFormat::raw(tag_two.hash), [addr_a.id])
            .await
            .expect("download blob two over endpoint b2");
        assert!(
            node_b.fs_store.blobs().has(tag_two.hash).await.unwrap(),
            "peer b has blob two after reattach to the new endpoint"
        );

        endpoint_b2.close().await;
        router_a.shutdown().await.ok();
    }

    /// regression: shutting down a router that serves `blobs_protocol()`
    /// used to shut down the node's shared store too, so after an endpoint
    /// restart every later fetch failed with "send get"/"unexpected end of
    /// stream" until the app was restarted.
    #[tokio::test]
    #[serial_test::serial(iroh_net)]
    async fn router_shutdown_leaves_the_shared_store_usable_for_the_next_router() {
        use iroh::address_lookup::MemoryLookup;
        use iroh::protocol::Router;
        use iroh_blobs::HashAndFormat;

        let tmp_a = tempfile::tempdir().expect("tempdir");
        let blobz_a = test_blobz(tmp_a.path()).await;
        let node_a = StorageNode::init_local(
            tmp_a.path(),
            blobz_a,
            StorageNodeOptions {
                gc_enabled: false,
                ..Default::default()
            },
        )
        .await
        .expect("init_local peer a");

        let tag = node_a
            .fs_store
            .blobs()
            .add_bytes(b"served by the second router".to_vec())
            .await
            .expect("add bytes on peer a");

        // first router comes and goes, the way an endpoint restart does.
        let endpoint_a1 = test_endpoint().await;
        node_a.attach_endpoint(&endpoint_a1);
        let router_a1 = Router::builder(endpoint_a1)
            .accept(iroh_blobs::ALPN, node_a.blobs_protocol(None))
            .spawn();
        router_a1.shutdown().await.expect("shut down router a1");
        node_a.detach_endpoint();

        assert!(
            node_a.fs_store.blobs().has(tag.hash).await.unwrap(),
            "store still answers reads after a router shutdown"
        );
        node_a
            .fs_store
            .blobs()
            .add_bytes(b"written after router shutdown".to_vec())
            .await
            .expect("store still accepts writes after a router shutdown");
        node_a
            .check_local_store()
            .await
            .expect("health probe passes after a router shutdown");

        // second router on a brand new endpoint serves the same store.
        let endpoint_a2 = test_endpoint().await;
        node_a.attach_endpoint(&endpoint_a2);
        let router_a2 = Router::builder(endpoint_a2)
            .accept(iroh_blobs::ALPN, node_a.blobs_protocol(None))
            .spawn();
        let addr_a2 = router_a2.endpoint().addr();

        let tmp_b = tempfile::tempdir().expect("tempdir");
        let blobz_b = test_blobz(tmp_b.path()).await;
        let discovery_b = MemoryLookup::new();
        discovery_b.add_endpoint_info(addr_a2.clone());
        let endpoint_b = Endpoint::builder(iroh::endpoint::presets::Minimal)
            .relay_mode(iroh::RelayMode::Disabled)
            .clear_ip_transports()
            .bind_addr("127.0.0.1:0")
            .unwrap()
            .address_lookup(discovery_b)
            .bind()
            .await
            .expect("bind endpoint b");
        let node_b = StorageNode::init(
            tmp_b.path(),
            blobz_b,
            &endpoint_b,
            StorageNodeOptions {
                gc_enabled: false,
                ..Default::default()
            },
        )
        .await
        .expect("init peer b");

        node_b
            .downloader()
            .expect("downloader attached")
            .download(HashAndFormat::raw(tag.hash), [addr_a2.id])
            .await
            .expect("peer b downloads from peer a's second router");
        let bytes = node_b.fs_store.blobs().get_bytes(tag.hash).await.unwrap();
        assert_eq!(&bytes[..], b"served by the second router");

        endpoint_b.close().await;
        router_a2.shutdown().await.ok();
    }

    #[tokio::test]
    async fn shutdown_is_idempotent_and_makes_the_health_probe_fail() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let blobz = test_blobz(tmp.path()).await;
        let node = StorageNode::init_local(
            tmp.path(),
            blobz,
            StorageNodeOptions {
                gc_enabled: false,
                ..Default::default()
            },
        )
        .await
        .expect("init_local storage node");

        node.check_local_store()
            .await
            .expect("healthy before shutdown");
        node.shutdown().await.expect("first shutdown");
        node.shutdown().await.expect("second shutdown is a no-op");

        let err = node
            .check_local_store()
            .await
            .expect_err("probe fails after shutdown");
        assert!(matches!(err, NodeError::StoreUnavailable(_)), "{err}");
    }

    /// the store dying underneath the node (the old router-shutdown bug, or
    /// its internal db task crashing) must be detected by the probe itself,
    /// not just by the shut_down flag.
    #[tokio::test]
    async fn health_probe_detects_a_store_killed_out_from_under_the_node() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let blobz = test_blobz(tmp.path()).await;
        let node = StorageNode::init_local(
            tmp.path(),
            blobz,
            StorageNodeOptions {
                gc_enabled: false,
                ..Default::default()
            },
        )
        .await
        .expect("init_local storage node");

        node.fs_store
            .shutdown()
            .await
            .expect("kill the store directly");

        let err = node
            .check_local_store()
            .await
            .expect_err("probe notices the dead store");
        assert!(matches!(err, NodeError::StoreUnavailable(_)), "{err}");
    }
}
