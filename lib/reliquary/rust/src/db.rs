//! database handle: a single sqlx `SqlitePool` used by all reliquary modules.
//!
//! reliquary owns its own sqlite database file (`reliquary.db`, decision Q2 in
//! the xl-refactor phase 2 doc), separate from any consuming app's own db.

use std::path::Path;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use thiserror::Error;

/// default filename used by [`open`]. a consuming app that wants a
/// different name or a db file that isn't a direct child of its data
/// directory (e.g. sharing one directory across several sqlite files, or
/// naming it per-profile) should call [`open_at`] directly instead.
pub const DB_FILENAME: &str = "reliquary.db";

#[derive(Debug, Error)]
pub enum DbError {
    #[error("sqlx error: {0}")]
    Sqlx(#[from] sqlx::Error),

    #[error("migration error: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// open (creating if needed) the reliquary sqlite db under
/// `<data_dir>/reliquary.db` and run migrations. returns a cloneable pool.
///
/// this is the common-case entry point: a consuming app picks a data
/// directory and gets sensible defaults (wal mode, foreign keys on,
/// migrations applied) for free. call [`open_at`] instead if the app needs
/// to control the exact db file name or place it somewhere other than a
/// direct child of `data_dir`.
pub async fn open(data_dir: &Path) -> Result<SqlitePool, DbError> {
    tokio::fs::create_dir_all(data_dir).await?;
    open_at(&data_dir.join(DB_FILENAME)).await
}

/// open (creating if needed) the reliquary sqlite db at the exact path
/// `db_path` and run migrations. returns a cloneable pool.
///
/// unlike [`open`], the caller controls the full file name and location -
/// useful for apps that want a non-default file name (e.g. per-profile db
/// files) or that keep reliquary's db file alongside other app-managed
/// files rather than in its own directory. the parent directory is created
/// if it doesn't already exist.
pub async fn open_at(db_path: &Path) -> Result<SqlitePool, DbError> {
    if let Some(parent) = db_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(true)
        .journal_mode(sqlx::sqlite::SqliteJournalMode::Wal)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(8)
        .connect_with(options)
        .await?;

    sqlx::migrate!("./migrations").run(&pool).await?;

    Ok(pool)
}

#[cfg(test)]
pub(crate) async fn open_in_memory() -> SqlitePool {
    // each :memory: connection is a separate database — share-cache + a single
    // connection ensures every checked-out connection sees the same schema and
    // rows. ideal for fast, isolated unit tests.
    let options = SqliteConnectOptions::new()
        .filename(":memory:")
        .create_if_missing(true)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("connect in-memory sqlite");

    sqlx::migrate!("./migrations")
        .run(&pool)
        .await
        .expect("run migrations on in-memory sqlite");

    pool
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn open_creates_db_file_and_runs_migrations() {
        let tmp = tempfile::tempdir().unwrap();
        let pool = open(tmp.path()).await.expect("open db");

        // confirm the blobz table exists by querying it.
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM blobz")
            .fetch_one(&pool)
            .await
            .expect("query blobz table");
        assert_eq!(count.0, 0);

        // db file should be on disk under data_dir.
        assert!(tmp.path().join(DB_FILENAME).exists());
    }

    #[tokio::test]
    async fn open_at_honors_a_custom_file_name_and_location() {
        let tmp = tempfile::tempdir().unwrap();
        // a nested, non-default path - open_at should create the parent dir
        // and use exactly this file name, not DB_FILENAME.
        let custom_path = tmp.path().join("profiles/alice/store.sqlite");
        let pool = open_at(&custom_path).await.expect("open db at custom path");

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM blobz")
            .fetch_one(&pool)
            .await
            .expect("query blobz table");
        assert_eq!(count.0, 0);

        assert!(custom_path.exists());
        assert!(!tmp.path().join(DB_FILENAME).exists());
    }

    #[tokio::test]
    async fn in_memory_helper_runs_migrations() {
        let pool = open_in_memory().await;
        // expect the migrated table to be queryable.
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM blobz")
            .fetch_one(&pool)
            .await
            .expect("query blobz table");
        assert_eq!(count.0, 0, "fresh blobz table should be empty");
    }
}
