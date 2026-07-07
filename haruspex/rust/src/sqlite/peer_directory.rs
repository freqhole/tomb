//! sqlite-backed `PeerDirectory`.
//!
//! ported from skein's `userz` table: `upsert_profile` is a coalesce-based
//! partial upsert (a `None` field never clobbers an existing value), and
//! `is_self`/`is_hub` are one-way ratchets - once set, a plain profile
//! update can never flip them back off.

use async_trait::async_trait;
use sqlx::SqlitePool;

use crate::error::StoreError;
use crate::identity::PeerProfile;
use crate::stores::PeerDirectory;

pub struct SqlitePeerDirectory {
    pool: SqlitePool,
}

impl SqlitePeerDirectory {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

struct PeerRow {
    node_id: String,
    display_name: Option<String>,
    alias: Option<String>,
    bio: Option<String>,
    avatar_blake3: Option<String>,
    accent_color: Option<String>,
    is_self: i64,
    is_hub: i64,
    first_seen: i64,
    last_seen: i64,
}

impl From<PeerRow> for PeerProfile {
    fn from(row: PeerRow) -> Self {
        PeerProfile {
            node_id: row.node_id,
            display_name: row.display_name,
            alias: row.alias,
            bio: row.bio,
            avatar_blake3: row.avatar_blake3,
            accent_color: row.accent_color,
            is_self: row.is_self != 0,
            is_hub: row.is_hub != 0,
            first_seen: row.first_seen,
            last_seen: row.last_seen,
        }
    }
}

#[async_trait]
impl PeerDirectory for SqlitePeerDirectory {
    async fn upsert_profile(&self, profile: PeerProfile) -> Result<PeerProfile, StoreError> {
        let is_self = profile.is_self as i64;
        let is_hub = profile.is_hub as i64;

        let row = sqlx::query_as!(
            PeerRow,
            r#"
            INSERT INTO peerz (node_id, display_name, alias, bio, avatar_blake3, accent_color, is_self, is_hub, first_seen, last_seen)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(node_id) DO UPDATE SET
                display_name  = COALESCE(excluded.display_name,  peerz.display_name),
                alias         = COALESCE(excluded.alias,         peerz.alias),
                bio           = COALESCE(excluded.bio,           peerz.bio),
                avatar_blake3 = COALESCE(excluded.avatar_blake3, peerz.avatar_blake3),
                accent_color  = COALESCE(excluded.accent_color,  peerz.accent_color),
                is_self       = MAX(excluded.is_self, peerz.is_self),
                is_hub        = MAX(excluded.is_hub, peerz.is_hub),
                last_seen     = excluded.last_seen
            RETURNING node_id as "node_id!", display_name, alias, bio, avatar_blake3, accent_color,
                      is_self as "is_self!", is_hub as "is_hub!",
                      first_seen as "first_seen!", last_seen as "last_seen!"
            "#,
            profile.node_id,
            profile.display_name,
            profile.alias,
            profile.bio,
            profile.avatar_blake3,
            profile.accent_color,
            is_self,
            is_hub,
            profile.first_seen,
            profile.last_seen,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(row.into())
    }

    async fn touch(&self, node_id: &str, last_seen: i64) -> Result<(), StoreError> {
        sqlx::query!(
            r#"
            INSERT INTO peerz (node_id, first_seen, last_seen, is_self, is_hub)
            VALUES (?1, ?2, ?2, 0, 0)
            ON CONFLICT(node_id) DO UPDATE SET last_seen = excluded.last_seen
            "#,
            node_id,
            last_seen,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn mark_as_hub(&self, node_id: &str, last_seen: i64) -> Result<(), StoreError> {
        sqlx::query!(
            r#"
            INSERT INTO peerz (node_id, first_seen, last_seen, is_self, is_hub)
            VALUES (?1, ?2, ?2, 0, 1)
            ON CONFLICT(node_id) DO UPDATE SET is_hub = 1
            "#,
            node_id,
            last_seen,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn get_profile(&self, node_id: &str) -> Result<Option<PeerProfile>, StoreError> {
        let row = sqlx::query_as!(
            PeerRow,
            r#"
            SELECT node_id as "node_id!", display_name, alias, bio, avatar_blake3, accent_color,
                   is_self as "is_self!", is_hub as "is_hub!",
                   first_seen as "first_seen!", last_seen as "last_seen!"
            FROM peerz WHERE node_id = ?1
            "#,
            node_id,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(Into::into))
    }

    async fn get_self(&self) -> Result<Option<PeerProfile>, StoreError> {
        let row = sqlx::query_as!(
            PeerRow,
            r#"
            SELECT node_id as "node_id!", display_name, alias, bio, avatar_blake3, accent_color,
                   is_self as "is_self!", is_hub as "is_hub!",
                   first_seen as "first_seen!", last_seen as "last_seen!"
            FROM peerz WHERE is_self = 1 LIMIT 1
            "#,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(Into::into))
    }

    async fn list_profiles(&self) -> Result<Vec<PeerProfile>, StoreError> {
        let rows = sqlx::query_as!(
            PeerRow,
            r#"
            SELECT node_id as "node_id!", display_name, alias, bio, avatar_blake3, accent_color,
                   is_self as "is_self!", is_hub as "is_hub!",
                   first_seen as "first_seen!", last_seen as "last_seen!"
            FROM peerz ORDER BY last_seen DESC
            "#,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(Into::into).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sqlite::test_pool;

    async fn store() -> SqlitePeerDirectory {
        SqlitePeerDirectory::new(test_pool().await)
    }

    fn profile(node_id: &str) -> PeerProfile {
        PeerProfile {
            node_id: node_id.to_string(),
            display_name: Some("alice".to_string()),
            alias: None,
            bio: Some("hi".to_string()),
            avatar_blake3: None,
            accent_color: Some("#ff00ff".to_string()),
            is_self: false,
            is_hub: false,
            first_seen: 1,
            last_seen: 1,
        }
    }

    #[tokio::test]
    async fn upsert_then_get_round_trips() {
        let store = store().await;
        let p = profile("node-a");
        store.upsert_profile(p.clone()).await.unwrap();

        let fetched = store.get_profile("node-a").await.unwrap().unwrap();
        assert_eq!(fetched, p);
    }

    #[tokio::test]
    async fn upsert_profile_coalesces_partial_updates() {
        let store = store().await;
        store.upsert_profile(profile("node-a")).await.unwrap();

        // a partial update with only display_name set must leave bio/alias
        // /accent_color untouched (coalesce-based partial upsert).
        store
            .upsert_profile(PeerProfile {
                node_id: "node-a".to_string(),
                display_name: Some("alice2".to_string()),
                alias: None,
                bio: None,
                avatar_blake3: None,
                accent_color: None,
                is_self: false,
                is_hub: false,
                first_seen: 1,
                last_seen: 2,
            })
            .await
            .unwrap();

        let fetched = store.get_profile("node-a").await.unwrap().unwrap();
        assert_eq!(fetched.display_name.as_deref(), Some("alice2"));
        assert_eq!(fetched.bio.as_deref(), Some("hi"));
        assert_eq!(fetched.accent_color.as_deref(), Some("#ff00ff"));
        assert_eq!(fetched.last_seen, 2);
    }

    #[tokio::test]
    async fn upsert_profile_first_seen_never_changes() {
        let store = store().await;
        store.upsert_profile(profile("node-a")).await.unwrap();
        store
            .upsert_profile(PeerProfile {
                first_seen: 999,
                ..profile("node-a")
            })
            .await
            .unwrap();

        let fetched = store.get_profile("node-a").await.unwrap().unwrap();
        assert_eq!(fetched.first_seen, 1);
    }

    #[tokio::test]
    async fn is_hub_is_a_one_way_ratchet() {
        let store = store().await;
        store.mark_as_hub("node-a", 1).await.unwrap();
        store
            .upsert_profile(PeerProfile {
                is_hub: false,
                ..profile("node-a")
            })
            .await
            .unwrap();

        let fetched = store.get_profile("node-a").await.unwrap().unwrap();
        assert!(fetched.is_hub, "is_hub must not reset once set");
    }

    #[tokio::test]
    async fn touch_inserts_a_minimal_row_then_updates_last_seen() {
        let store = store().await;
        store.touch("node-a", 1).await.unwrap();
        let fetched = store.get_profile("node-a").await.unwrap().unwrap();
        assert_eq!(fetched.last_seen, 1);
        assert!(!fetched.is_self);
        assert!(!fetched.is_hub);

        store.touch("node-a", 5).await.unwrap();
        let fetched = store.get_profile("node-a").await.unwrap().unwrap();
        assert_eq!(fetched.last_seen, 5);
    }

    #[tokio::test]
    async fn get_self_returns_the_is_self_row() {
        let store = store().await;
        store.touch("node-a", 1).await.unwrap();
        store
            .upsert_profile(PeerProfile {
                is_self: true,
                ..profile("node-self")
            })
            .await
            .unwrap();

        let self_profile = store.get_self().await.unwrap().unwrap();
        assert_eq!(self_profile.node_id, "node-self");
    }

    #[tokio::test]
    async fn list_profiles_returns_everything() {
        let store = store().await;
        store.touch("node-a", 1).await.unwrap();
        store.touch("node-b", 2).await.unwrap();

        let profiles = store.list_profiles().await.unwrap();
        assert_eq!(profiles.len(), 2);
    }
}
