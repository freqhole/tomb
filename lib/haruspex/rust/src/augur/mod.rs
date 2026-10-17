//! augur - lan discovery for freqhole's family of apps, over mdns/dns-sd.
//! gated behind the `augur` feature (see `Cargo.toml`) - off by default,
//! same as this crate's other optional, heavier-dependency modules
//! (`webauthn`, `iroh`).
//!
//! finds nearby freqhole iroh endpoints on the same lan, for two related
//! purposes:
//!
//!   - resolving an already-known node id's current address faster than
//!     iroh's default relay + dns/pkarr resolution (which needs real
//!     internet reachability to n0's infrastructure, even when both
//!     peers are a few feet apart). [`builder()`]'s result plugs
//!     straight into
//!     `iroh::Endpoint::builder(preset).address_lookup(haruspex::augur::builder())`
//!     - both this and iroh's own dns/pkarr lookup race concurrently,
//!     whichever answers first wins (confirmed from iroh's own source:
//!     `AddressLookupServices` merges every configured lookup's stream
//!     rather than trying them in sequence) - there's no "only try mdns
//!     if dns fails" ordering to configure.
//!   - browsing for nearby node ids you do *not* yet know, for a
//!     friendly add-remote flow instead of typing/pasting a 64-char hex
//!     id by hand. [`subscribe()`] gives a live feed of
//!     [`DiscoveredPeer`] events for this - independent of any
//!     particular `Endpoint`, since it's just as useful before you've
//!     even decided to connect to anyone.
//!
//! on macos/linux/windows this is a thin wrapper around the official
//! [`iroh_mdns_address_lookup`] crate (raw multicast sockets work fine,
//! unsandboxed, on these targets). android/ios can't reliably use raw
//! multicast sockets at all (android needs a jvm-level multicast lock on
//! older versions; ios's multicast entitlement is apple-gated for
//! arbitrary/wildcard multicast - neither restriction applies to a
//! specific, pre-declared service type through the platform's own
//! resolver instead) - so those platforms get their own implementation
//! of the same traits, calling through to that resolver: a real
//! `NsdManager` bridge on android (`android.rs` + its companion
//! `android/NsdBridge.kt`), and a real `NWListener`/`NWBrowser` bridge on
//! ios (`ios.rs` + its companion `ios/AugurBonjour.swift`, compiled and
//! linked by `../build.rs` with no xcode project wiring needed at all).
//!
//! this module itself has no freqhole-app-specific code anywhere in it -
//! just the iroh traits plus whatever each platform needs to talk to its
//! own resolver - living inside haruspex is purely for distribution
//! (haruspex already ships to every app in the freqhole family via path/
//! git deps, so this comes along for free), not a dependency on anything
//! else in this crate.

use iroh::address_lookup::EndpointInfo;
use iroh::EndpointId;

/// one event from [`subscribe()`]'s "browse everyone nearby" feed - the
/// goal #2 use case (see this module's own doc comment), as opposed to
/// `builder()`'s goal #1 (resolving one already-known node id). mirrors
/// the shape of the desktop backend's own concrete
/// [`iroh_mdns_address_lookup::DiscoveryEvent`], without literally being
/// that type - android/ios can't produce one of those (it's that one
/// crate's own type, not part of the generic iroh traits), so this crate
/// needs its own platform-agnostic equivalent instead.
///
/// every platform's `subscribe(local_node_id)` already filters out
/// `local_node_id` itself before it ever reaches this feed (mdns can see
/// your own announcements bounce back) - callers never need to do that
/// filtering themselves.
#[derive(Debug, Clone)]
pub enum DiscoveredPeer {
    /// a peer was found (or its advertised info changed).
    Found {
        endpoint_id: EndpointId,
        endpoint_info: EndpointInfo,
    },
    /// a previously-found peer disappeared.
    Lost { endpoint_id: EndpointId },
}

impl DiscoveredPeer {
    /// the discovered/lost peer's node id, regardless of which variant.
    pub fn endpoint_id(&self) -> EndpointId {
        match self {
            Self::Found { endpoint_id, .. } | Self::Lost { endpoint_id } => *endpoint_id,
        }
    }
}

// every platform below exposes the exact same signature:
// `pub async fn subscribe(local_node_id: EndpointId) -> BoxStream<DiscoveredPeer>`
// - callers can treat this as a single, uniform api regardless of target
// os (the `async fn` is a no-op `.await` on android/ios, which don't need
// to wait for anything to start browsing, but keeping the signature
// identical everywhere is worth that one wasted poll).

#[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
mod desktop;
#[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
pub use desktop::{builder, subscribe};

#[cfg(any(target_os = "android", target_os = "ios"))]
mod wire;

#[cfg(target_os = "android")]
mod android;
#[cfg(target_os = "android")]
pub use android::{builder, subscribe};

#[cfg(target_os = "ios")]
mod ios;
#[cfg(target_os = "ios")]
pub use ios::{builder, subscribe};
