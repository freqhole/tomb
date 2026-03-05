//! Federation module for P2P coordination via haruspex
//!
//! Provides haruspex (Supabase) client for user/group sync and peer discovery.
//! This module handles the coordination layer - discovering who's in your groups
//! and syncing their identities to the local freqhole user database.

mod client;
mod credentials;
mod setup;
mod sync;

pub use client::{GroupInfo, GroupMember, HaruspexClient, PeerInfo};
pub use credentials::FederationCredentials;
pub use setup::{
    clear_credentials, get_authenticated_client, get_setup_status, get_setup_status_verified,
    interactive_setup, setup_federation, SetupResult, SetupStatus,
};
pub use sync::{interactive_sync, sync_users_from_haruspex, SyncResult, SyncStats};
