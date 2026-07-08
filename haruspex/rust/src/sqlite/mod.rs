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
