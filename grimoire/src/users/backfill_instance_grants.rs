// CUTOVER(0.2.0): one-shot backfill of instance-scope haruspex RoleGrant rows from grimoire's legacy user_accountz.role column; can be deleted, along with acl_bridge's tier-1 field-check fast path, once every deployment has run this and real grants exist for every user

//! backfills real, stored haruspex `RoleGrant` rows on the instance
//! resource from grimoire's own `user_accountz.role` column - the last
//! step before `acl_bridge::declared_min_role`'s tier-1 fast path (a plain
//! `caller.role` field comparison) can be retired in favor of checking
//! stored grants alone.
//!
//! safe to run repeatedly: `GrantStore::grant` upserts on `(subject,
//! resource)`, so a rerun after a partial or complete prior run just
//! writes the same rows again - see haruspex's own
//! `examples/role-backfill.rs`, which this mirrors.

use haruspex::stores::{GrantStore, Resource, Role as HaruspexRole, RoleGrant, Subject};
use serde::Serialize;
use sqlx::SqlitePool;

use crate::database;
use crate::error::{GrimoireError, GrimoireResult};
use crate::users::{haruspex_bridge, UserRole};

/// who backfilled grants are recorded as `granted_by` - matches haruspex's
/// own proving example so the two are easy to cross-reference.
const BACKFILL_GRANTED_BY: &str = "legacy-role-backfill";

/// counts from one backfill run.
#[derive(Debug, Clone, Serialize)]
pub struct BackfillReport {
    /// live (non-deleted) grimoire users read from `user_accountz`.
    pub examined: i64,
    /// instance-scope grants written (== `examined`; every live user with
    /// a role gets exactly one grant, and `role` is a required column).
    pub granted: i64,
}

/// grimoire's role hierarchy maps onto haruspex's grantable roles, except
/// `Root`: haruspex's own docs are explicit that `Role::Root` is "not
/// meant to be stored as a `RoleGrant::role` value in practice - an app
/// assigns root structurally". grimoire does exactly that already (its
/// root-protection guards check `caller.role == UserRole::Root` directly
/// against its own column, never through acl_bridge), so a root user's
/// instance grant only needs to cover everything `require_scope` itself
/// ever checks - `Role::Admin`, the highest storable value, does that.
fn to_grantable_role(role: UserRole) -> HaruspexRole {
    match role {
        UserRole::Root | UserRole::Admin => HaruspexRole::Admin,
        UserRole::Member => HaruspexRole::Member,
        UserRole::Viewer => HaruspexRole::Viewer,
    }
}

struct SourceUser {
    id: String,
    username: String,
    role: String,
}

async fn fetch_source_users(pool: &SqlitePool) -> GrimoireResult<Vec<SourceUser>> {
    let rows = sqlx::query_as!(
        SourceUser,
        r#"SELECT id as "id!", username as "username!", role as "role!"
         FROM user_accountz
         WHERE deleted_at IS NULL
         ORDER BY created_at ASC"#
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

fn store_error(context: &str) -> impl Fn(haruspex::error::StoreError) -> GrimoireError + '_ {
    move |e| GrimoireError::ProcessingFailed {
        message: format!("{context}: {e}"),
    }
}

/// backfill one instance-scope grant per live grimoire user, against
/// `identities`/`grants` directly - split out from [`backfill_instance_grants`]
/// so tests can exercise the actual backfill logic against an in-memory
/// haruspex db without going through `connect_haruspex()`.
async fn backfill_instance_grants_via(
    identities: &dyn haruspex::stores::IdentityStore,
    grants: &dyn GrantStore,
    users: &[SourceUser],
    now: i64,
) -> GrimoireResult<BackfillReport> {
    let mut granted = 0i64;
    for user in users {
        let role = UserRole::from(user.role.clone());
        let identity_id =
            haruspex_bridge::ensure_identity_for_user(identities, &user.id, &user.username, now)
                .await
                .map_err(store_error("failed to ensure haruspex identity"))?;
        grants
            .grant(RoleGrant {
                subject: Subject::Identity { identity_id },
                resource: Resource::instance(),
                role: to_grantable_role(role),
                granted_by: BACKFILL_GRANTED_BY.to_string(),
                granted_at: now,
                expires_at: None,
            })
            .await
            .map_err(store_error("failed to write instance grant"))?;
        granted += 1;
    }
    Ok(BackfillReport {
        examined: users.len() as i64,
        granted,
    })
}

/// backfill instance-scope grants for every live grimoire user, against
/// this crate's real grimoire and haruspex pools.
pub async fn backfill_instance_grants() -> GrimoireResult<BackfillReport> {
    let grimoire_pool = database::connect().await?;
    let haruspex_pool = database::connect_haruspex().await?;
    let identities = haruspex::sqlite::SqliteIdentityStore::new(haruspex_pool.clone());
    let grants = haruspex::sqlite::SqliteGrantStore::new(haruspex_pool);

    let users = fetch_source_users(&grimoire_pool).await?;
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    backfill_instance_grants_via(&identities, &grants, &users, now).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use haruspex::acl::AclEvaluator;
    use haruspex::stores::GroupStore;
    use std::sync::Arc;

    async fn test_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:")
            .await
            .expect("open in-memory sqlite pool");
        haruspex::sqlite::migrate(&pool)
            .await
            .expect("run haruspex migrations");
        pool
    }

    fn user(id: &str, role: &str) -> SourceUser {
        SourceUser {
            id: id.to_string(),
            username: id.to_string(),
            role: role.to_string(),
        }
    }

    #[tokio::test]
    async fn backfills_one_instance_grant_per_live_user_root_maps_to_admin() {
        let pool = test_pool().await;
        let identities = haruspex::sqlite::SqliteIdentityStore::new(pool.clone());
        let grants = haruspex::sqlite::SqliteGrantStore::new(pool.clone());
        let groups: Arc<dyn GroupStore> =
            Arc::new(haruspex::sqlite::SqliteGroupStore::new(pool.clone()));

        let users = vec![
            user("root-user", "root"),
            user("admin-user", "admin"),
            user("member-user", "member"),
            user("viewer-user", "viewer"),
        ];

        let report = backfill_instance_grants_via(&identities, &grants, &users, 1000)
            .await
            .expect("backfill run");
        assert_eq!(report.examined, 4);
        assert_eq!(report.granted, 4);

        let evaluator = AclEvaluator::new(Arc::new(grants), groups);
        for (user_id, expected) in [
            ("root-user", HaruspexRole::Admin),
            ("admin-user", HaruspexRole::Admin),
            ("member-user", HaruspexRole::Member),
            ("viewer-user", HaruspexRole::Viewer),
        ] {
            let identity_id = haruspex_bridge::identity_id_for_existing_user(user_id);
            let role = evaluator
                .effective_role(identity_id, &Resource::instance(), &[], 1000, None)
                .await
                .expect("evaluate instance role");
            assert_eq!(
                role,
                Some(expected),
                "{user_id} should hold exactly {expected:?} via a stored grant, no resolver"
            );
        }
    }

    #[tokio::test]
    async fn rerunning_the_backfill_is_idempotent() {
        let pool = test_pool().await;
        let identities = haruspex::sqlite::SqliteIdentityStore::new(pool.clone());
        let grants = haruspex::sqlite::SqliteGrantStore::new(pool.clone());

        let users = vec![user("admin-user", "admin")];

        backfill_instance_grants_via(&identities, &grants, &users, 1000)
            .await
            .expect("first run");
        let second = backfill_instance_grants_via(&identities, &grants, &users, 2000)
            .await
            .expect("second run");
        assert_eq!(second.granted, 1);

        let identity_id = haruspex_bridge::identity_id_for_existing_user("admin-user");
        let existing = grants
            .grants_for(Subject::Identity { identity_id })
            .await
            .expect("fetch grants for identity");
        assert_eq!(
            existing.len(),
            1,
            "a rerun updates the existing grant in place rather than creating a second one"
        );
        assert_eq!(
            existing[0].granted_at, 2000,
            "the update carries the newer timestamp"
        );
    }

    #[tokio::test]
    async fn a_role_downgrade_is_reflected_on_rerun() {
        let pool = test_pool().await;
        let identities = haruspex::sqlite::SqliteIdentityStore::new(pool.clone());
        let grants = haruspex::sqlite::SqliteGrantStore::new(pool.clone());
        let groups: Arc<dyn GroupStore> =
            Arc::new(haruspex::sqlite::SqliteGroupStore::new(pool.clone()));

        backfill_instance_grants_via(&identities, &grants, &[user("demoted-user", "admin")], 1000)
            .await
            .expect("first run as admin");
        backfill_instance_grants_via(
            &identities,
            &grants,
            &[user("demoted-user", "viewer")],
            2000,
        )
        .await
        .expect("second run as viewer");

        let evaluator = AclEvaluator::new(Arc::new(grants), groups);
        let identity_id = haruspex_bridge::identity_id_for_existing_user("demoted-user");
        let role = evaluator
            .effective_role(identity_id, &Resource::instance(), &[], 2000, None)
            .await
            .expect("evaluate instance role");
        assert_eq!(role, Some(HaruspexRole::Viewer));
    }
}
