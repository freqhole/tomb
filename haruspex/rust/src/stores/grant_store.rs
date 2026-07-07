//! role grants for the acl evaluator (PHASE_4_HARUSPEX_RUST.md, "grants +
//! acl: the unified model").
//!
//! signature only in this task - the real sqlite implementation depends on
//! the acl evaluator's resource-ancestry model (`effective_role` walking a
//! resource's ancestors), which is a separate, larger task. no migration
//! table exists for this store yet.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::StoreError;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Viewer,
    Member,
    Admin,
}

/// who a grant applies to: a single identity, every live member of a group,
/// or every caller (`Everyone`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case", tag = "kind")]
pub enum Subject {
    Identity { identity_id: Uuid },
    Group { group_id: Uuid },
    Everyone,
}

/// a grantable thing: instance | doc | blob | collection | route-class, plus
/// its id.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Resource {
    pub kind: String,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RoleGrant {
    pub subject: Subject,
    pub resource: Resource,
    pub role: Role,
    pub granted_by: String,
    pub granted_at: i64,
    pub expires_at: Option<i64>,
}

#[async_trait]
pub trait GrantStore: Send + Sync {
    async fn grant(&self, grant: RoleGrant) -> Result<RoleGrant, StoreError>;
    async fn revoke(&self, subject: Subject, resource: Resource) -> Result<(), StoreError>;
    async fn grants_for(&self, subject: Subject) -> Result<Vec<RoleGrant>, StoreError>;
    async fn grants_on(&self, resource: Resource) -> Result<Vec<RoleGrant>, StoreError>;
}
