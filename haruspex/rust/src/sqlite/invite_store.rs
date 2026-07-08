//! sqlite-backed `InviteStore`.

use async_trait::async_trait;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::error::StoreError;
use crate::stores::grant_store::Role;
use crate::stores::invite_store::{InviteCode, InviteCodeType};
use crate::stores::InviteStore;

pub struct SqliteInviteStore {
    pool: SqlitePool,
}

impl SqliteInviteStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[derive(sqlx::FromRow)]
struct InviteRow {
    id: String,
    code: String,
    code_type: String,
    grants_role: String,
    link_for_user_id: Option<String>,
    link_expires_at: Option<i64>,
    created_at: i64,
    used_at: Option<i64>,
    used_by: Option<String>,
    is_active: i64,
}

impl TryFrom<InviteRow> for InviteCode {
    type Error = StoreError;

    fn try_from(row: InviteRow) -> Result<Self, Self::Error> {
        Ok(InviteCode {
            id: Uuid::parse_str(&row.id)
                .map_err(|e| StoreError::Conflict(format!("invalid invite id: {e}")))?,
            code: row.code,
            code_type: InviteCodeType::parse(&row.code_type).ok_or_else(|| {
                StoreError::Conflict(format!("invalid invite code type: {}", row.code_type))
            })?,
            grants_role: Role::parse(&row.grants_role).ok_or_else(|| {
                StoreError::Conflict(format!("invalid grants_role: {}", row.grants_role))
            })?,
            link_for_user_id: row
                .link_for_user_id
                .map(|s| Uuid::parse_str(&s))
                .transpose()
                .map_err(|e| StoreError::Conflict(format!("invalid link_for_user_id: {e}")))?,
            link_expires_at: row.link_expires_at,
            created_at: row.created_at,
            used_at: row.used_at,
            used_by: row
                .used_by
                .map(|s| Uuid::parse_str(&s))
                .transpose()
                .map_err(|e| StoreError::Conflict(format!("invalid used_by: {e}")))?,
            is_active: row.is_active != 0,
        })
    }
}

#[async_trait]
impl InviteStore for SqliteInviteStore {
    async fn create_invite(&self, invite: InviteCode) -> Result<InviteCode, StoreError> {
        let id = invite.id.to_string();
        let code_type = invite.code_type.as_str();
        let grants_role = invite.grants_role.as_str();
        let link_for_user_id = invite.link_for_user_id.map(|id| id.to_string());
        let is_active = invite.is_active as i64;

        let row: InviteRow = sqlx::query_as(
            r#"
            INSERT INTO invite_codez (id, code, code_type, grants_role, link_for_user_id, link_expires_at, created_at, is_active)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            RETURNING id, code, code_type, grants_role, link_for_user_id, link_expires_at,
                      created_at, used_at, used_by, is_active
            "#,
        )
        .bind(&id)
        .bind(&invite.code)
        .bind(code_type)
        .bind(grants_role)
        .bind(&link_for_user_id)
        .bind(invite.link_expires_at)
        .bind(invite.created_at)
        .bind(is_active)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| match e {
            sqlx::Error::Database(db_err) if db_err.is_unique_violation() => {
                StoreError::Conflict(format!("invite code {} already exists", invite.code))
            }
            e => e.into(),
        })?;

        row.try_into()
    }

    async fn find_by_code(&self, code: &str) -> Result<Option<InviteCode>, StoreError> {
        let row: Option<InviteRow> = sqlx::query_as(
            r#"
            SELECT id, code, code_type, grants_role, link_for_user_id, link_expires_at,
                   created_at, used_at, used_by, is_active
            FROM invite_codez WHERE code = ?1
            "#,
        )
        .bind(code)
        .fetch_optional(&self.pool)
        .await?;

        row.map(TryInto::try_into).transpose()
    }

    async fn mark_used(
        &self,
        code: &str,
        used_by: Uuid,
        used_at: i64,
    ) -> Result<InviteCode, StoreError> {
        let used_by_str = used_by.to_string();
        sqlx::query("UPDATE invite_codez SET used_at = ?1, used_by = ?2 WHERE code = ?3")
            .bind(used_at)
            .bind(&used_by_str)
            .bind(code)
            .execute(&self.pool)
            .await?;

        self.find_by_code(code).await?.ok_or(StoreError::NotFound)
    }

    async fn deactivate(&self, code: &str) -> Result<(), StoreError> {
        sqlx::query("UPDATE invite_codez SET is_active = 0 WHERE code = ?1")
            .bind(code)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn list_active(&self) -> Result<Vec<InviteCode>, StoreError> {
        let rows: Vec<InviteRow> = sqlx::query_as(
            r#"
            SELECT id, code, code_type, grants_role, link_for_user_id, link_expires_at,
                   created_at, used_at, used_by, is_active
            FROM invite_codez WHERE is_active = 1
            ORDER BY created_at ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(TryInto::try_into).collect()
    }

    async fn list_all(&self) -> Result<Vec<InviteCode>, StoreError> {
        let rows: Vec<InviteRow> = sqlx::query_as(
            r#"
            SELECT id, code, code_type, grants_role, link_for_user_id, link_expires_at,
                   created_at, used_at, used_by, is_active
            FROM invite_codez ORDER BY created_at DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(TryInto::try_into).collect()
    }

    async fn deactivate_all_unused(&self) -> Result<u64, StoreError> {
        let result =
            sqlx::query("UPDATE invite_codez SET is_active = 0 WHERE is_active = 1 AND used_at IS NULL")
                .execute(&self.pool)
                .await?;
        Ok(result.rows_affected())
    }

    async fn update_grants_role(&self, code: &str, role: Role) -> Result<InviteCode, StoreError> {
        sqlx::query(
            "UPDATE invite_codez SET grants_role = ?1 WHERE code = ?2 AND is_active = 1 AND used_at IS NULL",
        )
        .bind(role.as_str())
        .bind(code)
        .execute(&self.pool)
        .await?;

        self.find_by_code(code).await?.ok_or(StoreError::NotFound)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::test_pool;

    async fn store() -> SqliteInviteStore {
        SqliteInviteStore::new(test_pool().await)
    }

    async fn seed_identity(store: &SqliteInviteStore, id: Uuid) {
        let id_str = id.to_string();
        sqlx::query("INSERT INTO identityz (id, created_at) VALUES (?1, ?2)")
            .bind(&id_str)
            .bind(100)
            .execute(&store.pool)
            .await
            .unwrap();
    }

    fn invite(code: &str) -> InviteCode {
        InviteCode {
            id: Uuid::new_v4(),
            code: code.to_string(),
            code_type: InviteCodeType::Invite,
            grants_role: Role::Member,
            link_for_user_id: None,
            link_expires_at: None,
            created_at: 100,
            used_at: None,
            used_by: None,
            is_active: true,
        }
    }

    #[tokio::test]
    async fn create_then_find_round_trips() {
        let store = store().await;
        let created = store.create_invite(invite("AAAA-BBBB")).await.unwrap();

        let fetched = store.find_by_code("AAAA-BBBB").await.unwrap().unwrap();
        assert_eq!(fetched, created);
    }

    #[tokio::test]
    async fn find_by_code_missing_returns_none() {
        let store = store().await;
        assert!(store.find_by_code("nope").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn duplicate_code_is_rejected() {
        let store = store().await;
        store.create_invite(invite("AAAA-BBBB")).await.unwrap();

        let err = store.create_invite(invite("AAAA-BBBB")).await.unwrap_err();
        assert!(matches!(err, StoreError::Conflict(_)));
    }

    #[tokio::test]
    async fn mark_used_stamps_used_at_and_used_by() {
        let store = store().await;
        store.create_invite(invite("AAAA-BBBB")).await.unwrap();
        let redeemer = Uuid::new_v4();
        seed_identity(&store, redeemer).await;

        let used = store.mark_used("AAAA-BBBB", redeemer, 200).await.unwrap();

        assert_eq!(used.used_at, Some(200));
        assert_eq!(used.used_by, Some(redeemer));
        assert!(!used.is_valid_for_use(300));
    }

    #[tokio::test]
    async fn deactivate_flips_is_active() {
        let store = store().await;
        store.create_invite(invite("AAAA-BBBB")).await.unwrap();
        store.deactivate("AAAA-BBBB").await.unwrap();

        let fetched = store.find_by_code("AAAA-BBBB").await.unwrap().unwrap();
        assert!(!fetched.is_active);
        assert!(!fetched.is_valid_for_use(1000));
    }

    #[tokio::test]
    async fn list_active_excludes_deactivated_codes() {
        let store = store().await;
        store.create_invite(invite("AAAA-BBBB")).await.unwrap();
        store.create_invite(invite("CCCC-DDDD")).await.unwrap();
        store.deactivate("CCCC-DDDD").await.unwrap();

        let active = store.list_active().await.unwrap();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].code, "AAAA-BBBB");
    }

    #[tokio::test]
    async fn account_link_round_trips_link_fields() {
        let store = store().await;
        let target = Uuid::new_v4();
        seed_identity(&store, target).await;
        let mut i = invite("LINK-CODE");
        i.code_type = InviteCodeType::AccountLink;
        i.link_for_user_id = Some(target);
        i.link_expires_at = Some(9999);
        store.create_invite(i).await.unwrap();

        let fetched = store.find_by_code("LINK-CODE").await.unwrap().unwrap();
        assert!(fetched.is_account_link());
        assert_eq!(fetched.link_for_user_id, Some(target));
        assert_eq!(fetched.link_expires_at, Some(9999));
    }
}
