//! skein's peer directory: what a peer shows you.

use async_trait::async_trait;

use crate::error::StoreError;
use crate::identity::PeerProfile;

/// peer profile crud. `upsert_profile` is a coalesce-based partial upsert -
/// passing `None` for a field leaves the existing value alone, ported from
/// skein's userz table so partial profile updates never require a
/// read-modify-write round trip.
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
}
