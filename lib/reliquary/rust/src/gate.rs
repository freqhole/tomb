//! access gate seam for the `iroh-blobs/*` verified-transfer ALPN.
//!
//! provides the generic `EventSender` adapter mechanics that wire an
//! [`AccessGate`] trait object into iroh-blobs' event extension point.
//! concrete gates that consult app-specific state (friendz tables, canvas
//! acl maps, etc.) are implemented by the consuming application - this
//! crate ships the adapter plus [`AllowAll`] for open nodes.
//!
//! `iroh_blobs::provider::events::EventSender` is an upstream, documented
//! extension point (see the `iroh-blobs` crate's own `examples/limit.rs`)
//! that lets a caller intercept `ClientConnected`/`GetRequestReceived`/
//! `GetManyRequestReceived` events and accept or reject them before any
//! bytes are served. [`build_gated_blobs_events`] wires an [`AccessGate`]
//! trait object into that extension point.

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Instant;

use async_trait::async_trait;
use iroh_blobs::provider::events::{
    AbortReason, ConnectMode, EventMask, EventResult, EventSender, ProviderMessage, RequestMode,
    RequestUpdate,
};
use tokio::sync::Mutex;

/// decides whether a peer may fetch a given blob over `iroh-blobs/*`.
///
/// implementations typically consult app-specific state (a friendz table, a
/// canvas acl map, etc.) - the generic adapter in this module never does.
#[async_trait]
pub trait AccessGate: Send + Sync {
    /// true if `peer` (a node id hex string) may fetch the blob identified
    /// by `blake3` (hex).
    async fn allow_blob(&self, peer: &str, blake3: &str) -> bool;
}

/// trivial gate for open nodes: every peer may fetch every blob.
#[derive(Debug, Clone, Copy, Default)]
pub struct AllowAll;

#[async_trait]
impl AccessGate for AllowAll {
    async fn allow_blob(&self, _peer: &str, _blake3: &str) -> bool {
        true
    }
}

// ---------------------------------------------------------------------------
// outgoing transfer progress (this node is serving, some peer is snatching)
// ---------------------------------------------------------------------------

/// one outgoing blob transfer in progress - this node is serving `blake3`
/// to `peer`. see [`TransferRegistry::snapshot`].
#[derive(Debug, Clone)]
pub struct ActiveTransfer {
    pub peer: String,
    pub blake3: String,
    pub bytes_sent: u64,
    pub total_size: u64,
    pub started_at: Instant,
}

/// keyed by (connection_id, request_id) - unique per in-flight get/get_many
/// request, per iroh-blobs' own event fields.
type TransferKey = (u64, u64);

/// live registry of outgoing blob transfers, fed by [`build_gated_blobs_events`]
/// whenever `EventMask.get`/`get_many` is `RequestMode::InterceptLog`.
///
/// two consumption styles are supported so callers don't need to pick one:
/// poll [`TransferRegistry::snapshot`] on your own cadence (e.g. a
/// periodically-redrawn dashboard), or supply an `on_change` callback at
/// construction time to be pushed the full snapshot every time it changes
/// (e.g. to forward over an IPC event to a UI). both can be used at once.
pub struct TransferRegistry {
    transfers: StdMutex<HashMap<TransferKey, ActiveTransfer>>,
    on_change: Option<Arc<dyn Fn(Vec<ActiveTransfer>) + Send + Sync>>,
}

impl TransferRegistry {
    /// a registry with no push notifications - callers poll [`Self::snapshot`].
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            transfers: StdMutex::new(HashMap::new()),
            on_change: None,
        })
    }

    /// a registry that also pushes the full snapshot to `on_change` every
    /// time a transfer starts, progresses, or ends.
    pub fn with_on_change(
        on_change: impl Fn(Vec<ActiveTransfer>) + Send + Sync + 'static,
    ) -> Arc<Self> {
        Arc::new(Self {
            transfers: StdMutex::new(HashMap::new()),
            on_change: Some(Arc::new(on_change)),
        })
    }

    /// snapshot of transfers currently in flight - unordered.
    pub fn snapshot(&self) -> Vec<ActiveTransfer> {
        match self.transfers.lock() {
            Ok(map) => map.values().cloned().collect(),
            Err(_) => Vec::new(),
        }
    }

    fn upsert(&self, key: TransferKey, transfer: ActiveTransfer) {
        if let Ok(mut map) = self.transfers.lock() {
            map.insert(key, transfer);
        }
        self.notify();
    }

    fn remove(&self, key: TransferKey) {
        let removed = match self.transfers.lock() {
            Ok(mut map) => map.remove(&key).is_some(),
            Err(_) => false,
        };
        if removed {
            self.notify();
        }
    }

    fn notify(&self) {
        if let Some(on_change) = &self.on_change {
            on_change(self.snapshot());
        }
    }
}

/// RAII registration for one outgoing transfer: removed from the registry on
/// drop (covers successful completion, abort, and the drain task being
/// cancelled alike) - mirrors [`crate::snatch::SnatchEngine`]'s
/// `ActiveDownloadGuard` for the equivalent incoming-transfer case.
struct TransferGuard {
    registry: Arc<TransferRegistry>,
    key: TransferKey,
}

impl Drop for TransferGuard {
    fn drop(&mut self) {
        self.registry.remove(self.key);
    }
}

/// drain one request's `RequestUpdate` stream (only populated when
/// `RequestMode::InterceptLog` is set), updating `registry` as transfer
/// progress arrives. `blake3` is the hash known up front from the request
/// itself (for `get_many`, this is only a best guess kept in sync with
/// whichever blob is currently being sent within the batch - see this
/// module's doc comment on multi-hash requests not being exercised by this
/// app today).
async fn track_transfer(
    registry: Arc<TransferRegistry>,
    mut rx: irpc::channel::mpsc::Receiver<RequestUpdate>,
    key: TransferKey,
    peer: String,
    mut blake3: String,
) {
    let mut guard: Option<TransferGuard> = None;
    while let Ok(Some(update)) = rx.recv().await {
        match update {
            RequestUpdate::Started(started) => {
                if !started.hash.to_string().is_empty() {
                    blake3 = started.hash.to_string();
                }
                registry.upsert(
                    key,
                    ActiveTransfer {
                        peer: peer.clone(),
                        blake3: blake3.clone(),
                        bytes_sent: 0,
                        total_size: started.size,
                        started_at: Instant::now(),
                    },
                );
                guard = Some(TransferGuard {
                    registry: registry.clone(),
                    key,
                });
            }
            RequestUpdate::Progress(progress) => {
                if let Ok(mut map) = registry.transfers.lock() {
                    if let Some(entry) = map.get_mut(&key) {
                        entry.bytes_sent = progress.end_offset;
                    }
                }
                registry.notify();
            }
            RequestUpdate::Completed(_) | RequestUpdate::Aborted(_) => break,
        }
    }
    drop(guard);
}

/// build an `EventSender` that intercepts iroh-blobs' connect/get/get_many
/// events and gates them against `gate`. when `transfers` is supplied, also
/// tracks outgoing transfer progress for every allowed request (see
/// [`TransferRegistry`]).
///
/// a connection is never rejected outright at `ClientConnected` time - the
/// requested hash is only known once a get/get_many request arrives, so
/// gating happens per-request, keyed by the requester's endpoint id
/// (recorded from `ClientConnected`, looked up by connection id - iroh
/// authenticates the remote endpoint id at the QUIC/TLS layer before any
/// application data flows). a request whose connection id can't be resolved
/// to an endpoint id is denied - fail closed.
pub fn build_gated_blobs_events(
    gate: Arc<dyn AccessGate>,
    transfers: Option<Arc<TransferRegistry>>,
) -> EventSender {
    let mask = EventMask {
        connected: ConnectMode::Intercept,
        get: RequestMode::InterceptLog,
        get_many: RequestMode::InterceptLog,
        ..EventMask::DEFAULT
    };
    let (tx, mut rx) = EventSender::channel(32, mask);
    let connections: Arc<Mutex<HashMap<u64, String>>> = Arc::new(Mutex::new(HashMap::new()));

    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            match msg {
                ProviderMessage::ClientConnected(msg) => {
                    match msg.endpoint_id {
                        Some(endpoint_id) => {
                            tracing::info!(
                                connection_id = msg.connection_id,
                                peer = %endpoint_id,
                                "gate: client connected"
                            );
                            connections
                                .lock()
                                .await
                                .insert(msg.connection_id, endpoint_id.to_string());
                        }
                        None => {
                            tracing::warn!(
                                connection_id = msg.connection_id,
                                "gate: client connected with no endpoint_id — every request on this connection will be denied (fail closed)"
                            );
                        }
                    }
                    // always accept the connection itself; gating happens
                    // per-request below, once we know which hash is asked for.
                    msg.tx.send(Ok(())).await.ok();
                }
                ProviderMessage::ConnectionClosed(msg) => {
                    tracing::debug!(connection_id = msg.connection_id, "gate: connection closed");
                    connections.lock().await.remove(&msg.connection_id);
                }
                ProviderMessage::GetRequestReceived(msg) => {
                    let peer = connections.lock().await.get(&msg.connection_id).cloned();
                    let hash = msg.request.hash;
                    let allowed = match &peer {
                        Some(peer) => gate.allow_blob(peer, &hash.to_string()).await,
                        None => false,
                    };
                    if allowed {
                        tracing::info!(peer = ?peer, %hash, "gate: allowed get request");
                    } else {
                        tracing::warn!(peer = ?peer, %hash, "gate: denied get request");
                    }
                    let res: EventResult = if allowed {
                        Ok(())
                    } else {
                        Err(AbortReason::Permission)
                    };
                    let key = (msg.connection_id, msg.request_id);
                    let rx = msg.rx;
                    msg.tx.send(res).await.ok();
                    if let (true, Some(peer), Some(registry)) = (allowed, peer, transfers.clone()) {
                        tokio::spawn(track_transfer(registry, rx, key, peer, hash.to_string()));
                    }
                }
                ProviderMessage::GetManyRequestReceived(msg) => {
                    let peer = connections.lock().await.get(&msg.connection_id).cloned();
                    let allowed = match &peer {
                        Some(peer) => {
                            let mut ok = true;
                            for hash in &msg.request.hashes {
                                if !gate.allow_blob(peer, &hash.to_string()).await {
                                    ok = false;
                                    break;
                                }
                            }
                            ok
                        }
                        None => false,
                    };
                    if allowed {
                        tracing::info!(
                            peer = ?peer,
                            hash_count = msg.request.hashes.len(),
                            "gate: allowed get_many request"
                        );
                    } else {
                        tracing::warn!(peer = ?peer, "gate: denied get_many request");
                    }
                    let res: EventResult = if allowed {
                        Ok(())
                    } else {
                        Err(AbortReason::Permission)
                    };
                    // get_many isn't used by any snatch path in this app today
                    // (single-hash `GetRequest`s only) - still drain the update
                    // stream when allowed so the bounded channel never backs up,
                    // but attribution across multiple hashes in one batch is
                    // only ever as precise as the most recent `Started` event
                    // (see `track_transfer`'s doc comment).
                    let key = (msg.connection_id, msg.request_id);
                    let rx = msg.rx;
                    msg.tx.send(res).await.ok();
                    if let (true, Some(peer), Some(registry)) = (allowed, peer, transfers.clone()) {
                        tokio::spawn(track_transfer(registry, rx, key, peer, String::new()));
                    }
                }
                _ => {}
            }
        }
    });

    tx
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn allow_all_allows_anything() {
        let gate = AllowAll;
        assert!(gate.allow_blob("any-peer", "any-hash").await);
    }

    /// gate that only allows a single hardcoded peer, for testing the
    /// adapter's fail-closed / per-request gating behavior end to end.
    struct OnlyPeer(&'static str);

    #[async_trait]
    impl AccessGate for OnlyPeer {
        async fn allow_blob(&self, peer: &str, _blake3: &str) -> bool {
            peer == self.0
        }
    }

    /// real, two-endpoint, localhost-only (no relay/discovery needed) proof
    /// that `build_gated_blobs_events` actually gates byte transfer, not
    /// just the `AccessGate` trait in isolation. uses the same test pattern
    /// as `iroh_blobs`' own suite for local node pairs (`presets::Minimal` +
    /// direct `EndpointAddr`, no relay).
    async fn two_local_endpoints() -> (iroh::Endpoint, iroh::Endpoint) {
        let a = iroh::Endpoint::builder(iroh::endpoint::presets::Minimal)
            .relay_mode(iroh::RelayMode::Disabled)
            .bind()
            .await
            .expect("bind endpoint a");
        let b = iroh::Endpoint::builder(iroh::endpoint::presets::Minimal)
            .relay_mode(iroh::RelayMode::Disabled)
            .bind()
            .await
            .expect("bind endpoint b");
        (a, b)
    }

    #[tokio::test]
    #[serial_test::serial(iroh_net)]
    async fn allowed_peer_can_fetch_over_the_gated_alpn() {
        let (server_ep, client_ep) = two_local_endpoints().await;
        let server_id = server_ep.id().to_string();

        let store = iroh_blobs::store::mem::MemStore::new();
        let tag = store
            .blobs()
            .add_bytes(b"hello gate".to_vec())
            .await
            .expect("add bytes");
        let hash = tag.hash;

        let gate: Arc<dyn AccessGate> = Arc::new(OnlyPeer(Box::leak(
            client_ep.id().to_string().into_boxed_str(),
        )));
        // `on_change` fires synchronously (in the drain task) whenever a
        // transfer starts/progresses/ends - a "started" event always
        // precedes the client's `fetch()` resolving (the client can't see
        // completion before the server begins responding), so recording
        // whether we ever saw a non-empty snapshot is a reliable (not
        // racy) way to assert the transfer was tracked, unlike polling
        // `snapshot()` after the fact against what can be an
        // sub-millisecond in-memory transfer.
        let saw_transfer = Arc::new(StdMutex::new(false));
        let saw_transfer_cb = saw_transfer.clone();
        let transfers = TransferRegistry::with_on_change(move |snapshot| {
            if !snapshot.is_empty() {
                *saw_transfer_cb.lock().unwrap() = true;
            }
        });
        let events = build_gated_blobs_events(gate, Some(transfers.clone()));
        let blobs_protocol = iroh_blobs::BlobsProtocol::new(&store, Some(events));

        let router = iroh::protocol::Router::builder(server_ep)
            .accept(iroh_blobs::ALPN, blobs_protocol)
            .spawn();

        let addr = router.endpoint().addr();
        let conn = client_ep
            .connect(addr, iroh_blobs::ALPN)
            .await
            .expect("connect");
        let client_store = iroh_blobs::store::mem::MemStore::new();
        client_store
            .remote()
            .fetch(conn, hash)
            .await
            .expect("allowed peer's fetch should succeed");
        let bytes = client_store.get_bytes(hash).await.expect("get_bytes");
        assert_eq!(&bytes[..], b"hello gate");

        assert!(
            *saw_transfer.lock().unwrap(),
            "expected the transfer to be recorded in the registry during the fetch"
        );

        // and it should clean up again once the fetch completes.
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                if transfers.snapshot().is_empty() {
                    return;
                }
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("transfer registry should clear once the fetch completes");

        router.shutdown().await.ok();
        client_ep.close().await;
        let _ = server_id;
    }

    #[tokio::test]
    #[serial_test::serial(iroh_net)]
    async fn denied_peer_is_rejected() {
        let (server_ep, client_ep) = two_local_endpoints().await;

        let store = iroh_blobs::store::mem::MemStore::new();
        let tag = store
            .blobs()
            .add_bytes(b"secret bytes".to_vec())
            .await
            .expect("add bytes");
        let hash = tag.hash;

        // gate only allows some other peer id, never the real client.
        let gate: Arc<dyn AccessGate> = Arc::new(OnlyPeer("not-the-real-peer"));
        let events = build_gated_blobs_events(gate, None);
        let blobs_protocol = iroh_blobs::BlobsProtocol::new(&store, Some(events));

        let router = iroh::protocol::Router::builder(server_ep)
            .accept(iroh_blobs::ALPN, blobs_protocol)
            .spawn();

        let addr = router.endpoint().addr();
        let conn = client_ep
            .connect(addr, iroh_blobs::ALPN)
            .await
            .expect("connect");
        let client_store = iroh_blobs::store::mem::MemStore::new();
        let result = client_store.remote().fetch(conn, hash).await;
        assert!(result.is_err(), "denied peer's fetch must fail");

        router.shutdown().await.ok();
        client_ep.close().await;
    }
}
