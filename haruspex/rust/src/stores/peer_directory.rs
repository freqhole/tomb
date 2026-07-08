//! skein's peer directory: what a peer shows you.

use async_trait::async_trait;

use crate::error::StoreError;
use crate::identity::PeerProfile;

/// peer profile crud. `upsert_profile` is a coalesce-based partial upsert -
/// passing `None` for a field leaves the existing value alone, ported from
/// skein's userz table so partial profile updates never require a
/// read-modify-write round trip.
///
/// to explicitly clear an optional field back to `NULL` (rather than leave
/// it unchanged), use the dedicated `clear_*` methods below.
#[async_trait]
pub trait PeerDirectory: Send + Sync {
    async fn upsert_profile(&self, profile: PeerProfile) -> Result<PeerProfile, StoreError>;
    /// bump `last_seen` for a peer, inserting a minimal row if new.
    async fn touch(&self, node_id: &str, last_seen: i64) -> Result<(), StoreError>;
    /// mark a peer as a reliquary hub. sticky - never resets back to false.
    async fn mark_as_hub(&self, node_id: &str, last_seen: i64) -> Result<(), StoreError>;
    async fn get_profile(&self, node_id: &str) -> Result<Option<PeerProfile>, StoreError>;
    /// fetch the local node's own profile row (`is_self = true`), if any.
    async fn get_self(&self) -> Result<Option<PeerProfile>, StoreError>;
    async fn list_profiles(&self) -> Result<Vec<PeerProfile>, StoreError>;

    // --- explicit-clear methods ---
    // each sets exactly one optional column to NULL for `node_id`.
    // a no-op if the peer row does not exist.

    /// clear the custom alias for `node_id` back to NULL.
    async fn clear_alias(&self, node_id: &str) -> Result<(), StoreError>;
    /// clear the display name for `node_id` back to NULL.
    async fn clear_display_name(&self, node_id: &str) -> Result<(), StoreError>;
    /// clear the bio for `node_id` back to NULL.
    async fn clear_bio(&self, node_id: &str) -> Result<(), StoreError>;
    /// clear the avatar blake3 hash for `node_id` back to NULL.
    async fn clear_avatar(&self, node_id: &str) -> Result<(), StoreError>;
    /// clear the accent color for `node_id` back to NULL.
    async fn clear_accent_color(&self, node_id: &str) -> Result<(), StoreError>;
}
