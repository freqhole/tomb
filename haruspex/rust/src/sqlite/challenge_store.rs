//! sqlite-backed `ChallengeStore`.

use async_trait::async_trait;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::error::StoreError;
use crate::stores::challenge_store::{Challenge, ChallengeKind, SaveChallengeArgs};
use crate::stores::ChallengeStore;

pub struct SqliteChallengeStore {
    pool: SqlitePool,
}

impl SqliteChallengeStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl ChallengeStore for SqliteChallengeStore {
    async fn save(&self, args: SaveChallengeArgs) -> Result<String, StoreError> {
        let nonce = Uuid::new_v4().to_string();
        let kind = args.kind.as_str();
        let identity_id = args.identity_id.map(|id| id.to_string());
        let is_account_link = args.is_account_link as i64;

        sqlx::query!(
            r#"
            INSERT INTO webauthn_challengez
                (nonce, kind, challenge_json, identity_id, username, is_account_link, invite_code, created_at, expires_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            "#,
            nonce,
            kind,
            args.challenge_json,
            identity_id,
            args.username,
            is_account_link,
            args.invite_code,
            args.created_at,
            args.expires_at,
        )
        .execute(&self.pool)
        .await?;

        Ok(nonce)
    }

    async fn take(
        &self,
        nonce: &str,
        expected_kind: ChallengeKind,
        now: i64,
    ) -> Result<Option<Challenge>, StoreError> {
        let mut tx = self.pool.begin().await?;

        // lazily purge every expired row while we're here (best-effort,
        // mirrors the donor's behavior).
        sqlx::query!(
            "DELETE FROM webauthn_challengez WHERE expires_at <= ?1",
            now
        )
        .execute(&mut *tx)
        .await?;

        let row = sqlx::query!(
            r#"
            SELECT nonce as "nonce!", kind as "kind!", challenge_json as "challenge_json!",
                   identity_id, username, is_account_link as "is_account_link!: i64",
                   invite_code, expires_at as "expires_at!"
            FROM webauthn_challengez WHERE nonce = ?1
            "#,
            nonce,
        )
        .fetch_optional(&mut *tx)
        .await?;

        let Some(row) = row else {
            tx.commit().await?;
            return Ok(None);
        };

        // already-expired rows were purged above, but the purge and this
        // select aren't atomic with each other in wall-clock terms if `now`
        // was computed slightly before the purge ran - check again to be safe.
        if row.expires_at <= now {
            tx.commit().await?;
            return Ok(None);
        }

        if row.kind != expected_kind.as_str() {
            tx.commit().await?;
            return Ok(None);
        }

        sqlx::query!("DELETE FROM webauthn_challengez WHERE nonce = ?1", nonce)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;

        let identity_id = row
            .identity_id
            .map(|id| {
                Uuid::parse_str(&id)
                    .map_err(|e| StoreError::Conflict(format!("invalid identity id: {e}")))
            })
            .transpose()?;

        Ok(Some(Challenge {
            nonce: row.nonce,
            kind: expected_kind,
            challenge_json: row.challenge_json,
            identity_id,
            username: row.username,
            is_account_link: row.is_account_link != 0,
            invite_code: row.invite_code,
        }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::test_pool;

    async fn store() -> SqliteChallengeStore {
        SqliteChallengeStore::new(test_pool().await)
    }

    fn args(kind: ChallengeKind) -> SaveChallengeArgs {
        SaveChallengeArgs {
            kind,
            challenge_json: "{\"opaque\":true}".to_string(),
            identity_id: None,
            username: Some("alice".to_string()),
            is_account_link: false,
            invite_code: None,
            created_at: 100,
            expires_at: 1000,
        }
    }

    #[tokio::test]
    async fn save_then_take_round_trips_and_is_single_use() {
        let store = store().await;
        let nonce = store.save(args(ChallengeKind::Registration)).await.unwrap();

        let taken = store
            .take(&nonce, ChallengeKind::Registration, 500)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(taken.username.as_deref(), Some("alice"));

        // single-use: taking again returns None.
        assert!(store
            .take(&nonce, ChallengeKind::Registration, 500)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn take_missing_nonce_returns_none() {
        let store = store().await;
        assert!(store
            .take("does-not-exist", ChallengeKind::Registration, 100)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn take_rejects_a_kind_mismatch() {
        let store = store().await;
        let nonce = store.save(args(ChallengeKind::Registration)).await.unwrap();

        assert!(store
            .take(&nonce, ChallengeKind::Authentication, 500)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn take_rejects_an_expired_challenge() {
        let store = store().await;
        let nonce = store.save(args(ChallengeKind::Registration)).await.unwrap();

        assert!(store
            .take(&nonce, ChallengeKind::Registration, 1000)
            .await
            .unwrap()
            .is_none());
        assert!(store
            .take(&nonce, ChallengeKind::Registration, 2000)
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn take_carries_the_account_link_and_invite_code_fields() {
        let store = store().await;
        let identity_id = Uuid::new_v4();
        let saved = SaveChallengeArgs {
            identity_id: Some(identity_id),
            is_account_link: true,
            invite_code: Some("invite-abc".to_string()),
            ..args(ChallengeKind::Registration)
        };
        let nonce = store.save(saved).await.unwrap();

        let taken = store
            .take(&nonce, ChallengeKind::Registration, 500)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(taken.identity_id, Some(identity_id));
        assert!(taken.is_account_link);
        assert_eq!(taken.invite_code.as_deref(), Some("invite-abc"));
    }
}
