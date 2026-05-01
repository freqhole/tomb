//! singleton iroh `Endpoint` + `MemStore` + `Downloader`. one of
//! these per process; both [`crate::host::SibylHost`] and
//! [`crate::peer::SibylPeer`] borrow it.
//!
//! mirrors the pattern in
//! `grimoire/src/federation/transport/endpoint.rs` and
//! `grimoire/src/federation/p2p_client.rs`. kept minimal because
//! sibyl doesn't need federation auth, named protocols, or a
//! persistent store — `MemStore` is enough for prototype lifetime.

use std::sync::Arc;

/// holds the iroh endpoint and an in-memory blobs store.
///
/// the actual iroh types are kept inside this module so callers
/// don't need to import iroh crates directly.
pub struct SibylNode {
    // todo (phase 2): real fields
    //   endpoint: iroh::Endpoint,
    //   store: iroh_blobs::store::mem::MemStore,
    //   downloader: iroh_blobs::downloader::Downloader,
}

impl SibylNode {
    /// build a new node with the iroh n0 preset. blocks until the
    /// endpoint binds. returns an `Arc` because both host and peer
    /// share it.
    pub async fn spawn() -> anyhow::Result<Arc<Self>> {
        // todo (phase 2): mirror federation::transport::endpoint::FederationEndpoint::new
        //   let secret_key = SecretKey::generate(rand::rngs::OsRng);
        //   let endpoint = Endpoint::builder(presets::N0).secret_key(secret_key).bind().await?;
        //   let store = iroh_blobs::store::mem::MemStore::default();
        //   let downloader = Downloader::new(&store, endpoint.clone());
        Ok(Arc::new(Self {}))
    }

    /// the local node id, formatted as a short string for logs/ui.
    pub fn node_id(&self) -> String {
        // todo (phase 2): self.endpoint.node_id().to_string()
        "<not-yet-spawned>".to_string()
    }
}
