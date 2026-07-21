//! groups + live membership for the acl evaluator.
//!
//! a seventh store trait, not folded into `GrantStore` (PHASE_4_HARUSPEX_RUST.md
//! leaves the choice to the implementer). kept separate because `Group`/
//! `Membership` are a distinct lifecycle from `RoleGrant`: a group can exist
//! with members and zero grants (the north-star "groups become real
//! access-control objects" only needs membership to be queryable, not
//! grant-bearing), and the evaluator's `subjects(identity)` computation
//! (`crate::acl::AclEvaluator`) needs `groups_for` on its own, independent of
//! any grants-table join. folding membership into `GrantStore` would force
//! every membership read through the grants schema for no benefit.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::StoreError;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Group {
    pub id: Uuid,
    pub name: String,
    pub color: Option<String>,
    pub created_at: i64,
}

/// live, revocable group membership. removing a row is what makes
/// `AclEvaluator::effective_role` stop counting a group's grants toward an
/// identity on the very next evaluation - there is no separate revocation
/// step beyond deleting this row (see `crate::acl` module docs).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Membership {
    pub group_id: Uuid,
    pub identity_id: Uuid,
    pub added_at: i64,
}

#[async_trait]
pub trait GroupStore: Send + Sync {
    async fn create_group(&self, group: Group) -> Result<Group, StoreError>;
    async fn get_group(&self, group_id: Uuid) -> Result<Option<Group>, StoreError>;
    async fn list_groups(&self) -> Result<Vec<Group>, StoreError>;
    /// deletes the group and every membership row referencing it (cascade).
    async fn delete_group(&self, group_id: Uuid) -> Result<(), StoreError>;

    /// adds a membership row. idempotent: adding an identity that is
    /// already a member updates `added_at` rather than erroring.
    async fn add_member(
        &self,
        group_id: Uuid,
        identity_id: Uuid,
        added_at: i64,
    ) -> Result<Membership, StoreError>;
    /// removes a membership row. a no-op (not an error) if the identity was
    /// not a member.
    async fn remove_member(&self, group_id: Uuid, identity_id: Uuid) -> Result<(), StoreError>;
    async fn members_of(&self, group_id: Uuid) -> Result<Vec<Uuid>, StoreError>;
    /// every group `identity_id` is a LIVE member of - the evaluator's
    /// `subjects(identity)` computation calls this directly.
    async fn groups_for(&self, identity_id: Uuid) -> Result<Vec<Uuid>, StoreError>;
}
