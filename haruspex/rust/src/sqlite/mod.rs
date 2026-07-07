//! sqlite implementations of the store traits, plus the migration runner.

pub mod challenge_store;
pub mod credential_store;
pub mod friend_store;
pub mod grant_store;
pub mod group_store;
pub mod identity_store;
pub mod knock_store;
pub mod peer_directory;

pub use challenge_store::SqliteChallengeStore;
pub use credential_store::SqliteCredentialStore;
pub use friend_store::SqliteFriendStore;
pub use grant_store::SqliteGrantStore;
pub use group_store::SqliteGroupStore;
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
