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

use std::sync::Arc;

use anyhow::Context;
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::Endpoint;
use iroh_blobs::api::downloader::Downloader;
use iroh_blobs::api::Store;
use iroh_blobs::store::mem::MemStore;
use iroh_blobs::BlobsProtocol;
use tracing::info;

/// holds the iroh endpoint, an in-memory blobs store, and a
/// downloader. cloning is cheap (everything inside is `Arc`-backed).
pub struct SibylNode {
    endpoint: Endpoint,
    store: Store,
    mem_store: MemStore,
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
        // bind endpoint with the n0 preset (relay + DNS discovery,
        // matches `grimoire::federation::transport::endpoint::build_endpoint`).
        let endpoint = Endpoint::builder(presets::N0)
            .bind()
            .await
            .context("failed to bind iroh endpoint")?;

        info!("[sibyl-node] endpoint bound, node_id={}", endpoint.id());

        // in-memory blobs store + downloader (matches
        // `grimoire::federation::p2p_client::set_federation_endpoint`).
        let mem_store = MemStore::default();
        let store: Store = mem_store.as_ref().clone();
        let downloader = Downloader::new(&mem_store, &endpoint);

        // router so peers can pull blobs via the standard blobs ALPN.
        let blobs_handler = BlobsProtocol::new(&mem_store, None);
        let router = Router::builder(endpoint.clone())
            .accept(iroh_blobs::ALPN, blobs_handler)
            .spawn();

        info!("[sibyl-node] blobs protocol router spawned");

        Ok(Arc::new(Self {
            endpoint,
            store,
            mem_store,
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

    pub fn mem_store(&self) -> &MemStore {
        &self.mem_store
    }

    pub fn downloader(&self) -> &Downloader {
        &self.downloader
    }
}
