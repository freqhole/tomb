//! `AclEvaluator` - computes `effective_role(identity, resource)`.

use std::collections::HashSet;
use std::sync::Arc;

use uuid::Uuid;

use crate::error::StoreError;
use crate::stores::grant_store::{Resource, Role, Subject};
use crate::stores::{GrantStore, GroupStore};

use super::resolver::RoleResolver;

/// evaluates `effective_role` against a `GrantStore` + `GroupStore` pair.
/// stateless beyond those two handles - see the module docs for why there is
/// deliberately no cache.
pub struct AclEvaluator {
    grants: Arc<dyn GrantStore>,
    groups: Arc<dyn GroupStore>,
}

impl AclEvaluator {
    pub fn new(grants: Arc<dyn GrantStore>, groups: Arc<dyn GroupStore>) -> Self {
        Self { grants, groups }
    }

    /// `subjects(identity) = { identity } ∪ groups(identity) ∪ { everyone }`.
    async fn subjects_for(&self, identity_id: Uuid) -> Result<HashSet<Uuid>, StoreError> {
        Ok(self
            .groups
            .groups_for(identity_id)
            .await?
            .into_iter()
            .collect())
    }

    /// max role granted to `identity_id` on exactly `resource` (no ancestry,
    /// no resolver) - unexpired grants only, as of `now`.
    async fn role_on(
        &self,
        identity_id: Uuid,
        resource: &Resource,
        member_group_ids: &HashSet<Uuid>,
        now: i64,
    ) -> Result<Option<Role>, StoreError> {
        let grants = self.grants.grants_on(resource.clone()).await?;
        let mut best = None;
        for grant in grants {
            if let Some(expires_at) = grant.expires_at {
                if expires_at <= now {
                    continue;
                }
            }
            let applies = match &grant.subject {
                Subject::Identity { identity_id: gid } => *gid == identity_id,
                Subject::Group { group_id } => member_group_ids.contains(group_id),
                Subject::Everyone => true,
            };
            if applies {
                best = merge(best, Some(grant.role));
            }
        }
        Ok(best)
    }

    /// `effective_role(identity, resource) = max-privilege over RoleGrants
    /// matching (subjects x resource-and-its-ancestors)`.
    ///
    /// `ancestors` is supplied by the caller, not looked up by haruspex -
    /// see `crate::stores::grant_store::Resource`'s doc comment for why
    /// (haruspex does not own doc/collection membership data). pass `&[]`
    /// for a resource with no ancestors (e.g. the instance resource itself).
    ///
    /// `resolver`, if given, is consulted for `resource` only (never its
    /// ancestors - an in-doc acl on a canvas doesn't also govern the
    /// collection it's filed under). if it returns `Some`, that role is
    /// authoritative for `resource` and stored grants on `resource` itself
    /// are not consulted; ancestor grants are still evaluated normally and
    /// can still raise the result (e.g. an instance-wide admin grant still
    /// wins over a doc whose in-doc acl says viewer).
    ///
    /// returns `None` if nothing grants any access at all - the evaluator's
    /// default is no access, never a fallback role (see module docs).
    pub async fn effective_role(
        &self,
        identity_id: Uuid,
        resource: &Resource,
        ancestors: &[Resource],
        now: i64,
        resolver: Option<&dyn RoleResolver>,
    ) -> Result<Option<Role>, StoreError> {
        let member_group_ids = self.subjects_for(identity_id).await?;
        let mut best = None;

        let resolved = match resolver {
            Some(resolver) => resolver.resolve_role(identity_id, resource).await,
            None => None,
        };
        match resolved {
            Some(role) => best = merge(best, Some(role)),
            None => {
                let role = self
                    .role_on(identity_id, resource, &member_group_ids, now)
                    .await?;
                best = merge(best, role);
            }
        }

        for ancestor in ancestors {
            let role = self
                .role_on(identity_id, ancestor, &member_group_ids, now)
                .await?;
            best = merge(best, role);
        }

        Ok(best)
    }

    /// the derived blob-access rule: `effective_role(identity, doc) >=
    /// viewer` for any doc referencing the blob - never a stored grant.
    /// `referencing_docs` is `(doc_resource, doc's_ancestors)` pairs, again
    /// caller-supplied for the same reason `effective_role`'s `ancestors`
    /// argument is. `Role::Viewer` is the lowest storable role, so
    /// `Some(_)` already means "at least viewer" - callers just check
    /// `.is_some()`; the specific role returned is the best found across
    /// every referencing doc.
    pub async fn effective_blob_role(
        &self,
        identity_id: Uuid,
        referencing_docs: &[(Resource, Vec<Resource>)],
        now: i64,
        resolver: Option<&dyn RoleResolver>,
    ) -> Result<Option<Role>, StoreError> {
        let mut best = None;
        for (doc, doc_ancestors) in referencing_docs {
            let role = self
                .effective_role(identity_id, doc, doc_ancestors, now, resolver)
                .await?;
            best = merge(best, role);
        }
        Ok(best)
    }
}

fn merge(a: Option<Role>, b: Option<Role>) -> Option<Role> {
    match (a, b) {
        (None, None) => None,
        (Some(x), None) | (None, Some(x)) => Some(x),
        (Some(x), Some(y)) => Some(x.max(y)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::{test_pool, SqliteGrantStore, SqliteGroupStore};
    use crate::stores::grant_store::RoleGrant;
    use crate::stores::group_store::Group;
    use async_trait::async_trait;
    use sqlx::SqlitePool;

    const GRANTER: &str = "granter-node";

    async fn evaluator() -> (AclEvaluator, SqlitePool) {
        let pool = test_pool().await;
        let grants: Arc<dyn GrantStore> = Arc::new(SqliteGrantStore::new(pool.clone()));
        let groups: Arc<dyn GroupStore> = Arc::new(SqliteGroupStore::new(pool.clone()));
        (AclEvaluator::new(grants, groups), pool)
    }

    async fn seed_identity(pool: &SqlitePool) -> Uuid {
        let id = Uuid::new_v4();
        let id_str = id.to_string();
        sqlx::query!(
            "INSERT INTO identityz (id, created_at) VALUES (?1, ?2)",
            id_str,
            100,
        )
        .execute(pool)
        .await
        .unwrap();
        id
    }

    fn grant(
        subject: crate::stores::grant_store::Subject,
        resource: Resource,
        role: Role,
    ) -> RoleGrant {
        RoleGrant {
            subject,
            resource,
            role,
            granted_by: GRANTER.to_string(),
            granted_at: 100,
            expires_at: None,
        }
    }

    // -- direct identity grants ---------------------------------------

    #[tokio::test]
    async fn no_grant_at_all_means_no_access() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;

        let role = eval
            .effective_role(identity_id, &Resource::doc("doc-1"), &[], 1000, None)
            .await
            .unwrap();

        assert_eq!(role, None);
    }

    #[tokio::test]
    async fn direct_identity_grant_is_visible() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        eval.grants
            .grant(grant(
                Subject::Identity { identity_id },
                Resource::doc("doc-1"),
                Role::Member,
            ))
            .await
            .unwrap();

        let role = eval
            .effective_role(identity_id, &Resource::doc("doc-1"), &[], 1000, None)
            .await
            .unwrap();

        assert_eq!(role, Some(Role::Member));
    }

    #[tokio::test]
    async fn grant_on_a_different_resource_does_not_apply() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        eval.grants
            .grant(grant(
                Subject::Identity { identity_id },
                Resource::doc("doc-1"),
                Role::Admin,
            ))
            .await
            .unwrap();

        let role = eval
            .effective_role(identity_id, &Resource::doc("doc-2"), &[], 1000, None)
            .await
            .unwrap();

        assert_eq!(role, None);
    }

    #[tokio::test]
    async fn grant_for_a_different_identity_does_not_apply() {
        let (eval, pool) = evaluator().await;
        let identity_a = seed_identity(&pool).await;
        let identity_b = seed_identity(&pool).await;
        eval.grants
            .grant(grant(
                Subject::Identity {
                    identity_id: identity_a,
                },
                Resource::doc("doc-1"),
                Role::Admin,
            ))
            .await
            .unwrap();

        let role = eval
            .effective_role(identity_b, &Resource::doc("doc-1"), &[], 1000, None)
            .await
            .unwrap();

        assert_eq!(role, None);
    }

    // -- group grants with live membership ------------------------------

    #[tokio::test]
    async fn group_grant_applies_to_a_live_member() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        let group = Group {
            id: Uuid::new_v4(),
            name: "editors".to_string(),
            color: None,
            created_at: 100,
        };
        eval.groups.create_group(group.clone()).await.unwrap();
        eval.groups
            .add_member(group.id, identity_id, 100)
            .await
            .unwrap();
        eval.grants
            .grant(grant(
                Subject::Group { group_id: group.id },
                Resource::doc("doc-1"),
                Role::Member,
            ))
            .await
            .unwrap();

        let role = eval
            .effective_role(identity_id, &Resource::doc("doc-1"), &[], 1000, None)
            .await
            .unwrap();

        assert_eq!(role, Some(Role::Member));
    }

    #[tokio::test]
    async fn group_grant_does_not_apply_to_a_non_member() {
        let (eval, pool) = evaluator().await;
        let member = seed_identity(&pool).await;
        let non_member = seed_identity(&pool).await;
        let group = Group {
            id: Uuid::new_v4(),
            name: "editors".to_string(),
            color: None,
            created_at: 100,
        };
        eval.groups.create_group(group.clone()).await.unwrap();
        eval.groups.add_member(group.id, member, 100).await.unwrap();
        eval.grants
            .grant(grant(
                Subject::Group { group_id: group.id },
                Resource::doc("doc-1"),
                Role::Member,
            ))
            .await
            .unwrap();

        let role = eval
            .effective_role(non_member, &Resource::doc("doc-1"), &[], 1000, None)
            .await
            .unwrap();

        assert_eq!(role, None);
    }

    #[tokio::test]
    async fn adding_membership_grants_access_immediately() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        let group = Group {
            id: Uuid::new_v4(),
            name: "editors".to_string(),
            color: None,
            created_at: 100,
        };
        eval.groups.create_group(group.clone()).await.unwrap();
        eval.grants
            .grant(grant(
                Subject::Group { group_id: group.id },
                Resource::doc("doc-1"),
                Role::Member,
            ))
            .await
            .unwrap();

        assert_eq!(
            eval.effective_role(identity_id, &Resource::doc("doc-1"), &[], 1000, None)
                .await
                .unwrap(),
            None
        );

        eval.groups
            .add_member(group.id, identity_id, 100)
            .await
            .unwrap();

        assert_eq!(
            eval.effective_role(identity_id, &Resource::doc("doc-1"), &[], 1000, None)
                .await
                .unwrap(),
            Some(Role::Member)
        );
    }

    #[tokio::test]
    async fn removing_membership_revokes_access_immediately() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        let group = Group {
            id: Uuid::new_v4(),
            name: "editors".to_string(),
            color: None,
            created_at: 100,
        };
        eval.groups.create_group(group.clone()).await.unwrap();
        eval.groups
            .add_member(group.id, identity_id, 100)
            .await
            .unwrap();
        eval.grants
            .grant(grant(
                Subject::Group { group_id: group.id },
                Resource::doc("doc-1"),
                Role::Member,
            ))
            .await
            .unwrap();

        assert_eq!(
            eval.effective_role(identity_id, &Resource::doc("doc-1"), &[], 1000, None)
                .await
                .unwrap(),
            Some(Role::Member)
        );

        eval.groups
            .remove_member(group.id, identity_id)
            .await
            .unwrap();

        assert_eq!(
            eval.effective_role(identity_id, &Resource::doc("doc-1"), &[], 1000, None)
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn max_privilege_wins_across_multiple_matching_grants() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        let group = Group {
            id: Uuid::new_v4(),
            name: "editors".to_string(),
            color: None,
            created_at: 100,
        };
        eval.groups.create_group(group.clone()).await.unwrap();
        eval.groups
            .add_member(group.id, identity_id, 100)
            .await
            .unwrap();
        // direct grant: viewer. group grant: admin. everyone grant: member.
        // the max (admin) should win.
        eval.grants
            .grant(grant(
                Subject::Identity { identity_id },
                Resource::doc("doc-1"),
                Role::Viewer,
            ))
            .await
            .unwrap();
        eval.grants
            .grant(grant(
                Subject::Group { group_id: group.id },
                Resource::doc("doc-1"),
                Role::Admin,
            ))
            .await
            .unwrap();
        eval.grants
            .grant(grant(
                Subject::Everyone,
                Resource::doc("doc-1"),
                Role::Member,
            ))
            .await
            .unwrap();

        let role = eval
            .effective_role(identity_id, &Resource::doc("doc-1"), &[], 1000, None)
            .await
            .unwrap();

        assert_eq!(role, Some(Role::Admin));
    }

    // -- everyone grants -------------------------------------------------

    #[tokio::test]
    async fn everyone_grant_applies_to_any_identity() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        eval.grants
            .grant(grant(
                Subject::Everyone,
                Resource::doc("public-doc"),
                Role::Viewer,
            ))
            .await
            .unwrap();

        let role = eval
            .effective_role(identity_id, &Resource::doc("public-doc"), &[], 1000, None)
            .await
            .unwrap();

        assert_eq!(role, Some(Role::Viewer));
    }

    // -- resource ancestry -------------------------------------------------

    #[tokio::test]
    async fn a_grant_on_the_ancestor_collection_covers_a_doc_in_it() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        eval.grants
            .grant(grant(
                Subject::Identity { identity_id },
                Resource::collection("my-playlists"),
                Role::Member,
            ))
            .await
            .unwrap();

        let role = eval
            .effective_role(
                identity_id,
                &Resource::doc("playlist-1"),
                &[Resource::collection("my-playlists")],
                1000,
                None,
            )
            .await
            .unwrap();

        assert_eq!(role, Some(Role::Member));
    }

    #[tokio::test]
    async fn a_grant_on_the_instance_covers_a_route_class() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        eval.grants
            .grant(grant(
                Subject::Identity { identity_id },
                Resource::instance(),
                Role::Admin,
            ))
            .await
            .unwrap();

        let role = eval
            .effective_role(
                identity_id,
                &Resource::route_class("admin-routes"),
                &[Resource::instance()],
                1000,
                None,
            )
            .await
            .unwrap();

        assert_eq!(role, Some(Role::Admin));
    }

    #[tokio::test]
    async fn a_grant_on_an_unrelated_collection_does_not_leak_into_a_sibling_doc() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        eval.grants
            .grant(grant(
                Subject::Identity { identity_id },
                Resource::collection("other-collection"),
                Role::Admin,
            ))
            .await
            .unwrap();

        let role = eval
            .effective_role(
                identity_id,
                &Resource::doc("playlist-1"),
                &[Resource::collection("my-playlists")],
                1000,
                None,
            )
            .await
            .unwrap();

        assert_eq!(role, None);
    }

    // -- derived blob access -----------------------------------------------

    #[tokio::test]
    async fn blob_access_derives_from_any_referencing_doc() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        eval.grants
            .grant(grant(
                Subject::Identity { identity_id },
                Resource::doc("doc-2"),
                Role::Viewer,
            ))
            .await
            .unwrap();

        let referencing_docs = vec![
            (Resource::doc("doc-1"), vec![]),
            (Resource::doc("doc-2"), vec![]),
        ];
        let role = eval
            .effective_blob_role(identity_id, &referencing_docs, 1000, None)
            .await
            .unwrap();

        assert_eq!(role, Some(Role::Viewer));
    }

    #[tokio::test]
    async fn blob_access_is_none_when_no_referencing_doc_grants_access() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;

        let referencing_docs = vec![
            (Resource::doc("doc-1"), vec![]),
            (Resource::doc("doc-2"), vec![]),
        ];
        let role = eval
            .effective_blob_role(identity_id, &referencing_docs, 1000, None)
            .await
            .unwrap();

        assert_eq!(role, None);
    }

    #[tokio::test]
    async fn blob_access_takes_the_max_role_across_referencing_docs() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        eval.grants
            .grant(grant(
                Subject::Identity { identity_id },
                Resource::doc("doc-1"),
                Role::Viewer,
            ))
            .await
            .unwrap();
        eval.grants
            .grant(grant(
                Subject::Identity { identity_id },
                Resource::doc("doc-2"),
                Role::Admin,
            ))
            .await
            .unwrap();

        let referencing_docs = vec![
            (Resource::doc("doc-1"), vec![]),
            (Resource::doc("doc-2"), vec![]),
        ];
        let role = eval
            .effective_blob_role(identity_id, &referencing_docs, 1000, None)
            .await
            .unwrap();

        assert_eq!(role, Some(Role::Admin));
    }

    // -- expires_at handling -------------------------------------------------

    #[tokio::test]
    async fn an_expired_grant_no_longer_applies() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        eval.grants
            .grant(RoleGrant {
                expires_at: Some(500),
                ..grant(
                    Subject::Identity { identity_id },
                    Resource::doc("doc-1"),
                    Role::Member,
                )
            })
            .await
            .unwrap();

        let still_valid = eval
            .effective_role(identity_id, &Resource::doc("doc-1"), &[], 400, None)
            .await
            .unwrap();
        assert_eq!(still_valid, Some(Role::Member));

        let expired = eval
            .effective_role(identity_id, &Resource::doc("doc-1"), &[], 500, None)
            .await
            .unwrap();
        assert_eq!(expired, None);

        let well_past_expiry = eval
            .effective_role(identity_id, &Resource::doc("doc-1"), &[], 999, None)
            .await
            .unwrap();
        assert_eq!(well_past_expiry, None);
    }

    #[tokio::test]
    async fn a_grant_with_no_expiry_never_expires() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        eval.grants
            .grant(grant(
                Subject::Identity { identity_id },
                Resource::doc("doc-1"),
                Role::Member,
            ))
            .await
            .unwrap();

        let role = eval
            .effective_role(identity_id, &Resource::doc("doc-1"), &[], i64::MAX, None)
            .await
            .unwrap();
        assert_eq!(role, Some(Role::Member));
    }

    // -- revocation (grant deleted -> access gone) --------------------------

    #[tokio::test]
    async fn revoking_a_direct_grant_removes_access_immediately() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        eval.grants
            .grant(grant(
                Subject::Identity { identity_id },
                Resource::doc("doc-1"),
                Role::Admin,
            ))
            .await
            .unwrap();
        assert_eq!(
            eval.effective_role(identity_id, &Resource::doc("doc-1"), &[], 1000, None)
                .await
                .unwrap(),
            Some(Role::Admin)
        );

        eval.grants
            .revoke(Subject::Identity { identity_id }, Resource::doc("doc-1"))
            .await
            .unwrap();

        assert_eq!(
            eval.effective_role(identity_id, &Resource::doc("doc-1"), &[], 1000, None)
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn revoking_a_group_grant_removes_access_for_every_member_immediately() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        let group = Group {
            id: Uuid::new_v4(),
            name: "editors".to_string(),
            color: None,
            created_at: 100,
        };
        eval.groups.create_group(group.clone()).await.unwrap();
        eval.groups
            .add_member(group.id, identity_id, 100)
            .await
            .unwrap();
        eval.grants
            .grant(grant(
                Subject::Group { group_id: group.id },
                Resource::doc("doc-1"),
                Role::Member,
            ))
            .await
            .unwrap();

        eval.grants
            .revoke(
                Subject::Group { group_id: group.id },
                Resource::doc("doc-1"),
            )
            .await
            .unwrap();

        assert_eq!(
            eval.effective_role(identity_id, &Resource::doc("doc-1"), &[], 1000, None)
                .await
                .unwrap(),
            None
        );
    }

    // -- the RoleResolver seam ------------------------------------------

    struct FixedResolver {
        role: Option<Role>,
    }

    #[async_trait]
    impl RoleResolver for FixedResolver {
        async fn resolve_role(&self, _identity_id: Uuid, _resource: &Resource) -> Option<Role> {
            self.role
        }
    }

    struct NoneResolver;

    #[async_trait]
    impl RoleResolver for NoneResolver {
        async fn resolve_role(&self, _identity_id: Uuid, _resource: &Resource) -> Option<Role> {
            None
        }
    }

    #[tokio::test]
    async fn resolver_overrides_the_default_for_its_resource() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        // no stored grant at all - the evaluator's default would be None,
        // but the resolver (standing in for a skein canvas's in-doc acl)
        // says this identity is a member.
        let resolver = FixedResolver {
            role: Some(Role::Member),
        };

        let role = eval
            .effective_role(
                identity_id,
                &Resource::doc("canvas-1"),
                &[],
                1000,
                Some(&resolver),
            )
            .await
            .unwrap();

        assert_eq!(role, Some(Role::Member));
    }

    #[tokio::test]
    async fn resolver_returning_none_falls_back_to_stored_grants() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        eval.grants
            .grant(grant(
                Subject::Identity { identity_id },
                Resource::doc("doc-1"),
                Role::Viewer,
            ))
            .await
            .unwrap();
        let resolver = NoneResolver;

        let role = eval
            .effective_role(
                identity_id,
                &Resource::doc("doc-1"),
                &[],
                1000,
                Some(&resolver),
            )
            .await
            .unwrap();

        assert_eq!(role, Some(Role::Viewer));
    }

    #[tokio::test]
    async fn resolver_does_not_suppress_a_stored_grant_on_an_ancestor() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        // instance-wide admin grant (tomb-style) should still win even
        // though the doc's own in-doc acl (the resolver) says viewer.
        eval.grants
            .grant(grant(
                Subject::Identity { identity_id },
                Resource::instance(),
                Role::Admin,
            ))
            .await
            .unwrap();
        let resolver = FixedResolver {
            role: Some(Role::Viewer),
        };

        let role = eval
            .effective_role(
                identity_id,
                &Resource::doc("canvas-1"),
                &[Resource::instance()],
                1000,
                Some(&resolver),
            )
            .await
            .unwrap();

        assert_eq!(role, Some(Role::Admin));
    }

    #[tokio::test]
    async fn resolver_ignores_a_stored_grant_on_the_same_resource_it_owns() {
        let (eval, pool) = evaluator().await;
        let identity_id = seed_identity(&pool).await;
        // a stray stored grant on the same doc resource - the resolver
        // should still be authoritative for that resource, per the doc
        // comment ("stored grants on resource itself are not consulted").
        eval.grants
            .grant(grant(
                Subject::Identity { identity_id },
                Resource::doc("canvas-1"),
                Role::Admin,
            ))
            .await
            .unwrap();
        let resolver = FixedResolver {
            role: Some(Role::Viewer),
        };

        let role = eval
            .effective_role(
                identity_id,
                &Resource::doc("canvas-1"),
                &[],
                1000,
                Some(&resolver),
            )
            .await
            .unwrap();

        assert_eq!(role, Some(Role::Viewer));
    }
}
