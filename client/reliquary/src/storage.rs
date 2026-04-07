//! SQLite-backed storage for samod automerge documents.
//!
//! implements `samod::storage::Storage` using a simple key-value table in SQLite,
//! with `StorageKey` components joined by `/` as the text key.

use std::collections::HashMap;
use std::future::Future;
use std::path::Path;

use samod::storage::{Storage, StorageKey};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use tracing::warn;

/// sqlite-backed storage backend for samod automerge document sync.
///
/// stores key-value pairs in a single `samod_kv` table, where keys are the
/// `/`-joined string representation of `StorageKey` and values are opaque blobs.
#[derive(Debug, Clone)]
pub struct SqliteAutomergeStorage {
    pool: SqlitePool,
}

impl SqliteAutomergeStorage {
    /// create a new storage instance backed by the given sqlite database file.
    ///
    /// creates the database and `samod_kv` table if they don't already exist.
    pub async fn new(db_path: &Path) -> Result<Self, sqlx::Error> {
        let options = SqliteConnectOptions::new()
            .filename(db_path)
            .create_if_missing(true);

        let pool = SqlitePoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS samod_kv (key TEXT PRIMARY KEY, data BLOB NOT NULL)",
        )
        .execute(&pool)
        .await?;

        Ok(Self { pool })
    }

    /// convert a `StorageKey` to its string representation for use as a sqlite key.
    fn key_to_string(key: &StorageKey) -> String {
        key.to_string()
    }

    /// parse a string key back into a `StorageKey` by splitting on `/`.
    fn string_to_key(s: &str) -> Option<StorageKey> {
        let parts: Vec<&str> = s.split('/').collect();
        StorageKey::from_parts(parts).ok()
    }
}

impl Storage for SqliteAutomergeStorage {
    fn load(&self, key: StorageKey) -> impl Future<Output = Option<Vec<u8>>> + Send {
        let pool = self.pool.clone();
        async move {
            let key_str = Self::key_to_string(&key);
            match sqlx::query_scalar::<_, Vec<u8>>("SELECT data FROM samod_kv WHERE key = ?")
                .bind(&key_str)
                .fetch_optional(&pool)
                .await
            {
                Ok(row) => row,
                Err(e) => {
                    warn!(key = %key_str, error = %e, "failed to load from samod_kv");
                    None
                }
            }
        }
    }

    fn load_range(
        &self,
        prefix: StorageKey,
    ) -> impl Future<Output = HashMap<StorageKey, Vec<u8>>> + Send {
        let pool = self.pool.clone();
        async move {
            let prefix_str = Self::key_to_string(&prefix);
            let pattern = format!("{prefix_str}%");

            let rows: Vec<(String, Vec<u8>)> = match sqlx::query_as(
                "SELECT key, data FROM samod_kv WHERE key LIKE ?",
            )
            .bind(&pattern)
            .fetch_all(&pool)
            .await
            {
                Ok(rows) => rows,
                Err(e) => {
                    warn!(prefix = %prefix_str, error = %e, "failed to load range from samod_kv");
                    return HashMap::new();
                }
            };

            let mut result = HashMap::new();
            for (key_str, data) in rows {
                match Self::string_to_key(&key_str) {
                    Some(storage_key) => {
                        result.insert(storage_key, data);
                    }
                    None => {
                        warn!(key = %key_str, "failed to parse storage key from database");
                    }
                }
            }
            result
        }
    }

    fn put(&self, key: StorageKey, data: Vec<u8>) -> impl Future<Output = ()> + Send {
        let pool = self.pool.clone();
        async move {
            let key_str = Self::key_to_string(&key);
            if let Err(e) = sqlx::query("INSERT OR REPLACE INTO samod_kv (key, data) VALUES (?, ?)")
                .bind(&key_str)
                .bind(&data)
                .execute(&pool)
                .await
            {
                warn!(key = %key_str, error = %e, "failed to put into samod_kv");
            }
        }
    }

    fn delete(&self, key: StorageKey) -> impl Future<Output = ()> + Send {
        let pool = self.pool.clone();
        async move {
            let key_str = Self::key_to_string(&key);
            if let Err(e) = sqlx::query("DELETE FROM samod_kv WHERE key = ?")
                .bind(&key_str)
                .execute(&pool)
                .await
            {
                warn!(key = %key_str, error = %e, "failed to delete from samod_kv");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    /// helper to create a storage instance backed by a temporary file.
    async fn test_storage() -> (SqliteAutomergeStorage, NamedTempFile) {
        let tmp = NamedTempFile::new().expect("failed to create temp file");
        let storage = SqliteAutomergeStorage::new(tmp.path())
            .await
            .expect("failed to create storage");
        (storage, tmp)
    }

    fn make_key(parts: &[&str]) -> StorageKey {
        StorageKey::from_parts(parts.iter().copied()).expect("invalid key parts")
    }

    #[tokio::test]
    async fn test_put_and_load() {
        let (storage, _tmp) = test_storage().await;
        let key = make_key(&["docs", "abc123"]);
        let data = b"hello world".to_vec();

        storage.put(key.clone(), data.clone()).await;
        let loaded = storage.load(key).await;

        assert_eq!(loaded, Some(data));
    }

    #[tokio::test]
    async fn test_load_missing() {
        let (storage, _tmp) = test_storage().await;
        let key = make_key(&["nonexistent", "key"]);

        let loaded = storage.load(key).await;

        assert_eq!(loaded, None);
    }

    #[tokio::test]
    async fn test_load_range() {
        let (storage, _tmp) = test_storage().await;

        // put keys with a shared prefix
        let key_a = make_key(&["docs", "alpha"]);
        let key_b = make_key(&["docs", "beta"]);
        let key_c = make_key(&["docs", "gamma"]);
        // put a key with a different prefix
        let key_other = make_key(&["other", "delta"]);

        storage.put(key_a.clone(), b"data_a".to_vec()).await;
        storage.put(key_b.clone(), b"data_b".to_vec()).await;
        storage.put(key_c.clone(), b"data_c".to_vec()).await;
        storage.put(key_other.clone(), b"data_other".to_vec()).await;

        let prefix = make_key(&["docs"]);
        let results = storage.load_range(prefix).await;

        assert_eq!(results.len(), 3);
        assert_eq!(results.get(&key_a), Some(&b"data_a".to_vec()));
        assert_eq!(results.get(&key_b), Some(&b"data_b".to_vec()));
        assert_eq!(results.get(&key_c), Some(&b"data_c".to_vec()));
        assert!(!results.contains_key(&key_other));
    }

    #[tokio::test]
    async fn test_delete() {
        let (storage, _tmp) = test_storage().await;
        let key = make_key(&["docs", "to_delete"]);

        storage.put(key.clone(), b"some data".to_vec()).await;
        assert!(storage.load(key.clone()).await.is_some());

        storage.delete(key.clone()).await;
        assert_eq!(storage.load(key).await, None);
    }

    #[tokio::test]
    async fn test_put_overwrite() {
        let (storage, _tmp) = test_storage().await;
        let key = make_key(&["docs", "overwrite_me"]);

        storage.put(key.clone(), b"first value".to_vec()).await;
        storage.put(key.clone(), b"second value".to_vec()).await;

        let loaded = storage.load(key).await;
        assert_eq!(loaded, Some(b"second value".to_vec()));
    }
}
