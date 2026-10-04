//! Media blob purge utilities
//! Finds and removes media blobs that have no references in any table
//!
//! this is domain-agnostic by design: it works off `media_blobz`'s
//! reference-counting (`find_media_blob_references`) alone, so it reclaims
//! orphaned blobs left behind by ANY domain's row purge (music, video, or
//! any future domain) with no per-domain code required. `reclaim_blob_bytes`
//! is the one shared place that decides how a blob's underlying bytes get
//! freed - callers (this module's own sweep, and `maintenance`'s
//! age-filtered variant) should use it instead of duplicating the logic.

use crate::config::get_config;
use crate::database;
use crate::error::{ErrorDetail, GrimoireResult};
use crate::media_blobz::{delete_media_blob, find_media_blob_references, get_media_blob};
use crate::response::GrimoireResponse;
use std::path::Path;
use std::time::Instant;

/// Summary of orphaned blob purge operation
#[derive(Debug, Clone, serde::Serialize)]
pub struct OrphanedBlobSummary {
    pub total_blobs_checked: u32,
    pub orphaned_blobs_found: u32,
    pub orphaned_blobs_deleted: u32,
    pub deletion_failures: u32,
    pub bytes_freed: u64,
    /// app-managed (uploaded/fetched) files physically removed from disk
    pub files_deleted: u32,
    /// files left untouched because they live outside the app's data_dir -
    /// i.e. a user's own library file, added in place via a directory scan
    pub files_skipped_user_owned: u32,
    pub duration_ms: u64,
}

/// Information about an orphaned blob
#[derive(Debug, Clone)]
pub struct OrphanedBlob {
    pub id: String,
    pub size: Option<i64>,
    pub mime: Option<String>,
    pub blob_type: String,
    pub created_at: i64,
    pub blake3: Option<String>,
    pub local_path: Option<String>,
}

/// true if `local_path` resolves to somewhere under the app's own
/// `data_dir` (an upload or a fetched download) - false for anything else,
/// including paths that no longer exist (nothing to delete either way, so
/// treating that as "not app-managed" is the safe default).
fn is_app_managed_file(local_path: &str, data_dir: &Path) -> bool {
    let Ok(canon_data_dir) = data_dir.canonicalize() else {
        return false;
    };
    let Ok(canon_path) = Path::new(local_path).canonicalize() else {
        return false;
    };
    canon_path.starts_with(canon_data_dir)
}

/// what happened when trying to free one blob's underlying bytes
pub(crate) enum ReclaimOutcome {
    /// `blob_data`-backed bytes (posters/thumbnails/waveforms) reclaimed
    BlobDataDeleted,
    /// an app-managed file was removed from disk
    FileDeleted,
    /// left untouched: this is the user's own library file (outside data_dir)
    FileSkippedUserOwned,
}

/// free one already-soft-deleted, already-confirmed-unreferenced blob's
/// underlying bytes. `blob_data`-backed blobs are always app-generated and
/// safe to fully reclaim; a `local_path`-backed file is only removed from
/// disk when it lives under `data_dir` - anything else is presumed to be a
/// user's own library file (added via directory scan) and is left alone.
pub(crate) async fn reclaim_blob_bytes(blob: &OrphanedBlob, data_dir: &Path) -> ReclaimOutcome {
    match blob.local_path.as_deref() {
        None => {
            let _ = crate::blob_data::delete_blob_data(&blob.id).await;
            if let Some(blake3) = blob.blake3.as_deref() {
                crate::media_blobz::mirror_hard_delete(blake3).await;
            }
            ReclaimOutcome::BlobDataDeleted
        }
        Some(local_path) if is_app_managed_file(local_path, data_dir) => {
            match tokio::fs::remove_file(local_path).await {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    // already gone, nothing left to do
                }
                Err(e) => {
                    tracing::warn!("blob purge: failed to remove file {}: {}", local_path, e);
                }
            }
            if let Some(blake3) = blob.blake3.as_deref() {
                crate::media_blobz::mirror_hard_delete(blake3).await;
            }
            ReclaimOutcome::FileDeleted
        }
        Some(_) => ReclaimOutcome::FileSkippedUserOwned,
    }
}

/// check-and-purge a single known candidate blob: soft-delete its
/// `media_blobz` row and reclaim its underlying bytes if it's now
/// unreferenced by anything (any domain) - a no-op (`Ok(false)`) if it's
/// still referenced or no longer exists. unlike `cleanup_orphaned_media_blobs`
/// (which scans the whole table), this is cheap enough to call right after
/// deleting the specific entity that used to reference `blob_id` (e.g. a
/// video/series/season delete), still never touching a user-owned file
/// (see `is_app_managed_file`).
pub async fn purge_blob_if_orphaned(
    blob_id: &str,
    deleted_by: Option<String>,
) -> GrimoireResult<bool> {
    let refs = find_media_blob_references(blob_id).await?;
    if refs.has_references() {
        return Ok(false);
    }

    let blob = match get_media_blob(blob_id).await {
        Ok(blob) => blob,
        Err(_) => return Ok(false), // already gone / never existed
    };

    delete_media_blob(blob_id, deleted_by).await?;

    let orphaned = OrphanedBlob {
        id: blob.id,
        size: blob.size,
        mime: blob.mime,
        blob_type: blob.blob_type.as_str().to_string(),
        created_at: blob.created_at,
        blake3: blob.blake3,
        local_path: blob.local_path,
    };
    reclaim_blob_bytes(&orphaned, &get_config().data_dir).await;

    Ok(true)
}

/// Find all orphaned media blobs (blobs with zero references)
pub async fn find_orphaned_media_blobs() -> GrimoireResponse<Vec<OrphanedBlob>> {
    let start_time = Instant::now();
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // Get all non-deleted media blobs
    let all_blobs = match sqlx::query!(
        "SELECT id as \"id!\", size, mime, blob_type as \"blob_type!\", created_at as \"created_at!\", blake3, local_path
         FROM media_blobz
         WHERE deleted_at IS NULL
         ORDER BY created_at ASC"
    )
    .fetch_all(&pool)
    .await
    {
        Ok(blobs) => blobs,
        Err(e) => {
            return GrimoireResponse::failure("Failed to query media blobs", vec![e.into()])
        }
    };

    let mut orphaned_blobs = Vec::new();
    let total_blobs = all_blobs.len();

    println!("Checking {} media blobs for references...", total_blobs);

    for blob in all_blobs {
        // Check if this blob has any references
        let refs = match find_media_blob_references(&blob.id).await {
            Ok(r) => r,
            Err(e) => {
                return GrimoireResponse::failure(
                    "Failed to check blob references",
                    vec![ErrorDetail::new(
                        "reference_check_failed",
                        "Reference Check Failed",
                        format!("Failed to check references for blob {}: {}", blob.id, e),
                    )],
                )
            }
        };

        if !refs.has_references() {
            orphaned_blobs.push(OrphanedBlob {
                id: blob.id,
                size: blob.size,
                mime: blob.mime,
                blob_type: blob.blob_type,
                created_at: blob.created_at,
                blake3: blob.blake3,
                local_path: blob.local_path,
            });
        }
    }

    let duration_ms = start_time.elapsed().as_millis() as u64;
    println!(
        "Found {} orphaned blobs out of {} total (took {}ms)",
        orphaned_blobs.len(),
        total_blobs,
        duration_ms
    );

    GrimoireResponse::success(
        format!(
            "Found {} orphaned blobs out of {} total (took {}ms)",
            orphaned_blobs.len(),
            total_blobs,
            duration_ms
        ),
        orphaned_blobs,
    )
}

/// Clean up all orphaned media blobs
pub async fn cleanup_orphaned_media_blobs() -> GrimoireResponse<OrphanedBlobSummary> {
    let start_time = Instant::now();

    // Find orphaned blobs
    let orphaned_blobs = match find_orphaned_media_blobs().await {
        response if response.success => match response.data {
            Some(blobs) => blobs,
            None => {
                return GrimoireResponse::failure(
                    "Failed to find orphaned blobs",
                    vec![ErrorDetail::new(
                        "no_data",
                        "No Data",
                        "Find operation succeeded but returned no data",
                    )],
                )
            }
        },
        response => {
            return GrimoireResponse::failure("Failed to find orphaned blobs", response.errors)
        }
    };

    let mut deleted_count = 0;
    let mut failure_count = 0;
    let mut bytes_freed = 0u64;
    let mut files_deleted = 0u32;
    let mut files_skipped_user_owned = 0u32;
    let data_dir = get_config().data_dir;

    println!("Deleting {} orphaned media blobs...", orphaned_blobs.len());

    for blob in &orphaned_blobs {
        println!("  Deleting orphaned blob: {}", blob.id);

        match delete_media_blob(&blob.id, Some("blob_purge".to_string())).await {
            Ok(()) => {
                deleted_count += 1;
                if let Some(size) = blob.size {
                    bytes_freed += size as u64;
                }
                match reclaim_blob_bytes(blob, &data_dir).await {
                    ReclaimOutcome::FileDeleted => files_deleted += 1,
                    ReclaimOutcome::FileSkippedUserOwned => files_skipped_user_owned += 1,
                    ReclaimOutcome::BlobDataDeleted => {}
                }
                println!("    ✓ Deleted: {}", blob.id);
            }
            Err(e) => {
                failure_count += 1;
                eprintln!("    ✗ Failed to delete {}: {}", blob.id, e);
            }
        }
    }

    let duration_ms = start_time.elapsed().as_millis() as u64;

    let summary = OrphanedBlobSummary {
        total_blobs_checked: orphaned_blobs.len() as u32,
        orphaned_blobs_found: orphaned_blobs.len() as u32,
        orphaned_blobs_deleted: deleted_count,
        deletion_failures: failure_count,
        bytes_freed,
        files_deleted,
        files_skipped_user_owned,
        duration_ms,
    };

    println!(
        "Orphaned blob cleanup completed: deleted {}/{} blobs, freed {} bytes ({}ms)",
        deleted_count,
        orphaned_blobs.len(),
        bytes_freed,
        duration_ms
    );

    GrimoireResponse::success(
        format!(
            "Orphaned blob cleanup completed: deleted {}/{} blobs, freed {} bytes ({}ms)",
            deleted_count,
            orphaned_blobs.len(),
            bytes_freed,
            duration_ms
        ),
        summary,
    )
}

/// a live `media_blobz` row with no retrievable content anywhere: no
/// `local_path` (not file-backed) and no matching row in the separate
/// `blob_data` database (not db-stored either) - so it can never have a
/// `blake3` either, there's nothing left to hash. unlike
/// `find_orphaned_media_blobs` (zero *references*), these rows are
/// commonly still referenced - e.g. a `song_imagez` row pointing at a
/// derived waveform/thumbnail whose bytes never made it into `blob_data`,
/// or a `songz` row whose original audio file's path never got recorded.
/// they're broken, not unused, and `backfill_blake3_hashes` will retry and
/// skip them every single round forever - this is the matching cleanup
/// for that permanently-stuck case.
#[derive(Debug, Clone)]
pub struct ContentlessBlob {
    pub id: String,
    pub blob_type: String,
}

/// summary of a contentless-blob cleanup pass
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct ContentlessBlobSummary {
    pub blobs_found: u32,
    pub blobs_deleted: u32,
    pub deletion_failures: u32,
}

/// find all live `media_blobz` rows with no retrievable content anywhere
/// (see `ContentlessBlob`'s doc comment for exactly what that means).
pub async fn find_contentless_media_blobs() -> GrimoireResponse<Vec<ContentlessBlob>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };
    let blob_data_pool = match database::connect_blob_data().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to blob_data database",
                vec![e.into()],
            )
        }
    };

    let candidates = match sqlx::query!(
        "SELECT id as \"id!\", blob_type as \"blob_type!\"
         FROM media_blobz
         WHERE deleted_at IS NULL
           AND blake3 IS NULL
           AND (local_path IS NULL OR local_path = '')"
    )
    .fetch_all(&pool)
    .await
    {
        Ok(rows) => rows,
        Err(e) => return GrimoireResponse::failure("Failed to query media blobs", vec![e.into()]),
    };

    if candidates.is_empty() {
        return GrimoireResponse::success("no contentless blobs found", Vec::new());
    }

    // blob_data lives in a separate sqlite file from media_blobz, so this
    // can't be compile-time checked against the same DATABASE_URL as the
    // query above - same reason blob_data/service.rs uses runtime-checked
    // `sqlx::query` throughout instead of the `query!`/`query_scalar!` macros.
    let stored_ids: std::collections::HashSet<String> =
        match sqlx::query_scalar::<_, String>("SELECT id FROM blob_data")
            .fetch_all(&blob_data_pool)
            .await
        {
            Ok(ids) => ids.into_iter().collect(),
            Err(e) => {
                return GrimoireResponse::failure("failed to query blob_data", vec![e.into()])
            }
        };

    let contentless: Vec<ContentlessBlob> = candidates
        .into_iter()
        .filter(|row| !stored_ids.contains(&row.id))
        .map(|row| ContentlessBlob {
            id: row.id,
            blob_type: row.blob_type,
        })
        .collect();

    GrimoireResponse::success(
        format!("found {} contentless blob(s)", contentless.len()),
        contentless,
    )
}

/// soft-delete every blob `find_contentless_media_blobs` finds. there's
/// nothing to reclaim (no file, no blob_data row), so this is strictly a
/// metadata cleanup via the same soft-delete used everywhere else in
/// media_blobz (`delete_media_blob`), never a hard delete.
pub async fn cleanup_contentless_media_blobs(
    dry_run: bool,
) -> GrimoireResponse<ContentlessBlobSummary> {
    let found = match find_contentless_media_blobs().await {
        response if response.success => response.data.unwrap_or_default(),
        response => {
            return GrimoireResponse::failure("failed to find contentless blobs", response.errors)
        }
    };

    let blobs_found = found.len() as u32;
    let mut blobs_deleted = 0u32;
    let mut deletion_failures = 0u32;

    if !dry_run {
        for blob in &found {
            match delete_media_blob(&blob.id, Some("contentless_blob_cleanup".to_string())).await {
                Ok(()) => blobs_deleted += 1,
                Err(e) => {
                    deletion_failures += 1;
                    tracing::warn!(
                        "contentless blob cleanup: failed to delete {}: {}",
                        blob.id,
                        e
                    );
                }
            }
        }
    }

    let summary = ContentlessBlobSummary {
        blobs_found,
        blobs_deleted,
        deletion_failures,
    };

    let message = if dry_run {
        format!(
            "found {} contentless blob(s) (dry run, nothing deleted)",
            blobs_found
        )
    } else {
        format!(
            "deleted {} of {} contentless blob(s)",
            blobs_deleted, blobs_found
        )
    };

    GrimoireResponse::success(message, summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_orphaned_blob_summary() {
        let summary = OrphanedBlobSummary {
            total_blobs_checked: 100,
            orphaned_blobs_found: 5,
            orphaned_blobs_deleted: 4,
            deletion_failures: 1,
            bytes_freed: 1024000,
            files_deleted: 2,
            files_skipped_user_owned: 1,
            duration_ms: 2500,
        };

        assert_eq!(summary.orphaned_blobs_found, 5);
        assert_eq!(summary.orphaned_blobs_deleted, 4);
        assert_eq!(summary.deletion_failures, 1);
    }

    #[test]
    fn test_orphaned_blob() {
        let blob = OrphanedBlob {
            id: "test123".to_string(),
            size: Some(5000),
            mime: Some("image/webp".to_string()),
            blob_type: "original".to_string(),
            created_at: 1000000000,
            blake3: None,
            local_path: None,
        };

        assert_eq!(blob.id, "test123");
        assert_eq!(blob.blob_type, "original");
        assert!(blob.size.unwrap() > 0);
    }

    // integration tests below touch the real db pool singletons, so each
    // gets its own process:
    // cargo test -p grimoire --lib -- --ignored --exact blob_data::purge::tests::test_find_contentless_media_blobs_skips_db_stored_and_file_backed_rows
    // cargo test -p grimoire --lib -- --ignored --exact blob_data::purge::tests::test_cleanup_contentless_media_blobs_dry_run_deletes_nothing
    // cargo test -p grimoire --lib -- --ignored --exact blob_data::purge::tests::test_cleanup_contentless_media_blobs_soft_deletes_only_the_contentless_row
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

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_find_contentless_media_blobs_skips_db_stored_and_file_backed_rows() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;
        let pool = database::connect().await.expect("connect");
        let blob_data_pool = database::connect_blob_data().await.expect("blob_data pool");

        // db-stored thumbnail with its bytes present - not contentless.
        sqlx::query(
            "INSERT INTO media_blobz (id, size, mime, blob_type, parent_blob_id)
             VALUES ('has-data', 100, 'image/webp', 'thumbnail', 'parent1')",
        )
        .execute(&pool)
        .await
        .expect("insert has-data row");
        sqlx::query("INSERT INTO blob_data (id, data) VALUES ('has-data', ?)")
            .bind(vec![0u8; 4])
            .execute(&blob_data_pool)
            .await
            .expect("insert blob_data row");

        // file-backed original with a local_path recorded - not contentless
        // even though the file itself doesn't exist on disk (a different,
        // out-of-scope problem from a row that never recorded a path).
        sqlx::query(
            "INSERT INTO media_blobz (id, size, mime, blob_type, local_path)
             VALUES ('has-path', 200, 'audio/mpeg', 'original', '/tmp/does-not-exist.mp3')",
        )
        .execute(&pool)
        .await
        .expect("insert has-path row");

        // already hashed - not contentless even with no local_path/blob_data
        // (content existed and was hashed before being lost later).
        sqlx::query(
            "INSERT INTO media_blobz (id, size, mime, blob_type, parent_blob_id, blake3)
             VALUES ('already-hashed', 100, 'image/webp', 'thumbnail', 'parent1', ?)",
        )
        .bind("b".repeat(64))
        .execute(&pool)
        .await
        .expect("insert already-hashed row");

        // the genuinely contentless row: no local_path, no blob_data, no blake3.
        sqlx::query(
            "INSERT INTO media_blobz (id, size, mime, blob_type, parent_blob_id)
             VALUES ('contentless', 100, 'image/webp', 'thumbnail', 'parent1')",
        )
        .execute(&pool)
        .await
        .expect("insert contentless row");

        let response = find_contentless_media_blobs().await;
        assert!(response.success);
        let found = response.data.expect("data");
        assert_eq!(
            found.len(),
            1,
            "only the genuinely contentless row should be found"
        );
        assert_eq!(found[0].id, "contentless");
    }

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_cleanup_contentless_media_blobs_dry_run_deletes_nothing() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;
        let pool = database::connect().await.expect("connect");

        sqlx::query(
            "INSERT INTO media_blobz (id, size, mime, blob_type, parent_blob_id)
             VALUES ('contentless', 100, 'image/webp', 'thumbnail', 'parent1')",
        )
        .execute(&pool)
        .await
        .expect("insert contentless row");

        let response = cleanup_contentless_media_blobs(true).await;
        assert!(response.success);
        let summary = response.data.expect("data");
        assert_eq!(summary.blobs_found, 1);
        assert_eq!(summary.blobs_deleted, 0);

        let still_live: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM media_blobz WHERE id = 'contentless' AND deleted_at IS NULL",
        )
        .fetch_one(&pool)
        .await
        .expect("count");
        assert_eq!(still_live, 1, "dry run must not delete anything");
    }

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_cleanup_contentless_media_blobs_soft_deletes_only_the_contentless_row() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;
        let pool = database::connect().await.expect("connect");

        sqlx::query(
            "INSERT INTO media_blobz (id, size, mime, blob_type, parent_blob_id)
             VALUES ('contentless', 100, 'image/webp', 'thumbnail', 'parent1')",
        )
        .execute(&pool)
        .await
        .expect("insert contentless row");
        sqlx::query(
            "INSERT INTO media_blobz (id, size, mime, blob_type, local_path)
             VALUES ('healthy', 200, 'audio/mpeg', 'original', '/tmp/still-here.mp3')",
        )
        .execute(&pool)
        .await
        .expect("insert healthy row");

        let response = cleanup_contentless_media_blobs(false).await;
        assert!(response.success);
        let summary = response.data.expect("data");
        assert_eq!(summary.blobs_found, 1);
        assert_eq!(summary.blobs_deleted, 1);
        assert_eq!(summary.deletion_failures, 0);

        let contentless_deleted_at: Option<i64> =
            sqlx::query_scalar("SELECT deleted_at FROM media_blobz WHERE id = 'contentless'")
                .fetch_one(&pool)
                .await
                .expect("fetch");
        assert!(contentless_deleted_at.is_some());

        let healthy_deleted_at: Option<i64> =
            sqlx::query_scalar("SELECT deleted_at FROM media_blobz WHERE id = 'healthy'")
                .fetch_one(&pool)
                .await
                .expect("fetch");
        assert!(
            healthy_deleted_at.is_none(),
            "unrelated healthy row must be untouched"
        );
    }
}
