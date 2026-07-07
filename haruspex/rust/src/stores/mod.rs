//! the six store traits behind which every app-facing haruspex api sits:
//! `IdentityStore`, `PeerDirectory`, `FriendStore`, `KnockStore`,
//! `GrantStore`, `CredentialStore`. see PHASE_4_HARUSPEX_RUST.md's module
//! map for the design these are lifted from, and
//! `docs/automerge-spike.md` for the design spike that established the
//! trait shapes.

pub mod credential_store;
pub mod friend_store;
pub mod grant_store;
pub mod identity_store;
pub mod knock_store;
pub mod peer_directory;

pub use credential_store::{Credential, CredentialStore};
pub use friend_store::{FriendDirection, FriendEdge, FriendStatus, FriendStore};
pub use grant_store::{GrantStore, Resource, Role, RoleGrant, Subject};
pub use identity_store::IdentityStore;
pub use knock_store::{
    KnockDecision, KnockDirection, KnockRecord, KnockScope, KnockStatus, KnockStore,
};
pub use peer_directory::PeerDirectory;
