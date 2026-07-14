// CUTOVER(0.2.0): this entire module exists to bridge grimoire's admin flag onto haruspex's acl evaluator without backfilling RoleGrant rows; can be deleted once instance-admin RoleGrants are backfilled and grimoire.user_accountz.role is dropped

//! bridges instance-wide routes onto grimoire's own per-user role, in the
//! shape haruspex's resource-scoped acl model will eventually replace it
//! with.
//!
//! every guard here takes just a `scope` (a route's own canonical name,
//! e.g. `"bulk_delete_songs"`) and the caller - never a role. the role a
//! scope requires is looked up from that route's own declared `RouteAuth`
//! in the registry (`declared_min_role`), which is already the single
//! place each route's required role is declared, so nothing here
//! duplicates it. call sites never spell out "admin" or "member"; if a
//! route's required role changes, only its `RouteInfo.auth` needs
//! updating; if grimoire moves the whole "which role does this scope
//! need" question to actual config or data-driven scope collections
//! later, only `declared_min_role`'s internals need to change.
//!
//! checking `caller` against a scope is two tiers:
//!
//! 1. does `caller`'s own grimoire-wide role already clear the bar? every
//!    caller reaching these guards today is a known grimoire user (built
//!    from a fresh `get_user`/`get_user_by_peer_node_id` lookup earlier in
//!    the same request), so this is a plain, zero-db field comparison and
//!    covers every caller in practice right now.
//! 2. only if (1) fails: is there a real, stored haruspex `RoleGrant` on
//!    `Resource::route_class(scope)` for this caller's identity (directly,
//!    via a group they belong to, or via `Subject::Everyone`)? this is the
//!    narrow-grant escape hatch - it lets an instance owner hand someone
//!    access to one specific capability without making them a full
//!    instance admin, and costs a db round trip only on the (today, always
//!    empty) path where tier 1 already failed.

use std::sync::Arc;

use haruspex::acl::AclEvaluator;
use haruspex::error::StoreError;
use haruspex::stores::{GrantStore, GroupStore, Resource, Role as HaruspexRole};
use serde_json::Value as JsonValue;
use uuid::Uuid;

use crate::api_registry::RouteAuth;
use crate::database;
use crate::error::{ErrorDetail, GrimoireError, GrimoireResult};
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use crate::users::{haruspex_bridge, UserRole};

/// grimoire's role hierarchy maps onto haruspex's grantable roles one for
/// one - both distinguish root/admin/member/viewer with the same ordering.
fn to_haruspex_role(role: UserRole) -> HaruspexRole {
    match role {
        UserRole::Root => HaruspexRole::Root,
        UserRole::Admin => HaruspexRole::Admin,
        UserRole::Member => HaruspexRole::Member,
        UserRole::Viewer => HaruspexRole::Viewer,
    }
}

/// the minimum role `scope` requires, per its own declared `RouteAuth` in
/// the route registry - the single source of truth for "which role grants
/// this capability". `None` means `scope` isn't a registered route name at
/// all, or is declared `Public`/`Owner` (no role ever grants a bare
/// `Owner` route without being the owner - see `require_owner_or_scope`).
fn declared_min_role(scope: &str) -> Option<HaruspexRole> {
    crate::offal::all_routes()
        .into_iter()
        .find(|route| route.name == scope)
        .and_then(|route| match route.auth {
            RouteAuth::Role(role) | RouteAuth::OwnerOr(role) => Some(role),
            RouteAuth::Authenticated => Some(UserRole::Viewer),
            RouteAuth::Public | RouteAuth::Owner => None,
        })
        .map(to_haruspex_role)
}

/// look up the effective role `identity_id` holds on `scope`'s route-class
/// resource, per `evaluator` - no ancestor resolution, since the
/// instance-wide case is already covered by `require_scope`'s fast tier.
/// split out from `scoped_grant_role` so tests can exercise the real
/// evaluation logic against an in-memory haruspex db without going through
/// `connect_haruspex()`.
async fn scoped_grant_role_via(
    evaluator: &AclEvaluator,
    identity_id: Uuid,
    scope: &str,
    now: i64,
) -> Result<Option<HaruspexRole>, StoreError> {
    evaluator
        .effective_role(identity_id, &Resource::route_class(scope), &[], now, None)
        .await
}

/// look up a real, stored haruspex `RoleGrant` on `scope`'s route-class
/// resource for `caller`'s identity, against the crate's real haruspex
/// pool.
async fn scoped_grant_role(
    caller: &Caller,
    scope: &str,
    now: i64,
) -> GrimoireResult<Option<HaruspexRole>> {
    let identity_id = haruspex_bridge::identity_id_for_existing_user(&caller.user_id);
    let pool = database::connect_haruspex().await?;
    let grants: Arc<dyn GrantStore> =
        Arc::new(haruspex::sqlite::SqliteGrantStore::new(pool.clone()));
    let groups: Arc<dyn GroupStore> = Arc::new(haruspex::sqlite::SqliteGroupStore::new(pool));
    let evaluator = AclEvaluator::new(grants, groups);
    scoped_grant_role_via(&evaluator, identity_id, scope, now)
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("acl evaluation failed: {e}"),
        })
}

fn forbidden_response(detail: &str) -> GrimoireResponse<JsonValue> {
    GrimoireResponse::failure(
        "forbidden",
        vec![ErrorDetail::new("forbidden", "forbidden", detail)],
    )
}

fn acl_check_failed_response(e: GrimoireError) -> GrimoireResponse<JsonValue> {
    GrimoireResponse::failure("acl check failed", vec![ErrorDetail::from(e)])
}

/// guard for a specific capability (`scope`, a route's own canonical
/// name): `Ok(())` if `caller` clears the role `scope` itself declares
/// (see `declared_min_role`) either via their own grimoire-wide role or a
/// narrow grant on `scope`, otherwise a forbidden response ready to return
/// directly from the handler (or a surfaced acl-store failure, if the
/// fallback grant lookup itself errors).
pub(crate) async fn require_scope(
    caller: &Caller,
    scope: &str,
) -> Result<(), GrimoireResponse<JsonValue>> {
    let min_role = match declared_min_role(scope) {
        Some(role) => role,
        None => {
            return Err(forbidden_response(&format!(
                "{scope} has no grantable role"
            )))
        }
    };
    if to_haruspex_role(caller.role) >= min_role {
        return Ok(());
    }
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    match scoped_grant_role(caller, scope, now).await {
        Ok(Some(role)) if role >= min_role => Ok(()),
        Ok(_) => Err(forbidden_response(&format!("{} only", min_role.as_str()))),
        Err(e) => Err(acl_check_failed_response(e)),
    }
}

/// guard for owner-or-scope routes: passes if `caller` owns the resource
/// (`caller.user_id == owner_id`) or clears `require_scope` for `scope`.
/// covers the OWNER, cross-user-scope, and uploader-or-admin shapes
/// scattered across the music/import_review/upload handlers - one helper
/// instead of each call site hand-rolling
/// `owner_id != Some(&caller.user_id) && !caller.is_admin()`.
///
/// takes `owner_id` as `Option<&str>` since ownership fields across these
/// handlers are frequently optional (e.g. `created_by_id: Option<String>`).
/// a missing owner never matches the caller, so only a `scope` grant holder
/// can act on an ownerless resource.
pub(crate) async fn require_owner_or_scope(
    owner_id: Option<&str>,
    caller: &Caller,
    scope: &str,
) -> Result<(), GrimoireResponse<JsonValue>> {
    if owner_id == Some(caller.user_id.as_str()) {
        return Ok(());
    }
    require_scope(caller, scope).await
}

/// the boolean counterpart to `require_scope`, for call sites that need to
/// combine the result with an ownership check that isn't a simple
/// `Option<&str>` comparison (e.g. "uploaded at least one song in this
/// album" - a many-to-one relationship `require_owner_or_scope`'s
/// single-owner-id shape can't express). any acl-store failure folds to
/// `false` rather than propagating, since a caller using this is always
/// about to fall through to its own additional ownership check anyway -
/// there is no "surface the error" path here the way `require_scope` has.
pub(crate) async fn caller_meets_scope(caller: &Caller, scope: &str) -> bool {
    require_scope(caller, scope).await.is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use haruspex::identity::Identity;
    use haruspex::stores::{IdentityStore, RoleGrant, Subject};
    use sqlx::SqlitePool;

    fn caller(role: UserRole) -> Caller {
        Caller::new("test-user", "test-user", role)
    }

    #[tokio::test]
    async fn admin_and_root_pass_an_admin_scoped_gate() {
        // "delete_song" is declared `RouteAuth::Role(UserRole::Admin)`. only
        // the passing cases belong in a plain test: a denial falls through
        // to the real scoped-grant fallback (tier 2), which needs the
        // crate's real db/config singletons - see
        // `an_insufficient_role_with_no_scope_grant_is_denied` below.
        assert!(require_scope(&caller(UserRole::Root), "delete_song")
            .await
            .is_ok());
        assert!(require_scope(&caller(UserRole::Admin), "delete_song")
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn member_and_above_pass_a_member_scoped_gate() {
        // "create_fetch_job" is declared `RouteAuth::Role(UserRole::Member)`.
        assert!(require_scope(&caller(UserRole::Root), "create_fetch_job")
            .await
            .is_ok());
        assert!(require_scope(&caller(UserRole::Admin), "create_fetch_job")
            .await
            .is_ok());
        assert!(require_scope(&caller(UserRole::Member), "create_fetch_job")
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn an_unregistered_scope_name_fails_closed() {
        assert!(
            require_scope(&caller(UserRole::Root), "no-such-scope-exists")
                .await
                .is_err(),
            "an unknown scope name must never silently allow a root/admin through - \
             a typo in a scope literal should surface as a hard failure, not a bypass"
        );
    }

    #[tokio::test]
    async fn require_owner_or_scope_allows_owner_or_scope_holder_only() {
        let owner = caller(UserRole::Viewer);
        assert!(
            require_owner_or_scope(Some("test-user"), &owner, "delete_song")
                .await
                .is_ok(),
            "owner always passes regardless of role"
        );

        let admin = caller(UserRole::Admin);
        assert!(
            require_owner_or_scope(Some("someone-else"), &admin, "delete_song")
                .await
                .is_ok(),
            "admin passes even when not the owner"
        );
    }

    /// an in-memory haruspex db, migrated the same way haruspex's own test
    /// pools are - independent of grimoire's own database entirely. only
    /// needed by the tests that exercise the real scoped-grant fallback
    /// (tier 2); every test above never reaches it.
    async fn test_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite pool");
        haruspex::sqlite::migrate(&pool)
            .await
            .expect("run haruspex migrations");
        pool
    }

    /// seed an identity + a route-class-scoped grant into an in-memory
    /// haruspex db, returning the identity's id.
    async fn seed_identity_and_grant(
        pool: &SqlitePool,
        grimoire_user_id: &str,
        role: HaruspexRole,
    ) -> Uuid {
        let identities = haruspex::sqlite::SqliteIdentityStore::new(pool.clone());
        let identity_id = haruspex_bridge::identity_id_for_existing_user(grimoire_user_id);
        identities
            .upsert_identity(Identity {
                id: identity_id,
                username: Some(grimoire_user_id.to_string()),
                created_at: 1000,
                metadata: None,
                deleted_at: None,
            })
            .await
            .expect("seed identity");

        let grants = haruspex::sqlite::SqliteGrantStore::new(pool.clone());
        grants
            .grant(RoleGrant {
                subject: Subject::Identity { identity_id },
                resource: Resource::route_class("bulk_delete_songs"),
                role,
                granted_by: "test".to_string(),
                granted_at: 1000,
                expires_at: None,
            })
            .await
            .expect("grant scoped role");
        identity_id
    }

    fn evaluator_for(pool: &SqlitePool) -> AclEvaluator {
        let grants: Arc<dyn GrantStore> =
            Arc::new(haruspex::sqlite::SqliteGrantStore::new(pool.clone()));
        let groups: Arc<dyn GroupStore> =
            Arc::new(haruspex::sqlite::SqliteGroupStore::new(pool.clone()));
        AclEvaluator::new(grants, groups)
    }

    #[tokio::test]
    async fn a_narrow_scope_grant_lets_a_non_admin_through_for_that_scope_only() {
        let pool = test_pool().await;
        let identity_id = seed_identity_and_grant(&pool, "test-user", HaruspexRole::Admin).await;
        let evaluator = evaluator_for(&pool);

        let role = scoped_grant_role_via(&evaluator, identity_id, "bulk_delete_songs", 1000)
            .await
            .expect("evaluate scoped grant");
        assert_eq!(role, Some(HaruspexRole::Admin));

        let no_grant = scoped_grant_role_via(&evaluator, identity_id, "some_other_scope", 1000)
            .await
            .expect("evaluate unrelated scope");
        assert_eq!(no_grant, None, "no grant exists on an unrelated scope");
    }

    #[tokio::test]
    async fn a_scope_grant_below_min_role_is_reported_but_does_not_clear_a_higher_bar() {
        let pool = test_pool().await;
        let identity_id = seed_identity_and_grant(&pool, "test-user", HaruspexRole::Viewer).await;
        let evaluator = evaluator_for(&pool);

        let role = scoped_grant_role_via(&evaluator, identity_id, "bulk_delete_songs", 1000)
            .await
            .expect("evaluate scoped grant");
        assert_eq!(
            role,
            Some(HaruspexRole::Viewer),
            "the grant itself is real, just below the admin bar require_scope checks for"
        );
        assert!(role < Some(HaruspexRole::Admin));
    }

    /// exercises `require_scope`'s actual deny path end to end (tier 1
    /// fails, tier 2's real grant lookup against the crate's real
    /// haruspex pool also finds nothing) - touches the process-wide db
    /// pool singleton, so this must run alone, not alongside another
    /// ignored test in the same invocation.
    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn an_insufficient_role_with_no_scope_grant_is_denied() {
        crate::config::init_config_for_tests();
        // "delete_song" is declared `RouteAuth::Role(UserRole::Admin)`; a
        // plain member with no grant on it anywhere clears neither tier.
        assert!(require_scope(&caller(UserRole::Member), "delete_song")
            .await
            .is_err());
        // "create_fetch_job" is declared `RouteAuth::Role(UserRole::Member)`;
        // a viewer clears neither tier.
        assert!(require_scope(&caller(UserRole::Viewer), "create_fetch_job")
            .await
            .is_err());
    }
}
