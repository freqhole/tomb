//! sqlite implementations of the store traits, plus the migration runner.
//!
//! `GrantStore` has no sqlite implementation here - its real backing depends
//! on the acl evaluator's resource-ancestry model, a separate, larger task.

pub mod credential_store;
pub mod friend_store;
pub mod identity_store;
pub mod knock_store;
pub mod peer_directory;

pub use credential_store::SqliteCredentialStore;
pub use friend_store::SqliteFriendStore;
pub use identity_store::SqliteIdentityStore;
pub use knock_store::SqliteKnockStore;
pub use peer_directory::SqlitePeerDirectory;

use sqlx::SqlitePool;

/// run every migration under `rust/migrations/` against `pool`. safe to
/// call repeatedly - sqlx tracks applied migrations in its own bookkeeping
/// table.
pub async fn migrate(pool: &SqlitePool) -> Result<(), sqlx::migrate::MigrateError> {
    sqlx::migrate!("./migrations").run(pool).await
}

#[cfg(test)]
pub(crate) async fn test_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite pool");
    migrate(&pool).await.expect("run migrations");
    pool
}
