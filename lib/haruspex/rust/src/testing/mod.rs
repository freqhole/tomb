//! in-process fixtures and fake stores for consumer test suites, behind the
//! `test-utils` feature.
//!
//! per PHASE_4_HARUSPEX_RUST.md's "examples + testing exports" section, this
//! module ships exactly five things: [`open_in_memory`] (an in-memory
//! `SqlitePool` with haruspex's full migration set applied), plain
//! constructor functions wrapping every sqlite store impl over a
//! caller-supplied pool (so a test can share one in-memory db across
//! several stores - the evaluator, for instance, needs `GrantStore` and
//! `GroupStore` over the same db), [`fake_challenge_store`] (a scripted,
//! non-sqlite `ChallengeStore`), [`knock_pair`] (two knock stores wired over
//! an in-memory duplex channel simulating the transport), and
//! [`evaluator_fixture`] (a pre-seeded `AclEvaluator` for acl tests).

mod evaluator_fixture;
mod fake_challenge_store;
mod knock_pair;

pub use evaluator_fixture::{evaluator_fixture, EvaluatorFixture};
pub use fake_challenge_store::{fake_challenge_store, FakeChallengeStore};
pub use knock_pair::{knock_pair, KnockExchangeError, KnockPair, KnockPeer};

use sqlx::SqlitePool;

use crate::sqlite::{
    SqliteCredentialStore, SqliteFriendStore, SqliteGrantStore, SqliteGroupStore,
    SqliteIdentityStore, SqliteInviteStore, SqliteKnockStore, SqlitePeerDirectory,
};

/// an in-memory sqlite pool with haruspex's full migration set applied -
/// the base every constructor in this module builds on. each call opens a
/// fresh, independent database (`sqlite::memory:` pools are never shared
/// across connections spawned from different `SqlitePool`s - clone the
/// returned pool, don't call this twice, to share one db across stores).
pub async fn open_in_memory() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:")
        .await
        .expect("open in-memory sqlite pool");
    crate::sqlite::migrate(&pool)
        .await
        .expect("run haruspex migrations");
    pool
}

/// a `SqliteIdentityStore` over `pool`.
pub fn identity_store(pool: &SqlitePool) -> SqliteIdentityStore {
    SqliteIdentityStore::new(pool.clone())
}

/// a `SqlitePeerDirectory` over `pool`.
pub fn peer_directory(pool: &SqlitePool) -> SqlitePeerDirectory {
    SqlitePeerDirectory::new(pool.clone())
}

/// a `SqliteFriendStore` over `pool`.
pub fn friend_store(pool: &SqlitePool) -> SqliteFriendStore {
    SqliteFriendStore::new(pool.clone())
}

/// a `SqliteKnockStore` over `pool`. see [`knock_pair`] for a ready-wired
/// pair of these simulating a two-peer knock exchange.
pub fn knock_store(pool: &SqlitePool) -> SqliteKnockStore {
    SqliteKnockStore::new(pool.clone())
}

/// a `SqliteGrantStore` over `pool`. see [`evaluator_fixture`] for a
/// ready-seeded `AclEvaluator` built on top of this + [`group_store`].
pub fn grant_store(pool: &SqlitePool) -> SqliteGrantStore {
    SqliteGrantStore::new(pool.clone())
}

/// a `SqliteGroupStore` over `pool`.
pub fn group_store(pool: &SqlitePool) -> SqliteGroupStore {
    SqliteGroupStore::new(pool.clone())
}

/// a `SqliteCredentialStore` over `pool`.
pub fn credential_store(pool: &SqlitePool) -> SqliteCredentialStore {
    SqliteCredentialStore::new(pool.clone())
}

/// a `SqliteInviteStore` over `pool`.
pub fn invite_store(pool: &SqlitePool) -> SqliteInviteStore {
    SqliteInviteStore::new(pool.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn open_in_memory_applies_migrations() {
        let pool = open_in_memory().await;
        // a query against a migrated-in table succeeds - proof the
        // migration set actually ran, not just that the pool opened.
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM identityz")
            .fetch_one(&pool)
            .await
            .expect("identityz table should exist after migration");
    }

    #[tokio::test]
    async fn store_constructors_share_one_pool() {
        let pool = open_in_memory().await;
        let identities = identity_store(&pool);
        let grants = grant_store(&pool);
        let groups = group_store(&pool);

        // exercised together against the SAME db - this is the whole point
        // of taking `&SqlitePool` rather than opening a fresh pool per call.
        use crate::identity::Identity;
        use crate::stores::grant_store::{Resource, RoleGrant, Subject};
        use crate::stores::{GrantStore, GroupStore, IdentityStore, Role};
        use uuid::Uuid;

        let identity = Identity {
            id: Uuid::new_v4(),
            username: None,
            created_at: 100,
            metadata: None,
            deleted_at: None,
        };
        identities.upsert_identity(identity.clone()).await.unwrap();
        grants
            .grant(RoleGrant {
                subject: Subject::Identity {
                    identity_id: identity.id,
                },
                resource: Resource::instance(),
                role: Role::Admin,
                granted_by: "test".to_string(),
                granted_at: 100,
                expires_at: None,
            })
            .await
            .unwrap();
        assert!(groups.list_groups().await.unwrap().is_empty());
    }
}
