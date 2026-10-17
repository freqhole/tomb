//! ios backend: a real c-ffi bridge to `Network.framework`'s bonjour
//! apis (`NWListener` for advertising, `NWBrowser` for discovery), via a
//! small companion swift file - see `ios/AugurBonjour.swift` next to this
//! file. unlike the android side, that file needs no consuming-app-side
//! wiring at all: `../build.rs` compiles it directly with `swiftc` and
//! links the result straight into whatever binary links this crate, the
//! same way a `cc`-compiled c file would be - nothing to add to an
//! xcode project.
//!
//! `NWBrowser`/`NWListener` are closure/delegate based, which (same as
//! `NsdManager` on android) needs a real swift-side object backing the
//! callbacks - not reachable from pure rust ffi alone. the swift side
//! calls back into the two `#[no_mangle] extern "C"` functions at the
//! bottom of this file directly by name (`@_silgen_name`-declared on its
//! side), rather than marshaling function pointers across the ffi
//! boundary - simpler than it sounds, and mirrors the android side's own
//! "call a specific, known entrypoint" shape one layer down the stack.
//!
//! wire-compatible with the macos/linux/windows AND android backends -
//! see `wire.rs`'s own doc comment for the exact shared service
//! type/instance-name/txt attribute format all three use, so any two
//! freqhole devices on the same lan discover each other with no
//! special-casing anywhere. `wire.rs` also holds the
//! `resolve(endpoint_id)`/`subscribe()` subscriber registries (shared
//! with the android backend) and the shared discovery-session
//! ref-counting - this file only has the actual ffi calls.
//!
//! known limitation, left for later: only the first address `publish()`
//! is given is advertised (same limitation as the android backend, for
//! the same reason - exactly one `NWListener`, exactly one bound port).

use std::ffi::{CStr, CString};
use std::os::raw::c_char;

use iroh::address_lookup::{
    AddressLookup, AddressLookupBuilder, AddressLookupBuilderError, EndpointData,
    Error as LookupError, Item as LookupItem,
};
use iroh::{Endpoint, EndpointId};
use n0_future::boxed::BoxStream;
use n0_future::StreamExt;
use tokio_stream::wrappers::ReceiverStream;

use super::wire::{self, DiscoveryGuard, SERVICE_TYPE};
use super::DiscoveredPeer;

/// identifies this backend's items in [`LookupItem::provenance`].
const PROVENANCE: &str = "augur-ios";

// implemented in `ios/AugurBonjour.swift`, compiled + linked by
// `../build.rs`.
unsafe extern "C" {
    fn augur_start_advertising(
        instance_name: *const c_char,
        service_type: *const c_char,
        port: u16,
        user_data: *const c_char,
        relay_url: *const c_char,
    );
    fn augur_stop_advertising();
    fn augur_start_discovery(service_type: *const c_char);
    fn augur_stop_discovery();
}

/// builder for the ios backend - see this module's own doc comment. the
/// real address-lookup work happens in [`BonjourAddressLookup`], built
/// once [`into_address_lookup`](AddressLookupBuilder::into_address_lookup)
/// runs and the endpoint's own node id is known.
#[derive(Debug, Clone, Copy, Default)]
pub struct BonjourAddressLookupBuilder;

/// returns a ready-to-use address-lookup builder for this platform - plug
/// directly into
/// `iroh::Endpoint::builder(preset).address_lookup(haruspex::augur::builder())`.
pub fn builder() -> BonjourAddressLookupBuilder {
    BonjourAddressLookupBuilder
}

impl AddressLookupBuilder for BonjourAddressLookupBuilder {
    fn into_address_lookup(
        self,
        endpoint: &Endpoint,
    ) -> Result<impl AddressLookup, AddressLookupBuilderError> {
        Ok(BonjourAddressLookup {
            node_id: endpoint.id(),
        })
    }
}

#[derive(Debug, Clone, Copy)]
struct BonjourAddressLookup {
    node_id: EndpointId,
}

impl AddressLookup for BonjourAddressLookup {
    fn publish(&self, data: &EndpointData) {
        let Some(addr) = data.ip_addrs().next() else {
            return;
        };
        let instance_name = wire::encode_instance_name(self.node_id);
        let user_data = data
            .user_data()
            .map(ToString::to_string)
            .unwrap_or_default();
        let relay_url = data
            .relay_urls()
            .next()
            .map(ToString::to_string)
            .unwrap_or_default();
        tracing::info!(
            instance_name = instance_name.as_str(),
            service_type = SERVICE_TYPE,
            port = addr.port(),
            "augur: ios starting mdns advertise"
        );
        let (Ok(instance_name), Ok(service_type), Ok(user_data), Ok(relay_url)) = (
            CString::new(instance_name),
            CString::new(SERVICE_TYPE),
            CString::new(user_data),
            CString::new(relay_url),
        ) else {
            // none of these can realistically contain an embedded nul
            // byte (base32 output, a fixed literal, and a parsed
            // url/user-data string respectively) - this is just defensive.
            return;
        };
        // safety: all four pointers are valid, nul-terminated c strings
        // for the duration of this call; `augur_start_advertising` does
        // not retain them past it (swift copies into its own `String`s
        // immediately via `String(cString:)`).
        unsafe {
            augur_start_advertising(
                instance_name.as_ptr(),
                service_type.as_ptr(),
                addr.port(),
                user_data.as_ptr(),
                relay_url.as_ptr(),
            );
        }
    }

    fn resolve(
        &self,
        endpoint_id: EndpointId,
    ) -> Option<BoxStream<Result<LookupItem, LookupError>>> {
        start_discovery();
        let rx = ReceiverStream::new(wire::register_resolver(endpoint_id));
        Some(Box::pin(DiscoveryGuard::new(rx, stop_discovery)))
    }
}

/// browses for every nearby augur peer, not just one already-known node
/// id - see [`super::DiscoveredPeer`]'s own doc comment. starts
/// `NWBrowser` discovery on first use and stops it again once the
/// returned stream (and every other live `resolve()`/`subscribe()`
/// stream) is dropped - this is the one apps should use for an
/// add-remote "nearby peerz" ui, rather than leaving discovery running
/// in the background indefinitely.
///
/// `async fn` purely for signature parity with the desktop backend
/// (which genuinely needs to await something first) - nothing here
/// actually awaits.
pub async fn subscribe(local_node_id: EndpointId) -> BoxStream<DiscoveredPeer> {
    start_discovery();
    let rx = ReceiverStream::new(wire::register_subscriber());
    Box::pin(
        DiscoveryGuard::new(rx, stop_discovery)
            .filter(move |peer| peer.endpoint_id() != local_node_id),
    )
}

fn start_discovery() {
    tracing::info!(service_type = SERVICE_TYPE, "augur: ios starting mdns discovery");
    if let Ok(service_type) = CString::new(SERVICE_TYPE) {
        // safety: see `publish()`'s own safety comment - same shape.
        unsafe { augur_start_discovery(service_type.as_ptr()) };
    }
}

#[allow(dead_code)] // reachable only via a real endpoint teardown path - not yet wired to one
fn stop_advertising() {
    tracing::info!("augur: ios stopping mdns advertise");
    // safety: takes no arguments, nothing to uphold beyond "called from
    // any thread" (`AugurBonjour`'s own dispatch queue serializes the
    // swift-side state).
    unsafe { augur_stop_advertising() };
}

/// stops `NWBrowser` discovery - called once augur's shared discovery
/// ref-count (see `wire::DiscoveryGuard`) drops to zero, i.e. no more
/// live `resolve()`/`subscribe()` consumers want it running.
fn stop_discovery() {
    tracing::info!("augur: ios stopping mdns discovery");
    // safety: takes no arguments, same shape as `stop_advertising()`.
    unsafe { augur_stop_discovery() };
}

/// decodes a (possibly-null) c string into an owned `String`. `None` for
/// null or non-utf8 input - swift always passes valid utf8 here, but this
/// is ffi-boundary code, so it's checked rather than assumed.
///
/// # safety
/// `ptr`, if non-null, must point at a valid, nul-terminated c string for
/// at least the duration of this call - true for every caller below (the
/// jvm/swift runtime owns these strings and outlives the callback).
unsafe fn decode_c_str(ptr: *const c_char) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    unsafe { CStr::from_ptr(ptr) }
        .to_str()
        .ok()
        .map(str::to_owned)
}

/// called by `AugurBonjour.resolve(_:)` once a nearby instance's
/// host/port/txt data is available. `host`/`port` are the resolved
/// socket address; `user_data`/`relay_url` are `""` (not null) for
/// "absent", matching how `augur_start_advertising` encodes the same on
/// the way out - mirrors `android.rs`'s own
/// `Java_..._nativeOnResolved` one layer down the stack.
///
/// # safety
/// called by swift with whatever arguments `AugurBonjour` passes - safe
/// as long as that's the only caller (true for a function this module
/// alone forward-declares via `@_silgen_name`).
#[unsafe(no_mangle)]
pub extern "C" fn augur_ios_on_resolved(
    instance_name: *const c_char,
    host: *const c_char,
    port: u16,
    user_data: *const c_char,
    relay_url: *const c_char,
) {
    // safety: see `decode_c_str`'s own safety comment - these pointers
    // come from the same trusted caller.
    let decoded = unsafe {
        (
            decode_c_str(instance_name),
            decode_c_str(host),
            decode_c_str(user_data),
            decode_c_str(relay_url),
        )
    };
    let (Some(instance_name), Some(host), Some(user_data), Some(relay_url)) = decoded else {
        tracing::warn!("augur: failed to decode resolved ios mdns peer");
        return;
    };
    wire::deliver_resolved(
        PROVENANCE,
        &instance_name,
        &host,
        port,
        &user_data,
        &relay_url,
    );
}

/// called by `AugurBonjour` once a previously-resolved instance
/// disappears - fanned out to `subscribe()`'s subscribers only (not
/// `resolve()`'s - its `Result<Item, Error>` stream has no "removed"
/// signal to represent this with, matching upstream
/// `iroh-mdns-address-lookup`'s own behavior).
///
/// # safety
/// same as [`augur_ios_on_resolved`].
#[unsafe(no_mangle)]
pub extern "C" fn augur_ios_on_lost(instance_name: *const c_char) {
    // safety: see `decode_c_str`'s own safety comment.
    if let Some(instance_name) = unsafe { decode_c_str(instance_name) } {
        tracing::debug!(instance_name, "augur: ios mdns peer lost");
        wire::deliver_lost(&instance_name);
    }
}
