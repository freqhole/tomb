//! sqlite-backed `GroupStore`.

use async_trait::async_trait;
use sqlx::SqlitePool;
use uuid::Uuid;

use crate::error::StoreError;
use crate::stores::group_store::{Group, Membership};
use crate::stores::GroupStore;

pub struct SqliteGroupStore {
    pool: SqlitePool,
}

impl SqliteGroupStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

struct GroupRow {
    id: String,
    name: String,
    color: Option<String>,
    created_at: i64,
}

impl TryFrom<GroupRow> for Group {
    type Error = StoreError;

    fn try_from(row: GroupRow) -> Result<Self, Self::Error> {
        Ok(Group {
            id: Uuid::parse_str(&row.id)
                .map_err(|e| StoreError::Conflict(format!("invalid group id: {e}")))?,
            name: row.name,
            color: row.color,
            created_at: row.created_at,
        })
    }
}

#[async_trait]
impl GroupStore for SqliteGroupStore {
    async fn create_group(&self, group: Group) -> Result<Group, StoreError> {
        let id = group.id.to_string();
        let row = sqlx::query_as!(
            GroupRow,
            r#"
            INSERT INTO groupz (id, name, color, created_at)
            VALUES (?1, ?2, ?3, ?4)
            RETURNING id as "id!", name as "name!", color, created_at as "created_at!"
            "#,
            id,
            group.name,
            group.color,
            group.created_at,
        )
        .fetch_one(&self.pool)
        .await?;

        row.try_into()
    }

    async fn get_group(&self, group_id: Uuid) -> Result<Option<Group>, StoreError> {
        let id = group_id.to_string();
        let row = sqlx::query_as!(
            GroupRow,
            r#"SELECT id as "id!", name as "name!", color, created_at as "created_at!" FROM groupz WHERE id = ?1"#,
            id,
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(TryInto::try_into).transpose()
    }

    async fn list_groups(&self) -> Result<Vec<Group>, StoreError> {
        let rows = sqlx::query_as!(
            GroupRow,
            r#"SELECT id as "id!", name as "name!", color, created_at as "created_at!" FROM groupz ORDER BY created_at ASC"#,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter().map(TryInto::try_into).collect()
    }

    async fn delete_group(&self, group_id: Uuid) -> Result<(), StoreError> {
        let id = group_id.to_string();
        sqlx::query!("DELETE FROM groupz WHERE id = ?1", id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn add_member(
        &self,
        group_id: Uuid,
        identity_id: Uuid,
        added_at: i64,
    ) -> Result<Membership, StoreError> {
        let group_id_str = group_id.to_string();
        let identity_id_str = identity_id.to_string();

        sqlx::query!(
            r#"
            INSERT INTO membershipz (group_id, identity_id, added_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(group_id, identity_id) DO UPDATE SET added_at = excluded.added_at
            "#,
            group_id_str,
            identity_id_str,
            added_at,
        )
        .execute(&self.pool)
        .await?;

        Ok(Membership {
            group_id,
            identity_id,
            added_at,
        })
    }

    async fn remove_member(&self, group_id: Uuid, identity_id: Uuid) -> Result<(), StoreError> {
        let group_id_str = group_id.to_string();
        let identity_id_str = identity_id.to_string();
        sqlx::query!(
            "DELETE FROM membershipz WHERE group_id = ?1 AND identity_id = ?2",
            group_id_str,
            identity_id_str,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn members_of(&self, group_id: Uuid) -> Result<Vec<Uuid>, StoreError> {
        let group_id_str = group_id.to_string();
        let rows = sqlx::query!(
            r#"SELECT identity_id as "identity_id!" FROM membershipz WHERE group_id = ?1"#,
            group_id_str,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|r| {
                Uuid::parse_str(&r.identity_id)
                    .map_err(|e| StoreError::Conflict(format!("invalid identity id: {e}")))
            })
            .collect()
    }

    async fn groups_for(&self, identity_id: Uuid) -> Result<Vec<Uuid>, StoreError> {
        let identity_id_str = identity_id.to_string();
        let rows = sqlx::query!(
            r#"SELECT group_id as "group_id!" FROM membershipz WHERE identity_id = ?1"#,
            identity_id_str,
        )
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|r| {
                Uuid::parse_str(&r.group_id)
                    .map_err(|e| StoreError::Conflict(format!("invalid group id: {e}")))
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::test_pool;

    async fn store() -> (SqliteGroupStore, SqlitePool) {
        let pool = test_pool().await;
        (SqliteGroupStore::new(pool.clone()), pool)
    }

    fn new_group(name: &str) -> Group {
        Group {
            id: Uuid::new_v4(),
            name: name.to_string(),
            color: None,
            created_at: 100,
        }
    }

    async fn seed_identity(pool: &SqlitePool, id: Uuid) {
        let id_str = id.to_string();
        sqlx::query!(
            "INSERT INTO identityz (id, created_at) VALUES (?1, ?2)",
            id_str,
            100,
        )
        .execute(pool)
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn create_then_get_round_trips() {
        let (store, _pool) = store().await;
        let group = new_group("editors");
        store.create_group(group.clone()).await.unwrap();

        let fetched = store.get_group(group.id).await.unwrap().unwrap();
        assert_eq!(fetched, group);
    }

    #[tokio::test]
    async fn get_group_missing_returns_none() {
        let (store, _pool) = store().await;
        assert!(store.get_group(Uuid::new_v4()).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn list_groups_returns_every_group() {
        let (store, _pool) = store().await;
        store.create_group(new_group("a")).await.unwrap();
        store.create_group(new_group("b")).await.unwrap();

        let all = store.list_groups().await.unwrap();
        assert_eq!(all.len(), 2);
    }

    #[tokio::test]
    async fn delete_group_removes_it_and_cascades_memberships() {
        let (store, pool) = store().await;
        let group = new_group("editors");
        store.create_group(group.clone()).await.unwrap();
        let identity_id = Uuid::new_v4();
        // seed the referenced identity row so the fk constraint is satisfied
        seed_identity(&pool, identity_id).await;
        store.add_member(group.id, identity_id, 100).await.unwrap();

        store.delete_group(group.id).await.unwrap();

        assert!(store.get_group(group.id).await.unwrap().is_none());
        assert!(store.members_of(group.id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn add_member_then_members_of_and_groups_for_round_trip() {
        let (store, pool) = store().await;
        let group = new_group("editors");
        store.create_group(group.clone()).await.unwrap();
        let identity_id = Uuid::new_v4();
        seed_identity(&pool, identity_id).await;

        store.add_member(group.id, identity_id, 100).await.unwrap();

        let members = store.members_of(group.id).await.unwrap();
        assert_eq!(members, vec![identity_id]);

        let groups = store.groups_for(identity_id).await.unwrap();
        assert_eq!(groups, vec![group.id]);
    }

    #[tokio::test]
    async fn add_member_is_idempotent() {
        let (store, pool) = store().await;
        let group = new_group("editors");
        store.create_group(group.clone()).await.unwrap();
        let identity_id = Uuid::new_v4();
        seed_identity(&pool, identity_id).await;

        store.add_member(group.id, identity_id, 100).await.unwrap();
        store.add_member(group.id, identity_id, 200).await.unwrap();

        let members = store.members_of(group.id).await.unwrap();
        assert_eq!(members.len(), 1);
    }

    #[tokio::test]
    async fn remove_member_drops_live_membership_immediately() {
        let (store, pool) = store().await;
        let group = new_group("editors");
        store.create_group(group.clone()).await.unwrap();
        let identity_id = Uuid::new_v4();
        seed_identity(&pool, identity_id).await;
        store.add_member(group.id, identity_id, 100).await.unwrap();

        store.remove_member(group.id, identity_id).await.unwrap();

        assert!(store.members_of(group.id).await.unwrap().is_empty());
        assert!(store.groups_for(identity_id).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn remove_member_missing_is_a_no_op() {
        let (store, _pool) = store().await;
        let group = new_group("editors");
        store.create_group(group.clone()).await.unwrap();

        store.remove_member(group.id, Uuid::new_v4()).await.unwrap();
    }
}
