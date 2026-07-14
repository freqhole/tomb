//! best-effort dual-write mirror from grimoire's `media_blobz` table into
//! reliquary's `blobz` table.
//!
//! grimoire's own `media_blobz` + `blob_data` tables remain fully
//! authoritative - every function here runs alongside a grimoire write that
//! has already succeeded, never in place of it. none of these functions
//! ever return an error or panic: a reliquary-side failure (an unreachable
//! pool, a `BlobStoreError`, a file io error) only ever produces a log line,
//! since there is currently no reconciliation pass that retries a missed
//! dual-write.

use std::path::Path;

use reliquary::blobz::{BlobStore, BlobType as ReliquaryBlobType, NewBlobMeta, SqliteBlobStore};
use sqlx::SqlitePool;

use super::models::{BlobType, MediaBlob};
use crate::{config, database};

/// map grimoire's blob_type enum onto reliquary's - both have the same four
/// variants, so this is a plain rename rather than a lossy conversion.
fn map_blob_type(blob_type: BlobType) -> ReliquaryBlobType {
    match blob_type {
        BlobType::Original => ReliquaryBlobType::Original,
        BlobType::Thumbnail => ReliquaryBlobType::Thumbnail,
        BlobType::Waveform => ReliquaryBlobType::Waveform,
        BlobType::Preview => ReliquaryBlobType::Preview,
    }
}

/// resolve `parent_blob_id` to the parent row's blake3 hash, if any. a
/// missing parent row, or a parent row with no blake3 yet, both resolve to
/// `None` rather than erroring - a dual-write mirror is best-effort by
/// design, never a hard dependency for the caller's own write.
async fn resolve_parent_blake3(pool: &SqlitePool, parent_blob_id: Option<&str>) -> Option<String> {
    let parent_blob_id = parent_blob_id?;
    let row = sqlx::query!(
        "SELECT blake3 FROM media_blobz WHERE id = ?",
        parent_blob_id
    )
    .fetch_optional(pool)
    .await
    .ok()?;
    row.and_then(|r| r.blake3)
}

/// build the `NewBlobMeta` reliquary needs from a grimoire blob row,
/// resolving its parent's blake3 along the way. failing to reach grimoire's
/// own pool for the parent lookup is logged and treated as "no parent"
/// rather than aborting the mirror attempt entirely.
async fn build_new_blob_meta(blob: &MediaBlob) -> NewBlobMeta {
    let parent_blake3 = match database::connect().await {
        Ok(pool) => resolve_parent_blake3(&pool, blob.parent_blob_id.as_deref()).await,
        Err(e) => {
            tracing::error!(
                blob_id = %blob.id,
                error = %e,
                "reliquary_mirror: could not reach grimoire pool to resolve parent blake3"
            );
            None
        }
    };

    NewBlobMeta {
        filename: blob.filename.clone(),
        mime: blob.mime.clone(),
        blob_type: map_blob_type(blob.blob_type),
        parent_blake3,
        width: blob.width.and_then(|w| u32::try_from(w).ok()),
        height: blob.height.and_then(|h| u32::try_from(h).ok()),
        metadata: match &blob.metadata {
            serde_json::Value::Null => None,
            other => Some(other.clone()),
        },
    }
}

/// open reliquary's blob store, returning `None` (rather than an error) if
/// its pool can't be reached - callers log their own context on this path.
async fn reliquary_store() -> Option<SqliteBlobStore> {
    let pool = database::connect_reliquary().await.ok()?;
    Some(SqliteBlobStore::new(pool, &config::get_config().data_dir))
}

/// mirror a newly-created, data-backed blob into reliquary. a no-op (no
/// log) when `blob.blake3` is `None` - dual-write is deferred until a hash
/// is known, at which point `mirror_register_local_path`/`mirror_insert_bytes`
/// runs from `update_blob_blake3` instead.
pub(crate) async fn mirror_insert_bytes(blob: &MediaBlob, bytes: &[u8]) {
    let Some(blake3) = blob.blake3.as_deref() else {
        return;
    };

    let Some(store) = reliquary_store().await else {
        tracing::error!(
            blob_id = %blob.id,
            blake3 = %blake3,
            "reliquary_mirror: could not reach reliquary pool for insert_bytes"
        );
        return;
    };

    let meta = build_new_blob_meta(blob).await;

    if let Err(e) = store.insert(bytes, meta).await {
        tracing::error!(
            blob_id = %blob.id,
            blake3 = %blake3,
            error = %e,
            "reliquary_mirror: insert_bytes failed"
        );
    }
}

/// mirror a newly-created, file-backed blob into reliquary by registering
/// its on-disk path without copying bytes. a no-op when `blob.blake3` or
/// `blob.local_path` is `None`.
pub(crate) async fn mirror_register_local_path(blob: &MediaBlob) {
    let Some(blake3) = blob.blake3.as_deref() else {
        return;
    };
    let Some(local_path) = blob.local_path.as_deref() else {
        return;
    };

    let Some(store) = reliquary_store().await else {
        tracing::error!(
            blob_id = %blob.id,
            blake3 = %blake3,
            "reliquary_mirror: could not reach reliquary pool for register_local_path"
        );
        return;
    };

    let meta = build_new_blob_meta(blob).await;

    if let Err(e) = store
        .register_external_path(Path::new(local_path), meta, None, None)
        .await
    {
        tracing::error!(
            blob_id = %blob.id,
            blake3 = %blake3,
            local_path = %local_path,
            error = %e,
            "reliquary_mirror: register_local_path failed"
        );
    }
}

/// mirror an undelete: clear reliquary's soft-delete marker for `blake3`.
/// reliquary having no matching row (e.g. it predates dual-write) is
/// expected and benign, logged at `warn!` rather than `error!`.
pub(crate) async fn mirror_restore(blake3: &str) {
    let Some(store) = reliquary_store().await else {
        tracing::error!(
            blake3 = %blake3,
            "reliquary_mirror: could not reach reliquary pool for restore"
        );
        return;
    };

    match store.restore(&[blake3.to_string()]).await {
        Ok(outcome) if !outcome.failed.is_empty() => {
            tracing::warn!(
                blake3 = %blake3,
                "reliquary_mirror: restore found no matching reliquary row (predates dual-write, or was never mirrored)"
            );
        }
        Ok(_) => {}
        Err(e) => {
            tracing::error!(
                blake3 = %blake3,
                error = %e,
                "reliquary_mirror: restore failed"
            );
        }
    }
}

/// mirror a soft-delete: stamp reliquary's row for `blake3` as deleted by
/// `actor`. reliquary having no matching row is expected and benign, logged
/// at `warn!` rather than `error!`.
pub(crate) async fn mirror_soft_delete(blake3: &str, actor: &str) {
    let Some(store) = reliquary_store().await else {
        tracing::error!(
            blake3 = %blake3,
            "reliquary_mirror: could not reach reliquary pool for soft_delete"
        );
        return;
    };

    match store.soft_delete(&[blake3.to_string()], actor).await {
        Ok(outcome) if !outcome.failed.is_empty() => {
            tracing::warn!(
                blake3 = %blake3,
                "reliquary_mirror: soft_delete found no matching reliquary row (predates dual-write, or was never mirrored)"
            );
        }
        Ok(_) => {}
        Err(e) => {
            tracing::error!(
                blake3 = %blake3,
                error = %e,
                "reliquary_mirror: soft_delete failed"
            );
        }
    }
}

/// mirror a path change (a file moved on disk) directly against reliquary's
/// `blobz` table. reliquary's `BlobStore` trait has no "update an existing
/// record's path" operation - every insert/register method dedupes by
/// blake3 and returns the existing row unchanged - so this bypasses the
/// trait with a direct update, the same trait-bypass approach the initial
/// migration into reliquary uses for file-backed blobs (verbatim
/// `local_path` string, `external = 0`).
pub(crate) async fn mirror_update_path(blake3: &str, new_path: &str) {
    let pool = match database::connect_reliquary().await {
        Ok(pool) => pool,
        Err(e) => {
            tracing::error!(
                blake3 = %blake3,
                error = %e,
                "reliquary_mirror: could not reach reliquary pool for update_path"
            );
            return;
        }
    };

    // grimoire's own database is checked at compile time against a schema
    // that doesn't include reliquary's blobz table, so this query is
    // runtime-checked rather than a `sqlx::query!` macro call.
    let result = sqlx::query("UPDATE blobz SET path = ?1 WHERE blake3 = ?2")
        .bind(new_path)
        .bind(blake3)
        .execute(&pool)
        .await;

    match result {
        Ok(res) if res.rows_affected() == 0 => {
            tracing::error!(
                blake3 = %blake3,
                new_path = %new_path,
                "reliquary_mirror: update_path affected 0 rows (reliquary likely never had this blake3)"
            );
        }
        Ok(_) => {}
        Err(e) => {
            tracing::error!(
                blake3 = %blake3,
                new_path = %new_path,
                error = %e,
                "reliquary_mirror: update_path failed"
            );
        }
    }
}

/// permanently free a blob's bytes in reliquary once it's already
/// soft-deleted there (grimoire's own `delete_media_blob` + its
/// `mirror_soft_delete` call should already have caused that). only rows
/// that are currently soft-deleted are qualified, so calling this before
/// the soft-delete mirror has caught up is a harmless no-op rather than an
/// error.
pub(crate) async fn mirror_hard_delete(blake3: &str) {
    let Some(store) = reliquary_store().await else {
        tracing::error!(
            blake3 = %blake3,
            "reliquary_mirror: could not reach reliquary pool for hard_delete"
        );
        return;
    };

    if let Err(e) = store
        .hard_delete_soft_deleted(Some(&[blake3.to_string()]))
        .await
    {
        tracing::error!(
            blake3 = %blake3,
            error = %e,
            "reliquary_mirror: hard_delete failed"
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // each test spins up its own tempdir with a fresh grimoire.db and
    // reliquary.db (via the same real db pool singletons the mirror
    // functions themselves use), so each is marked #[ignore] per this
    // crate's convention for tests touching those singletons - two such
    // tests cannot safely share a process (they race over the same
    // singleton and fail with a spurious "table already exists" migration
    // error even though each passes fine alone). run ONE at a time, each
    // its own process:
    // cargo test -p grimoire --lib -- --ignored --exact media_blobz::reliquary_mirror::tests::test_mirror_insert_bytes_skips_when_blake3_none
    // cargo test -p grimoire --lib -- --ignored --exact media_blobz::reliquary_mirror::tests::test_mirror_insert_bytes_creates_row_with_parent_and_blob_type
    // cargo test -p grimoire --lib -- --ignored --exact media_blobz::reliquary_mirror::tests::test_mirror_restore_and_soft_delete_missing_hash_are_benign
    // cargo test -p grimoire --lib -- --ignored --exact media_blobz::reliquary_mirror::tests::test_mirror_update_path_updates_existing_row
    // cargo test -p grimoire --lib -- --ignored --exact media_blobz::reliquary_mirror::tests::test_mirror_hard_delete_removes_soft_deleted_row_but_not_active_ones
    async fn init_test_env(data_dir: &std::path::Path) {
        let config_toml = format!(
            r#"data_dir = "{data_dir}"

[database]
filename = "grimoire.db"

[media]
max_fs_file_size = 104857600
supported_audio_formats = ["mp3", "flac"]

[musicbrainz]
enabled = false

[logging]
level = "warn"
"#,
            data_dir = data_dir.display()
        );
        let config_path = data_dir.join("freqhole-config.toml");
        std::fs::write(&config_path, config_toml).expect("write config");
        std::fs::write(data_dir.join("grimoire.db"), b"").expect("touch grimoire.db");

        crate::config::init_config(Some(config_path)).expect("init config");
        database::run_migrations().await.expect("run migrations");
    }

    fn make_test_blob(
        id: &str,
        blake3: Option<&str>,
        parent_blob_id: Option<&str>,
        local_path: Option<&str>,
    ) -> MediaBlob {
        MediaBlob {
            id: id.to_string(),
            sha256: "0".repeat(64),
            size: None,
            mime: Some("audio/mpeg".to_string()),
            source_client_id: None,
            local_path: local_path.map(|s| s.to_string()),
            filename: Some("test.mp3".to_string()),
            parent_blob_id: parent_blob_id.map(|s| s.to_string()),
            blob_type: BlobType::Original,
            metadata: serde_json::Value::Null,
            created_at: 0,
            updated_at: 0,
            deleted_at: None,
            deleted_by: None,
            created_by: None,
            updated_by: None,
            width: None,
            height: None,
            blake3: blake3.map(|s| s.to_string()),
        }
    }

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_mirror_insert_bytes_skips_when_blake3_none() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;

        let blob = make_test_blob("noblake3", None, None, None);
        mirror_insert_bytes(&blob, b"whatever bytes").await;

        let reliquary_pool = database::connect_reliquary().await.expect("reliquary pool");
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM blobz")
            .fetch_one(&reliquary_pool)
            .await
            .expect("count blobz rows");
        assert_eq!(count, 0, "no blake3 means insert_bytes must be a no-op");
    }

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_mirror_insert_bytes_creates_row_with_parent_and_blob_type() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;

        let pool = database::connect().await.expect("connect");

        // a parent row already carrying a blake3, so the child's
        // parent_blob_id resolves to a real parent_blake3.
        let parent_bytes = b"fake parent audio bytes";
        let parent_blake3 = reliquary::hash_bytes(parent_bytes);
        sqlx::query(
            "INSERT INTO media_blobz (id, sha256, size, mime, blob_type, blake3)
             VALUES ('parent01', ?, ?, 'audio/mpeg', 'original', ?)",
        )
        .bind("a".repeat(64))
        .bind(parent_bytes.len() as i64)
        .bind(&parent_blake3)
        .execute(&pool)
        .await
        .expect("insert parent row");

        let child_bytes = b"fake thumbnail bytes for the child";
        let child_blake3 = reliquary::hash_bytes(child_bytes);
        let blob = make_test_blob("child01", Some(&child_blake3), Some("parent01"), None);

        mirror_insert_bytes(&blob, child_bytes).await;

        let reliquary_pool = database::connect_reliquary().await.expect("reliquary pool");
        let row: (Option<String>, String) =
            sqlx::query_as("SELECT parent_blake3, blob_type FROM blobz WHERE blake3 = ?")
                .bind(&child_blake3)
                .fetch_one(&reliquary_pool)
                .await
                .expect("fetch mirrored row");
        assert_eq!(row.0, Some(parent_blake3));
        assert_eq!(row.1, "original");
    }

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_mirror_restore_and_soft_delete_missing_hash_are_benign() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;

        // neither hash was ever inserted into reliquary - both calls must
        // return without panicking or propagating an error.
        mirror_restore(&"f".repeat(64)).await;
        mirror_soft_delete(&"f".repeat(64), "tester").await;
    }

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_mirror_update_path_updates_existing_row() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;

        let reliquary_pool = database::connect_reliquary().await.expect("reliquary pool");
        let config = crate::config::get_config();
        let store = SqliteBlobStore::new(reliquary_pool.clone(), &config.data_dir);

        let bytes = b"bytes for a blob whose path will move";
        let record = store
            .insert(bytes, NewBlobMeta::default())
            .await
            .expect("insert reliquary blob");

        mirror_update_path(&record.blake3, "/new/path/for/this/blob.mp3").await;

        let path: String = sqlx::query_scalar("SELECT path FROM blobz WHERE blake3 = ?")
            .bind(&record.blake3)
            .fetch_one(&reliquary_pool)
            .await
            .expect("fetch updated row");
        assert_eq!(path, "/new/path/for/this/blob.mp3");
    }

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_mirror_hard_delete_removes_soft_deleted_row_but_not_active_ones() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;

        let reliquary_pool = database::connect_reliquary().await.expect("reliquary pool");
        let config = crate::config::get_config();
        let store = SqliteBlobStore::new(reliquary_pool.clone(), &config.data_dir);

        let deleted_bytes = b"bytes for a blob that is already soft-deleted";
        let deleted_record = store
            .insert(deleted_bytes, NewBlobMeta::default())
            .await
            .expect("insert reliquary blob");
        store
            .soft_delete(std::slice::from_ref(&deleted_record.blake3), "tester")
            .await
            .expect("soft delete");

        let active_bytes = b"bytes for a blob that stays active";
        let active_record = store
            .insert(active_bytes, NewBlobMeta::default())
            .await
            .expect("insert reliquary blob");

        mirror_hard_delete(&deleted_record.blake3).await;

        let deleted_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM blobz WHERE blake3 = ?")
            .bind(&deleted_record.blake3)
            .fetch_one(&reliquary_pool)
            .await
            .expect("count deleted row");
        assert_eq!(
            deleted_count, 0,
            "hard_delete must remove the soft-deleted row"
        );

        let active_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM blobz WHERE blake3 = ?")
            .bind(&active_record.blake3)
            .fetch_one(&reliquary_pool)
            .await
            .expect("count active row");
        assert_eq!(
            active_count, 1,
            "hard_delete must never touch a non-soft-deleted row"
        );

        // calling it again on a hash that is no longer soft-deleted (already
        // purged) must be a benign no-op, not a panic or propagated error.
        mirror_hard_delete(&deleted_record.blake3).await;
    }
}
