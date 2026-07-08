//! `KnockOutcome` + the `KnockPolicy` trait, and `GrantOnAcceptPolicy` - a
//! concrete example/test-double implementation exercising the full stack
//! (`IdentityStore` + `GrantStore`) end to end. not tomb's or skein's real
//! policy (those are app-specific and land in a later adoption phase per
//! PHASE_4_HARUSPEX_RUST.md) - this is a reference shape consumers can
//! start from or crib patterns out of.

use async_trait::async_trait;
use uuid::Uuid;

use crate::identity::{DeviceNode, Identity};
use crate::stores::grant_store::{Resource, Role, RoleGrant, Subject};
use crate::stores::knock_store::{KnockRecord, KnockScope, KnockStatus};
use crate::stores::{GrantStore, IdentityStore};

/// the reason an `on_accept` side effect could not be completed. carries a
/// human-readable description suitable for surfacing to an operator (e.g.
/// "username 'alice' already taken", "database error: ...").
#[derive(Debug, Clone, thiserror::Error)]
#[error("{message}")]
pub struct PolicyError {
    pub message: String,
}

impl PolicyError {
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

/// the result of accepting a knock: what got granted (if anything) and, for
/// `KnockScope::Account`, the identity that was created or linked.
#[derive(Debug, Clone, PartialEq)]
pub struct KnockOutcome {
    pub status: KnockStatus,
    pub granted_role: Option<Role>,
    pub granted_resource_ids: Option<Vec<String>>,
    pub account: Option<Identity>,
}

/// the accept-side-effect seam. tomb's "create user with role", skein's
/// "write acl entry", and playlistz's "store grant" are all implementations
/// of this trait over the same `KnockRecord` shape - see module docs.
///
/// `on_accept` returns `Err(PolicyError)` when the side effect cannot be
/// completed (e.g. username collision, database error). the caller decides
/// what to do with the failure - typically leaving the knock pending and
/// surfacing the message to the operator.
#[async_trait]
pub trait KnockPolicy: Send + Sync {
    async fn on_accept(&self, knock: &KnockRecord) -> Result<KnockOutcome, PolicyError>;
}

/// a concrete `KnockPolicy`: creates/resolves an identity for the knocking
/// node id and writes a `RoleGrant` appropriate to the knock's scope.
///
/// - `Account`: creates a fresh `Identity` (username from the knock's
///   `requested_username`), links the knocking `node_id` to it, and grants
///   `default_role` on the singleton instance resource (tomb's "create user
///   with role" pattern).
/// - `Resource`: resolves the knocking `node_id` to an identity - creating
///   an anonymous one (no username) if this is its first time being seen,
///   per the identity module's "bare node id = anonymous single-device
///   identity" rule - and grants `requested_role` (falling back to
///   `default_role` if the knock didn't ask for a specific one) on
///   `Resource::doc(resource_id)`.
/// - `Browse`: accepted with no resource-specific grant - browse access is
///   advisory-checked elsewhere (playlistz's pattern), not a stored grant.
pub struct GrantOnAcceptPolicy<'a> {
    pub identities: &'a dyn IdentityStore,
    pub grants: &'a dyn GrantStore,
    pub default_role: Role,
    pub granted_by: String,
}

impl<'a> GrantOnAcceptPolicy<'a> {
    /// resolves `node_id` to its identity, creating a fresh anonymous
    /// identity (no username) and linking the device if this is the first
    /// time the node id has been seen.
    async fn resolve_or_create_identity(&self, node_id: &str, now: i64) -> Option<Uuid> {
        if let Ok(Some(device)) = self.identities.resolve_device(node_id).await {
            return Some(device.identity_id);
        }

        let identity = Identity {
            id: Uuid::new_v4(),
            username: None,
            created_at: now,
            metadata: None,
            deleted_at: None,
        };
        let created = self.identities.upsert_identity(identity).await.ok()?;
        self.identities
            .add_device(DeviceNode {
                identity_id: created.id,
                node_id: node_id.to_string(),
                instance_name: None,
                created_at: now,
                last_seen_at: now,
                deleted_at: None,
            })
            .await
            .ok()?;
        Some(created.id)
    }
}

#[async_trait]
impl<'a> KnockPolicy for GrantOnAcceptPolicy<'a> {
    async fn on_accept(&self, knock: &KnockRecord) -> Result<KnockOutcome, PolicyError> {
        match &knock.scope {
            KnockScope::Account { requested_username } => {
                let identity = Identity {
                    id: Uuid::new_v4(),
                    username: requested_username.clone(),
                    created_at: knock.created_at,
                    metadata: None,
                    deleted_at: None,
                };
                let created = self
                    .identities
                    .upsert_identity(identity)
                    .await
                    .map_err(|e| PolicyError::new(format!("failed to create identity: {e}")))?;
                self.identities
                    .add_device(DeviceNode {
                        identity_id: created.id,
                        node_id: knock.node_id.clone(),
                        instance_name: None,
                        created_at: knock.created_at,
                        last_seen_at: knock.created_at,
                        deleted_at: None,
                    })
                    .await
                    .map_err(|e| PolicyError::new(format!("failed to link device: {e}")))?;
                self.grants
                    .grant(RoleGrant {
                        subject: Subject::Identity {
                            identity_id: created.id,
                        },
                        resource: Resource::instance(),
                        role: self.default_role,
                        granted_by: self.granted_by.clone(),
                        granted_at: knock.created_at,
                        expires_at: None,
                    })
                    .await
                    .map_err(|e| PolicyError::new(format!("failed to write grant: {e}")))?;

                Ok(KnockOutcome {
                    status: KnockStatus::Accepted,
                    granted_role: Some(self.default_role),
                    granted_resource_ids: None,
                    account: Some(created),
                })
            }
            KnockScope::Browse => Ok(KnockOutcome {
                status: KnockStatus::Accepted,
                granted_role: None,
                granted_resource_ids: None,
                account: None,
            }),
            KnockScope::Resource {
                resource_id,
                requested_role,
            } => {
                let identity_id = self
                    .resolve_or_create_identity(&knock.node_id, knock.created_at)
                    .await
                    .ok_or_else(|| PolicyError::new("failed to resolve or create identity"))?;
                let role = requested_role.unwrap_or(self.default_role);

                self.grants
                    .grant(RoleGrant {
                        subject: Subject::Identity { identity_id },
                        resource: Resource::doc(resource_id.clone()),
                        role,
                        granted_by: self.granted_by.clone(),
                        granted_at: knock.created_at,
                        expires_at: None,
                    })
                    .await
                    .map_err(|e| PolicyError::new(format!("failed to write grant: {e}")))?;

                Ok(KnockOutcome {
                    status: KnockStatus::Accepted,
                    granted_role: Some(role),
                    granted_resource_ids: Some(vec![resource_id.clone()]),
                    account: None,
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::{test_pool, SqliteGrantStore, SqliteIdentityStore};
    use crate::stores::knock_store::KnockDirection;

    async fn policy_stores() -> (SqliteIdentityStore, SqliteGrantStore) {
        let pool = test_pool().await;
        (
            SqliteIdentityStore::new(pool.clone()),
            SqliteGrantStore::new(pool),
        )
    }

    fn knock(node_id: &str, scope: KnockScope) -> KnockRecord {
        KnockRecord {
            id: Uuid::new_v4(),
            node_id: node_id.to_string(),
            direction: KnockDirection::Inbound,
            scope,
            message: "let me in".to_string(),
            status: KnockStatus::Pending,
            created_at: 100,
            processed_at: None,
            processed_by: None,
            decisions: vec![],
        }
    }

    #[tokio::test]
    async fn account_scope_creates_identity_links_device_and_grants_instance_role() {
        let (identities, grants) = policy_stores().await;
        let policy = GrantOnAcceptPolicy {
            identities: &identities,
            grants: &grants,
            default_role: Role::Member,
            granted_by: "admin-node".to_string(),
        };
        let record = knock(
            "node-a",
            KnockScope::Account {
                requested_username: Some("alice".to_string()),
            },
        );

        let outcome = policy.on_accept(&record).await.unwrap();

        assert_eq!(outcome.status, KnockStatus::Accepted);
        assert_eq!(outcome.granted_role, Some(Role::Member));
        let account = outcome.account.expect("account created");
        assert_eq!(account.username.as_deref(), Some("alice"));

        let device = identities.resolve_device("node-a").await.unwrap().unwrap();
        assert_eq!(device.identity_id, account.id);

        let instance_grants = grants.grants_on(Resource::instance()).await.unwrap();
        assert_eq!(instance_grants.len(), 1);
        assert_eq!(instance_grants[0].role, Role::Member);
        assert_eq!(
            instance_grants[0].subject,
            Subject::Identity {
                identity_id: account.id
            }
        );
    }

    #[tokio::test]
    async fn resource_scope_creates_an_anonymous_identity_on_first_knock() {
        let (identities, grants) = policy_stores().await;
        let policy = GrantOnAcceptPolicy {
            identities: &identities,
            grants: &grants,
            default_role: Role::Viewer,
            granted_by: "admin-node".to_string(),
        };
        let record = knock(
            "node-b",
            KnockScope::Resource {
                resource_id: "canvas-1".to_string(),
                requested_role: Some(Role::Member),
            },
        );

        let outcome = policy.on_accept(&record).await.unwrap();

        assert_eq!(outcome.status, KnockStatus::Accepted);
        assert_eq!(outcome.granted_role, Some(Role::Member));
        assert_eq!(
            outcome.granted_resource_ids,
            Some(vec!["canvas-1".to_string()])
        );

        let device = identities.resolve_device("node-b").await.unwrap().unwrap();
        assert_eq!(device.instance_name, None);

        let doc_grants = grants.grants_on(Resource::doc("canvas-1")).await.unwrap();
        assert_eq!(doc_grants.len(), 1);
        assert_eq!(doc_grants[0].role, Role::Member);
    }

    #[tokio::test]
    async fn resource_scope_falls_back_to_the_default_role_when_none_requested() {
        let (identities, grants) = policy_stores().await;
        let policy = GrantOnAcceptPolicy {
            identities: &identities,
            grants: &grants,
            default_role: Role::Viewer,
            granted_by: "admin-node".to_string(),
        };
        let record = knock(
            "node-c",
            KnockScope::Resource {
                resource_id: "canvas-1".to_string(),
                requested_role: None,
            },
        );

        let outcome = policy.on_accept(&record).await.unwrap();

        assert_eq!(outcome.granted_role, Some(Role::Viewer));
    }

    #[tokio::test]
    async fn resource_scope_reuses_an_already_registered_identity() {
        let (identities, grants) = policy_stores().await;
        let existing = identities
            .upsert_identity(Identity {
                id: Uuid::new_v4(),
                username: Some("bob".to_string()),
                created_at: 50,
                metadata: None,
                deleted_at: None,
            })
            .await
            .unwrap();
        identities
            .add_device(DeviceNode {
                identity_id: existing.id,
                node_id: "node-d".to_string(),
                instance_name: None,
                created_at: 50,
                last_seen_at: 50,
                deleted_at: None,
            })
            .await
            .unwrap();

        let policy = GrantOnAcceptPolicy {
            identities: &identities,
            grants: &grants,
            default_role: Role::Viewer,
            granted_by: "admin-node".to_string(),
        };
        let record = knock(
            "node-d",
            KnockScope::Resource {
                resource_id: "canvas-1".to_string(),
                requested_role: Some(Role::Admin),
            },
        );

        policy.on_accept(&record).await.unwrap();

        let doc_grants = grants.grants_on(Resource::doc("canvas-1")).await.unwrap();
        assert_eq!(doc_grants.len(), 1);
        assert_eq!(
            doc_grants[0].subject,
            Subject::Identity {
                identity_id: existing.id
            }
        );
    }

    #[tokio::test]
    async fn browse_scope_is_accepted_with_no_stored_grant() {
        let (identities, grants) = policy_stores().await;
        let policy = GrantOnAcceptPolicy {
            identities: &identities,
            grants: &grants,
            default_role: Role::Viewer,
            granted_by: "admin-node".to_string(),
        };
        let record = knock("node-e", KnockScope::Browse);

        let outcome = policy.on_accept(&record).await.unwrap();

        assert_eq!(outcome.status, KnockStatus::Accepted);
        assert_eq!(outcome.granted_role, None);
        assert_eq!(outcome.granted_resource_ids, None);
        // no identity should have been created for a bare browse knock.
        assert!(identities.resolve_device("node-e").await.unwrap().is_none());
    }
}
