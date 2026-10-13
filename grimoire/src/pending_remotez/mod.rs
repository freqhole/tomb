//! shared pending-remote registry
//!
//! "pending remotes" (an in-progress knock or device-link, not yet an
//! established remote) are stored as rows in the *same* `remotez` table
//! established remotes use - not a separate table (that was the original,
//! briefly-shipped-internally design; it duplicated remotez's shape
//! almost column-for-column, which is exactly the kind of schema
//! duplication this codebase keeps having to clean up elsewhere). a row
//! with `pending_stage IS NOT NULL` is pending; `pending_stage IS NULL` is
//! an established remote. see `migrations/097_pending_remotez.sql`'s doc
//! comment for the full column-mapping rationale.
//!
//! this module exists to give pending-remote operations their own clean,
//! purpose-built API (matching the frontend's `PendingRemote` shape
//! exactly) without leaking "is this row pending or established" checks
//! into every caller of `remotez::RemoteRepository` - that repository's
//! own queries simply filter pending rows out (`pending_stage IS NULL`),
//! and this one filters down to pending rows only.
//!
//! pure-web spume continues to use IndexedDB; this module only runs in
//! tauri context (or anywhere the grimoire database is reachable).

pub mod models;
pub mod repository;

pub use models::{
    CreatePendingRemoteRequest, PendingRemote, PendingRemoteCommand, UpsertPendingRemoteRequest,
};
pub use repository::PendingRemoteRepository;

/// true if `node_id` is the `peer_addr` of a pending remote we're actively
/// waiting on a response from (a knock we sent, or a device-link invite we
/// issued) - lets that peer dial back into us (e.g. to deliver a
/// knock-accepted/device-linked callback) even though it isn't yet a fully
/// established remote or registered user.
pub async fn is_pending_remote_peer(node_id: &str) -> bool {
    matches!(
        PendingRemoteRepository::new()
            .get_by_peer_addr(node_id)
            .await,
        Ok(Some(_))
    )
}
