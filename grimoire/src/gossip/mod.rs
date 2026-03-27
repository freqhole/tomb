//! gossip channels — peer-to-peer music sharing conversations
//!
//! uses iroh-gossip for epidemic broadcast messaging between peers.
//! channels are topic-based conversations where users share music
//! references with optional text commentary.

pub mod manager;
pub mod models;
pub mod protocol;
pub mod repository;
pub mod service;

pub use manager::GossipManager;
pub use models::{
    GossipChannel, GossipChannelMember, GossipKnockRequest, GossipMessage, GossipProfile,
    GossipReaction,
};
pub use protocol::{
    GossipEnvelope, GossipMessageType, MusicReference, MusicSharePayload, ProfileUpdatePayload,
    ReactionPayload,
};
pub use service::GossipService;
