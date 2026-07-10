//! sqlite-backed `KnockStore`.
//!
//! implements the single-responder, last-decision-wins semantics the
//! automerge design spike's `PlainKnockStore` demonstrated and recommended
//! promoting to production (`docs/automerge-spike.md` section 2): each
//! `record_decision` call overwrites the record's resolved status with
//! whatever decision just arrived, while still appending every decision to
//! an audit log. the spike's first-decision-wins `AutomergeStyleKnockStore`
//! variant stays spike-only.

use async_trait::async_trait;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::error::StoreError;
use crate::stores::knock_store::{
    KnockDecision, KnockDirection, KnockRecord, KnockScope, KnockStatus,
};
use crate::stores::KnockStore;

pub struct SqliteKnockStore {
    pool: SqlitePool,
}

impl SqliteKnockStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[derive(sqlx::FromRow)]
struct KnockRow {
    id: String,
    node_id: String,
    direction: String,
    scope_json: String,
    message: String,
    status: String,
    created_at: i64,
    processed_at: Option<i64>,
    processed_by: Option<String>,
    decisions_json: String,
    metadata_json: Option<String>,
}

impl TryFrom<KnockRow> for KnockRecord {
    type Error = StoreError;

    fn try_from(row: KnockRow) -> Result<Self, Self::Error> {
        Ok(KnockRecord {
            id: Uuid::parse_str(&row.id)
                .map_err(|e| StoreError::Conflict(format!("invalid knock id: {e}")))?,
            node_id: row.node_id,
            direction: KnockDirection::parse(&row.direction).ok_or_else(|| {
                StoreError::Conflict(format!("invalid knock direction: {}", row.direction))
            })?,
            scope: serde_json::from_str::<KnockScope>(&row.scope_json)?,
            message: row.message,
            status: KnockStatus::parse(&row.status).ok_or_else(|| {
                StoreError::Conflict(format!("invalid knock status: {}", row.status))
            })?,
            created_at: row.created_at,
            processed_at: row.processed_at,
            processed_by: row.processed_by,
            decisions: serde_json::from_str::<Vec<KnockDecision>>(&row.decisions_json)?,
            metadata: row
                .metadata_json
                .map(|json| serde_json::from_str(&json))
                .transpose()?,
        })
    }
}

#[async_trait]
impl KnockStore for SqliteKnockStore {
    async fn create_knock(
        &self,
        node_id: &str,
        direction: KnockDirection,
        scope: KnockScope,
        message: String,
        created_at: i64,
        metadata: Option<serde_json::Value>,
    ) -> Result<KnockRecord, StoreError> {
        let id = Uuid::new_v4();
        let id_str = id.to_string();
        let direction_str = direction.as_str();
        // canonical json rendering of the scope enum, used only as the dedup
        // key - serde_json serializes a given enum variant + field values
        // deterministically, so identical scopes always produce identical keys.
        let scope_key = serde_json::to_string(&scope)?;
        let scope_json = scope_key.clone();
        let status = KnockStatus::Pending.as_str();
        let decisions_json = "[]";
        let metadata_json = metadata.map(|m| serde_json::to_string(&m)).transpose()?;

        let result = sqlx::query(
            r#"
            INSERT INTO knockz (id, node_id, direction, scope_key, scope_json, message, status, created_at, decisions_json, metadata_json)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
        )
        .bind(&id_str)
        .bind(node_id)
        .bind(direction_str)
        .bind(&scope_key)
        .bind(&scope_json)
        .bind(&message)
        .bind(status)
        .bind(created_at)
        .bind(decisions_json)
        .bind(&metadata_json)
        .execute(&self.pool)
        .await;

        match result {
            Ok(_) => {}
            Err(sqlx::Error::Database(db_err)) if db_err.is_unique_violation() => {
                return Err(StoreError::Conflict(format!(
                    "an active knock already exists for node {node_id} + this scope"
                )));
            }
            Err(e) => return Err(e.into()),
        }

        self.get_knock(id).await?.ok_or(StoreError::NotFound)
    }

    async fn get_knock(&self, knock_id: Uuid) -> Result<Option<KnockRecord>, StoreError> {
        let id = knock_id.to_string();
        let row: Option<KnockRow> = sqlx::query_as(
            r#"
            SELECT id, node_id, direction, scope_json, message, status, created_at,
                   processed_at, processed_by, decisions_json, metadata_json
            FROM knockz WHERE id = ?1
            "#,
        )
        .bind(&id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(TryInto::try_into).transpose()
    }

    async fn list_pending(&self) -> Result<Vec<KnockRecord>, StoreError> {
        let rows: Vec<KnockRow> = sqlx::query_as(
            r#"
            SELECT id, node_id, direction, scope_json, message, status, created_at,
                   processed_at, processed_by, decisions_json, metadata_json
            FROM knockz WHERE status = 'pending'
            ORDER BY created_at ASC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(TryInto::try_into).collect()
    }

    async fn record_decision(
        &self,
        knock_id: Uuid,
        decision: KnockDecision,
    ) -> Result<KnockRecord, StoreError> {
        let id_str = knock_id.to_string();
        let mut tx = self.pool.begin().await?;

        let existing: Option<String> =
            sqlx::query_scalar(r#"SELECT decisions_json FROM knockz WHERE id = ?1"#)
                .bind(&id_str)
                .fetch_optional(&mut *tx)
                .await?;
        let existing = existing.ok_or(StoreError::NotFound)?;

        let mut decisions: Vec<KnockDecision> = serde_json::from_str(&existing)?;
        decisions.push(decision.clone());
        let decisions_json = serde_json::to_string(&decisions)?;
        // single-responder assumption: whichever decision arrives becomes the
        // record's resolved status - there is no concurrent-writer case to
        // reconcile here (each knock typically has one admin deciding, not
        // multiple simultaneous responders).
        let status = decision.outcome.as_str();

        sqlx::query(
            r#"
            UPDATE knockz
            SET status = ?1, processed_at = ?2, processed_by = ?3, decisions_json = ?4
            WHERE id = ?5
            "#,
        )
        .bind(status)
        .bind(decision.at)
        .bind(&decision.by_node_id)
        .bind(&decisions_json)
        .bind(&id_str)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        self.get_knock(knock_id).await?.ok_or(StoreError::NotFound)
    }

    async fn list_all(&self) -> Result<Vec<KnockRecord>, StoreError> {
        let rows: Vec<KnockRow> = sqlx::query_as(
            r#"
            SELECT id, node_id, direction, scope_json, message, status, created_at,
                   processed_at, processed_by, decisions_json, metadata_json
            FROM knockz ORDER BY created_at DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(TryInto::try_into).collect()
    }

    async fn find_by_node_id(&self, node_id: &str) -> Result<Option<KnockRecord>, StoreError> {
        let row: Option<KnockRow> = sqlx::query_as(
            r#"
            SELECT id, node_id, direction, scope_json, message, status, created_at,
                   processed_at, processed_by, decisions_json, metadata_json
            FROM knockz WHERE node_id = ?1
            ORDER BY created_at DESC
            LIMIT 1
            "#,
        )
        .bind(node_id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(TryInto::try_into).transpose()
    }

    async fn delete_knock(&self, knock_id: Uuid) -> Result<(), StoreError> {
        let id = knock_id.to_string();
        let result = sqlx::query("DELETE FROM knockz WHERE id = ?1")
            .bind(&id)
            .execute(&self.pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(StoreError::NotFound);
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::test_pool;
    use crate::stores::grant_store::Role;
    use serde_json::json;

    async fn store() -> SqliteKnockStore {
        SqliteKnockStore::new(test_pool().await)
    }

    fn resource_scope(resource_id: &str) -> KnockScope {
        KnockScope::Resource {
            resource_id: resource_id.to_string(),
            requested_role: Some(Role::Member),
        }
    }

    #[tokio::test]
    async fn create_then_get_round_trips() {
        let store = store().await;
        let created = store
            .create_knock(
                "node-a",
                KnockDirection::Inbound,
                resource_scope("canvas-1"),
                "let me in".to_string(),
                100,
                None,
            )
            .await
            .unwrap();

        let fetched = store.get_knock(created.id).await.unwrap().unwrap();
        assert_eq!(fetched, created);
        assert_eq!(fetched.status, KnockStatus::Pending);
        assert!(fetched.decisions.is_empty());
        // absence of metadata behaves exactly as before this field existed.
        assert_eq!(fetched.metadata, None);
    }

    #[tokio::test]
    async fn create_then_get_round_trips_metadata() {
        let store = store().await;
        let metadata = json!({ "name": "alice", "avatarColor": "#ff00ff" });
        let created = store
            .create_knock(
                "node-a",
                KnockDirection::Inbound,
                resource_scope("canvas-1"),
                "let me in".to_string(),
                100,
                Some(metadata.clone()),
            )
            .await
            .unwrap();
        assert_eq!(created.metadata, Some(metadata.clone()));

        let fetched = store.get_knock(created.id).await.unwrap().unwrap();
        assert_eq!(fetched.metadata, Some(metadata));
    }

    #[tokio::test]
    async fn get_knock_missing_returns_none() {
        let store = store().await;
        assert!(store.get_knock(Uuid::new_v4()).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn dedup_rejects_a_second_active_knock_for_same_node_and_scope() {
        let store = store().await;
        store
            .create_knock(
                "node-a",
                KnockDirection::Inbound,
                resource_scope("canvas-1"),
                "first".to_string(),
                100,
                None,
            )
            .await
            .unwrap();

        let err = store
            .create_knock(
                "node-a",
                KnockDirection::Inbound,
                resource_scope("canvas-1"),
                "second".to_string(),
                101,
                None,
            )
            .await
            .unwrap_err();
        assert!(matches!(err, StoreError::Conflict(_)));
    }

    #[tokio::test]
    async fn dedup_allows_different_scopes_for_the_same_node() {
        let store = store().await;
        store
            .create_knock(
                "node-a",
                KnockDirection::Inbound,
                resource_scope("canvas-1"),
                "first".to_string(),
                100,
                None,
            )
            .await
            .unwrap();

        store
            .create_knock(
                "node-a",
                KnockDirection::Inbound,
                resource_scope("canvas-2"),
                "second".to_string(),
                101,
                None,
            )
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn dedup_allows_a_new_knock_once_the_prior_one_is_resolved() {
        let store = store().await;
        let first = store
            .create_knock(
                "node-a",
                KnockDirection::Inbound,
                resource_scope("canvas-1"),
                "first".to_string(),
                100,
                None,
            )
            .await
            .unwrap();

        store
            .record_decision(
                first.id,
                KnockDecision {
                    by_node_id: "admin-1".to_string(),
                    outcome: KnockStatus::Denied,
                    granted_role: None,
                    at: 101,
                },
            )
            .await
            .unwrap();

        store
            .create_knock(
                "node-a",
                KnockDirection::Inbound,
                resource_scope("canvas-1"),
                "second attempt".to_string(),
                102,
                None,
            )
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn list_pending_excludes_resolved_knocks() {
        let store = store().await;
        let pending = store
            .create_knock(
                "node-a",
                KnockDirection::Inbound,
                resource_scope("canvas-1"),
                "pending".to_string(),
                100,
                None,
            )
            .await
            .unwrap();
        let resolved = store
            .create_knock(
                "node-b",
                KnockDirection::Inbound,
                resource_scope("canvas-2"),
                "resolved".to_string(),
                100,
                None,
            )
            .await
            .unwrap();
        store
            .record_decision(
                resolved.id,
                KnockDecision {
                    by_node_id: "admin-1".to_string(),
                    outcome: KnockStatus::Accepted,
                    granted_role: Some("member".to_string()),
                    at: 101,
                },
            )
            .await
            .unwrap();

        let listed = store.list_pending().await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, pending.id);
    }

    /// mirrors the automerge spike's own demonstration: feeding the same
    /// sequence of decisions (accept, then deny) yields the LAST decision as
    /// the resolved status - haruspex's production semantics, per the
    /// spike's recommendation.
    #[tokio::test]
    async fn record_decision_is_last_decision_wins() {
        let store = store().await;
        let knock = store
            .create_knock(
                "node-a",
                KnockDirection::Inbound,
                resource_scope("canvas-1"),
                "let me in".to_string(),
                100,
                None,
            )
            .await
            .unwrap();

        let after_first = store
            .record_decision(
                knock.id,
                KnockDecision {
                    by_node_id: "admin-1".to_string(),
                    outcome: KnockStatus::Accepted,
                    granted_role: Some("member".to_string()),
                    at: 101,
                },
            )
            .await
            .unwrap();
        assert_eq!(after_first.status, KnockStatus::Accepted);
        assert_eq!(after_first.decisions.len(), 1);

        let after_second = store
            .record_decision(
                knock.id,
                KnockDecision {
                    by_node_id: "admin-2".to_string(),
                    outcome: KnockStatus::Denied,
                    granted_role: None,
                    at: 102,
                },
            )
            .await
            .unwrap();

        // the second (most recent) decision wins - opposite of the spike's
        // AutomergeStyleKnockStore, which would keep the first.
        assert_eq!(after_second.status, KnockStatus::Denied);
        assert_eq!(after_second.decisions.len(), 2);
        assert_eq!(after_second.processed_by.as_deref(), Some("admin-2"));
        assert_eq!(after_second.processed_at, Some(102));
    }

    #[tokio::test]
    async fn record_decision_on_missing_knock_returns_not_found() {
        let store = store().await;
        let err = store
            .record_decision(
                Uuid::new_v4(),
                KnockDecision {
                    by_node_id: "admin-1".to_string(),
                    outcome: KnockStatus::Accepted,
                    granted_role: None,
                    at: 1,
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(err, StoreError::NotFound));
    }
}
