//! the unified friendz peer protocol - message types, codec, the
//! transport-agnostic `FriendzService`/`dispatch` engine, and gossip digest
//! computation/merge logic.
//!
//! ALPN `freqhole-friendz/1` ([`messages::FRIENDZ_ALPN`]). every handler in
//! this module family is transport-agnostic by construction: [`dispatch`]
//! and [`FriendzService`] carry zero iroh (or any other transport) types.
//! the `iroh` cargo feature (`iroh_transport`) is the one place iroh types
//! appear - a thin `ProtocolHandler` shell around `dispatch`.

pub mod codec;
pub mod gossip;
pub mod messages;
pub mod service;

#[cfg(feature = "iroh")]
pub mod iroh_transport;

pub use codec::{encode_message, read_message, read_raw_payload, write_message, CodecError};
pub use gossip::{build_gossip_digest, merge_gossip_digest, GossipMergeResult};
pub use messages::{
    BrowseCapability, Capabilities, CoreMessage, FriendzMessage, GossipDigestPendingKnock,
    GossipDigestProfileEntry, WireKnockScope, DISCOVERY_SWEEP_MS, FRIENDZ_ALPN,
    HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS,
};
pub use service::{dispatch, FriendzEvent, FriendzResponse, FriendzService, LocalProfile};

#[cfg(feature = "iroh")]
pub use iroh_transport::{FriendzProtocolHandler, FriendzTransportError};
