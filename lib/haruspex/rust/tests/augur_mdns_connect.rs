//! two real localhost iroh endpoints, `RelayMode::Disabled`, connecting
//! via nothing but `haruspex::augur`'s mdns-based address lookup.
//!
//! this is the end-to-end proof for the exact capability
//! `grimoire::federation::transport::endpoint::build_endpoint()` wires in
//! for desktop charnel/rathole when `[federation].lan_discovery = true`:
//! a bare node id (no direct addresses, no relay, no other address
//! lookup configured) has no other path to the peer under these
//! conditions - augur's mdns publish/resolve is the only thing that can
//! possibly make `connect()` succeed here.

use std::time::Duration;

use iroh::endpoint::{presets, Connection};
use iroh::protocol::{AcceptError, ProtocolHandler, Router};
use iroh::{Endpoint, RelayMode};

const ECHO_ALPN: &[u8] = b"augur-test-echo/1";

async fn bind_endpoint() -> Endpoint {
    Endpoint::builder(presets::Minimal)
        .relay_mode(RelayMode::Disabled)
        .address_lookup(haruspex::augur::builder())
        .bind()
        .await
        .expect("bind iroh endpoint")
}

#[derive(Debug, Clone)]
struct EchoHandler;

impl ProtocolHandler for EchoHandler {
    async fn accept(&self, connection: Connection) -> Result<(), AcceptError> {
        let (mut send, mut recv) = connection.accept_bi().await?;
        let data = recv.read_to_end(64).await.map_err(AcceptError::from_err)?;
        send.write_all(&data).await.map_err(AcceptError::from_err)?;
        send.finish().map_err(AcceptError::from_err)?;
        connection.closed().await;
        Ok(())
    }
}

#[tokio::test]
async fn connects_via_mdns_alone_using_only_the_bare_node_id() {
    let endpoint_a = bind_endpoint().await;
    let endpoint_b = bind_endpoint().await;

    let router_b = Router::builder(endpoint_b.clone())
        .accept(ECHO_ALPN, EchoHandler)
        .spawn();

    // only the bare node id - no direct addresses, no relay. see this
    // file's own doc comment for why that makes this a genuine,
    // unambiguous test of augur's mdns path specifically.
    let node_id_b = endpoint_b.id();

    let exchange = tokio::time::timeout(Duration::from_secs(15), async {
        let conn = endpoint_a.connect(node_id_b, ECHO_ALPN).await?;
        let (mut send, mut recv) = conn.open_bi().await?;
        send.write_all(b"ping").await?;
        send.finish()?;
        let response = recv.read_to_end(64).await?;
        anyhow::Ok(response)
    })
    .await
    .expect("connect+exchange did not complete via mdns within 15s - augur discovery failed");

    assert_eq!(exchange.unwrap(), b"ping");

    router_b.shutdown().await.ok();
}
