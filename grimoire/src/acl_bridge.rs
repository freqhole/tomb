// CUTOVER(0.2.0): this entire module exists to bridge grimoire's admin flag onto haruspex's acl evaluator without backfilling RoleGrant rows; can be deleted once instance-admin RoleGrants are backfilled and grimoire.user_accountz.role is dropped

//! bridges instance-wide admin routes onto haruspex's acl evaluator.
//!
//! grimoire still tracks its own admin flag on `user_accountz.role`
//! (`UserRole::Admin`/`Root`), while haruspex's grant model
//! (`RoleGrant`/`AclEvaluator`) is the newer, resource-scoped source of
//! truth. `GrimoireRoleResolver` lets the two coexist without a one-time
//! backfill: for the instance-wide admin resource, it reports grimoire's
//! own admin flag as an authoritative role whenever the flag is set, and
//! otherwise defers to haruspex's stored `RoleGrant`s (so an explicit
//! haruspex grant can still raise a caller's access even for a user
//! grimoire itself doesn't consider an admin). every other resource defers
//! straight to stored grants - this module only speaks for the instance
//! resource.

use std::sync::Arc;

use async_trait::async_trait;
use haruspex::acl::{AclEvaluator, RoleResolver};
use haruspex::error::StoreError;
use haruspex::stores::{GrantStore, GroupStore, IdentityStore, Resource, Role};
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::database;
use crate::error::{ErrorDetail, GrimoireError, GrimoireResult};
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use crate::users::haruspex_bridge;

/// answers "does grimoire's own `user_accountz` row for this user currently
/// carry the admin flag" - the fallback `GrimoireRoleResolver` consults.
/// a trait (rather than calling `crate::users::get_user` directly) so
/// tests can exercise the resolver against an in-memory haruspex db without
/// also standing up grimoire's own database.
#[async_trait]
trait GrimoireAdminFlag: Send + Sync {
    /// `None` means "no such grimoire user" (never treated as admin).
    async fn is_admin(&self, user_id: &str) -> Option<bool>;
}

struct LiveGrimoireAdminFlag;

#[async_trait]
impl GrimoireAdminFlag for LiveGrimoireAdminFlag {
    async fn is_admin(&self, user_id: &str) -> Option<bool> {
        crate::users::get_user(user_id)
            .await
            .data
            .map(|user| user.is_admin())
    }
}

struct GrimoireRoleResolver {
    identities: Arc<dyn IdentityStore>,
    admin_flag: Arc<dyn GrimoireAdminFlag>,
}

#[async_trait]
impl RoleResolver for GrimoireRoleResolver {
    async fn resolve_role(&self, identity_id: Uuid, resource: &Resource) -> Option<Role> {
        if resource != &Resource::instance() {
            return None;
        }
        let user_id =
            haruspex_bridge::grimoire_user_id_for_identity(self.identities.as_ref(), identity_id)
                .await
                .ok()
                .flatten()?;
        if self.admin_flag.is_admin(&user_id).await? {
            Some(Role::Admin)
        } else {
            None
        }
    }
}

/// open haruspex's grant/group/identity stores (via `connect_haruspex()`,
/// the same pool every other haruspex-backed store in this crate shares)
/// and assemble an evaluator + role resolver ready to answer
/// `effective_role` queries.
async fn acl_evaluator() -> GrimoireResult<(AclEvaluator, GrimoireRoleResolver)> {
    let pool = database::connect_haruspex().await?;
    let grants: Arc<dyn GrantStore> =
        Arc::new(haruspex::sqlite::SqliteGrantStore::new(pool.clone()));
    let groups: Arc<dyn GroupStore> =
        Arc::new(haruspex::sqlite::SqliteGroupStore::new(pool.clone()));
    let identities: Arc<dyn IdentityStore> =
        Arc::new(haruspex::sqlite::SqliteIdentityStore::new(pool));
    let resolver = GrimoireRoleResolver {
        identities,
        admin_flag: Arc::new(LiveGrimoireAdminFlag),
    };
    Ok((AclEvaluator::new(grants, groups), resolver))
}

/// true iff `identity_id` currently resolves to at least `Role::Admin` on
/// the instance-wide admin resource, per `evaluator`/`resolver`. split out
/// from `is_instance_admin` so tests can exercise the real evaluation logic
/// against an in-memory haruspex db without going through
/// `connect_haruspex()`.
async fn admin_role(
    evaluator: &AclEvaluator,
    resolver: &GrimoireRoleResolver,
    identity_id: Uuid,
    now: i64,
) -> Result<bool, StoreError> {
    let role = evaluator
        .effective_role(identity_id, &Resource::instance(), &[], now, Some(resolver))
        .await?;
    Ok(role.is_some_and(|role| role >= Role::Admin))
}

/// true iff `caller` currently resolves to at least `Role::Admin` on the
/// instance-wide admin resource - the acl-backed replacement for grimoire's
/// own `Caller::is_admin`, scoped to instance-wide admin routes.
pub(crate) async fn is_instance_admin(caller: &Caller) -> GrimoireResult<bool> {
    let identity_id = haruspex_bridge::identity_id_for_existing_user(&caller.user_id);
    let (evaluator, resolver) = acl_evaluator().await?;
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    admin_role(&evaluator, &resolver, identity_id, now)
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("acl evaluation failed: {e}"),
        })
}

/// guard for instance-wide admin routes: `Ok(())` if `caller` passes,
/// otherwise an error response ready to return directly from the handler
/// (a forbidden response, or a surfaced acl-store failure).
pub(crate) async fn require_instance_admin(
    caller: &Caller,
) -> Result<(), GrimoireResponse<JsonValue>> {
    match is_instance_admin(caller).await {
        Ok(true) => Ok(()),
        Ok(false) => Err(GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        )),
        Err(e) => Err(GrimoireResponse::failure(
            "acl check failed",
            vec![ErrorDetail::from(e)],
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use haruspex::identity::Identity;
    use haruspex::stores::{RoleGrant, Subject};
    use sqlx::SqlitePool;
    use std::collections::HashMap;

    /// an in-memory haruspex db, migrated the same way haruspex's own test
    /// pools are - independent of grimoire's own database entirely.
    async fn test_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite pool");
        haruspex::sqlite::migrate(&pool)
            .await
            .expect("run haruspex migrations");
        pool
    }

    /// a fixed table of grimoire user id -> admin flag, standing in for
    /// `crate::users::get_user(..).is_admin()` without touching grimoire's
    /// own database.
    struct FakeAdminFlag(HashMap<String, bool>);

    #[async_trait]
    impl GrimoireAdminFlag for FakeAdminFlag {
        async fn is_admin(&self, user_id: &str) -> Option<bool> {
            self.0.get(user_id).copied()
        }
    }

    async fn seed_identity(identities: &dyn IdentityStore, grimoire_user_id: &str) -> Uuid {
        let id = haruspex_bridge::identity_id_for_existing_user(grimoire_user_id);
        identities
            .upsert_identity(Identity {
                id,
                username: Some(grimoire_user_id.to_string()),
                created_at: 1000,
                metadata: Some(serde_json::json!({ "grimoire_user_id": grimoire_user_id })),
                deleted_at: None,
            })
            .await
            .expect("seed identity");
        id
    }

    async fn harness(
        admin_user_ids: &[&str],
    ) -> (
        AclEvaluator,
        GrimoireRoleResolver,
        Arc<dyn IdentityStore>,
        Arc<dyn GrantStore>,
    ) {
        let pool = test_pool().await;
        let grants: Arc<dyn GrantStore> =
            Arc::new(haruspex::sqlite::SqliteGrantStore::new(pool.clone()));
        let groups: Arc<dyn GroupStore> =
            Arc::new(haruspex::sqlite::SqliteGroupStore::new(pool.clone()));
        let identities: Arc<dyn IdentityStore> =
            Arc::new(haruspex::sqlite::SqliteIdentityStore::new(pool));

        let flags = admin_user_ids
            .iter()
            .map(|id| (id.to_string(), true))
            .collect();
        let resolver = GrimoireRoleResolver {
            identities: identities.clone(),
            admin_flag: Arc::new(FakeAdminFlag(flags)),
        };

        (
            AclEvaluator::new(grants.clone(), groups),
            resolver,
            identities,
            grants,
        )
    }

    #[tokio::test]
    async fn grimoire_admin_flag_grants_instance_admin_access() {
        let (evaluator, resolver, identities, _grants) = harness(&["admin-user"]).await;
        let identity_id = seed_identity(identities.as_ref(), "admin-user").await;

        let is_admin = admin_role(&evaluator, &resolver, identity_id, 1000)
            .await
            .unwrap();

        assert!(is_admin);
    }

    #[tokio::test]
    async fn non_admin_grimoire_user_is_denied_instance_admin_access() {
        let (evaluator, resolver, identities, _grants) = harness(&["admin-user"]).await;
        let identity_id = seed_identity(identities.as_ref(), "regular-user").await;

        let is_admin = admin_role(&evaluator, &resolver, identity_id, 1000)
            .await
            .unwrap();

        assert!(!is_admin);
    }

    #[tokio::test]
    async fn unknown_grimoire_user_is_denied_instance_admin_access() {
        let (evaluator, resolver, identities, _grants) = harness(&[]).await;
        // never linked to a grimoire user at all - resolver can't even find
        // a grimoire_user_id to look up.
        let identity_id = Uuid::new_v4();
        identities
            .upsert_identity(Identity {
                id: identity_id,
                username: Some("ghost".to_string()),
                created_at: 1000,
                metadata: None,
                deleted_at: None,
            })
            .await
            .unwrap();

        let is_admin = admin_role(&evaluator, &resolver, identity_id, 1000)
            .await
            .unwrap();

        assert!(!is_admin);
    }

    #[tokio::test]
    async fn an_explicit_haruspex_grant_still_elevates_a_non_grimoire_admin() {
        let (evaluator, resolver, identities, grants) = harness(&[]).await;
        let identity_id = seed_identity(identities.as_ref(), "regular-user").await;
        grants
            .grant(RoleGrant {
                subject: Subject::Identity { identity_id },
                resource: Resource::instance(),
                role: Role::Admin,
                granted_by: "test".to_string(),
                granted_at: 1000,
                expires_at: None,
            })
            .await
            .expect("grant instance admin directly");

        let is_admin = admin_role(&evaluator, &resolver, identity_id, 1000)
            .await
            .unwrap();

        assert!(is_admin);
    }

    #[tokio::test]
    async fn resolver_only_speaks_for_the_instance_resource() {
        let (_, resolver, identities, _grants) = harness(&["admin-user"]).await;
        let identity_id = seed_identity(identities.as_ref(), "admin-user").await;

        let resolved = resolver
            .resolve_role(identity_id, &Resource::doc("some-doc"))
            .await;

        assert_eq!(resolved, None);
    }
}
