//! sqlite implementations of the store traits, plus the migration runner.
//!
//! every query in this module goes through sqlx's runtime-checked
//! `sqlx::query`/`sqlx::query_as`/`sqlx::query_scalar`, never the
//! compile-time `query!`/`query_as!` macros. this is deliberate: haruspex is
//! a library crate meant to be pulled in as a path or git dependency by
//! several host apps (tomb/grimoire, skein), each with its own separate
//! sqlite schema and its own `DATABASE_URL`. `DATABASE_URL`/`SQLX_OFFLINE`
//! are process-wide settings for a single `cargo` invocation - there is no
//! per-crate override - so compiling a host app that depends on haruspex
//! would expand haruspex's compile-time macros against the HOST's
//! `DATABASE_URL`, pointed at the host's own unrelated schema, breaking the
//! build. runtime-checked queries sidestep this entirely: they carry no
//! compile-time dependency on any database at all, in any consuming
//! context. the tradeoff is losing compile-time sql validation, which this
//! crate's test suite covers instead - every query here is exercised by a
//! test. do not reintroduce `query!`/`query_as!` here without solving the
//! multi-consumer `DATABASE_URL` conflict first.

pub mod challenge_store;
pub mod credential_store;
pub mod friend_store;
pub mod grant_store;
pub mod group_store;
pub mod identity_store;
pub mod invite_store;
pub mod knock_store;
pub mod peer_directory;

pub use challenge_store::SqliteChallengeStore;
pub use credential_store::SqliteCredentialStore;
pub use friend_store::SqliteFriendStore;
pub use grant_store::SqliteGrantStore;
pub use group_store::SqliteGroupStore;
pub use identity_store::SqliteIdentityStore;
pub use invite_store::SqliteInviteStore;
pub use knock_store::SqliteKnockStore;
pub use peer_directory::SqlitePeerDirectory;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use std::path::Path;
use thiserror::Error;

/// default filename used by [`open`]. a consuming app that wants a
/// different name or a db file that isn't a direct child of its data
/// directory (e.g. sharing one directory across several sqlite files, or
/// naming it per-profile) should call [`open_at`] directly instead.
pub const DEFAULT_DB_FILENAME: &str = "haruspex.db";

#[derive(Debug, Error)]
pub enum OpenError {
    #[error("sqlx error: {0}")]
    Sqlx(#[from] sqlx::Error),

    #[error("migration error: {0}")]
    Migrate(#[from] sqlx::migrate::MigrateError),

    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

/// run every migration under `rust/migrations/` against `pool`. safe to
/// call repeatedly - sqlx tracks applied migrations in its own bookkeeping
/// table. useful on its own for an app that already manages its own pool
/// (e.g. wants haruspex's tables alongside its own in a pool it opened
/// itself) and just needs migrations applied to it - most apps should
/// prefer [`open`] or [`open_at`] instead, which handle opening the pool
/// too.
pub async fn migrate(pool: &SqlitePool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}

/// open (creating if needed) haruspex's own sqlite db under
/// `<data_dir>/haruspex.db` and run migrations. returns a cloneable pool.
///
/// this is the common-case entry point: a consuming app picks a data
/// directory and gets sensible defaults (wal mode, foreign keys on,
/// migrations applied) for free. call [`open_at`] instead if the app needs
/// to control the exact db file name or place it somewhere other than a
/// direct child of `data_dir`.
pub async fn open(data_dir: &Path) -> Result<SqlitePool, OpenError> {
    tokio::fs::create_dir_all(data_dir).await?;
    open_at(&data_dir.join(DEFAULT_DB_FILENAME)).await
}

/// open (creating if needed) haruspex's own sqlite db at the exact path
/// `db_path` and run migrations. returns a cloneable pool.
///
/// unlike [`open`], the caller controls the full file name and location -
/// useful for apps that want a non-default file name (e.g. per-profile db
/// files) or that keep haruspex's db file alongside other app-managed files
/// rather than in its own directory. the parent directory is created if it
/// doesn't already exist.
pub async fn open_at(db_path: &Path) -> Result<SqlitePool, OpenError> {
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

    migrate(&pool).await?;

    Ok(pool)
}

#[cfg(test)]
pub(crate) async fn test_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite pool");
    migrate(&pool).await.expect("run migrations");
    pool
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn open_creates_db_file_and_runs_migrations() {
        let tmp = tempfile::tempdir().unwrap();
        let pool = open(tmp.path()).await.expect("open db");

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM identityz")
            .fetch_one(&pool)
            .await
            .expect("query identityz table");
        assert_eq!(count.0, 0);

        assert!(tmp.path().join(DEFAULT_DB_FILENAME).exists());
    }

    #[tokio::test]
    async fn open_at_honors_a_custom_file_name_and_location() {
        let tmp = tempfile::tempdir().unwrap();
        // a nested, non-default path - open_at should create the parent dir
        // and use exactly this file name, not DEFAULT_DB_FILENAME.
        let custom_path = tmp.path().join("profiles/alice/store.sqlite");
        let pool = open_at(&custom_path).await.expect("open db at custom path");

        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM identityz")
            .fetch_one(&pool)
            .await
            .expect("query identityz table");
        assert_eq!(count.0, 0);

        assert!(custom_path.exists());
        assert!(!tmp.path().join(DEFAULT_DB_FILENAME).exists());
    }
}
