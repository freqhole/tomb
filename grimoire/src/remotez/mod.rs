//! shared remote registry
//!
//! a single sqlite-backed list of remote freqhole instances the user can
//! connect to. used by both the spume player (in tauri) and the wizard admin
//! app, so they share one source of truth.
//!
//! pure-web spume continues to use IndexedDB; this module only runs in tauri
//! context (or anywhere the grimoire database is reachable).

pub mod models;
pub mod repository;

pub use models::{Remote, RemoteTransport, UpsertRemoteRequest};
pub use repository::RemoteRepository;

/// true if `node_id` is the `peer_addr` of a remote we ourselves added.
///
/// used to let a peer we've chosen to trust (by pairing with it) dial back
/// into us - e.g. so a sync target can pull a blob back from the device that
/// just pushed it, instead of only ever accepting connections FROM peers
/// that have separately authenticated as a local user via `user_peer_nodez`.
pub async fn is_known_remote_peer(node_id: &str) -> bool {
    matches!(
        RemoteRepository::new().get_by_peer_addr(node_id).await,
        Ok(Some(_))
    )
}
