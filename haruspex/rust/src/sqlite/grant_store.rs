//! sqlite-backed `GrantStore`.
//!
//! `subject_kind`/`subject_id` and `resource_kind`/`resource_id` are plain
//! columns rather than a canonical-json dedup key (contrast
//! `sqlite::knock_store`'s `scope_key`) - `Subject` and `Resource` are both
//! flat enough that indexing their fields directly is simpler and lets
//! `grants_for`/`grants_on` filter in sql instead of deserializing every row.

use async_trait::async_trait;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::error::StoreError;
use crate::stores::grant_store::{Resource, Role, RoleGrant, Subject};
use crate::stores::GrantStore;

pub struct SqliteGrantStore {
    pool: SqlitePool,
}

impl SqliteGrantStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

/// `subject_id` is `""` for `Subject::Everyone` (see migration 0002's doc
/// comment on `role_grantz` for why - not `NULL`).
fn subject_columns(subject: &Subject) -> (&'static str, String) {
    match subject {
        Subject::Identity { identity_id } => ("identity", identity_id.to_string()),
        Subject::Group { group_id } => ("group", group_id.to_string()),
        Subject::Everyone => ("everyone", String::new()),
    }
}

fn subject_from_columns(kind: &str, id: &str) -> Result<Subject, StoreError> {
    match kind {
        "identity" => Ok(Subject::Identity {
            identity_id: Uuid::parse_str(id)
                .map_err(|e| StoreError::Conflict(format!("invalid identity id: {e}")))?,
        }),
        "group" => Ok(Subject::Group {
            group_id: Uuid::parse_str(id)
                .map_err(|e| StoreError::Conflict(format!("invalid group id: {e}")))?,
        }),
        "everyone" => Ok(Subject::Everyone),
        other => Err(StoreError::Conflict(format!(
            "invalid subject kind: {other}"
        ))),
    }
}

fn role_as_str(role: Role) -> &'static str {
    match role {
        Role::Viewer => "viewer",
        Role::Member => "member",
        Role::Admin => "admin",
        Role::Root => "root",
    }
}

fn role_from_str(s: &str) -> Result<Role, StoreError> {
    match s {
        "viewer" => Ok(Role::Viewer),
        "member" => Ok(Role::Member),
        "admin" => Ok(Role::Admin),
        "root" => Ok(Role::Root),
        other => Err(StoreError::Conflict(format!("invalid role: {other}"))),
    }
}

#[derive(sqlx::FromRow)]
struct GrantRow {
    subject_kind: String,
    subject_id: String,
    resource_kind: String,
    resource_id: String,
    role: String,
    granted_by: String,
    granted_at: i64,
    expires_at: Option<i64>,
}

impl TryFrom<GrantRow> for RoleGrant {
    type Error = StoreError;

    fn try_from(row: GrantRow) -> Result<Self, Self::Error> {
        Ok(RoleGrant {
            subject: subject_from_columns(&row.subject_kind, &row.subject_id)?,
            resource: Resource {
                kind: row.resource_kind,
                id: row.resource_id,
            },
            role: role_from_str(&row.role)?,
            granted_by: row.granted_by,
            granted_at: row.granted_at,
            expires_at: row.expires_at,
        })
    }
}

#[async_trait]
impl GrantStore for SqliteGrantStore {
    async fn grant(&self, grant: RoleGrant) -> Result<RoleGrant, StoreError> {
        let id = Uuid::new_v4().to_string();
        let (subject_kind, subject_id) = subject_columns(&grant.subject);
        let role = role_as_str(grant.role);

        let row: GrantRow = sqlx::query_as(
            r#"
            INSERT INTO role_grantz
                (id, subject_kind, subject_id, resource_kind, resource_id, role, granted_by, granted_at, expires_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(subject_kind, subject_id, resource_kind, resource_id) DO UPDATE SET
                role = excluded.role,
                granted_by = excluded.granted_by,
                granted_at = excluded.granted_at,
                expires_at = excluded.expires_at
            RETURNING subject_kind, subject_id, resource_kind, resource_id, role, granted_by,
                      granted_at, expires_at
            "#,
        )
        .bind(&id)
        .bind(subject_kind)
        .bind(&subject_id)
        .bind(&grant.resource.kind)
        .bind(&grant.resource.id)
        .bind(role)
        .bind(&grant.granted_by)
        .bind(grant.granted_at)
        .bind(grant.expires_at)
        .fetch_one(&self.pool)
        .await?;

        row.try_into()
    }

    async fn revoke(&self, subject: Subject, resource: Resource) -> Result<(), StoreError> {
        let (subject_kind, subject_id) = subject_columns(&subject);
        sqlx::query(
            r#"
            DELETE FROM role_grantz
            WHERE subject_kind = ?1 AND subject_id = ?2 AND resource_kind = ?3 AND resource_id = ?4
            "#,
        )
        .bind(subject_kind)
        .bind(&subject_id)
        .bind(&resource.kind)
        .bind(&resource.id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn grants_for(&self, subject: Subject) -> Result<Vec<RoleGrant>, StoreError> {
        let (subject_kind, subject_id) = subject_columns(&subject);
        let rows: Vec<GrantRow> = sqlx::query_as(
            r#"
            SELECT subject_kind, subject_id, resource_kind, resource_id, role, granted_by,
                   granted_at, expires_at
            FROM role_grantz WHERE subject_kind = ?1 AND subject_id = ?2
            "#,
        )
        .bind(subject_kind)
        .bind(&subject_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(TryInto::try_into).collect()
    }

    async fn grants_on(&self, resource: Resource) -> Result<Vec<RoleGrant>, StoreError> {
        let rows: Vec<GrantRow> = sqlx::query_as(
            r#"
            SELECT subject_kind, subject_id, resource_kind, resource_id, role, granted_by,
                   granted_at, expires_at
            FROM role_grantz WHERE resource_kind = ?1 AND resource_id = ?2
            "#,
        )
        .bind(&resource.kind)
        .bind(&resource.id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(TryInto::try_into).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::test_pool;

    async fn store() -> SqliteGrantStore {
        SqliteGrantStore::new(test_pool().await)
    }

    fn identity_grant(identity_id: Uuid, resource: Resource, role: Role) -> RoleGrant {
        RoleGrant {
            subject: Subject::Identity { identity_id },
            resource,
            role,
            granted_by: "admin-node".to_string(),
            granted_at: 100,
            expires_at: None,
        }
    }

    #[tokio::test]
    async fn grant_then_grants_on_round_trips() {
        let store = store().await;
        let identity_id = Uuid::new_v4();
        let grant = identity_grant(identity_id, Resource::doc("doc-1"), Role::Member);
        store.grant(grant.clone()).await.unwrap();

        let on_resource = store.grants_on(Resource::doc("doc-1")).await.unwrap();
        assert_eq!(on_resource, vec![grant.clone()]);

        let for_subject = store
            .grants_for(Subject::Identity { identity_id })
            .await
            .unwrap();
        assert_eq!(for_subject, vec![grant]);
    }

    #[tokio::test]
    async fn grant_upserts_on_same_subject_and_resource() {
        let store = store().await;
        let identity_id = Uuid::new_v4();
        store
            .grant(identity_grant(
                identity_id,
                Resource::doc("doc-1"),
                Role::Viewer,
            ))
            .await
            .unwrap();
        store
            .grant(identity_grant(
                identity_id,
                Resource::doc("doc-1"),
                Role::Admin,
            ))
            .await
            .unwrap();

        let on_resource = store.grants_on(Resource::doc("doc-1")).await.unwrap();
        assert_eq!(on_resource.len(), 1);
        assert_eq!(on_resource[0].role, Role::Admin);
    }

    #[tokio::test]
    async fn revoke_deletes_the_exact_subject_resource_pair() {
        let store = store().await;
        let identity_id = Uuid::new_v4();
        store
            .grant(identity_grant(
                identity_id,
                Resource::doc("doc-1"),
                Role::Member,
            ))
            .await
            .unwrap();
        store
            .grant(identity_grant(
                identity_id,
                Resource::doc("doc-2"),
                Role::Member,
            ))
            .await
            .unwrap();

        store
            .revoke(Subject::Identity { identity_id }, Resource::doc("doc-1"))
            .await
            .unwrap();

        assert!(store
            .grants_on(Resource::doc("doc-1"))
            .await
            .unwrap()
            .is_empty());
        assert_eq!(
            store.grants_on(Resource::doc("doc-2")).await.unwrap().len(),
            1
        );
    }

    #[tokio::test]
    async fn revoke_missing_grant_is_a_no_op() {
        let store = store().await;
        store
            .revoke(
                Subject::Identity {
                    identity_id: Uuid::new_v4(),
                },
                Resource::doc("doc-1"),
            )
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn everyone_subject_grants_round_trip_and_stay_unique() {
        let store = store().await;
        let grant = RoleGrant {
            subject: Subject::Everyone,
            resource: Resource::doc("public-doc"),
            role: Role::Viewer,
            granted_by: "admin-node".to_string(),
            granted_at: 100,
            expires_at: None,
        };
        store.grant(grant.clone()).await.unwrap();
        store.grant(grant.clone()).await.unwrap();

        let on_resource = store.grants_on(Resource::doc("public-doc")).await.unwrap();
        assert_eq!(on_resource, vec![grant]);
    }

    #[tokio::test]
    async fn group_subject_grants_round_trip() {
        let store = store().await;
        let group_id = Uuid::new_v4();
        let grant = RoleGrant {
            subject: Subject::Group { group_id },
            resource: Resource::collection("shared"),
            role: Role::Member,
            granted_by: "admin-node".to_string(),
            granted_at: 100,
            expires_at: Some(200),
        };
        store.grant(grant.clone()).await.unwrap();

        let for_subject = store.grants_for(Subject::Group { group_id }).await.unwrap();
        assert_eq!(for_subject, vec![grant]);
    }

    #[tokio::test]
    async fn grants_on_returns_empty_for_unknown_resource() {
        let store = store().await;
        assert!(store
            .grants_on(Resource::doc("nothing-here"))
            .await
            .unwrap()
            .is_empty());
    }
}
