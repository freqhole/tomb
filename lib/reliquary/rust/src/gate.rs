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
use std::sync::Arc;

use async_trait::async_trait;
use iroh_blobs::provider::events::{
    AbortReason, ConnectMode, EventMask, EventResult, EventSender, ProviderMessage, RequestMode,
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

/// build an `EventSender` that intercepts iroh-blobs' connect/get/get_many
/// events and gates them against `gate`.
///
/// a connection is never rejected outright at `ClientConnected` time - the
/// requested hash is only known once a get/get_many request arrives, so
/// gating happens per-request, keyed by the requester's endpoint id
/// (recorded from `ClientConnected`, looked up by connection id - iroh
/// authenticates the remote endpoint id at the QUIC/TLS layer before any
/// application data flows). a request whose connection id can't be resolved
/// to an endpoint id is denied - fail closed.
pub fn build_gated_blobs_events(gate: Arc<dyn AccessGate>) -> EventSender {
    let mask = EventMask {
        connected: ConnectMode::Intercept,
        get: RequestMode::Intercept,
        get_many: RequestMode::Intercept,
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
                    msg.tx.send(res).await.ok();
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
                    msg.tx.send(res).await.ok();
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
        let events = build_gated_blobs_events(gate);
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
        let events = build_gated_blobs_events(gate);
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
