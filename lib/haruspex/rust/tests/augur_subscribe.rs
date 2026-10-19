//! real localhost proof of `haruspex::augur::subscribe()` - the "browse
//! everyone nearby" capability.
//!
//! also proves the discovery-session ref-counting actually tears down
//! and restarts correctly (not just "works the first time"): subscribes
//! twice in a row, dropping the first subscription before starting the
//! second.

use std::time::Duration;

use iroh::endpoint::presets;
use iroh::{Endpoint, RelayMode};
use n0_future::StreamExt;

async fn bind_endpoint() -> Endpoint {
    Endpoint::builder(presets::Minimal)
        .relay_mode(RelayMode::Disabled)
        .address_lookup(haruspex::augur::builder())
        .bind()
        .await
        .expect("bind iroh endpoint")
}

/// polls `subscribe()`'s stream until it reports `target` as found, or
/// the timeout elapses.
async fn wait_for_found(
    stream: &mut (impl StreamExt<Item = haruspex::augur::DiscoveredPeer> + Unpin),
    target: iroh::EndpointId,
) {
    tokio::time::timeout(Duration::from_secs(15), async {
        loop {
            match stream.next().await.expect("subscribe stream ended early") {
                haruspex::augur::DiscoveredPeer::Found { endpoint_id, .. }
                    if endpoint_id == target =>
                {
                    return;
                }
                _ => continue,
            }
        }
    })
    .await
    .expect("did not discover the target peer via subscribe() within 15s")
}

#[tokio::test]
async fn subscribe_discovers_a_nearby_unknown_peer() {
    // endpoint_b just needs to exist and publish (via the same
    // `builder()` wiring grimoire's `build_endpoint()` uses) - nothing
    // calls `connect()` on it; `subscribe()` alone should be enough to
    // learn its node id. endpoint_a is the one doing the subscribing -
    // its own id is passed as `subscribe()`'s `local_node_id` so its own
    // announcements (if any) get self-filtered, same as a real app would
    // see.
    let endpoint_a = bind_endpoint().await;
    let endpoint_b = bind_endpoint().await;
    let node_id_b = endpoint_b.id();

    let mut first = haruspex::augur::subscribe(endpoint_a.id()).await;
    wait_for_found(&mut first, node_id_b).await;
    drop(first);

    // dropping the first subscription should tear the shared discovery
    // session down cleanly (see `wire::DiscoveryGuard`) - a second,
    // independent subscribe() right after should still work, proving
    // teardown didn't leave anything broken for next time.
    let mut second = haruspex::augur::subscribe(endpoint_a.id()).await;
    wait_for_found(&mut second, node_id_b).await;
}
