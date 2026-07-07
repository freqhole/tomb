//! role grants for the acl evaluator (PHASE_4_HARUSPEX_RUST.md, "grants +
//! acl: the unified model").
//!
//! the sqlite implementation lives at `crate::sqlite::grant_store` and the
//! evaluation logic (`effective_role`, resource ancestry, the `RoleResolver`
//! seam, `Caller`, the `on_access_changed` hook) lives in `crate::acl` - this
//! module owns the entity shapes and the store trait only.

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::StoreError;

/// the grantable role hierarchy. `Root` sits above `Admin` per
/// PHASE_4_HARUSPEX_RUST.md's "freqhole adds root above admin as a
/// constant" - the doc describes the grantable role table itself as
/// admin/member/viewer (app-parameterizable), so `Root` is not meant to be
/// stored as a `RoleGrant::role` value in practice (an app assigns root
/// structurally, e.g. tomb's instance owner, never through a grant). it
/// lives on this same enum rather than a second parallel type so
/// `Caller::has_privilege`/`is_admin` can compare against one derived `Ord`
/// hierarchy (root > admin > member > viewer) without a conversion step.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Viewer,
    Member,
    Admin,
    Root,
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
/// its id. resource *ancestry* (a collection covering the docs in it, the
/// instance covering every route-class) is deliberately not modeled here -
/// haruspex does not own that membership data (an app's doc index does), so
/// `crate::acl::AclEvaluator::effective_role` takes ancestors as a caller-
/// supplied argument instead of looking them up itself.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct Resource {
    pub kind: String,
    pub id: String,
}

impl Resource {
    /// the singleton instance resource (tomb's instance-wide role table).
    /// its id is always empty - there is exactly one per haruspex deployment.
    pub fn instance() -> Self {
        Self {
            kind: "instance".to_string(),
            id: String::new(),
        }
    }

    pub fn doc(id: impl Into<String>) -> Self {
        Self {
            kind: "doc".to_string(),
            id: id.into(),
        }
    }

    pub fn blob(id: impl Into<String>) -> Self {
        Self {
            kind: "blob".to_string(),
            id: id.into(),
        }
    }

    pub fn collection(id: impl Into<String>) -> Self {
        Self {
            kind: "collection".to_string(),
            id: id.into(),
        }
    }

    pub fn route_class(id: impl Into<String>) -> Self {
        Self {
            kind: "route_class".to_string(),
            id: id.into(),
        }
    }
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

/// role-grant crud. one grant per (subject, resource) pair - granting again
/// updates the existing row (role/granted_by/granted_at/expires_at) rather
/// than creating a second one, matching the upsert convention the other
/// stores in this crate use.
#[async_trait]
pub trait GrantStore: Send + Sync {
    async fn grant(&self, grant: RoleGrant) -> Result<RoleGrant, StoreError>;
    /// delete the grant for exactly this (subject, resource) pair, if any.
    /// a no-op (not an error) if none exists.
    async fn revoke(&self, subject: Subject, resource: Resource) -> Result<(), StoreError>;
    async fn grants_for(&self, subject: Subject) -> Result<Vec<RoleGrant>, StoreError>;
    async fn grants_on(&self, resource: Resource) -> Result<Vec<RoleGrant>, StoreError>;
}
