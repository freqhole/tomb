//! two real iroh endpoints on localhost, each running a `StorageNode`: peer
//! a imports a 96 KiB deterministic blob, peer b asks peer a to stage it
//! (the ensure protocol) and then downloads it via a verified iroh-blobs
//! transfer. the example asserts the blake3 hash and the bytes match on
//! both sides - this is the phase's endpoint-agnostic integration proof,
//! exercised over real localhost quic connections, not a mock.
//!
//! run with: `cargo run --example two-peer-blob-transfer --features test-utils`

use std::sync::Arc;

use iroh::address_lookup::MemoryLookup;
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{Endpoint, RelayMode};
use iroh_blobs::{Hash, HashAndFormat};

use reliquary::ensure::send_ensure_blob_request;
use reliquary::gate::AllowAll;
use reliquary::node::{export_try_reference, import_try_reference};
use reliquary::testing::{deterministic_bytes, make_blobz_store};
use reliquary::{BlobStore, EnsureBlobHandler, NewBlobMeta, StorageNode, StorageNodeOptions};

const ENSURE_ALPN: &[u8] = b"reliquary-example-ensure/1";
const PAYLOAD_SIZE: usize = 96 * 1024;
const SEED: u64 = 20260707;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // -- peer a: seeds the blob and serves it ---------------------------

    let (blobz_a, _tmp_a) = make_blobz_store().await;
    let blobz_a: Arc<dyn BlobStore> = Arc::new(blobz_a);

    let endpoint_a = Endpoint::builder(presets::Minimal)
        .relay_mode(RelayMode::Disabled)
        .bind()
        .await?;

    let data_dir_a = tempfile::tempdir()?;
    let node_a = StorageNode::init(
        data_dir_a.path(),
        Arc::clone(&blobz_a),
        &endpoint_a,
        StorageNodeOptions {
            gc_enabled: false,
            ..Default::default()
        },
    )
    .await?;

    let payload = deterministic_bytes(PAYLOAD_SIZE, SEED);
    let record = blobz_a
        .insert(
            &payload,
            NewBlobMeta {
                filename: Some("payload.bin".to_string()),
                mime: Some("application/octet-stream".to_string()),
                ..Default::default()
            },
        )
        .await?;
    println!(
        "peer a: imported {} byte blob, blake3 {}",
        payload.len(),
        record.blake3
    );

    // make it servable over iroh-blobs/* by importing the canonical file
    // into peer a's fs store, by reference (no copy).
    let path = blobz_a.path_for(&record);
    import_try_reference(node_a.fs_store, &path).await?;

    let ensure_handler = EnsureBlobHandler::new(
        ENSURE_ALPN,
        node_a.fs_store,
        Arc::clone(&blobz_a),
        Arc::new(AllowAll),
    );

    let router_a = Router::builder(endpoint_a)
        .accept(iroh_blobs::ALPN, node_a.blobs_protocol(None))
        .accept(ENSURE_ALPN, ensure_handler)
        .spawn();
    let addr_a = router_a.endpoint().addr();
    let node_id_a = addr_a.id;
    println!("peer a: listening as {node_id_a}");

    // -- peer b: ensures + downloads the blob ---------------------------

    let (blobz_b, _tmp_b) = make_blobz_store().await;
    let blobz_b: Arc<dyn BlobStore> = Arc::new(blobz_b);

    // wire an in-memory address lookup so peer b can resolve peer a's bare
    // node id without any real discovery/relay service (relay is disabled
    // for this offline localhost demo).
    let discovery_b = MemoryLookup::new();
    discovery_b.add_endpoint_info(addr_a.clone());

    let endpoint_b = Endpoint::builder(presets::Minimal)
        .relay_mode(RelayMode::Disabled)
        .address_lookup(discovery_b)
        .bind()
        .await?;

    let data_dir_b = tempfile::tempdir()?;
    let node_b = StorageNode::init(
        data_dir_b.path(),
        Arc::clone(&blobz_b),
        &endpoint_b,
        StorageNodeOptions {
            gc_enabled: false,
            ..Default::default()
        },
    )
    .await?;

    // ensure: ask peer a to have the blob staged before spending a download
    // attempt on it.
    let available =
        send_ensure_blob_request(&endpoint_b, ENSURE_ALPN, addr_a.clone(), &record.blake3)
            .await
            .map_err(|e| anyhow::anyhow!("ensure request failed: {e}"))?;
    assert!(available, "peer a should report the blob available");
    println!("peer b: ensure confirmed peer a has the blob");

    // download: a real verified iroh-blobs transfer over localhost quic.
    let hash: Hash = record.blake3.parse()?;
    node_b
        .downloader()
        .expect("node_b should have a downloader attached via StorageNode::init")
        .download(HashAndFormat::raw(hash), [node_id_a])
        .await
        .map_err(|e| anyhow::anyhow!("download failed: {e}"))?;
    println!("peer b: verified download complete");

    // export the downloaded bytes into peer b's own blobz store, mirroring
    // how production wiring completes an ensure + download cycle.
    let exported_path = export_try_reference(node_b.fs_store, hash, &blobz_b).await?;
    assert!(exported_path.exists());
    let record_b = blobz_b
        .register_ingested(
            &record.blake3,
            NewBlobMeta {
                filename: Some("payload.bin".to_string()),
                mime: Some("application/octet-stream".to_string()),
                ..Default::default()
            },
        )
        .await?;

    assert_eq!(
        record.blake3, record_b.blake3,
        "blake3 must match across peers"
    );
    let bytes_b = blobz_b
        .read_bytes(&record_b.blake3)
        .await?
        .expect("peer b has the downloaded blob");
    assert_eq!(
        bytes_b, payload,
        "downloaded bytes must be byte-identical to the original"
    );

    println!(
        "two-peer-blob-transfer: verified transfer of {} bytes, blake3 {} matches on both peers",
        payload.len(),
        record.blake3
    );

    router_a.shutdown().await.ok();
    endpoint_b.close().await;

    Ok(())
}
