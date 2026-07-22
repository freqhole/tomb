//! two real localhost iroh endpoints, `RelayMode::Disabled`, no discovery
//! configured - proving `FriendzProtocolHandler::send_message` completes
//! when addressed via the peer's full `EndpointAddr` rather than a bare
//! node id. a bare node id (no direct addresses) has no path to the peer
//! under these conditions and hangs until the connection attempt times
//! out; a full address (`endpoint.addr()`) carries the peer's direct
//! addresses and connects immediately.

use std::sync::Arc;
use std::time::Duration;

use iroh::endpoint::presets;
use iroh::protocol::Router;
use iroh::{Endpoint, RelayMode};

use haruspex::protocol::{FriendzEvent, FriendzProtocolHandler, FriendzService, FRIENDZ_ALPN};

async fn bind_endpoint() -> Endpoint {
    Endpoint::builder(presets::Minimal)
        .relay_mode(RelayMode::Disabled)
        .bind()
        .await
        .expect("bind iroh endpoint")
}

#[tokio::test]
async fn send_message_completes_when_addressed_via_the_peers_full_endpoint_addr() {
    let endpoint_a = bind_endpoint().await;
    let endpoint_b = bind_endpoint().await;

    let (service_a, _events_a) = FriendzService::new(endpoint_a.id().to_string(), "alice");
    let handler_a = FriendzProtocolHandler::new(Arc::new(service_a));

    let (service_b, mut events_b) = FriendzService::new(endpoint_b.id().to_string(), "bob");
    let handler_b = FriendzProtocolHandler::new(Arc::new(service_b));

    let router_a = Router::builder(endpoint_a.clone())
        .accept(FRIENDZ_ALPN, handler_a.clone())
        .spawn();
    let router_b = Router::builder(endpoint_b.clone())
        .accept(FRIENDZ_ALPN, handler_b.clone())
        .spawn();

    // the full address (direct addrs included) - the fix under test. a
    // bare node id built from `endpoint_b.id()` alone would have no path
    // to the peer here, since relay is disabled and no discovery service
    // is configured.
    let addr_b = endpoint_b.addr();

    let msg = handler_a.service().build_heartbeat().await;
    let send_result = tokio::time::timeout(
        Duration::from_secs(10),
        handler_a.send_message(&endpoint_a, addr_b, &msg),
    )
    .await
    .expect("send_message did not hang when addressed via a full EndpointAddr");
    send_result.expect("send_message succeeded");

    // a peer's first heartbeat marks it online (emitting `PeerOnline`)
    // before dispatch's own unconditional `MessageReceived` - read past
    // any presence-transition events to find the message event itself.
    let event = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match events_b.recv().await {
                Some(FriendzEvent::MessageReceived {
                    from_node_id,
                    message,
                }) => {
                    return Some(FriendzEvent::MessageReceived {
                        from_node_id,
                        message,
                    });
                }
                Some(_other) => continue,
                None => return None,
            }
        }
    })
    .await
    .expect("b did not receive an event in time")
    .expect("b's event channel closed unexpectedly");
    match event {
        FriendzEvent::MessageReceived {
            from_node_id,
            message,
        } => {
            assert_eq!(from_node_id, endpoint_a.id().to_string());
            assert_eq!(message.message_type(), "heartbeat");
        }
        other => panic!("expected a MessageReceived event, got {other:?}"),
    }

    router_a.shutdown().await.ok();
    router_b.shutdown().await.ok();
}
