//! `AccessGate` wired through the ensure protocol's per-request gating: an
//! allowed peer successfully fetches a blob, a denied peer is rejected. two
//! real iroh endpoints on localhost, same `EnsureBlobHandler` wiring
//! `two-peer-blob-transfer` uses, just with the gate doing real work this
//! time instead of `AllowAll`.
//!
//! run with: `cargo run --example blob-acl-gate --features test-utils`

use std::sync::Arc;

use async_trait::async_trait;
use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{Endpoint, RelayMode};

use reliquary::ensure::send_ensure_blob_request;
use reliquary::gate::AccessGate;
use reliquary::node::import_try_reference;
use reliquary::testing::make_blobz_store;
use reliquary::{BlobStore, EnsureBlobHandler, NewBlobMeta, StorageNode, StorageNodeOptions};

const ENSURE_ALPN: &[u8] = b"reliquary-example-acl-gate/1";

/// a gate that only allows one specific peer (by node id hex), denying
/// everyone else - exercises both the allow and deny paths of the same
/// gate instance.
struct OnlyOnePeer {
    allowed_peer: String,
}

#[async_trait]
impl AccessGate for OnlyOnePeer {
    async fn allow_blob(&self, peer: &str, _blake3: &str) -> bool {
        peer == self.allowed_peer
    }
}

async fn test_endpoint() -> anyhow::Result<Endpoint> {
    Ok(Endpoint::builder(presets::Minimal)
        .relay_mode(RelayMode::Disabled)
        .bind()
        .await?)
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // -- the server: hosts one blob, gated to a single allowed peer -------

    let (blobz, _tmp) = make_blobz_store().await;
    let blobz: Arc<dyn BlobStore> = Arc::new(blobz);

    let endpoint_server = test_endpoint().await?;
    let data_dir = tempfile::tempdir()?;
    let node = StorageNode::init(
        data_dir.path(),
        Arc::clone(&blobz),
        &endpoint_server,
        StorageNodeOptions {
            gc_enabled: false,
            ..Default::default()
        },
    )
    .await?;

    let record = blobz
        .insert(b"gate-guarded example blob", NewBlobMeta::default())
        .await?;
    import_try_reference(node.fs_store, &blobz.path_for(&record)).await?;

    // -- the two clients: one allowed, one denied -------------------------

    let allowed_client = test_endpoint().await?;
    let denied_client = test_endpoint().await?;
    let allowed_node_id = allowed_client.id().to_string();
    let denied_node_id = denied_client.id().to_string();

    let gate = OnlyOnePeer {
        allowed_peer: allowed_node_id.clone(),
    };
    let handler = EnsureBlobHandler::new(
        ENSURE_ALPN,
        node.fs_store,
        Arc::clone(&blobz),
        Arc::new(gate),
    );

    let router = Router::builder(endpoint_server)
        .accept(ENSURE_ALPN, handler)
        .spawn();
    let server_addr = router.endpoint().addr();

    // allow case: the gate's allowed peer asks for the blob and gets it.
    let allowed_result = send_ensure_blob_request(
        &allowed_client,
        ENSURE_ALPN,
        server_addr.clone(),
        &record.blake3,
    )
    .await
    .map_err(|e| anyhow::anyhow!("allowed peer's ensure request failed: {e}"))?;
    assert!(allowed_result, "the allowed peer must be granted access");
    println!("allowed peer ({allowed_node_id}): access granted, blob available = {allowed_result}");

    // deny case: a different peer asks for the same blob and is rejected.
    let denied_result =
        send_ensure_blob_request(&denied_client, ENSURE_ALPN, server_addr, &record.blake3)
            .await
            .map_err(|e| anyhow::anyhow!("denied peer's ensure request failed: {e}"))?;
    assert!(!denied_result, "the denied peer must not be granted access");
    println!("denied peer ({denied_node_id}): access denied, blob available = {denied_result}");

    router.shutdown().await.ok();
    allowed_client.close().await;
    denied_client.close().await;

    println!("blob-acl-gate: allow and deny cases both verified");

    Ok(())
}
