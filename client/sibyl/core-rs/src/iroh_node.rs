//! singleton iroh `Endpoint` + `MemStore` + `Downloader`. one of
//! these per process; both [`crate::host::SibylHost`] and
//! [`crate::peer::SibylPeer`] borrow it.
//!
//! mirrors the pattern in `grimoire/src/federation/transport/endpoint.rs`
//! (`Endpoint::builder(presets::N0)`) + `grimoire/src/federation/p2p_client.rs`
//! (`MemStore::default()` + `Downloader::new(&store, endpoint)`). a
//! `Router` is started so this single node can both serve blobs to
//! peers (host role) and download from peers (peer role).
//!
//! kept minimal because sibyl doesn't need federation auth, named
//! protocols, or a persistent store.

use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Context;
use iroh::endpoint::presets::{self, Preset};
use iroh::protocol::Router;
use iroh::Endpoint;
use iroh_blobs::api::downloader::Downloader;
use iroh_blobs::api::Store;
use iroh_blobs::store::fs::FsStore;
use iroh_blobs::store::mem::MemStore;
use iroh_blobs::BlobsProtocol;
use tracing::info;

/// internal: which backing store this node uses. both backends expose
/// the unified [`Store`] handle (`MemStore`/`FsStore` both implement
/// `AsRef<Store>` + `Deref<Target = Store>`), so the rest of the node
/// is store-agnostic — host/peer code talks to `node.store()` only.
#[allow(dead_code)] // variants only kept alive so the store actor doesn't shut down
enum Backend {
    /// in-memory store. cheap, ephemeral, default for browser/wasm and tests.
    Mem(MemStore),
    /// on-disk store. used by tauri/native to keep blobs across runs and
    /// to support `ImportMode::TryReference` (file-stays-in-place hosting).
    Fs(FsStore),
}

/// holds the iroh endpoint, a blobs store (mem or fs), and a
/// downloader. cloning is cheap (everything inside is `Arc`-backed).
pub struct SibylNode {
    endpoint: Endpoint,
    store: Store,
    /// kept alive for the lifetime of the node. dropping the backend
    /// would close the store actor and break the unified `Store` handle.
    _backend: Backend,
    downloader: Downloader,
    /// kept alive so the protocol router doesn't shut down. never read
    /// directly after spawn — just dropped at shutdown.
    _router: Router,
}

impl SibylNode {
    /// build a new node with the iroh n0 preset (relay + DNS
    /// discovery), spawn the blobs protocol router, and return an
    /// `Arc` because both host and peer share it.
    pub async fn spawn() -> anyhow::Result<Arc<Self>> {
        Self::spawn_with_preset(presets::N0).await
    }

    /// like [`Self::spawn`] but lets the caller pick the preset.
    /// integration tests use [`presets::Minimal`] to avoid network
    /// dependencies.
    pub async fn spawn_with_preset<P: Preset>(preset: P) -> anyhow::Result<Arc<Self>> {
        Self::spawn_inner(preset, None).await
    }

    /// like [`Self::spawn`] but persists blobs (and outboard verification
    /// trees) under `store_path` via [`FsStore`]. used by tauri/native
    /// builds; browser/wasm builds keep the in-memory default.
    ///
    /// the directory must exist (caller responsibility — same convention
    /// as `grimoire::blobz::store`).
    pub async fn spawn_with_store_path(store_path: PathBuf) -> anyhow::Result<Arc<Self>> {
        Self::spawn_inner(presets::N0, Some(store_path)).await
    }

    async fn spawn_inner<P: Preset>(
        preset: P,
        store_path: Option<PathBuf>,
    ) -> anyhow::Result<Arc<Self>> {
        // bind endpoint with the chosen preset.
        let endpoint = Endpoint::builder(preset)
            .bind()
            .await
            .context("failed to bind iroh endpoint")?;

        info!("[sibyl-node] endpoint bound, node_id={}", endpoint.id());

        // pick backing store. both backends deref to the same `Store`
        // handle, so downloader + protocol setup is identical.
        let (backend, store): (Backend, Store) = match store_path {
            Some(path) => {
                info!("[sibyl-node] loading FsStore at {:?}", path);
                let fs_store = FsStore::load(&path)
                    .await
                    .with_context(|| format!("failed to load FsStore at {:?}", path))?;
                let store: Store = fs_store.as_ref().clone();
                (Backend::Fs(fs_store), store)
            }
            None => {
                let mem_store = MemStore::default();
                let store: Store = mem_store.as_ref().clone();
                (Backend::Mem(mem_store), store)
            }
        };

        let downloader = Downloader::new(&store, &endpoint);

        // router so peers can pull blobs via the standard blobs ALPN.
        let blobs_handler = BlobsProtocol::new(&store, None);
        let router = Router::builder(endpoint.clone())
            .accept(iroh_blobs::ALPN, blobs_handler)
            .spawn();

        info!("[sibyl-node] blobs protocol router spawned");

        Ok(Arc::new(Self {
            endpoint,
            store,
            _backend: backend,
            downloader,
            _router: router,
        }))
    }

    /// the local node id, formatted for logs/ui.
    pub fn node_id(&self) -> String {
        self.endpoint.id().to_string()
    }

    pub fn endpoint(&self) -> &Endpoint {
        &self.endpoint
    }

    pub fn store(&self) -> &Store {
        &self.store
    }

    pub fn downloader(&self) -> &Downloader {
        &self.downloader
    }
}
