//! gossip channels — peer-to-peer music sharing conversations
//!
//! uses iroh-gossip for epidemic broadcast messaging between peers.
//! channels are topic-based conversations where every message must
//! include at least one music reference.

pub mod manager;
pub mod models;
pub mod protocol;
pub mod repository;
pub mod service;

pub use manager::GossipManager;
pub use models::{
    GossipChannel, GossipChannelMember, GossipKnockRequest, GossipMessage, GossipReaction,
};
pub use protocol::{
    GossipEnvelope, GossipMessageType, MusicReference, MusicSharePayload, ReactionPayload,
};
pub use service::GossipService;
