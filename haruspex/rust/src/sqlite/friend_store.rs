//! sqlite-backed `FriendStore`.

use async_trait::async_trait;
use sqlx::SqlitePool;

use crate::error::StoreError;
use crate::stores::friend_store::{FriendDirection, FriendEdge, FriendStatus};
use crate::stores::FriendStore;

pub struct SqliteFriendStore {
    pool: SqlitePool,
}

impl SqliteFriendStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

#[derive(sqlx::FromRow)]
struct FriendRow {
    node_id: String,
    status: String,
    direction: String,
    alias: Option<String>,
    group_name: Option<String>,
    created_at: i64,
    updated_at: i64,
}

impl TryFrom<FriendRow> for FriendEdge {
    type Error = StoreError;

    fn try_from(row: FriendRow) -> Result<Self, Self::Error> {
        Ok(FriendEdge {
            node_id: row.node_id,
            status: FriendStatus::parse(&row.status).ok_or_else(|| {
                StoreError::Conflict(format!("invalid friend status: {}", row.status))
            })?,
            direction: FriendDirection::parse(&row.direction).ok_or_else(|| {
                StoreError::Conflict(format!("invalid friend direction: {}", row.direction))
            })?,
            alias: row.alias,
            group_name: row.group_name,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

#[async_trait]
impl FriendStore for SqliteFriendStore {
    async fn upsert_edge(&self, edge: FriendEdge) -> Result<FriendEdge, StoreError> {
        let status = edge.status.as_str();
        let direction = edge.direction.as_str();

        let row: FriendRow = sqlx::query_as(
            r#"
            INSERT INTO friendz (node_id, status, direction, alias, group_name, created_at, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
            ON CONFLICT(node_id) DO UPDATE SET
                status = excluded.status,
                direction = excluded.direction,
                alias = excluded.alias,
                group_name = excluded.group_name,
                updated_at = excluded.updated_at
            RETURNING node_id, status, direction, alias, group_name, created_at, updated_at
            "#,
        )
        .bind(&edge.node_id)
        .bind(status)
        .bind(direction)
        .bind(&edge.alias)
        .bind(&edge.group_name)
        .bind(edge.updated_at)
        .fetch_one(&self.pool)
        .await?;

        row.try_into()
    }

    async fn get_edge(&self, node_id: &str) -> Result<Option<FriendEdge>, StoreError> {
        let row: Option<FriendRow> = sqlx::query_as(
            r#"
            SELECT node_id, status, direction, alias, group_name, created_at, updated_at
            FROM friendz WHERE node_id = ?1
            "#,
        )
        .bind(node_id)
        .fetch_optional(&self.pool)
        .await?;

        row.map(TryInto::try_into).transpose()
    }

    async fn list_edges(
        &self,
        status: Option<FriendStatus>,
    ) -> Result<Vec<FriendEdge>, StoreError> {
        let rows: Vec<FriendRow> = match status {
            Some(status) => {
                let status = status.as_str();
                sqlx::query_as(
                    r#"
                    SELECT node_id, status, direction, alias, group_name, created_at, updated_at
                    FROM friendz WHERE status = ?1
                    ORDER BY updated_at DESC
                    "#,
                )
                .bind(status)
                .fetch_all(&self.pool)
                .await?
            }
            None => {
                sqlx::query_as(
                    r#"
                    SELECT node_id, status, direction, alias, group_name, created_at, updated_at
                    FROM friendz
                    ORDER BY updated_at DESC
                    "#,
                )
                .fetch_all(&self.pool)
                .await?
            }
        };

        rows.into_iter().map(TryInto::try_into).collect()
    }

    async fn remove_edge(&self, node_id: &str) -> Result<(), StoreError> {
        sqlx::query("DELETE FROM friendz WHERE node_id = ?1")
            .bind(node_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::test_pool;

    async fn store() -> SqliteFriendStore {
        SqliteFriendStore::new(test_pool().await)
    }

    fn edge(node_id: &str, status: FriendStatus) -> FriendEdge {
        FriendEdge {
            node_id: node_id.to_string(),
            status,
            direction: FriendDirection::Outbound,
            alias: Some("bestie".to_string()),
            group_name: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[tokio::test]
    async fn upsert_then_get_round_trips() {
        let store = store().await;
        let e = edge("node-a", FriendStatus::Pending);
        store.upsert_edge(e.clone()).await.unwrap();

        let fetched = store.get_edge("node-a").await.unwrap().unwrap();
        assert_eq!(fetched, e);
    }

    #[tokio::test]
    async fn upsert_edge_updates_status_but_keeps_created_at() {
        let store = store().await;
        store
            .upsert_edge(edge("node-a", FriendStatus::Pending))
            .await
            .unwrap();
        store
            .upsert_edge(FriendEdge {
                updated_at: 5,
                ..edge("node-a", FriendStatus::Accepted)
            })
            .await
            .unwrap();

        let fetched = store.get_edge("node-a").await.unwrap().unwrap();
        assert_eq!(fetched.status, FriendStatus::Accepted);
        assert_eq!(fetched.created_at, 1);
        assert_eq!(fetched.updated_at, 5);
    }

    #[tokio::test]
    async fn get_edge_missing_returns_none() {
        let store = store().await;
        assert!(store.get_edge("nope").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn list_edges_filters_by_status() {
        let store = store().await;
        store
            .upsert_edge(edge("node-a", FriendStatus::Pending))
            .await
            .unwrap();
        store
            .upsert_edge(edge("node-b", FriendStatus::Accepted))
            .await
            .unwrap();

        let pending = store.list_edges(Some(FriendStatus::Pending)).await.unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].node_id, "node-a");

        let all = store.list_edges(None).await.unwrap();
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn remove_edge_deletes_it() {
        let store = store().await;
        store
            .upsert_edge(edge("node-a", FriendStatus::Pending))
            .await
            .unwrap();
        store.remove_edge("node-a").await.unwrap();
        assert!(store.get_edge("node-a").await.unwrap().is_none());
    }
}
