//! macos/linux/windows backend - a thin wrapper around the official
//! [`iroh_mdns_address_lookup`] crate. raw multicast sockets (what
//! `swarm-discovery`, the crate underneath this, uses) work fine,
//! unsandboxed, on these targets - no platform-resolver bridge needed
//! here the way android/ios need one.

use std::pin::Pin;
use std::task::Poll;

use iroh::EndpointId;
use n0_future::boxed::BoxStream;
use n0_future::Stream;

pub use iroh_mdns_address_lookup::{MdnsAddressLookup, MdnsAddressLookupBuilder};
#[allow(unused_imports)] // re-exported for callers, not used in this module itself
pub use iroh_mdns_address_lookup::DiscoveryEvent;

use super::DiscoveredPeer;

/// returns a ready-to-use address-lookup builder for this platform - plug
/// directly into `iroh::Endpoint::builder(preset).address_lookup(haruspex::augur::builder())`.
///
/// for the "browse everything nearby" use case, see [`subscribe()`]
/// instead.
pub fn builder() -> MdnsAddressLookupBuilder {
    MdnsAddressLookup::builder()
}

/// browses for every nearby augur peer, not just one already-known node
/// id - see [`super::DiscoveredPeer`]'s own doc comment.
///
/// `local_node_id` is still required even though this never advertises
/// (`advertise(false)` below) - `swarm-discovery`'s own discoverer needs
/// an identity regardless (used to construct its own mdns instance
/// name). it does *not* filter out this device's own announcements on
/// its own (confirmed directly from its source - multicast loopback is
/// explicitly enabled, and nothing compares a received peer's id against
/// its own), so this filters them out explicitly below instead.
///
/// builds its own independent, advertise-disabled `MdnsAddressLookup`
/// instance rather than reusing whatever one [`builder()`] already wired
/// into a real `Endpoint` (not reachable from here - iroh doesn't expose
/// a way to get a concrete backend instance back out of an `Endpoint`) -
/// a second, parallel multicast listener in the same process is a minor,
/// acceptable inefficiency for this, not a correctness problem.
pub async fn subscribe(local_node_id: EndpointId) -> BoxStream<DiscoveredPeer> {
    let lookup = match MdnsAddressLookup::builder()
        .advertise(false)
        .build(local_node_id)
    {
        Ok(lookup) => lookup,
        Err(err) => {
            tracing::warn!("augur: failed to start desktop mdns browse session: {err}");
            return Box::pin(n0_future::stream::empty());
        }
    };
    let mut events = lookup.subscribe().await;
    // the closure captures (and so keeps alive) both `lookup` and
    // `events` for as long as the returned stream is - dropping `lookup`
    // early would tear down the underlying discoverer.
    Box::pin(n0_future::stream::poll_fn(move |cx| {
        let _keep_lookup_alive = &lookup;
        loop {
            let Poll::Ready(opt) = Pin::new(&mut events).poll_next(cx) else {
                return Poll::Pending;
            };
            let Some(event) = opt else {
                return Poll::Ready(None);
            };
            match event {
                DiscoveryEvent::Discovered { endpoint_info, .. } => {
                    if endpoint_info.endpoint_id == local_node_id {
                        continue;
                    }
                    return Poll::Ready(Some(DiscoveredPeer::Found {
                        endpoint_id: endpoint_info.endpoint_id,
                        endpoint_info,
                    }));
                }
                DiscoveryEvent::Expired { endpoint_id } => {
                    if endpoint_id == local_node_id {
                        continue;
                    }
                    return Poll::Ready(Some(DiscoveredPeer::Lost { endpoint_id }));
                }
                // `DiscoveryEvent` is `#[non_exhaustive]` - a future
                // upstream variant we don't understand yet is simply
                // skipped (loop around for the next one) rather than a
                // hard compile break every time that crate adds one.
                _ => continue,
            }
        }
    }))
}
