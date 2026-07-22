//! `SnatchEngine` driven by a mock `BlobRefSource` (a fixed set of blob
//! descriptors, as an app's automerge/sql scanning code would produce) and
//! a mock `PeerProbeTransport` (always confirms the one seeded peer has the
//! blob, standing in for a real wire probe like
//! `ensure::send_ensure_blob_request`). the actual download still goes
//! through a real iroh-blobs verified transfer against a real localhost
//! peer - only the probe leg is mocked - demonstrating the trait boundary
//! an app implements without needing a second protocol handler wired up.
//!
//! run with: `cargo run --example snatch-engine --features test-utils`

use std::sync::{Arc, Mutex as StdMutex, RwLock};

use async_trait::async_trait;
use iroh::address_lookup::MemoryLookup;
use iroh::endpoint::presets;
use iroh::{Endpoint, RelayMode};
use iroh_blobs::api::downloader::Downloader;
use iroh_blobs::store::fs::FsStore;
use iroh_blobs::Hash;
use reliquary::node::import_try_reference;
use reliquary::snatch::{
    BlobDescriptor, BlobRefSource, PeerProbeTransport, ProbeError, SnatchEngine,
    SnatchEngineOptions,
};
use reliquary::testing::make_blobz_store;
use reliquary::{BlobStore, NewBlobMeta};
use tokio::sync::broadcast;

/// a source that always reports the same fixed doc, holding one blob
/// reference - stands in for scanning an automerge doc or joining sql
/// tables in a real app.
struct FixedSource {
    descriptor: BlobDescriptor,
    _changes: broadcast::Sender<String>,
}

impl FixedSource {
    fn new(descriptor: BlobDescriptor) -> Self {
        let (changes, _rx) = broadcast::channel(1);
        Self {
            descriptor,
            _changes: changes,
        }
    }
}

#[async_trait]
impl BlobRefSource for FixedSource {
    async fn all_doc_ids(&self) -> Vec<String> {
        vec!["example-doc".to_string()]
    }

    fn subscribe_changes(&self) -> broadcast::Receiver<String> {
        self._changes.subscribe()
    }

    async fn extract_from_doc(&self, doc_id: &str) -> Vec<BlobDescriptor> {
        if doc_id == "example-doc" {
            vec![self.descriptor.clone()]
        } else {
            Vec::new()
        }
    }

    async fn on_snatched(&self, descriptor: &BlobDescriptor, local_node_id: &str) {
        println!(
            "source: {local_node_id} snatched blake3 {}",
            descriptor.blake3
        );
    }
}

/// a transport that confirms availability for exactly one known-good peer,
/// standing in for a real wire probe (e.g. `ensure::send_ensure_blob_request`).
struct FixedTransport {
    known_good_peer: String,
}

#[async_trait]
impl PeerProbeTransport for FixedTransport {
    async fn probe(&self, peer_node_id: &str, blake3: &str) -> Result<bool, ProbeError> {
        println!("transport: probing {peer_node_id} for blake3 {blake3}");
        Ok(peer_node_id == self.known_good_peer)
    }
}

async fn leaked_fs_store(dir: &std::path::Path) -> anyhow::Result<&'static FsStore> {
    Ok(Box::leak(Box::new(
        FsStore::load(dir.join("blobs.db")).await?,
    )))
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    // -- peer a: the one candidate peer that actually has the blob -------

    let (blobz_a, _tmp_a) = make_blobz_store().await;
    let blobz_a: Arc<dyn BlobStore> = Arc::new(blobz_a);

    let endpoint_a = Endpoint::builder(presets::Minimal)
        .relay_mode(RelayMode::Disabled)
        .bind()
        .await?;

    let fs_dir_a = tempfile::tempdir()?;
    let store_a = leaked_fs_store(fs_dir_a.path()).await?;
    let router_a = iroh::protocol::Router::builder(endpoint_a)
        .accept(
            iroh_blobs::ALPN,
            iroh_blobs::BlobsProtocol::new(store_a, None),
        )
        .spawn();
    let addr_a = router_a.endpoint().addr();
    let node_id_a = addr_a.id.to_string();

    let record = blobz_a
        .insert(
            b"a blob the snatch engine should replicate",
            NewBlobMeta::default(),
        )
        .await?;
    import_try_reference(store_a, &blobz_a.path_for(&record)).await?;
    println!("peer a ({node_id_a}): hosting blake3 {}", record.blake3);

    // -- peer b: runs the engine, with a mock source + mock transport ----

    let (blobz_b, _tmp_b) = make_blobz_store().await;
    let blobz_b: Arc<dyn BlobStore> = Arc::new(blobz_b);

    let discovery_b = MemoryLookup::new();
    discovery_b.add_endpoint_info(addr_a.clone());
    let endpoint_b = Endpoint::builder(presets::Minimal)
        .relay_mode(RelayMode::Disabled)
        .address_lookup(discovery_b)
        .bind()
        .await?;

    let fs_dir_b = tempfile::tempdir()?;
    let store_b = leaked_fs_store(fs_dir_b.path()).await?;
    // the downloader's connection pool defaults to a 1s connect timeout,
    // which is tight enough to flake occasionally even for a localhost
    // connection on a busy machine - give it more room for this demo.
    let downloader = Downloader::new_with_opts(
        store_b,
        &endpoint_b,
        iroh_blobs::util::connection_pool::Options {
            connect_timeout: std::time::Duration::from_secs(10),
            ..Default::default()
        },
    );
    let in_flight = Arc::new(StdMutex::new(std::collections::HashSet::<Hash>::new()));

    let source = FixedSource::new(BlobDescriptor {
        blake3: record.blake3.clone(),
        filename: "replicated.bin".to_string(),
        mime: "application/octet-stream".to_string(),
        size: 42,
        candidate_peers: vec![node_id_a.clone()],
        source_ref: "example-doc".to_string(),
    });
    let transport = FixedTransport {
        known_good_peer: node_id_a.clone(),
    };

    let engine = SnatchEngine::new(
        Arc::clone(&blobz_b),
        Arc::new(RwLock::new(Some(downloader))),
        store_b,
        in_flight,
        endpoint_b.id().to_string(),
        source,
        transport,
        SnatchEngineOptions::default(),
    );

    let snatched = engine.scan_and_snatch().await;
    assert_eq!(
        snatched, 1,
        "the engine should have replicated exactly one blob"
    );
    println!("engine: scan_and_snatch replicated {snatched} blob(s)");

    let replicated = blobz_b
        .get(&record.blake3)
        .await?
        .expect("blobz_b should now have the replicated blob's metadata");
    let bytes = blobz_b
        .read_bytes(&replicated.blake3)
        .await?
        .expect("blobz_b should have the replicated bytes on disk");
    assert_eq!(bytes, b"a blob the snatch engine should replicate");
    println!(
        "snatch-engine: peer b now holds blake3 {} ({} bytes)",
        replicated.blake3,
        bytes.len()
    );

    router_a.shutdown().await.ok();
    endpoint_b.close().await;

    Ok(())
}
