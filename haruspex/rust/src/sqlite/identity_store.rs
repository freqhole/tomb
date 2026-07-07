//! sqlite-backed `IdentityStore`.
//!
//! `add_device` ports tomb's `user_peer_nodez` global-unique-even-when-
//! deleted rule (see migration 0001's `idx_device_nodez_node_id`, a
//! non-partial unique index): a node id already registered to a different
//! identity is rejected, while re-adding it under its own identity restores
//! a soft-deleted row.

use std::collections::HashMap;

use async_trait::async_trait;
use sqlx::{QueryBuilder, Sqlite, SqlitePool};
use uuid::Uuid;

use crate::error::StoreError;
use crate::identity::{DeviceNode, Identity};
use crate::stores::IdentityStore;

pub struct SqliteIdentityStore {
    pool: SqlitePool,
}

impl SqliteIdentityStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

struct IdentityRow {
    id: String,
    username: Option<String>,
    created_at: i64,
    metadata: Option<String>,
    deleted_at: Option<i64>,
}

impl TryFrom<IdentityRow> for Identity {
    type Error = StoreError;

    fn try_from(row: IdentityRow) -> Result<Self, Self::Error> {
        Ok(Identity {
            id: Uuid::parse_str(&row.id)
                .map_err(|e| StoreError::Conflict(format!("invalid identity id: {e}")))?,
            username: row.username,
            created_at: row.created_at,
            metadata: row.metadata.map(|m| serde_json::from_str(&m)).transpose()?,
            deleted_at: row.deleted_at,
        })
    }
}

struct DeviceRow {
    identity_id: String,
    node_id: String,
    instance_name: Option<String>,
    last_seen_at: i64,
    deleted_at: Option<i64>,
}

impl TryFrom<DeviceRow> for DeviceNode {
    type Error = StoreError;

    fn try_from(row: DeviceRow) -> Result<Self, Self::Error> {
        Ok(DeviceNode {
            identity_id: Uuid::parse_str(&row.identity_id)
                .map_err(|e| StoreError::Conflict(format!("invalid identity id: {e}")))?,
            node_id: row.node_id,
            instance_name: row.instance_name,
            last_seen_at: row.last_seen_at,
            deleted_at: row.deleted_at,
        })
    }
}

#[async_trait]
impl IdentityStore for SqliteIdentityStore {
    async fn upsert_identity(&self, identity: Identity) -> Result<Identity, StoreError> {
        let id = identity.id.to_string();
        let metadata = identity
            .metadata
            .as_ref()
            .map(serde_json::to_string)
            .transpose()?;

        let row = sqlx::query_as!(
            IdentityRow,
            r#"
            INSERT INTO identityz (id, username, created_at, metadata, deleted_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
                username = excluded.username,
                metadata = excluded.metadata,
                deleted_at = excluded.deleted_at
            RETURNING id as "id!", username, created_at as "created_at!", metadata, deleted_at
            "#,
            id,
            identity.username,
            identity.created_at,
            metadata,
            identity.deleted_at,
        )
        .fetch_one(&self.pool)
        .await?;

        row.try_into()
    }

    async fn get_identity(&self, identity_id: Uuid) -> Result<Option<Identity>, StoreError> {
        let id = identity_id.to_string();
        let row = sqlx::query_as!(
            IdentityRow,
            r#"
            SELECT id as "id!", username, created_at as "created_at!", metadata, deleted_at
            FROM identityz WHERE id = ?1
            "#,
            id,
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(TryInto::try_into).transpose()
    }

    async fn usernames_for(
        &self,
        identity_ids: &[Uuid],
    ) -> Result<HashMap<Uuid, Option<String>>, StoreError> {
        if identity_ids.is_empty() {
            return Ok(HashMap::new());
        }

        #[derive(sqlx::FromRow)]
        struct Row {
            id: String,
            username: Option<String>,
        }

        let mut builder: QueryBuilder<Sqlite> =
            QueryBuilder::new("SELECT id, username FROM identityz WHERE id IN (");
        let mut separated = builder.separated(", ");
        for id in identity_ids {
            separated.push_bind(id.to_string());
        }
        separated.push_unseparated(")");

        let rows: Vec<Row> = builder.build_query_as().fetch_all(&self.pool).await?;

        let mut result = HashMap::new();
        for row in rows {
            let id = Uuid::parse_str(&row.id)
                .map_err(|e| StoreError::Conflict(format!("invalid identity id: {e}")))?;
            result.insert(id, row.username);
        }
        Ok(result)
    }

    async fn add_device(&self, device: DeviceNode) -> Result<DeviceNode, StoreError> {
        let mut tx = self.pool.begin().await?;
        let identity_id = device.identity_id.to_string();

        let existing = sqlx::query!(
            r#"SELECT identity_id as "identity_id!" FROM device_nodez WHERE node_id = ?1"#,
            device.node_id,
        )
        .fetch_optional(&mut *tx)
        .await?;

        if let Some(existing) = existing {
            if existing.identity_id != identity_id {
                return Err(StoreError::Conflict(format!(
                    "node id {} is already registered to a different identity",
                    device.node_id
                )));
            }
            sqlx::query!(
                r#"
                UPDATE device_nodez
                SET instance_name = COALESCE(?1, instance_name),
                    last_seen_at = ?2,
                    deleted_at = NULL
                WHERE node_id = ?3
                "#,
                device.instance_name,
                device.last_seen_at,
                device.node_id,
            )
            .execute(&mut *tx)
            .await?;
        } else {
            sqlx::query!(
                r#"
                INSERT INTO device_nodez (identity_id, node_id, instance_name, last_seen_at, deleted_at)
                VALUES (?1, ?2, ?3, ?4, ?5)
                "#,
                identity_id,
                device.node_id,
                device.instance_name,
                device.last_seen_at,
                device.deleted_at,
            )
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;

        self.resolve_device(&device.node_id)
            .await?
            .ok_or(StoreError::NotFound)
    }

    async fn resolve_device(&self, node_id: &str) -> Result<Option<DeviceNode>, StoreError> {
        let row = sqlx::query_as!(
            DeviceRow,
            r#"
            SELECT identity_id as "identity_id!", node_id as "node_id!", instance_name,
                   last_seen_at as "last_seen_at!", deleted_at
            FROM device_nodez WHERE node_id = ?1
            "#,
            node_id,
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(TryInto::try_into).transpose()
    }

    async fn touch_device(&self, node_id: &str, last_seen_at: i64) -> Result<(), StoreError> {
        sqlx::query!(
            "UPDATE device_nodez SET last_seen_at = ?1 WHERE node_id = ?2",
            last_seen_at,
            node_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn remove_device(&self, node_id: &str) -> Result<(), StoreError> {
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        sqlx::query!(
            "UPDATE device_nodez SET deleted_at = ?1 WHERE node_id = ?2 AND deleted_at IS NULL",
            now,
            node_id,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn devices_for_identity(&self, identity_id: Uuid) -> Result<Vec<DeviceNode>, StoreError> {
        let id = identity_id.to_string();
        let rows = sqlx::query_as!(
            DeviceRow,
            r#"
            SELECT identity_id as "identity_id!", node_id as "node_id!", instance_name,
                   last_seen_at as "last_seen_at!", deleted_at
            FROM device_nodez WHERE identity_id = ?1
            ORDER BY last_seen_at DESC
            "#,
            id,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(TryInto::try_into).collect()
    }

    async fn identities_for(
        &self,
        node_ids: &[String],
    ) -> Result<HashMap<String, Identity>, StoreError> {
        if node_ids.is_empty() {
            return Ok(HashMap::new());
        }

        #[derive(sqlx::FromRow)]
        struct Row {
            node_id: String,
            id: String,
            username: Option<String>,
            created_at: i64,
            metadata: Option<String>,
            deleted_at: Option<i64>,
        }

        let mut builder: QueryBuilder<Sqlite> = QueryBuilder::new(
            "SELECT d.node_id as node_id, i.id as id, i.username as username, \
             i.created_at as created_at, i.metadata as metadata, i.deleted_at as deleted_at \
             FROM device_nodez d JOIN identityz i ON i.id = d.identity_id \
             WHERE d.node_id IN (",
        );
        let mut separated = builder.separated(", ");
        for node_id in node_ids {
            separated.push_bind(node_id);
        }
        separated.push_unseparated(")");

        let rows: Vec<Row> = builder.build_query_as().fetch_all(&self.pool).await?;

        let mut result = HashMap::new();
        for row in rows {
            let identity = Identity {
                id: Uuid::parse_str(&row.id)
                    .map_err(|e| StoreError::Conflict(format!("invalid identity id: {e}")))?,
                username: row.username,
                created_at: row.created_at,
                metadata: row.metadata.map(|m| serde_json::from_str(&m)).transpose()?,
                deleted_at: row.deleted_at,
            };
            result.insert(row.node_id, identity);
        }
        Ok(result)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::test_pool;

    async fn store() -> SqliteIdentityStore {
        SqliteIdentityStore::new(test_pool().await)
    }

    fn new_identity(username: Option<&str>) -> Identity {
        Identity {
            id: Uuid::new_v4(),
            username: username.map(str::to_string),
            created_at: 1_700_000_000,
            metadata: None,
            deleted_at: None,
        }
    }

    #[tokio::test]
    async fn upsert_then_get_identity_round_trips() {
        let store = store().await;
        let identity = new_identity(Some("alice"));
        store.upsert_identity(identity.clone()).await.unwrap();

        let fetched = store.get_identity(identity.id).await.unwrap().unwrap();
        assert_eq!(fetched, identity);
    }

    #[tokio::test]
    async fn upsert_identity_is_idempotent() {
        let store = store().await;
        let mut identity = new_identity(Some("alice"));
        store.upsert_identity(identity.clone()).await.unwrap();

        identity.username = Some("alice2".to_string());
        store.upsert_identity(identity.clone()).await.unwrap();

        let fetched = store.get_identity(identity.id).await.unwrap().unwrap();
        assert_eq!(fetched.username.as_deref(), Some("alice2"));
    }

    #[tokio::test]
    async fn get_identity_missing_returns_none() {
        let store = store().await;
        assert!(store.get_identity(Uuid::new_v4()).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn usernames_for_batches_lookups() {
        let store = store().await;
        let a = new_identity(Some("alice"));
        let b = new_identity(None);
        store.upsert_identity(a.clone()).await.unwrap();
        store.upsert_identity(b.clone()).await.unwrap();

        let result = store.usernames_for(&[a.id, b.id]).await.unwrap();
        assert_eq!(result.get(&a.id).unwrap().as_deref(), Some("alice"));
        assert_eq!(result.get(&b.id).unwrap(), &None);
    }

    #[tokio::test]
    async fn usernames_for_empty_slice_returns_empty_map() {
        let store = store().await;
        assert!(store.usernames_for(&[]).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn add_device_then_resolve_round_trips() {
        let store = store().await;
        let identity = new_identity(Some("alice"));
        store.upsert_identity(identity.clone()).await.unwrap();

        let device = DeviceNode {
            identity_id: identity.id,
            node_id: "node-a".to_string(),
            instance_name: Some("laptop".to_string()),
            last_seen_at: 1_700_000_001,
            deleted_at: None,
        };
        store.add_device(device.clone()).await.unwrap();

        let resolved = store.resolve_device("node-a").await.unwrap().unwrap();
        assert_eq!(resolved, device);
    }

    #[tokio::test]
    async fn add_device_rejects_reregistration_to_a_different_identity() {
        let store = store().await;
        let a = new_identity(Some("alice"));
        let b = new_identity(Some("bob"));
        store.upsert_identity(a.clone()).await.unwrap();
        store.upsert_identity(b.clone()).await.unwrap();

        store
            .add_device(DeviceNode {
                identity_id: a.id,
                node_id: "node-a".to_string(),
                instance_name: None,
                last_seen_at: 1,
                deleted_at: None,
            })
            .await
            .unwrap();

        let err = store
            .add_device(DeviceNode {
                identity_id: b.id,
                node_id: "node-a".to_string(),
                instance_name: None,
                last_seen_at: 2,
                deleted_at: None,
            })
            .await
            .unwrap_err();
        assert!(matches!(err, StoreError::Conflict(_)));
    }

    #[tokio::test]
    async fn add_device_rejects_reregistration_even_after_soft_delete() {
        let store = store().await;
        let a = new_identity(Some("alice"));
        let b = new_identity(Some("bob"));
        store.upsert_identity(a.clone()).await.unwrap();
        store.upsert_identity(b.clone()).await.unwrap();

        store
            .add_device(DeviceNode {
                identity_id: a.id,
                node_id: "node-a".to_string(),
                instance_name: None,
                last_seen_at: 1,
                deleted_at: None,
            })
            .await
            .unwrap();
        store.remove_device("node-a").await.unwrap();

        // node-a is soft-deleted but still globally reserved to identity a.
        let err = store
            .add_device(DeviceNode {
                identity_id: b.id,
                node_id: "node-a".to_string(),
                instance_name: None,
                last_seen_at: 2,
                deleted_at: None,
            })
            .await
            .unwrap_err();
        assert!(matches!(err, StoreError::Conflict(_)));
    }

    #[tokio::test]
    async fn add_device_same_identity_restores_a_soft_deleted_row() {
        let store = store().await;
        let a = new_identity(Some("alice"));
        store.upsert_identity(a.clone()).await.unwrap();

        store
            .add_device(DeviceNode {
                identity_id: a.id,
                node_id: "node-a".to_string(),
                instance_name: Some("laptop".to_string()),
                last_seen_at: 1,
                deleted_at: None,
            })
            .await
            .unwrap();
        store.remove_device("node-a").await.unwrap();
        assert!(store
            .resolve_device("node-a")
            .await
            .unwrap()
            .unwrap()
            .deleted_at
            .is_some());

        let restored = store
            .add_device(DeviceNode {
                identity_id: a.id,
                node_id: "node-a".to_string(),
                instance_name: Some("laptop-renamed".to_string()),
                last_seen_at: 5,
                deleted_at: None,
            })
            .await
            .unwrap();

        assert!(restored.deleted_at.is_none());
        assert_eq!(restored.instance_name.as_deref(), Some("laptop-renamed"));
        assert_eq!(restored.last_seen_at, 5);
    }

    #[tokio::test]
    async fn touch_device_updates_last_seen() {
        let store = store().await;
        let a = new_identity(None);
        store.upsert_identity(a.clone()).await.unwrap();
        store
            .add_device(DeviceNode {
                identity_id: a.id,
                node_id: "node-a".to_string(),
                instance_name: None,
                last_seen_at: 1,
                deleted_at: None,
            })
            .await
            .unwrap();

        store.touch_device("node-a", 42).await.unwrap();
        let device = store.resolve_device("node-a").await.unwrap().unwrap();
        assert_eq!(device.last_seen_at, 42);
    }

    #[tokio::test]
    async fn devices_for_identity_lists_all_devices() {
        let store = store().await;
        let a = new_identity(None);
        store.upsert_identity(a.clone()).await.unwrap();
        for node_id in ["node-a", "node-b"] {
            store
                .add_device(DeviceNode {
                    identity_id: a.id,
                    node_id: node_id.to_string(),
                    instance_name: None,
                    last_seen_at: 1,
                    deleted_at: None,
                })
                .await
                .unwrap();
        }

        let devices = store.devices_for_identity(a.id).await.unwrap();
        assert_eq!(devices.len(), 2);
    }

    #[tokio::test]
    async fn identities_for_batches_node_id_lookups() {
        let store = store().await;
        let a = new_identity(Some("alice"));
        store.upsert_identity(a.clone()).await.unwrap();
        store
            .add_device(DeviceNode {
                identity_id: a.id,
                node_id: "node-a".to_string(),
                instance_name: None,
                last_seen_at: 1,
                deleted_at: None,
            })
            .await
            .unwrap();

        let result = store
            .identities_for(&["node-a".to_string(), "node-missing".to_string()])
            .await
            .unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result.get("node-a").unwrap().id, a.id);
    }
}
