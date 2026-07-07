//! identity + device lookups, including the batch resolvers the acl
//! evaluator and app-level joins need.

use std::collections::HashMap;

use async_trait::async_trait;
use uuid::Uuid;

use crate::error::StoreError;
use crate::identity::{DeviceNode, Identity};

/// identity/device crud, plus the batch resolvers
/// PHASE_4_HARUSPEX_RUST.md calls for so an app-level join across node ids
/// is one call, not n queries: `usernames_for(identity_ids) -> map` and
/// `identities_for(node_ids) -> map`.
#[async_trait]
pub trait IdentityStore: Send + Sync {
    /// create or update an identity by id.
    async fn upsert_identity(&self, identity: Identity) -> Result<Identity, StoreError>;
    async fn get_identity(&self, identity_id: Uuid) -> Result<Option<Identity>, StoreError>;

    /// batch username lookup.
    async fn usernames_for(
        &self,
        identity_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, Option<String>>, StoreError>;

    /// register a device node id under an identity.
    ///
    /// enforces the global-unique-even-when-deleted rule: a node id already
    /// registered to a DIFFERENT identity (whether active or soft-deleted)
    /// is rejected with `StoreError::Conflict`. re-adding a node id under
    /// the SAME identity it already belongs to restores it if soft-deleted
    /// and updates `instance_name`/`last_seen_at`.
    async fn add_device(&self, device: DeviceNode) -> Result<DeviceNode, StoreError>;
    async fn resolve_device(&self, node_id: &str) -> Result<Option<DeviceNode>, StoreError>;
    async fn touch_device(&self, node_id: &str, last_seen_at: i64) -> Result<(), StoreError>;
    /// soft-delete a device. the node id stays reserved (see `add_device`).
    async fn remove_device(&self, node_id: &str) -> Result<(), StoreError>;
    async fn devices_for_identity(&self, identity_id: Uuid) -> Result<Vec<DeviceNode>, StoreError>;

    /// batch identity lookup by node id.
    async fn identities_for(
        &self,
        node_ids: &[String],
    ) -> Result<HashMap<String, Identity>, StoreError>;
}
