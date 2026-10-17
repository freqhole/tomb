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

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::pin::Pin;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::task::{Context, Poll};

use iroh::address_lookup::{EndpointData, EndpointInfo, Error as LookupError, Item as LookupItem};
use iroh::{EndpointId, TransportAddr};
use n0_future::Stream;
use tokio::sync::mpsc;

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

type ResolveSender = mpsc::Sender<Result<LookupItem, LookupError>>;

/// subscribers waiting on a `resolve(endpoint_id)` call, filled in by
/// [`deliver_resolved`] whenever a matching mdns instance is
/// (re-)discovered.
static RESOLVERS: OnceLock<Mutex<HashMap<EndpointId, Vec<ResolveSender>>>> = OnceLock::new();

/// `subscribe()`'s "browse everyone nearby" subscribers.
static SUBSCRIBERS: OnceLock<Mutex<Vec<mpsc::Sender<DiscoveredPeer>>>> = OnceLock::new();

fn resolvers() -> &'static Mutex<HashMap<EndpointId, Vec<ResolveSender>>> {
    RESOLVERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn subscribers() -> &'static Mutex<Vec<mpsc::Sender<DiscoveredPeer>>> {
    SUBSCRIBERS.get_or_init(|| Mutex::new(Vec::new()))
}

/// how many live `resolve()`/`subscribe()` consumers currently want the
/// native browse session running. both platforms' `start_discovery()` is
/// idempotent (safe to call repeatedly), but only actually needs to run
/// at all while this is non-zero - see [`DiscoveryGuard`].
static DISCOVERY_REFCOUNT: AtomicUsize = AtomicUsize::new(0);

/// wraps a stream, keeping augur's shared discovery session alive for as
/// long as it's being polled and tearing it down (via `on_last_drop`) the
/// moment the *last* live `resolve()`/`subscribe()` consumer goes away -
/// e.g. the add-remote ui closing. without this, `start_discovery()`
/// would run forever once first triggered, continuously broadcasting
/// multicast queries even when nothing's listening anymore.
pub(super) struct DiscoveryGuard<S, F: FnOnce()> {
    inner: S,
    on_last_drop: Option<F>,
}

impl<S, F: FnOnce()> DiscoveryGuard<S, F> {
    pub(super) fn new(inner: S, on_last_drop: F) -> Self {
        DISCOVERY_REFCOUNT.fetch_add(1, Ordering::SeqCst);
        Self {
            inner,
            on_last_drop: Some(on_last_drop),
        }
    }
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
        if DISCOVERY_REFCOUNT.fetch_sub(1, Ordering::SeqCst) == 1 {
            if let Some(on_last_drop) = self.on_last_drop.take() {
                on_last_drop();
            }
        }
    }
}

/// registers a new `resolve(endpoint_id)` subscriber, returning the
/// receiving half of its channel (wrap in `tokio_stream::wrappers::ReceiverStream`,
/// then [`DiscoveryGuard`], to satisfy `AddressLookup::resolve`'s return
/// type while also participating in the shared discovery-session
/// ref-count).
pub(super) fn register_resolver(
    endpoint_id: EndpointId,
) -> mpsc::Receiver<Result<LookupItem, LookupError>> {
    let (tx, rx) = mpsc::channel(20);
    resolvers().lock().unwrap().entry(endpoint_id).or_default().push(tx);
    rx
}

/// registers a new `subscribe()` ("browse everyone nearby") subscriber -
/// same shape as [`register_resolver`], just not filtered to one id.
pub(super) fn register_subscriber() -> mpsc::Receiver<DiscoveredPeer> {
    let (tx, rx) = mpsc::channel(20);
    subscribers().lock().unwrap().push(tx);
    rx
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
        return;
    };
    let Ok(ip) = host.parse::<IpAddr>() else {
        tracing::warn!("augur: resolved peer with unparseable host {host:?}");
        return;
    };
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
    let item = LookupItem::new(endpoint_info.clone(), provenance, None);

    let mut map = resolvers().lock().unwrap();
    if let Some(senders) = map.get_mut(&endpoint_id) {
        // drop any subscriber whose stream was already dropped by its
        // caller - mirrors the desktop backend's own cleanup-on-send
        // pattern rather than leaking dead senders forever.
        senders.retain(|tx| tx.try_send(Ok(item.clone())).is_ok());
    }
    drop(map);

    let mut subs = subscribers().lock().unwrap();
    subs.retain(|tx| {
        tx.try_send(DiscoveredPeer::Found {
            endpoint_id,
            endpoint_info: endpoint_info.clone(),
        })
        .is_ok()
    });
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
    let mut subs = subscribers().lock().unwrap();
    subs.retain(|tx| tx.try_send(DiscoveredPeer::Lost { endpoint_id }).is_ok());
}

#[cfg(test)]
mod tests {
    use super::*;
    use iroh::SecretKey;

    #[test]
    fn instance_name_round_trips() {
        let id = SecretKey::generate().public();
        let encoded = encode_instance_name(id);
        // matches the exact shape `iroh-mdns-address-lookup` itself
        // documents (52 lowercase base32 chars for a 32-byte key).
        assert_eq!(encoded.len(), 52);
        assert!(encoded.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()));
        assert_eq!(decode_instance_name(&encoded), Some(id));
    }

    #[test]
    fn decode_rejects_garbage() {
        assert_eq!(decode_instance_name("not-a-real-instance-name"), None);
    }
}
