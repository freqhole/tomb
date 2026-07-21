//! [`evaluator_fixture`] - a pre-seeded `AclEvaluator` for acl tests.

use std::sync::Arc;

use sqlx::SqlitePool;
use uuid::Uuid;

use crate::acl::AclEvaluator;
use crate::identity::Identity;
use crate::stores::grant_store::{Resource, RoleGrant, Subject};
use crate::stores::group_store::Group;
use crate::stores::{GrantStore, GroupStore, IdentityStore, Role};

use super::open_in_memory;

/// the actor stamped as `RoleGrant::granted_by` on every grant this fixture
/// seeds.
const FIXTURE_GRANTER: &str = "fixture";
/// the timestamp every seeded row uses - comfortably in the past relative
/// to any `now` a test is likely to pass to `effective_role`.
const FIXTURE_SEEDED_AT: i64 = 1_700_000_000;

/// a ready-seeded acl fixture: three identities, one group, and grants
/// wiring them together, ready for `effective_role` assertions.
///
/// seeded state:
/// - `admin` holds `Role::Admin` on the singleton instance resource.
/// - `member` is a live member of `editors_group`, which holds `Role::Member`
///   on `shared_doc`.
/// - `outsider` has no grants and is not a member of anything - the
///   baseline "no access" case.
///
/// the underlying `grants`/`groups` stores are exposed alongside `evaluator`
/// so a test can mutate state afterward (e.g. `groups.remove_member(...)`
/// to exercise revocation) and re-evaluate.
pub struct EvaluatorFixture {
    pub pool: SqlitePool,
    pub evaluator: AclEvaluator,
    pub grants: Arc<dyn GrantStore>,
    pub groups: Arc<dyn GroupStore>,
    pub admin: Identity,
    pub member: Identity,
    pub outsider: Identity,
    pub editors_group: Group,
    pub shared_doc: Resource,
}

pub async fn evaluator_fixture() -> EvaluatorFixture {
    let pool = open_in_memory().await;
    let grants: Arc<dyn GrantStore> = Arc::new(super::grant_store(&pool));
    let groups: Arc<dyn GroupStore> = Arc::new(super::group_store(&pool));
    let identities = super::identity_store(&pool);

    let admin = seed_identity(&identities, Some("admin")).await;
    let member = seed_identity(&identities, Some("member")).await;
    let outsider = seed_identity(&identities, Some("outsider")).await;

    grants
        .grant(RoleGrant {
            subject: Subject::Identity {
                identity_id: admin.id,
            },
            resource: Resource::instance(),
            role: Role::Admin,
            granted_by: FIXTURE_GRANTER.to_string(),
            granted_at: FIXTURE_SEEDED_AT,
            expires_at: None,
        })
        .await
        .expect("seed admin grant");

    let editors_group = Group {
        id: Uuid::new_v4(),
        name: "editors".to_string(),
        color: None,
        created_at: FIXTURE_SEEDED_AT,
    };
    groups
        .create_group(editors_group.clone())
        .await
        .expect("seed editors group");
    groups
        .add_member(editors_group.id, member.id, FIXTURE_SEEDED_AT)
        .await
        .expect("seed editors membership");

    let shared_doc = Resource::doc("shared-doc");
    grants
        .grant(RoleGrant {
            subject: Subject::Group {
                group_id: editors_group.id,
            },
            resource: shared_doc.clone(),
            role: Role::Member,
            granted_by: FIXTURE_GRANTER.to_string(),
            granted_at: FIXTURE_SEEDED_AT,
            expires_at: None,
        })
        .await
        .expect("seed editors group grant");

    let evaluator = AclEvaluator::new(grants.clone(), groups.clone());

    EvaluatorFixture {
        pool,
        evaluator,
        grants,
        groups,
        admin,
        member,
        outsider,
        editors_group,
        shared_doc,
    }
}

async fn seed_identity(store: &impl IdentityStore, username: Option<&str>) -> Identity {
    let identity = Identity {
        id: Uuid::new_v4(),
        username: username.map(str::to_string),
        created_at: FIXTURE_SEEDED_AT,
        metadata: None,
        deleted_at: None,
    };
    store
        .upsert_identity(identity.clone())
        .await
        .expect("seed identity")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn admin_has_admin_on_the_instance_resource() {
        let fx = evaluator_fixture().await;
        let role = fx
            .evaluator
            .effective_role(
                fx.admin.id,
                &Resource::instance(),
                &[],
                FIXTURE_SEEDED_AT + 1,
                None,
            )
            .await
            .unwrap();
        assert_eq!(role, Some(Role::Admin));
    }

    #[tokio::test]
    async fn member_has_member_on_the_shared_doc_via_group_grant() {
        let fx = evaluator_fixture().await;
        let role = fx
            .evaluator
            .effective_role(
                fx.member.id,
                &fx.shared_doc,
                &[],
                FIXTURE_SEEDED_AT + 1,
                None,
            )
            .await
            .unwrap();
        assert_eq!(role, Some(Role::Member));
    }

    #[tokio::test]
    async fn outsider_has_no_access_anywhere() {
        let fx = evaluator_fixture().await;
        assert_eq!(
            fx.evaluator
                .effective_role(
                    fx.outsider.id,
                    &Resource::instance(),
                    &[],
                    FIXTURE_SEEDED_AT + 1,
                    None
                )
                .await
                .unwrap(),
            None
        );
        assert_eq!(
            fx.evaluator
                .effective_role(
                    fx.outsider.id,
                    &fx.shared_doc,
                    &[],
                    FIXTURE_SEEDED_AT + 1,
                    None
                )
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn removing_group_membership_revokes_access_immediately() {
        let fx = evaluator_fixture().await;
        fx.groups
            .remove_member(fx.editors_group.id, fx.member.id)
            .await
            .unwrap();

        let role = fx
            .evaluator
            .effective_role(
                fx.member.id,
                &fx.shared_doc,
                &[],
                FIXTURE_SEEDED_AT + 1,
                None,
            )
            .await
            .unwrap();
        assert_eq!(role, None);
    }
}
