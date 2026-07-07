//! ensure/blob_proxy protocol handler: lets a peer ask this node to stage a
//! blob for verified `iroh-blobs/*` transfer.
//!
//! ported from skein's `protocol/blob_proxy.rs`. two differences from the
//! donor: the ALPN is a constructor parameter (skein hardcoded `skein/1`;
//! tomb and other consumers pass their own), and the friendz-only gate
//! becomes an injected [`AccessGate`] (see [`crate::gate`]), checked per
//! request against the specific blake3 being asked for rather than once per
//! connection - a stranger can open a connection, but every individual
//! ensure request is still gated.

use std::sync::Arc;

use iroh::endpoint::{RecvStream, SendStream};
use iroh::protocol::{AcceptError, ProtocolHandler};
use iroh_blobs::store::fs::FsStore;
use serde::{Deserialize, Serialize};

use crate::blobz::BlobStore;
use crate::gate::AccessGate;

// ---------------------------------------------------------------------------
// protocol messages
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PeerMessage {
    /// request that a blob (by blake3 hex) be loaded into this node's
    /// iroh-blobs store so the caller can then perform a verified download.
    EnsureBlobRequest { id: u64, blake3_hash: String },

    /// response to an `EnsureBlobRequest`.
    EnsureBlobResponse {
        id: u64,
        available: bool,
        #[serde(skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
}

// ---------------------------------------------------------------------------
// EnsureBlobHandler
// ---------------------------------------------------------------------------

/// `ensure`-protocol handler. clones are cheap (backed by `Arc`).
#[derive(Clone)]
pub struct EnsureBlobHandler {
    inner: Arc<Inner>,
}

struct Inner {
    alpn: Vec<u8>,
    store: &'static FsStore,
    blobz: Arc<dyn BlobStore>,
    gate: Arc<dyn AccessGate>,
}

impl std::fmt::Debug for EnsureBlobHandler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EnsureBlobHandler").finish_non_exhaustive()
    }
}

impl EnsureBlobHandler {
    /// `alpn` is registered by the caller (e.g. via `Router::builder(..).accept(handler.alpn(), handler.clone())`);
    /// this handler doesn't register itself with any router.
    pub fn new(
        alpn: impl Into<Vec<u8>>,
        store: &'static FsStore,
        blobz: Arc<dyn BlobStore>,
        gate: Arc<dyn AccessGate>,
    ) -> Self {
        Self {
            inner: Arc::new(Inner {
                alpn: alpn.into(),
                store,
                blobz,
                gate,
            }),
        }
    }

    /// the ALPN this handler was constructed with.
    pub fn alpn(&self) -> &[u8] {
        &self.inner.alpn
    }
}

impl ProtocolHandler for EnsureBlobHandler {
    async fn accept(&self, conn: iroh::endpoint::Connection) -> Result<(), AcceptError> {
        let peer_id = conn.remote_id().to_string();
        let peer_short = peer_id[..16.min(peer_id.len())].to_string();

        tracing::info!(peer = %peer_short, "ensure: accepted connection");

        loop {
            let (send, recv) = match conn.accept_bi().await {
                Ok(bi) => bi,
                Err(e) => {
                    tracing::debug!(peer = %peer_short, error = %e, "ensure: connection closed");
                    break;
                }
            };

            let handler = self.clone();
            let peer_id = peer_id.clone();
            let peer_short = peer_short.clone();
            tokio::spawn(async move {
                if let Err(e) = handle_stream(send, recv, &handler, &peer_id, &peer_short).await {
                    tracing::debug!(peer = %peer_short, error = %e, "ensure: stream error");
                }
            });
        }

        Ok(())
    }

    async fn shutdown(&self) {
        tracing::debug!("ensure: shutting down");
    }
}

// ---------------------------------------------------------------------------
// stream handling
// ---------------------------------------------------------------------------

async fn handle_stream(
    mut send: SendStream,
    mut recv: RecvStream,
    handler: &EnsureBlobHandler,
    peer_id: &str,
    peer_short: &str,
) -> Result<(), String> {
    let msg_bytes = recv
        .read_to_end(64 * 1024)
        .await
        .map_err(|e| format!("failed to read request: {e}"))?;

    let msg: PeerMessage =
        serde_json::from_slice(&msg_bytes).map_err(|e| format!("failed to parse request: {e}"))?;

    match msg {
        PeerMessage::EnsureBlobRequest { id, blake3_hash } => {
            let (available, error) = ensure(handler, peer_id, &blake3_hash).await;
            let resp = PeerMessage::EnsureBlobResponse {
                id,
                available,
                error,
            };
            send_response(&mut send, &resp).await
        }
        PeerMessage::EnsureBlobResponse { .. } => {
            tracing::debug!(
                peer = peer_short,
                "ensure: ignoring response on server stream"
            );
            Ok(())
        }
    }
}

/// ensure a blob with the given blake3 hex is importable from this node's
/// iroh-blobs store. gates the request against `peer_id`, looks the blob up
/// in `blobz`, finds its on-disk file, and adds it by reference into the
/// `FsStore` if not already present.
async fn ensure(
    handler: &EnsureBlobHandler,
    peer_id: &str,
    blake3_hex: &str,
) -> (bool, Option<String>) {
    if blake3_hex.len() != 64 {
        return (
            false,
            Some(format!(
                "expected 64-char blake3 hex, got {}",
                blake3_hex.len()
            )),
        );
    }

    if !handler.inner.gate.allow_blob(peer_id, blake3_hex).await {
        tracing::info!(peer = %peer_id, blake3 = %blake3_hex, "ensure: denied by access gate");
        return (false, Some("not authorized".into()));
    }

    let blob = match handler.inner.blobz.get(blake3_hex).await {
        Ok(Some(b)) => b,
        Ok(None) => return (false, Some("unknown blake3".into())),
        Err(e) => return (false, Some(format!("blobz lookup failed: {e}"))),
    };

    let path = handler.inner.blobz.path_for(&blob);
    if !path.exists() {
        return (false, Some("blob file missing on disk".into()));
    }

    // import the file into the iroh-blobs store by reference. iroh-blobs
    // computes blake3 internally and dedupes on hash, so re-imports are
    // cheap (outboard metadata only).
    match handler.inner.store.blobs().add_path(path).await {
        Ok(_tag) => (true, None),
        Err(e) => (false, Some(format!("FsStore import failed: {e}"))),
    }
}

async fn send_response(send: &mut SendStream, msg: &PeerMessage) -> Result<(), String> {
    let bytes =
        serde_json::to_vec(msg).map_err(|e| format!("failed to serialize response: {e}"))?;
    send.write_all(&bytes)
        .await
        .map_err(|e| format!("failed to write response: {e}"))?;
    send.finish()
        .map_err(|e| format!("failed to finish stream: {e}"))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// client-side helper (used by snatch::PeerProbeTransport implementations)
// ---------------------------------------------------------------------------

/// send an `EnsureBlobRequest` to `peer` over `alpn` and return whether the
/// peer reports the blob as available. a small client helper for consumers
/// implementing `snatch::PeerProbeTransport` against this exact protocol.
/// `peer` accepts either a bare node id (resolved via the endpoint's
/// configured discovery/relay) or a full `EndpointAddr` with known
/// transport addresses (bypasses discovery entirely).
pub async fn send_ensure_blob_request(
    endpoint: &iroh::Endpoint,
    alpn: &[u8],
    peer: impl Into<iroh::EndpointAddr>,
    blake3_hash: &str,
) -> Result<bool, String> {
    let addr = peer.into();
    let conn = endpoint
        .connect(addr, alpn)
        .await
        .map_err(|e| format!("failed to connect to peer: {e}"))?;

    let (mut send, mut recv) = conn
        .open_bi()
        .await
        .map_err(|e| format!("failed to open bi stream: {e}"))?;

    let request = PeerMessage::EnsureBlobRequest {
        id: 1,
        blake3_hash: blake3_hash.to_string(),
    };
    let bytes =
        serde_json::to_vec(&request).map_err(|e| format!("failed to serialize request: {e}"))?;
    send.write_all(&bytes)
        .await
        .map_err(|e| format!("failed to write request: {e}"))?;
    send.finish()
        .map_err(|e| format!("failed to finish request stream: {e}"))?;

    let response_bytes = recv
        .read_to_end(64 * 1024)
        .await
        .map_err(|e| format!("failed to read response: {e}"))?;

    let response: PeerMessage = serde_json::from_slice(&response_bytes)
        .map_err(|e| format!("failed to parse response: {e}"))?;

    match response {
        PeerMessage::EnsureBlobResponse { available, .. } => Ok(available),
        _ => Err("unexpected response type".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::blobz::{NewBlobMeta, SqliteBlobStore};
    use crate::gate::AllowAll;
    use async_trait::async_trait;

    const TEST_ALPN: &[u8] = b"reliquary-test-ensure/1";

    #[test]
    fn ensure_blob_request_roundtrip() {
        let msg = PeerMessage::EnsureBlobRequest {
            id: 42,
            blake3_hash: "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262".into(),
        };
        let j = serde_json::to_string(&msg).unwrap();
        assert!(j.contains("ensure_blob_request"));
        let back: PeerMessage = serde_json::from_str(&j).unwrap();
        assert!(matches!(
            back,
            PeerMessage::EnsureBlobRequest { id: 42, .. }
        ));
    }

    #[test]
    fn ensure_blob_response_roundtrip() {
        let msg = PeerMessage::EnsureBlobResponse {
            id: 7,
            available: true,
            error: None,
        };
        let j = serde_json::to_string(&msg).unwrap();
        let back: PeerMessage = serde_json::from_str(&j).unwrap();
        assert!(matches!(
            back,
            PeerMessage::EnsureBlobResponse {
                available: true,
                ..
            }
        ));
    }

    struct DenyAll;

    #[async_trait]
    impl AccessGate for DenyAll {
        async fn allow_blob(&self, _peer: &str, _blake3: &str) -> bool {
            false
        }
    }

    async fn test_endpoint() -> iroh::Endpoint {
        iroh::Endpoint::builder(iroh::endpoint::presets::Minimal)
            .relay_mode(iroh::RelayMode::Disabled)
            .bind()
            .await
            .expect("bind test endpoint")
    }

    /// leak an `FsStore` for the lifetime of the test process - matches the
    /// `'static` requirement of `EnsureBlobHandler`/`BlobsProtocol`, same as
    /// `StorageNode::init` does in production.
    async fn leaked_fs_store(dir: &std::path::Path) -> &'static FsStore {
        Box::leak(Box::new(
            FsStore::load(dir.join("blobs.db"))
                .await
                .expect("load fs store"),
        ))
    }

    #[tokio::test]
    #[serial_test::serial(iroh_net)]
    async fn allowed_peer_gets_available_true_and_blob_is_staged() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pool = crate::db::open_in_memory().await;
        let blobz: Arc<dyn BlobStore> = Arc::new(SqliteBlobStore::new(pool, tmp.path()));
        let record = blobz
            .insert(b"ensure me please", NewBlobMeta::default())
            .await
            .expect("insert blob");

        let fs_dir = tmp.path().join("iroh-blobs");
        tokio::fs::create_dir_all(&fs_dir).await.unwrap();
        let store = leaked_fs_store(&fs_dir).await;

        let handler =
            EnsureBlobHandler::new(TEST_ALPN, store, Arc::clone(&blobz), Arc::new(AllowAll));

        let server_ep = test_endpoint().await;
        let router = iroh::protocol::Router::builder(server_ep)
            .accept(TEST_ALPN, handler)
            .spawn();
        let server_addr = router.endpoint().addr();

        let client_ep = test_endpoint().await;
        let hash: iroh_blobs::Hash = record.blake3.parse().unwrap();
        let available =
            send_ensure_blob_request(&client_ep, TEST_ALPN, server_addr, &record.blake3)
                .await
                .expect("send_ensure_blob_request");
        assert!(
            available,
            "blob known to blobz should be reported available"
        );
        assert!(
            store.blobs().has(hash).await.unwrap(),
            "blob should now be staged in the fs store"
        );

        router.shutdown().await.ok();
        client_ep.close().await;
    }

    #[tokio::test]
    #[serial_test::serial(iroh_net)]
    async fn denied_peer_gets_available_false() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pool = crate::db::open_in_memory().await;
        let blobz: Arc<dyn BlobStore> = Arc::new(SqliteBlobStore::new(pool, tmp.path()));
        let record = blobz
            .insert(b"secret staged blob", NewBlobMeta::default())
            .await
            .expect("insert blob");

        let fs_dir = tmp.path().join("iroh-blobs");
        tokio::fs::create_dir_all(&fs_dir).await.unwrap();
        let store = leaked_fs_store(&fs_dir).await;

        let handler =
            EnsureBlobHandler::new(TEST_ALPN, store, Arc::clone(&blobz), Arc::new(DenyAll));

        let server_ep = test_endpoint().await;
        let router = iroh::protocol::Router::builder(server_ep)
            .accept(TEST_ALPN, handler)
            .spawn();
        let server_addr = router.endpoint().addr();

        let client_ep = test_endpoint().await;
        let available =
            send_ensure_blob_request(&client_ep, TEST_ALPN, server_addr, &record.blake3)
                .await
                .expect("send_ensure_blob_request");
        assert!(
            !available,
            "gate denies this peer regardless of blob presence"
        );

        router.shutdown().await.ok();
        client_ep.close().await;
    }

    #[tokio::test]
    #[serial_test::serial(iroh_net)]
    async fn unknown_blake3_reports_unavailable() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let pool = crate::db::open_in_memory().await;
        let blobz: Arc<dyn BlobStore> = Arc::new(SqliteBlobStore::new(pool, tmp.path()));

        let fs_dir = tmp.path().join("iroh-blobs");
        tokio::fs::create_dir_all(&fs_dir).await.unwrap();
        let store = leaked_fs_store(&fs_dir).await;

        let handler = EnsureBlobHandler::new(TEST_ALPN, store, blobz, Arc::new(AllowAll));

        let server_ep = test_endpoint().await;
        let router = iroh::protocol::Router::builder(server_ep)
            .accept(TEST_ALPN, handler)
            .spawn();
        let server_addr = router.endpoint().addr();

        let client_ep = test_endpoint().await;
        let unknown_hash = "0".repeat(64);
        let available = send_ensure_blob_request(&client_ep, TEST_ALPN, server_addr, &unknown_hash)
            .await
            .expect("send_ensure_blob_request");
        assert!(!available);

        router.shutdown().await.ok();
        client_ep.close().await;
    }
}
