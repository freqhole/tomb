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

    /// issue or revoke an identity's api key: `Some(key)` replaces any
    /// existing key with `key` (rejecting it with `StoreError::Conflict` if
    /// `key` is already issued to a different identity); `None` revokes
    /// whatever key the identity currently has, a no-op if it has none. one
    /// active key per identity at a time - see `crate::identity::api_key`
    /// for the issue/revoke/validate helpers built on top of this.
    async fn set_api_key(
        &self,
        identity_id: Uuid,
        api_key: Option<String>,
    ) -> Result<(), StoreError>;
    /// resolve an api key back to the identity it was issued to.
    async fn find_by_api_key(&self, api_key: &str) -> Result<Option<Identity>, StoreError>;
    /// returns true if `identity_id` currently has an api key issued.
    async fn has_api_key(&self, identity_id: Uuid) -> Result<bool, StoreError>;

    // --- admin / hard-delete operations ---

    /// permanently delete a device row. the node id is freed and may be
    /// re-registered to any identity afterward (unlike `remove_device`,
    /// which soft-deletes and keeps the node id reserved forever).
    ///
    /// reserved for cleanup tooling - the normal soft-delete path should be
    /// preferred to preserve audit history.
    async fn hard_delete_device(&self, node_id: &str) -> Result<(), StoreError>;

    /// permanently delete an identity and all rows that reference it
    /// (devices, credentials, api keys) in one atomic operation. the
    /// identity id and any of its node ids are freed after this call.
    ///
    /// reserved for cleanup tooling. prefer soft-delete (`upsert_identity`
    /// with `deleted_at` set) for normal account management.
    async fn hard_delete_identity(&self, identity_id: Uuid) -> Result<(), StoreError>;

    /// move `node_id` onto `new_identity_id`, clearing any soft-delete marker
    /// on the device row in the same step. bypasses the global-unique-node-id
    /// rule that `add_device` enforces (which would reject a cross-identity
    /// move), so this is an explicit admin escape hatch rather than an
    /// ordinary registration.
    ///
    /// returns `StoreError::NotFound` if `node_id` has no row at all (i.e.
    /// was never registered, or was hard-deleted). the target identity must
    /// already exist.
    async fn force_reassign_device(
        &self,
        node_id: &str,
        new_identity_id: Uuid,
    ) -> Result<(), StoreError>;
}
