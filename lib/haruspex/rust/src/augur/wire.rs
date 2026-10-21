//! shared mdns/dns-sd wire-format constants, resolver-registry plumbing,
//! and discovery-session ref-counting for the android/ios backends - kept
//! in one place so both stay byte-for-byte compatible with each other
//! and with the macos/linux/windows backend's `iroh-mdns-address-lookup`
//! dependency (confirmed against that crate's own source, not guessed):
//!
//!   - service type: `_irohv1._udp.` (dns-sd convention: `_<name>._udp.`,
//!     `.local.` appended automatically by the platform's mdns responder).
//!   - instance name: the 32-byte node id, encoded as lowercase, unpadded
//!     base32 (rfc 4648).
//!   - txt attributes: `user-data` (free-form string) and `relay` (a relay
//!     url string), both optional.
//!
//! a plain `NsdManager`/`NWBrowser` advertiser using these same three
//! things is indistinguishable, on the wire, from a real
//! `iroh-mdns-address-lookup` peer - no special-casing needed on either
//! side for cross-platform discovery to work.
//!
//! also centralizes the `resolve(endpoint_id)`/`subscribe()` subscriber
//! registries and the native-callback-to-`Item`/`DiscoveredPeer`
//! conversions, since both platforms need the exact same bookkeeping
//! around their otherwise-completely-different native resolvers -
//! including *not* leaving the underlying `NsdManager`/`NWBrowser`
//! browse session running forever once started: it's ref-counted, and
//! actually stopped once the last `resolve()`/`subscribe()` stream is
//! dropped (e.g. the add-remote ui closes). advertising (`publish()`) is
//! unaffected - that's a one-time, lightweight presence beacon for as
//! long as the endpoint itself is alive, not something that needs the
//! same "stop when nobody's asking" treatment as active browsing.

use std::collections::{BTreeMap, VecDeque};
use std::net::{IpAddr, SocketAddr};
use std::pin::Pin;
use std::sync::{Arc, Mutex, OnceLock};
use std::task::{Context, Poll};

use iroh::address_lookup::{EndpointData, EndpointInfo, Error as LookupError, Item as LookupItem};
use iroh::{EndpointId, TransportAddr};
use n0_future::{boxed::BoxStream, Stream, StreamExt};
use tokio::sync::watch;

use super::DiscoveredPeer;

/// the dns-sd service type this crate's backends publish/discover under -
/// matches `iroh-mdns-address-lookup`'s own default (`N0_SERVICE_NAME`).
/// a future `.service_name()` builder option (mirroring the desktop
/// backend's own) could make this configurable; not yet needed.
pub(super) const SERVICE_TYPE: &str = "_irohv1._udp.";

// the `user-data`/`relay` txt attribute key names live only as literal
// strings in `android/NsdBridge.kt`/`ios/AugurBonjour.swift` (and this
// module's own doc comment above) - neither kotlin nor swift can
// reference a rust constant, and the rust side never reads txt keys
// directly (both native bridges already extract the values positionally
// before calling back into rust), so a rust-side constant for these
// would have nothing to actually guard against drift.

/// encodes a node id as the mdns instance name
/// (`iroh-mdns-address-lookup`'s own `BASE32_NOPAD`, lowercased).
///
/// unused while ios/android's `publish()` is a deliberate no-op (see
/// `ios.rs`/`android.rs`'s own doc comments on `publish()` for why) -
/// kept (and still exercised by this module's own round-trip test below)
/// for whenever mobile accept-handling is implemented and advertising is
/// re-enabled there.
#[allow(dead_code)]
pub(super) fn encode_instance_name(endpoint_id: EndpointId) -> String {
    data_encoding::BASE32_NOPAD
        .encode(endpoint_id.as_bytes())
        .to_ascii_lowercase()
}

/// reverses [`encode_instance_name`]. `None` for anything that isn't a
/// valid encoded node id (e.g. a stray non-augur service sharing the same
/// service type by coincidence).
pub(super) fn decode_instance_name(instance_name: &str) -> Option<EndpointId> {
    let bytes = data_encoding::BASE32_NOPAD
        .decode(instance_name.to_ascii_uppercase().as_bytes())
        .ok()?;
    let bytes: [u8; 32] = bytes.try_into().ok()?;
    EndpointId::from_bytes(&bytes).ok()
}

type PeerSnapshot = Arc<BTreeMap<EndpointId, EndpointInfo>>;

struct DiscoveryRegistry {
    consumers: Mutex<usize>,
    peers: Mutex<Option<BTreeMap<EndpointId, EndpointInfo>>>,
    snapshots: watch::Sender<PeerSnapshot>,
}

impl DiscoveryRegistry {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            consumers: Mutex::new(0),
            peers: Mutex::new(None),
            snapshots: watch::channel(Arc::new(BTreeMap::new())).0,
        })
    }

    fn subscribe(
        self: &Arc<Self>,
        start: impl FnOnce(),
        stop: impl FnOnce() + Send + Unpin + 'static,
    ) -> BoxStream<DiscoveredPeer> {
        // hold the lifecycle lock through start/stop, but never the peer
        // lock: platform callbacks may deliver results synchronously.
        let mut consumers = self.consumers.lock().unwrap();
        if *consumers == 0 {
            *self.peers.lock().unwrap() = Some(BTreeMap::new());
        }
        let receiver = self.snapshots.subscribe();
        *consumers += 1;
        let stream = DiscoveryGuard {
            inner: snapshot_events(receiver),
            registry: self.clone(),
            on_last_drop: Some(stop),
        };
        if *consumers == 1 {
            start();
        }
        Box::pin(stream)
    }

    fn found(&self, endpoint_info: EndpointInfo) {
        let mut peers = self.peers.lock().unwrap();
        let Some(peers) = peers.as_mut() else {
            return; // a callback finishing after browsing stopped
        };
        if peers.get(&endpoint_info.endpoint_id) == Some(&endpoint_info) {
            return;
        }
        peers.insert(endpoint_info.endpoint_id, endpoint_info);
        self.snapshots.send_replace(Arc::new(peers.clone()));
    }

    fn lost(&self, endpoint_id: EndpointId) {
        let mut peers = self.peers.lock().unwrap();
        if let Some(peers) = peers.as_mut() {
            if peers.remove(&endpoint_id).is_some() {
                self.snapshots.send_replace(Arc::new(peers.clone()));
            }
        }
    }

    fn resolve(
        self: &Arc<Self>,
        endpoint_id: EndpointId,
        provenance: &'static str,
        start: impl FnOnce(),
        stop: impl FnOnce() + Send + Unpin + 'static,
    ) -> BoxStream<Result<LookupItem, LookupError>> {
        Box::pin(
            self.subscribe(start, stop)
                .filter_map(move |event| match event {
                    DiscoveredPeer::Found {
                        endpoint_id: id,
                        endpoint_info,
                    } if id == endpoint_id => {
                        Some(Ok(LookupItem::new(endpoint_info, provenance, None)))
                    }
                    _ => None,
                }),
        )
    }
}

fn registry() -> &'static Arc<DiscoveryRegistry> {
    static REGISTRY: OnceLock<Arc<DiscoveryRegistry>> = OnceLock::new();
    REGISTRY.get_or_init(DiscoveryRegistry::new)
}

fn snapshot_events(receiver: watch::Receiver<PeerSnapshot>) -> BoxStream<DiscoveredPeer> {
    let state = (receiver, Arc::new(BTreeMap::new()), VecDeque::new(), true);
    Box::pin(n0_future::stream::unfold(
        state,
        |(mut receiver, mut known, mut pending, mut initial)| async move {
            loop {
                if let Some(event) = pending.pop_front() {
                    return Some((event, (receiver, known, pending, initial)));
                }
                if !initial && receiver.changed().await.is_err() {
                    return None;
                }
                initial = false;
                let snapshot = receiver.borrow_and_update().clone();
                for endpoint_id in known.keys() {
                    if !snapshot.contains_key(endpoint_id) {
                        pending.push_back(DiscoveredPeer::Lost {
                            endpoint_id: *endpoint_id,
                        });
                    }
                }
                for (endpoint_id, endpoint_info) in snapshot.iter() {
                    if known.get(endpoint_id) != Some(endpoint_info) {
                        pending.push_back(DiscoveredPeer::Found {
                            endpoint_id: *endpoint_id,
                            endpoint_info: endpoint_info.clone(),
                        });
                    }
                }
                known = snapshot;
            }
        },
    ))
}

/// wraps a stream, keeping augur's shared discovery session alive for as
/// long as it's being polled and tearing it down (via `on_last_drop`) the
/// moment the *last* live `resolve()`/`subscribe()` consumer goes away -
/// e.g. the add-remote ui closing. without this, `start_discovery()`
/// would run forever once first triggered, continuously broadcasting
/// multicast queries even when nothing's listening anymore.
pub(super) struct DiscoveryGuard<S, F: FnOnce()> {
    inner: S,
    registry: Arc<DiscoveryRegistry>,
    on_last_drop: Option<F>,
}

impl<S: Stream + Unpin, F: FnOnce() + Unpin> Stream for DiscoveryGuard<S, F> {
    type Item = S::Item;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        // sound without any unsafe pin-projection: both `S` and `F` are
        // bounded `Unpin` above, which (per rust's auto-trait rules)
        // makes the whole struct `Unpin` too, so an ordinary `&mut self`
        // is always available from a `Pin<&mut Self>` to begin with.
        Pin::new(&mut self.get_mut().inner).poll_next(cx)
    }
}

impl<S, F: FnOnce()> Drop for DiscoveryGuard<S, F> {
    fn drop(&mut self) {
        let mut consumers = self.registry.consumers.lock().unwrap();
        *consumers -= 1;
        if *consumers == 0 {
            *self.registry.peers.lock().unwrap() = None;
            self.registry
                .snapshots
                .send_replace(Arc::new(BTreeMap::new()));
            if let Some(on_last_drop) = self.on_last_drop.take() {
                on_last_drop();
            }
        }
    }
}

/// a resolver sees the same initial snapshot and updates as a browser.
pub(super) fn register_resolver(
    endpoint_id: EndpointId,
    provenance: &'static str,
    start: fn(),
    stop: fn(),
) -> BoxStream<Result<LookupItem, LookupError>> {
    registry().resolve(endpoint_id, provenance, start, stop)
}

/// subscribe before starting the platform browser, replaying current peers.
pub(super) fn register_subscriber(start: fn(), stop: fn()) -> BoxStream<DiscoveredPeer> {
    registry().subscribe(start, stop)
}

/// called by each platform's native callback once a matching mdns
/// instance is (re-)discovered: decodes `instance_name` back to a node
/// id, builds the resulting [`LookupItem`]/[`DiscoveredPeer`], and fans
/// it out to any `resolve()` subscribers registered for that id *and*
/// any `subscribe()` ("browse everyone") subscribers. a no-op if
/// `instance_name` isn't a valid encoded node id (e.g. a stray non-augur
/// service sharing the same service type by coincidence, or this
/// device's own advertisement bouncing back - both platforms' resolvers
/// can self-discover; harmless either way).
pub(super) fn deliver_resolved(
    provenance: &'static str,
    instance_name: &str,
    host: &str,
    port: u16,
    user_data: &str,
    relay_url: &str,
) {
    let Some(endpoint_id) = decode_instance_name(instance_name) else {
        tracing::debug!(
            instance_name,
            "augur: ignoring resolved mdns instance that isn't a valid encoded node id"
        );
        return;
    };
    let Ok(ip) = host.parse::<IpAddr>() else {
        tracing::warn!("augur: resolved peer with unparseable host {host:?}");
        return;
    };
    // per-event, not session-level - fires on EVERY mdns resolve
    // callback (continuously, whenever discovery is active at all, not
    // just while the "nearby peerz" ui is open - also fires for any
    // `resolve(endpoint_id)` call, not only `subscribe()`), so this is
    // debug, not info - a lan with several peers advertising/
    // re-announcing periodically would otherwise flood logz.txt. the
    // one-shot session start/stop logs (`start_discovery`/
    // `stop_discovery`/builder construction) are the useful at-a-glance
    // signal; this is the detailed trace for when something's actually
    // being debugged.
    tracing::debug!(
        provenance,
        endpoint_id = %endpoint_id.fmt_short(),
        host,
        port,
        "augur: resolved nearby peer over mdns"
    );
    let mut data = EndpointData::from_iter([TransportAddr::Ip(SocketAddr::new(ip, port))]);
    if !relay_url.is_empty() {
        match relay_url.parse() {
            Ok(relay_url) => data.add_relay_url(relay_url),
            Err(err) => tracing::warn!("augur: resolved unparseable relay url: {err}"),
        }
    }
    if !user_data.is_empty() {
        match user_data.parse() {
            Ok(user_data) => data.set_user_data(Some(user_data)),
            Err(err) => tracing::warn!("augur: resolved unparseable user data: {err}"),
        }
    }
    let endpoint_info = EndpointInfo::from_parts(endpoint_id, data);
    registry().found(endpoint_info);
}

/// called by each platform's native callback once a previously-resolved
/// instance disappears - only meaningful to `subscribe()`'s subscribers
/// (`resolve()`'s `Result<Item, Error>` stream has no "removed" signal to
/// represent this with, matching upstream `iroh-mdns-address-lookup`'s
/// own behavior).
pub(super) fn deliver_lost(instance_name: &str) {
    let Some(endpoint_id) = decode_instance_name(instance_name) else {
        return;
    };
    // see `deliver_resolved`'s own comment on why this is debug, not info.
    tracing::debug!(
        endpoint_id = %endpoint_id.fmt_short(),
        "augur: nearby peer no longer visible over mdns"
    );
    registry().lost(endpoint_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    use iroh::SecretKey;
    use std::time::Duration;

    fn peer() -> EndpointInfo {
        EndpointInfo::from_parts(
            SecretKey::generate().public(),
            EndpointData::from_iter([TransportAddr::Ip("127.0.0.1:1234".parse().unwrap())]),
        )
    }

    async fn next(stream: &mut BoxStream<DiscoveredPeer>) -> DiscoveredPeer {
        tokio::time::timeout(Duration::from_secs(1), stream.next())
            .await
            .unwrap()
            .unwrap()
    }

    async fn assert_pending(stream: &mut BoxStream<DiscoveredPeer>) {
        assert!(
            tokio::time::timeout(Duration::from_millis(10), stream.next())
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn registers_before_synchronous_start_callbacks() {
        let registry = DiscoveryRegistry::new();
        let info = peer();
        let mut stream = registry.subscribe(|| registry.found(info.clone()), || {});
        assert!(
            matches!(next(&mut stream).await, DiscoveredPeer::Found { endpoint_id, .. }
            if endpoint_id == info.endpoint_id)
        );
    }

    #[tokio::test]
    async fn late_subscribers_replay_snapshot_then_receive_changes_and_losses() {
        let registry = DiscoveryRegistry::new();
        let _first = registry.subscribe(|| {}, || {});
        let mut info = peer();
        registry.found(info.clone());
        let mut second = registry.subscribe(|| panic!("browser already running"), || {});
        assert!(
            matches!(next(&mut second).await, DiscoveredPeer::Found { endpoint_info, .. }
            if endpoint_info == info)
        );
        info.data = EndpointData::from_iter([TransportAddr::Ip("127.0.0.1:5678".parse().unwrap())]);
        registry.found(info.clone());
        assert!(
            matches!(next(&mut second).await, DiscoveredPeer::Found { endpoint_info, .. }
            if endpoint_info == info)
        );
        registry.lost(info.endpoint_id);
        assert!(
            matches!(next(&mut second).await, DiscoveredPeer::Lost { endpoint_id }
            if endpoint_id == info.endpoint_id)
        );
        let mut third = registry.subscribe(|| panic!("browser already running"), || {});
        assert_pending(&mut third).await;
    }

    #[tokio::test]
    async fn duplicate_announcements_do_not_repeat_found_events() {
        let registry = DiscoveryRegistry::new();
        let mut stream = registry.subscribe(|| {}, || {});
        let info = peer();
        registry.found(info.clone());
        next(&mut stream).await;
        registry.found(info);
        assert_pending(&mut stream).await;
    }

    #[tokio::test]
    async fn slow_subscribers_resync_after_more_than_twenty_events() {
        let registry = DiscoveryRegistry::new();
        let mut stream = registry.subscribe(|| {}, || {});
        let original = peer();
        registry.found(original.clone());
        next(&mut stream).await;
        let peers: Vec<_> = (0..100).map(|_| peer()).collect();
        for info in &peers {
            registry.found(info.clone());
        }
        registry.lost(original.endpoint_id);
        let mut found = BTreeMap::new();
        let mut lost = Vec::new();
        for _ in 0..101 {
            match next(&mut stream).await {
                DiscoveredPeer::Found {
                    endpoint_id,
                    endpoint_info,
                } => {
                    found.insert(endpoint_id, endpoint_info);
                }
                DiscoveredPeer::Lost { endpoint_id } => lost.push(endpoint_id),
            }
        }
        assert_eq!(found.len(), 100);
        assert_eq!(lost, vec![original.endpoint_id]);
        let mut reopened = registry.subscribe(|| panic!("browser already running"), || {});
        for _ in 0..100 {
            assert!(
                matches!(next(&mut reopened).await, DiscoveredPeer::Found { endpoint_id, .. }
                if found.contains_key(&endpoint_id))
            );
        }
        let final_peer = peer();
        registry.found(final_peer.clone());
        assert_eq!(
            next(&mut stream).await.endpoint_id(),
            final_peer.endpoint_id
        );
        assert_eq!(
            next(&mut reopened).await.endpoint_id(),
            final_peer.endpoint_id
        );
    }

    #[tokio::test]
    async fn cached_peer_is_immediately_available_to_a_new_resolver() {
        let registry = DiscoveryRegistry::new();
        let _browser = registry.subscribe(|| {}, || {});
        let info = peer();
        registry.found(info.clone());
        let mut resolver = registry.resolve(
            info.endpoint_id,
            "test",
            || panic!("browser already running"),
            || {},
        );
        let item = tokio::time::timeout(Duration::from_secs(1), resolver.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(item.endpoint_info(), &info);
    }

    #[tokio::test]
    async fn a_resolver_keeps_discovery_alive_while_the_modal_is_closed() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let registry = DiscoveryRegistry::new();
        let browser = registry.subscribe(|| {}, || panic!("resolver still active"));
        let info = peer();
        registry.found(info.clone());
        let stops = Arc::new(AtomicUsize::new(0));
        let stopped = stops.clone();
        let resolver = registry.resolve(
            info.endpoint_id,
            "test",
            || panic!("browser already running"),
            move || {
                stopped.fetch_add(1, Ordering::SeqCst);
            },
        );
        drop(browser);
        let mut reopened = registry.subscribe(|| panic!("resolver still active"), || {});
        assert_eq!(next(&mut reopened).await.endpoint_id(), info.endpoint_id);
        drop(reopened);
        assert_eq!(stops.load(Ordering::SeqCst), 0);
        drop(resolver);
        assert_eq!(stops.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn last_drop_clears_snapshot_and_reopening_starts_fresh() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let registry = DiscoveryRegistry::new();
        let stops = Arc::new(AtomicUsize::new(0));
        let stopped = stops.clone();
        let first = registry.subscribe(
            || {},
            move || {
                stopped.fetch_add(1, Ordering::SeqCst);
            },
        );
        let second = registry.subscribe(|| panic!("browser already running"), || {});
        registry.found(peer());
        drop(second);
        assert_eq!(stops.load(Ordering::SeqCst), 0);
        drop(first);
        assert_eq!(stops.load(Ordering::SeqCst), 1);
        registry.found(peer());
        let mut reopened = registry.subscribe(|| {}, || {});
        assert_pending(&mut reopened).await;
        let info = peer();
        registry.found(info.clone());
        assert_eq!(next(&mut reopened).await.endpoint_id(), info.endpoint_id);
    }

    #[test]
    fn a_new_start_cannot_overtake_the_last_consumers_stop() {
        use std::sync::mpsc;
        let registry = DiscoveryRegistry::new();
        let (stopping, wait_stopping) = mpsc::channel();
        let (release, wait_release) = mpsc::channel();
        let stream = registry.subscribe(
            || {},
            move || {
                stopping.send(()).unwrap();
                wait_release.recv_timeout(Duration::from_secs(5)).unwrap();
            },
        );
        std::thread::scope(|scope| {
            scope.spawn(move || drop(stream));
            wait_stopping.recv_timeout(Duration::from_secs(1)).unwrap();
            let (started, wait_started) = mpsc::channel();
            let registry = registry.clone();
            scope.spawn(move || {
                let _stream = registry.subscribe(
                    || {
                        started.send(()).unwrap();
                    },
                    || {},
                );
            });
            assert!(wait_started
                .recv_timeout(Duration::from_millis(20))
                .is_err());
            release.send(()).unwrap();
            wait_started.recv_timeout(Duration::from_secs(1)).unwrap();
        });
    }

    #[test]
    fn instance_name_round_trips() {
        let id = SecretKey::generate().public();
        let encoded = encode_instance_name(id);
        // matches the exact shape `iroh-mdns-address-lookup` itself
        // documents (52 lowercase base32 chars for a 32-byte key).
        assert_eq!(encoded.len(), 52);
        assert!(encoded
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()));
        assert_eq!(decode_instance_name(&encoded), Some(id));
    }

    #[test]
    fn decode_rejects_garbage() {
        assert_eq!(decode_instance_name("not-a-real-instance-name"), None);
    }
}
