//! the `RoleResolver` seam.
//!
//! per PHASE_4_HARUSPEX_RUST.md's storage + sync section: "docs that carry
//! their own acl (skein canvases, playlistz doc.acl) keep doing so - the
//! in-doc acl is the authoritative store for that doc resource; haruspex
//! ships the `RoleResolver` seam bridging in-doc acl into the evaluator."
//!
//! a resolver is consulted for exactly one resource per `effective_role`
//! call (the primary resource, never its ancestors - see
//! `evaluator::AclEvaluator::effective_role`'s doc comment for why). if it
//! returns `Some(role)`, that role is authoritative for the resource and
//! `GrantStore` is not consulted for it at all; if it returns `None`
//! (the resource isn't one this resolver owns, or the resource genuinely has
//! no in-doc acl entry for this identity), the evaluator falls back to
//! stored `RoleGrant`s exactly as if no resolver had been passed.
//!
//! a concrete resolver is an app-level adapter over its own doc storage
//! (e.g. reading a skein canvas's `acl` automerge field, or playlistz's
//! `doc.acl`) - haruspex ships only the trait.

use async_trait::async_trait;
use uuid::Uuid;

use crate::stores::grant_store::{Resource, Role};

#[async_trait]
pub trait RoleResolver: Send + Sync {
    /// resolve `identity_id`'s role on `resource` from an app-owned,
    /// in-doc acl - or `None` to defer to stored `RoleGrant`s.
    async fn resolve_role(&self, identity_id: Uuid, resource: &Resource) -> Option<Role>;
}
