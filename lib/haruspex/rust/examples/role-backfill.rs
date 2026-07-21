//! role-backfill: turn an app's legacy per-instance role column into real
//! `RoleGrant` rows, then show `AclEvaluator` answering admin/member/viewer
//! questions from those grants alone - no `RoleResolver` fallback anywhere
//! in this example.
//!
//! # recommended backfill sql (source side)
//!
//! an app with a legacy role column on its own user/account table (e.g.
//! `user_accountz(id, role, haruspex_user_id, deleted_at)`, where
//! `haruspex_user_id` links the row to the identity this grant belongs to)
//! reads the rows to backfill with a plain select:
//!
//! ```sql
//! SELECT haruspex_user_id, role
//! FROM user_accountz
//! WHERE deleted_at IS NULL
//!   AND haruspex_user_id IS NOT NULL
//!   AND role IS NOT NULL;
//! ```
//!
//! # recommended backfill pattern (target side)
//!
//! for each `(identity_id, role)` row, write one instance-scope grant via
//! `GrantStore::grant` - see [`backfill_instance_roles`] below. `grant`
//! upserts on `(subject, resource)`, so re-running the backfill against
//! already-backfilled identities updates the existing row in place rather
//! than creating a duplicate - the whole loop is naturally idempotent with
//! no extra bookkeeping required.
//!
//! if the legacy table and haruspex's `role_grantz` table ever live in the
//! same sqlite connection (e.g. via `ATTACH DATABASE`), the equivalent raw
//! sql - matching `role_grantz`'s real unique index exactly - is:
//!
//! ```sql
//! INSERT INTO role_grantz
//!     (id, subject_kind, subject_id, resource_kind, resource_id,
//!      role, granted_by, granted_at, expires_at)
//! SELECT
//!     lower(hex(randomblob(16))),
//!     'identity',
//!     user_accountz.haruspex_user_id,
//!     'instance',
//!     '',
//!     user_accountz.role,
//!     'legacy-role-backfill',
//!     unixepoch(),
//!     NULL
//! FROM user_accountz
//! WHERE user_accountz.deleted_at IS NULL
//!   AND user_accountz.haruspex_user_id IS NOT NULL
//!   AND user_accountz.role IS NOT NULL
//! ON CONFLICT(subject_kind, subject_id, resource_kind, resource_id) DO UPDATE SET
//!     role = excluded.role,
//!     granted_by = excluded.granted_by,
//!     granted_at = excluded.granted_at,
//!     expires_at = excluded.expires_at;
//! ```
//!
//! run with: `cargo run --example role-backfill --features test-utils`

use std::collections::HashMap;
use std::sync::Arc;

use uuid::Uuid;

use haruspex::acl::AclEvaluator;
use haruspex::identity::Identity;
use haruspex::stores::{GrantStore, GroupStore, IdentityStore, Resource, Role, RoleGrant, Subject};
use haruspex::testing::{grant_store, group_store, identity_store, open_in_memory};

/// backfill one instance-scope grant per `(identity_id, role)` legacy
/// mapping entry. safe to call repeatedly against the same store:
/// `GrantStore::grant` upserts on `(subject, resource)`, so re-running this
/// against already-backfilled identities updates the existing row rather
/// than creating a second one.
async fn backfill_instance_roles(
    grants: &dyn GrantStore,
    legacy_roles: &HashMap<Uuid, Role>,
    granted_by: &str,
    now: i64,
) {
    for (&identity_id, &role) in legacy_roles {
        grants
            .grant(RoleGrant {
                subject: Subject::Identity { identity_id },
                resource: Resource::instance(),
                role,
                granted_by: granted_by.to_string(),
                granted_at: now,
                expires_at: None,
            })
            .await
            .expect("write backfilled grant");
    }
}

#[tokio::main]
async fn main() {
    let pool = open_in_memory().await;
    let identities = identity_store(&pool);
    let grants = grant_store(&pool);

    // three identities standing in for an app's legacy user rows - each
    // already has a role assigned on that legacy column, before any
    // RoleGrant exists at all.
    let admin_id = Uuid::new_v4();
    let member_id = Uuid::new_v4();
    let viewer_id = Uuid::new_v4();

    for (id, username) in [
        (admin_id, "admin-alice"),
        (member_id, "member-bob"),
        (viewer_id, "viewer-carol"),
    ] {
        identities
            .upsert_identity(Identity {
                id,
                username: Some(username.to_string()),
                created_at: 1_700_000_000,
                metadata: None,
                deleted_at: None,
            })
            .await
            .expect("seed identity");
    }

    let mut legacy_roles = HashMap::new();
    legacy_roles.insert(admin_id, Role::Admin);
    legacy_roles.insert(member_id, Role::Member);
    legacy_roles.insert(viewer_id, Role::Viewer);

    backfill_instance_roles(
        &grants,
        &legacy_roles,
        "legacy-role-backfill",
        1_700_000_100,
    )
    .await;
    println!(
        "backfilled {} instance-scope grant(s) from legacy roles",
        legacy_roles.len()
    );

    let evaluator = AclEvaluator::new(
        Arc::new(grant_store(&pool)) as Arc<dyn GrantStore>,
        Arc::new(group_store(&pool)) as Arc<dyn GroupStore>,
    );
    let now = 1_700_000_200;

    // every question below is answered purely from the backfilled grants -
    // `resolver` is `None` throughout, so there is no fallback path at all.
    let admin_role = evaluator
        .effective_role(admin_id, &Resource::instance(), &[], now, None)
        .await
        .expect("evaluate admin");
    println!("admin's backfilled instance role: {admin_role:?}");
    assert_eq!(admin_role, Some(Role::Admin));

    let member_role = evaluator
        .effective_role(member_id, &Resource::instance(), &[], now, None)
        .await
        .expect("evaluate member");
    println!("member's backfilled instance role: {member_role:?}");
    assert_eq!(member_role, Some(Role::Member));

    let viewer_role = evaluator
        .effective_role(viewer_id, &Resource::instance(), &[], now, None)
        .await
        .expect("evaluate viewer");
    println!("viewer's backfilled instance role: {viewer_role:?}");
    assert_eq!(viewer_role, Some(Role::Viewer));

    // re-running the backfill against already-backfilled identities is
    // idempotent: grant() upserts on (subject, resource), so this must not
    // create a second grant row, nor change the resolved role.
    backfill_instance_roles(
        &grants,
        &legacy_roles,
        "legacy-role-backfill",
        1_700_000_300,
    )
    .await;
    let grants_on_instance = grants
        .grants_on(Resource::instance())
        .await
        .expect("list grants on instance");
    println!(
        "re-running the backfill left {} grant row(s) on the instance resource (still 3, not 6)",
        grants_on_instance.len()
    );
    assert_eq!(grants_on_instance.len(), 3);

    let admin_role_after_rerun = evaluator
        .effective_role(admin_id, &Resource::instance(), &[], now, None)
        .await
        .expect("re-evaluate admin");
    assert_eq!(admin_role_after_rerun, Some(Role::Admin));

    // revocation cuts access immediately - the evaluator re-reads
    // GrantStore on every call, so there is no cache to invalidate.
    grants
        .revoke(
            Subject::Identity {
                identity_id: viewer_id,
            },
            Resource::instance(),
        )
        .await
        .expect("revoke viewer's grant");
    let viewer_role_after_revocation = evaluator
        .effective_role(viewer_id, &Resource::instance(), &[], now, None)
        .await
        .expect("re-evaluate viewer after revocation");
    println!("viewer's role after revocation: {viewer_role_after_revocation:?}");
    assert_eq!(viewer_role_after_revocation, None);

    println!(
        "role-backfill complete: legacy roles became real grants, the evaluator answered every \
         question from grants alone, re-running the backfill was idempotent, and revocation cut \
         access immediately"
    );
}
