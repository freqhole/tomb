//! test fixtures + fake stores for consumer test suites, behind the
//! `test-utils` cargo feature.
//!
//! a consuming app enables `test-utils` as a dev-dependency feature (e.g.
//! `reliquary = { path = "...", features = ["test-utils"] }` under
//! `[dev-dependencies]`) to get real, tempdir-backed reliquary instances in
//! its own tests without hand-rolling the setup this crate's own test suite
//! already needed.

use std::sync::Arc;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::SqlitePool;
use tempfile::TempDir;

use crate::blobz::{BlobStore, SqliteBlobStore};
use crate::node::{StorageNode, StorageNodeOptions};

/// an in-memory sqlite pool with reliquary's full migration set applied.
///
/// each `:memory:` connection is its own separate database, so this uses a
/// single-connection pool - every checked-out connection sees the same
/// schema and rows. ideal for fast, isolated tests that don't need real
/// files on disk (see [`make_blobz_store`] for the case that does).
pub async fn open_in_memory() -> SqlitePool {
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

/// a real `SqliteBlobStore` over a fresh tempdir.
///
/// the metadata db is in-memory (see [`open_in_memory`]), but blob content
/// is written to real files on disk under the tempdir - blobz's file
/// operations need a real filesystem to be exercised honestly, so this
/// never fakes that half of the store.
pub async fn make_blobz_store() -> (SqliteBlobStore, TempDir) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let pool = open_in_memory().await;
    let store = SqliteBlobStore::new(pool, tmp.path());
    (store, tmp)
}

/// a tempdir-backed `StorageNode` with gc disabled by default.
///
/// binds its own localhost iroh endpoint (relay disabled) and attaches it,
/// since most tests want a fully-wired node; the endpoint is dropped when
/// this function returns, but stays alive in practice because the attached
/// downloader holds its own clone. use [`make_local_storage_node`] instead
/// for a node with no endpoint attached at all.
pub async fn make_storage_node() -> (StorageNode, TempDir) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let pool = open_in_memory().await;
    let blobz: Arc<dyn BlobStore> = Arc::new(SqliteBlobStore::new(pool, tmp.path()));

    let endpoint = iroh::Endpoint::builder(iroh::endpoint::presets::Minimal)
        .relay_mode(iroh::RelayMode::Disabled)
        .bind()
        .await
        .expect("bind test endpoint");

    let node = StorageNode::init(
        tmp.path(),
        blobz,
        &endpoint,
        StorageNodeOptions {
            gc_enabled: false,
            ..Default::default()
        },
    )
    .await
    .expect("init storage node");

    (node, tmp)
}

/// a tempdir-backed `StorageNode` with no endpoint attached at all, for
/// tests that specifically want to exercise the local-only, no-downloader
/// state (e.g. before a consuming app has any identity/keypair set up).
/// call `node.attach_endpoint(...)` to bind one later in the test.
pub async fn make_local_storage_node() -> (StorageNode, TempDir) {
    let tmp = tempfile::tempdir().expect("tempdir");
    let pool = open_in_memory().await;
    let blobz: Arc<dyn BlobStore> = Arc::new(SqliteBlobStore::new(pool, tmp.path()));

    let node = StorageNode::init_local(
        tmp.path(),
        blobz,
        StorageNodeOptions {
            gc_enabled: false,
            ..Default::default()
        },
    )
    .await
    .expect("init_local storage node");

    (node, tmp)
}

/// deterministic, non-trivial content for tests: `size` bytes generated
/// from a seeded mulberry32 prng stream (a small, well-known generator -
/// see <https://gist.github.com/tommyettinger/46a874533244883189143505d203312c>).
///
/// spans multiple BAO chunk groups for any realistic test size, unlike a
/// short ascii string - tests built on this fixture actually exercise
/// chunked transfer instead of silently passing on a single-chunk edge
/// case.
pub fn deterministic_bytes(size: usize, seed: u64) -> Vec<u8> {
    let mut state = seed as u32;
    let mut out = Vec::with_capacity(size);
    while out.len() < size {
        state = state.wrapping_add(0x6D2B79F5);
        let mut t = state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        t ^= t >> 14;
        out.extend_from_slice(&t.to_le_bytes());
    }
    out.truncate(size);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn open_in_memory_runs_migrations() {
        let pool = open_in_memory().await;
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM blobz")
            .fetch_one(&pool)
            .await
            .expect("query blobz table");
        assert_eq!(count.0, 0);
    }

    #[tokio::test]
    async fn make_blobz_store_writes_real_files_on_disk() {
        let (store, _tmp) = make_blobz_store().await;
        let record = store
            .insert(b"hello from testing::make_blobz_store", Default::default())
            .await
            .expect("insert");
        let path = store.path_for(&record);
        assert!(path.exists(), "blob bytes should be a real file on disk");
    }

    #[tokio::test]
    async fn make_storage_node_boots_with_gc_disabled() {
        let (node, tmp) = make_storage_node().await;
        assert!(tmp.path().join("iroh-blobs").exists());
        assert!(
            node.downloader().is_some(),
            "make_storage_node attaches an endpoint"
        );

        let tag = node
            .fs_store
            .blobs()
            .add_bytes(b"hello from testing::make_storage_node".to_vec())
            .await
            .expect("add bytes");
        let bytes = node
            .fs_store
            .blobs()
            .get_bytes(tag.hash)
            .await
            .expect("get bytes");
        assert_eq!(&bytes[..], b"hello from testing::make_storage_node");
    }

    #[tokio::test]
    async fn make_local_storage_node_has_no_downloader_attached() {
        let (node, tmp) = make_local_storage_node().await;
        assert!(tmp.path().join("iroh-blobs").exists());
        assert!(
            node.downloader().is_none(),
            "make_local_storage_node attaches no endpoint"
        );

        let tag = node
            .fs_store
            .blobs()
            .add_bytes(b"hello from testing::make_local_storage_node".to_vec())
            .await
            .expect("add bytes works offline");
        let bytes = node
            .fs_store
            .blobs()
            .get_bytes(tag.hash)
            .await
            .expect("get bytes works offline");
        assert_eq!(&bytes[..], b"hello from testing::make_local_storage_node");
    }

    #[test]
    fn deterministic_bytes_is_deterministic_and_sized() {
        let a = deterministic_bytes(200_000, 42);
        let b = deterministic_bytes(200_000, 42);
        assert_eq!(a, b, "same size + seed must reproduce identical bytes");
        assert_eq!(a.len(), 200_000);

        let c = deterministic_bytes(200_000, 43);
        assert_ne!(a, c, "different seeds must diverge");
    }

    #[test]
    fn deterministic_bytes_spans_multiple_bao_chunk_groups() {
        // a BAO chunk group is 16 KiB; use a size several groups deep so
        // content actually exercises chunked transfer in tests that use it.
        let bytes = deterministic_bytes(96 * 1024, 7);
        assert_eq!(bytes.len(), 96 * 1024);
        let first_chunk_group = &bytes[..16 * 1024];
        let second_chunk_group = &bytes[16 * 1024..32 * 1024];
        assert_ne!(
            first_chunk_group, second_chunk_group,
            "content should vary across chunk groups, not repeat"
        );
    }
}
