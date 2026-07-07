//! sqlite-backed `CredentialStore`.
//!
//! schema grounded in tomb's `user_credentialz` table (see
//! `grimoire/src/users/webauthn.rs` and `models.rs::WebAuthnCredential`,
//! read-only research): `credential_id` is the raw authenticator credential
//! id (globally unique), `credential_data` is the serialized passkey json
//! blob, plus an optional friendly name and the usual lifecycle timestamps.

use async_trait::async_trait;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::error::StoreError;
use crate::stores::{Credential, CredentialStore};

pub struct SqliteCredentialStore {
    pool: SqlitePool,
}

impl SqliteCredentialStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

struct CredentialRow {
    id: String,
    identity_id: String,
    credential_id: Vec<u8>,
    credential_data: String,
    name: Option<String>,
    created_at: i64,
    last_used_at: Option<i64>,
    deleted_at: Option<i64>,
}

impl TryFrom<CredentialRow> for Credential {
    type Error = StoreError;

    fn try_from(row: CredentialRow) -> Result<Self, Self::Error> {
        Ok(Credential {
            id: row.id,
            identity_id: Uuid::parse_str(&row.identity_id)
                .map_err(|e| StoreError::Conflict(format!("invalid identity id: {e}")))?,
            credential_id: row.credential_id,
            credential_data: serde_json::from_str(&row.credential_data)?,
            name: row.name,
            created_at: row.created_at,
            last_used_at: row.last_used_at,
            deleted_at: row.deleted_at,
        })
    }
}

#[async_trait]
impl CredentialStore for SqliteCredentialStore {
    async fn add_credential(&self, credential: Credential) -> Result<Credential, StoreError> {
        let id = Uuid::new_v4().to_string();
        let identity_id = credential.identity_id.to_string();
        let credential_data = serde_json::to_string(&credential.credential_data)?;

        let result = sqlx::query_as!(
            CredentialRow,
            r#"
            INSERT INTO credentialz (id, identity_id, credential_id, credential_data, name, created_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6)
            RETURNING id as "id!", identity_id as "identity_id!", credential_id as "credential_id!",
                      credential_data as "credential_data!", name, created_at as "created_at!",
                      last_used_at, deleted_at
            "#,
            id,
            identity_id,
            credential.credential_id,
            credential_data,
            credential.name,
            credential.created_at,
        )
        .fetch_one(&self.pool)
        .await;

        let row = match result {
            Ok(row) => row,
            Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
                return Err(StoreError::Conflict(
                    "this credential id is already registered".to_string(),
                ));
            }
            Err(e) => return Err(e.into()),
        };

        row.try_into()
    }

    async fn get_credential(&self, credential_id: &[u8]) -> Result<Option<Credential>, StoreError> {
        let row = sqlx::query_as!(
            CredentialRow,
            r#"
            SELECT id as "id!", identity_id as "identity_id!", credential_id as "credential_id!",
                   credential_data as "credential_data!", name, created_at as "created_at!",
                   last_used_at, deleted_at
            FROM credentialz WHERE credential_id = ?1 AND deleted_at IS NULL
            "#,
            credential_id,
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(TryInto::try_into).transpose()
    }

    async fn list_for_identity(&self, identity_id: Uuid) -> Result<Vec<Credential>, StoreError> {
        let identity_id = identity_id.to_string();
        let rows = sqlx::query_as!(
            CredentialRow,
            r#"
            SELECT id as "id!", identity_id as "identity_id!", credential_id as "credential_id!",
                   credential_data as "credential_data!", name, created_at as "created_at!",
                   last_used_at, deleted_at
            FROM credentialz WHERE identity_id = ?1 AND deleted_at IS NULL
            ORDER BY created_at DESC
            "#,
            identity_id,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(TryInto::try_into).collect()
    }

    async fn touch_last_used(
        &self,
        credential_id: &[u8],
        last_used_at: i64,
    ) -> Result<(), StoreError> {
        sqlx::query!(
            "UPDATE credentialz SET last_used_at = ?1 WHERE credential_id = ?2",
            last_used_at,
            credential_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn remove_credential(&self, credential_id: &[u8]) -> Result<(), StoreError> {
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        sqlx::query!(
            "UPDATE credentialz SET deleted_at = ?1 WHERE credential_id = ?2 AND deleted_at IS NULL",
            now,
            credential_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::test_pool;
    use serde_json::json;

    async fn store() -> (SqliteCredentialStore, SqlitePool) {
        let pool = test_pool().await;
        (SqliteCredentialStore::new(pool.clone()), pool)
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

    fn credential(identity_id: Uuid, credential_id: &[u8]) -> Credential {
        Credential {
            id: String::new(),
            identity_id,
            credential_id: credential_id.to_vec(),
            credential_data: json!({"passkey": "opaque-blob"}),
            name: Some("yubikey".to_string()),
            created_at: 100,
            last_used_at: None,
            deleted_at: None,
        }
    }

    #[tokio::test]
    async fn add_then_get_round_trips() {
        let (store, pool) = store().await;
        let identity_id = seed_identity(&pool).await;
        let added = store
            .add_credential(credential(identity_id, b"cred-a"))
            .await
            .unwrap();
        assert!(!added.id.is_empty());

        let fetched = store.get_credential(b"cred-a").await.unwrap().unwrap();
        assert_eq!(fetched, added);
    }

    #[tokio::test]
    async fn get_credential_missing_returns_none() {
        let (store, _pool) = store().await;
        assert!(store.get_credential(b"missing").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn add_credential_rejects_duplicate_credential_id() {
        let (store, pool) = store().await;
        let identity_id = seed_identity(&pool).await;
        store
            .add_credential(credential(identity_id, b"cred-a"))
            .await
            .unwrap();

        let err = store
            .add_credential(credential(identity_id, b"cred-a"))
            .await
            .unwrap_err();
        assert!(matches!(err, StoreError::Conflict(_)));
    }

    #[tokio::test]
    async fn list_for_identity_orders_newest_first_and_excludes_removed() {
        let (store, pool) = store().await;
        let identity_id = seed_identity(&pool).await;
        store
            .add_credential(Credential {
                created_at: 100,
                ..credential(identity_id, b"cred-a")
            })
            .await
            .unwrap();
        store
            .add_credential(Credential {
                created_at: 200,
                ..credential(identity_id, b"cred-b")
            })
            .await
            .unwrap();

        let all = store.list_for_identity(identity_id).await.unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].credential_id, b"cred-b");

        store.remove_credential(b"cred-b").await.unwrap();
        let remaining = store.list_for_identity(identity_id).await.unwrap();
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].credential_id, b"cred-a");
    }

    #[tokio::test]
    async fn touch_last_used_updates_the_timestamp() {
        let (store, pool) = store().await;
        let identity_id = seed_identity(&pool).await;
        store
            .add_credential(credential(identity_id, b"cred-a"))
            .await
            .unwrap();

        store.touch_last_used(b"cred-a", 999).await.unwrap();
        let fetched = store.get_credential(b"cred-a").await.unwrap().unwrap();
        assert_eq!(fetched.last_used_at, Some(999));
    }

    #[tokio::test]
    async fn remove_credential_soft_deletes_it() {
        let (store, pool) = store().await;
        let identity_id = seed_identity(&pool).await;
        store
            .add_credential(credential(identity_id, b"cred-a"))
            .await
            .unwrap();

        store.remove_credential(b"cred-a").await.unwrap();
        assert!(store.get_credential(b"cred-a").await.unwrap().is_none());
    }
}
