//! federation module for P2P coordination via haruspex
//!
//! provides haruspex (Supabase) client for user/group sync and peer discovery.
//! this module handles the coordination layer - discovering who's in your groups
//! and syncing their identities to the local freqhole user database.
//!
//! the optional `transport` submodule provides the actual iroh P2P networking.

mod client;
mod credentials;
mod identity;
pub mod p2p_client;
mod resolver;
mod setup;
mod sync;
pub mod transport;

pub use client::{GroupInfo, GroupMember, HaruspexClient, NodeIdUserInfo, PeerInfo};
pub use credentials::FederationCredentials;
pub use identity::{
    generate_keypair, get_identity_info, get_node_id, keypair_exists, keypair_path, load_keypair,
    load_or_generate_keypair, IdentityInfo,
};
pub use resolver::{get_local_user_by_node_id, is_known_peer, resolve_peer, ResolvedPeer};
pub use setup::{
    clear_credentials, get_authenticated_client, get_setup_status, get_setup_status_verified,
    setup_federation, SetupResult, SetupStatus,
};
pub use sync::{
    sync_users_from_haruspex, sync_users_from_stored_credentials, SyncResult, SyncStats,
};
