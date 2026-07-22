//! CUTOVER(0.2.0): one-shot migration of grimoire's media_blobz + blob_data
//! rows into reliquary's blobz table. deleted once the storage seam cutover
//! finishes and reliquary is the sole source of truth for blob storage.
//!
//! safe to run multiple times: every insert is `INSERT OR IGNORE` keyed on
//! blake3 (reliquary's primary key), so a rerun after a partial or complete
//! prior run only fills in whatever is still missing. never modifies or
//! deletes anything in grimoire's own tables - only reads from them, and
//! writes into reliquary's database plus its canonical blob-files
//! directory.

use std::collections::{HashMap, HashSet};

use reliquary::blobz::{BlobStore, SqliteBlobStore};
use serde::Serialize;

use crate::config::get_config;
use crate::error::{GrimoireError, GrimoireResult};
use crate::{blob_data, database, media_blobz};

/// one blob whose `parent_blob_id` could not be resolved to a blake3 hash
/// through the id->blake3 map built from media_blobz. a hard problem to
/// surface, never silently skipped.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct UnresolvedParent {
    pub blob_id: String,
    pub parent_blob_id: String,
}

/// the result of one `migrate_to_reliquary` run.
#[derive(Debug, Clone, Default, Serialize)]
pub struct MigrationReport {
    /// non-deleted media_blobz rows considered for migration this run.
    pub total_live_blobs: i64,
    /// rows newly inserted into reliquary's blobz table this run.
    pub inserted: i64,
    /// rows whose blake3 already existed in blobz (a previous run already
    /// migrated them, or this run is a no-op rerun).
    pub already_migrated: i64,
    /// blobs whose parent_blob_id has no resolvable blake3. never silently
    /// skipped - must be empty for a clean migration.
    pub unresolved_parents: Vec<UnresolvedParent>,
    /// blobs with neither a local_path nor a blob_data row - no content
    /// exists anywhere to migrate. must be empty for a clean migration.
    pub missing_content: Vec<String>,
    /// blob_data rows that still have no matching reliquary blobz row
    /// (resolved via old_grimoire_id) after this run. must be 0 for a
    /// clean migration.
    pub unmigrated_blob_data: i64,
}

impl MigrationReport {
    /// true when every verification count this command performs came back
    /// clean: no unresolved parents, no missing content, no leftover
    /// blob_data rows.
    pub fn is_clean(&self) -> bool {
        self.unresolved_parents.is_empty()
            && self.missing_content.is_empty()
            && self.unmigrated_blob_data == 0
    }
}

/// one media_blobz row, read in full (including columns the `MediaBlob`
/// domain model doesn't carry, like `content_id`) for migration purposes.
#[derive(Debug, Clone)]
struct SourceBlob {
    id: String,
    sha256: String,
    size: Option<i64>,
    mime: Option<String>,
    source_client_id: Option<String>,
    local_path: Option<String>,
    filename: Option<String>,
    parent_blob_id: Option<String>,
    blob_type: String,
    content_id: Option<String>,
    created_at: i64,
    updated_at: i64,
    deleted_at: Option<i64>,
    created_by: Option<String>,
    updated_by: Option<String>,
    width: Option<i64>,
    height: Option<i64>,
    blake3: Option<String>,
}

async fn fetch_all_source_blobs() -> GrimoireResult<Vec<SourceBlob>> {
    let pool = database::connect().await?;
    let rows = sqlx::query_as!(
        SourceBlob,
        r#"SELECT
            id as "id!",
            sha256 as "sha256!",
            size,
            mime,
            source_client_id,
            local_path,
            filename,
            parent_blob_id,
            blob_type as "blob_type!",
            content_id,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            created_by,
            updated_by,
            width,
            height,
            blake3
         FROM media_blobz
         ORDER BY created_at ASC"#
    )
    .fetch_all(&pool)
    .await?;
    Ok(rows)
}

/// build the id->blake3 map from every row that has a blake3 hash,
/// including soft-deleted rows - a live blob's parent link resolves
/// correctly even if the parent itself was later soft-deleted.
fn build_blake3_map(rows: &[SourceBlob]) -> HashMap<String, String> {
    rows.iter()
        .filter_map(|row| row.blake3.clone().map(|blake3| (row.id.clone(), blake3)))
        .collect()
}

/// resolve `parent_blob_id` (if any) to a blake3 hash via `id_to_blake3`.
/// returns:
/// - `Ok(None)` when the blob has no parent
/// - `Ok(Some(blake3))` when the parent resolved
/// - `Err(parent_blob_id)` when the blob has a parent that isn't in the map
fn resolve_parent_blake3(
    parent_blob_id: Option<&str>,
    id_to_blake3: &HashMap<String, String>,
) -> Result<Option<String>, String> {
    match parent_blob_id {
        None => Ok(None),
        Some(pid) => match id_to_blake3.get(pid) {
            Some(blake3) => Ok(Some(blake3.clone())),
            None => Err(pid.to_string()),
        },
    }
}

/// music-domain attribution that doesn't belong on reliquary's own blobz
/// columns, carried instead in its metadata json bag.
fn build_metadata_json(row: &SourceBlob) -> GrimoireResult<String> {
    let bag = serde_json::json!({
        "created_by": row.created_by,
        "updated_by": row.updated_by,
        "content_id": row.content_id,
        "source_client_id": row.source_client_id,
        "updated_at": row.updated_at,
    });
    serde_json::to_string(&bag).map_err(|e| GrimoireError::ProcessingFailed {
        message: format!("failed to serialize migration metadata bag: {e}"),
    })
}

/// migrate every live (non-deleted) `media_blobz` row into reliquary's
/// `blobz` table, extracting `blob_data` bytes to canonical
/// `blob-files/<blake3>` files along the way. every live blob needs a
/// blake3 hash to migrate; rather than requiring a separate manual step
/// first, this backfills any missing hashes itself before migrating.
///
/// safe to run repeatedly: every insert is `INSERT OR IGNORE` keyed on
/// blake3, so reruns after a partial run only fill in what's missing.
/// never writes to or deletes from any grimoire table - reads only.
pub async fn migrate_to_reliquary() -> GrimoireResult<MigrationReport> {
    // every live blob needs a blake3 hash before it can migrate. back-fill
    // whatever is missing (most commonly db-stored images that never got
    // one at creation time) instead of hard-failing and pointing the
    // caller at a separate manual command.
    let (_total, _with_blake3, needing_blake3) =
        media_blobz::count_blake3_backfill_status().await?;
    if needing_blake3 > 0 {
        tracing::info!(
            "migrate_to_reliquary: {needing_blake3} media blob(s) need a blake3 hash, \
             backfilling before migrating"
        );
        crate::progress::report(format!(
            "backfilling blake3 for {needing_blake3} blob(s) before migration\u{2026}"
        ));
        crate::blobz::backfill_blake3_hashes(needing_blake3, 4).await?;

        let (_total, _with_blake3, still_needing) =
            media_blobz::count_blake3_backfill_status().await?;
        if still_needing > 0 {
            return Err(GrimoireError::ProcessingFailed {
                message: format!(
                    "{still_needing} media blob(s) still need a blake3 hash after backfill \
                     (likely missing source files) - run `freqhole blobz backfill-blake3` \
                     to see which ones, then re-run this command"
                ),
            });
        }
    }

    let rows = fetch_all_source_blobs().await?;
    let id_to_blake3 = build_blake3_map(&rows);

    let reliquary_pool = database::connect_reliquary().await?;
    let config = get_config();
    let store = SqliteBlobStore::new(reliquary_pool.clone(), &config.data_dir);

    let mut report = MigrationReport::default();

    for row in rows.iter().filter(|r| r.deleted_at.is_none()) {
        report.total_live_blobs += 1;

        // the aggregate gate above already checked this; guard the
        // per-row case too rather than trusting the aggregate blindly.
        let Some(blake3) = row.blake3.clone() else {
            report.missing_content.push(row.id.clone());
            continue;
        };

        let parent_blake3 =
            match resolve_parent_blake3(row.parent_blob_id.as_deref(), &id_to_blake3) {
                Ok(v) => v,
                Err(parent_blob_id) => {
                    report.unresolved_parents.push(UnresolvedParent {
                        blob_id: row.id.clone(),
                        parent_blob_id,
                    });
                    continue;
                }
            };

        let (path, size) = match resolve_path_and_size(row, &blake3, &store).await? {
            Some(v) => v,
            None => {
                report.missing_content.push(row.id.clone());
                continue;
            }
        };

        let metadata_json = build_metadata_json(row)?;

        let result = sqlx::query(
            r#"
            INSERT INTO blobz (
                blake3, iroh_hash, sha256, old_grimoire_id, filename, mime, size, path,
                external, blob_type, parent_blake3, width, height, metadata, created_at
            )
            VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8, ?9, ?10, ?11, ?12, ?13)
            ON CONFLICT (blake3) DO NOTHING
            "#,
        )
        .bind(&blake3)
        .bind(&row.sha256)
        .bind(&row.id)
        .bind(&row.filename)
        .bind(&row.mime)
        .bind(size)
        .bind(&path)
        .bind(&row.blob_type)
        .bind(&parent_blake3)
        .bind(row.width)
        .bind(row.height)
        .bind(&metadata_json)
        .bind(row.created_at)
        .execute(&reliquary_pool)
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to insert blobz row for {}: {e}", row.id),
        })?;

        if result.rows_affected() > 0 {
            report.inserted += 1;
        } else {
            report.already_migrated += 1;
        }
    }

    report.unmigrated_blob_data = count_unmigrated_blob_data(&reliquary_pool).await?;

    Ok(report)
}

/// determine the path (relative for extracted files, verbatim for
/// file-backed blobs) and byte size for one source row. returns `Ok(None)`
/// when the blob has neither a local_path nor a blob_data row - no content
/// exists anywhere to migrate.
async fn resolve_path_and_size(
    row: &SourceBlob,
    blake3: &str,
    store: &SqliteBlobStore,
) -> GrimoireResult<Option<(String, i64)>> {
    if let Some(local_path) = &row.local_path {
        let size = match row.size {
            Some(s) => s,
            None => match tokio::fs::metadata(local_path).await {
                Ok(meta) => meta.len() as i64,
                Err(_) => return Ok(None),
            },
        };
        return Ok(Some((local_path.clone(), size)));
    }

    let data_response = blob_data::get_blob_data(&row.id).await;
    if !data_response.success {
        return Ok(None);
    }
    let Some(bytes) = data_response.data else {
        return Ok(None);
    };

    let abs_path = store.prepare_canonical_path(blake3).await.map_err(|e| {
        GrimoireError::ProcessingFailed {
            message: format!("failed to prepare canonical path for {blake3}: {e}"),
        }
    })?;
    if !abs_path.exists() {
        tokio::fs::write(&abs_path, &bytes)
            .await
            .map_err(|e| GrimoireError::ProcessingFailed {
                message: format!("failed to write canonical blob file {abs_path:?}: {e}"),
            })?;
    }

    let (prefix, rest) = blake3.split_at(2);
    Ok(Some((format!("{prefix}/{rest}"), bytes.len() as i64)))
}

/// count of `blob_data` rows with no matching reliquary blobz row (resolved
/// via old_grimoire_id). must be 0 after a clean migration run.
async fn count_unmigrated_blob_data(reliquary_pool: &sqlx::SqlitePool) -> GrimoireResult<i64> {
    let blob_data_pool = database::connect_blob_data().await?;
    let blob_data_ids: Vec<String> = sqlx::query_scalar("SELECT id FROM blob_data")
        .fetch_all(&blob_data_pool)
        .await?;

    let migrated_ids: HashSet<String> =
        sqlx::query_scalar("SELECT old_grimoire_id FROM blobz WHERE old_grimoire_id IS NOT NULL")
            .fetch_all(reliquary_pool)
            .await?
            .into_iter()
            .collect();

    Ok(blob_data_ids
        .into_iter()
        .filter(|id| !migrated_ids.contains(id))
        .count() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(id: &str, blake3: Option<&str>, deleted: bool) -> SourceBlob {
        SourceBlob {
            id: id.to_string(),
            sha256: "0".repeat(64),
            size: Some(10),
            mime: None,
            source_client_id: None,
            local_path: None,
            filename: None,
            parent_blob_id: None,
            blob_type: "original".to_string(),
            content_id: None,
            created_at: 0,
            updated_at: 0,
            deleted_at: if deleted { Some(1) } else { None },
            created_by: None,
            updated_by: None,
            width: None,
            height: None,
            blake3: blake3.map(|s| s.to_string()),
        }
    }

    #[test]
    fn test_build_blake3_map_includes_soft_deleted_rows() {
        let rows = vec![
            row("a", Some("blake_a"), false),
            row("b", Some("blake_b"), true), // soft-deleted, still in the map
            row("c", None, false),           // no blake3, excluded
        ];
        let map = build_blake3_map(&rows);
        assert_eq!(map.get("a").map(String::as_str), Some("blake_a"));
        assert_eq!(map.get("b").map(String::as_str), Some("blake_b"));
        assert!(!map.contains_key("c"));
        assert_eq!(map.len(), 2);
    }

    #[test]
    fn test_resolve_parent_blake3_no_parent() {
        let map = HashMap::new();
        assert_eq!(resolve_parent_blake3(None, &map), Ok(None));
    }

    #[test]
    fn test_resolve_parent_blake3_resolved() {
        let mut map = HashMap::new();
        map.insert("parent-id".to_string(), "parent-blake3".to_string());
        assert_eq!(
            resolve_parent_blake3(Some("parent-id"), &map),
            Ok(Some("parent-blake3".to_string()))
        );
    }

    #[test]
    fn test_resolve_parent_blake3_unresolved() {
        let map = HashMap::new();
        assert_eq!(
            resolve_parent_blake3(Some("missing-id"), &map),
            Err("missing-id".to_string())
        );
    }

    #[test]
    fn test_migration_report_is_clean() {
        let mut report = MigrationReport::default();
        assert!(report.is_clean());

        report.unresolved_parents.push(UnresolvedParent {
            blob_id: "x".to_string(),
            parent_blob_id: "y".to_string(),
        });
        assert!(!report.is_clean());
    }

    #[test]
    fn test_migration_report_is_clean_missing_content() {
        let mut report = MigrationReport::default();
        report.missing_content.push("x".to_string());
        assert!(!report.is_clean());
    }

    #[test]
    fn test_migration_report_is_clean_unmigrated_blob_data() {
        let report = MigrationReport {
            unmigrated_blob_data: 1,
            ..Default::default()
        };
        assert!(!report.is_clean());
    }

    // full end-to-end flow against a real, self-contained tempdir database
    // (its own grimoire.db + blob_data db + reliquary.db, migrated fresh).
    // marked #[ignore] per this crate's existing convention for grimoire
    // lib tests that touch real db pools (the pools are process-wide
    // singletons, so this can't safely share a process with unrelated
    // tests) - run explicitly with:
    // cargo test -p grimoire --lib -- --ignored migrate_to_reliquary_full_flow
    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_migrate_to_reliquary_full_flow_is_idempotent() {
        let tmp = tempfile::tempdir().expect("tempdir");
        let data_dir = tmp.path();

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

        let pool = database::connect().await.expect("connect");

        // blob A: file-backed original audio blob.
        let audio_bytes = b"fake audio bytes for blob A";
        let audio_path = data_dir.join("blob-a.mp3");
        std::fs::write(&audio_path, audio_bytes).expect("write audio file");
        let blake3_a = reliquary::hash_bytes(audio_bytes);
        sqlx::query(
            "INSERT INTO media_blobz (id, sha256, size, mime, local_path, blob_type, blake3)
             VALUES ('bloba001', ?, ?, 'audio/mpeg', ?, 'original', ?)",
        )
        .bind("a".repeat(64))
        .bind(audio_bytes.len() as i64)
        .bind(audio_path.to_string_lossy().to_string())
        .bind(&blake3_a)
        .execute(&pool)
        .await
        .expect("insert blob a");

        // blob B: db-stored thumbnail, child of blob A.
        let thumb_bytes = b"fake thumbnail bytes for blob B";
        let blake3_b = reliquary::hash_bytes(thumb_bytes);
        sqlx::query(
            "INSERT INTO media_blobz (id, sha256, size, mime, parent_blob_id, blob_type, blake3)
             VALUES ('blobb001', ?, ?, 'image/webp', 'bloba001', 'thumbnail', ?)",
        )
        .bind("b".repeat(64))
        .bind(thumb_bytes.len() as i64)
        .bind(&blake3_b)
        .execute(&pool)
        .await
        .expect("insert blob b");
        blob_data::store_blob_data("blobb001", thumb_bytes.to_vec()).await;

        // blob C: thumbnail with a parent_blob_id that doesn't exist - the
        // deliberately-broken row this migration must surface, not hide.
        let broken_bytes = b"fake bytes for the broken row C";
        let blake3_c = reliquary::hash_bytes(broken_bytes);
        sqlx::query(
            "INSERT INTO media_blobz (id, sha256, size, mime, parent_blob_id, blob_type, blake3)
             VALUES ('blobc001', ?, ?, 'image/webp', 'does-not-exist', 'thumbnail', ?)",
        )
        .bind("c".repeat(64))
        .bind(broken_bytes.len() as i64)
        .bind(&blake3_c)
        .execute(&pool)
        .await
        .expect("insert blob c");
        blob_data::store_blob_data("blobc001", broken_bytes.to_vec()).await;

        // --- first run ---
        let report1 = migrate_to_reliquary().await.expect("first migration run");
        assert_eq!(report1.total_live_blobs, 3);
        assert_eq!(report1.inserted, 2, "blob a + blob b, not broken blob c");
        assert_eq!(report1.already_migrated, 0);
        assert_eq!(report1.unresolved_parents.len(), 1);
        assert_eq!(report1.unresolved_parents[0].blob_id, "blobc001");
        assert_eq!(
            report1.unresolved_parents[0].parent_blob_id,
            "does-not-exist"
        );
        assert!(report1.missing_content.is_empty());
        // blobc001's blob_data row never gets a blobz row (unresolved
        // parent), so it must show up as unmigrated.
        assert_eq!(report1.unmigrated_blob_data, 1);
        assert!(!report1.is_clean());

        // verify blob A's row: external=0, path is local_path verbatim,
        // iroh_hash NULL, no parent.
        let reliquary_pool = database::connect_reliquary().await.expect("reliquary pool");
        let row_a: (String, Option<String>, i64, Option<String>) = sqlx::query_as(
            "SELECT path, iroh_hash, external, parent_blake3 FROM blobz WHERE blake3 = ?",
        )
        .bind(&blake3_a)
        .fetch_one(&reliquary_pool)
        .await
        .expect("fetch blob a row");
        assert_eq!(row_a.0, audio_path.to_string_lossy().to_string());
        assert_eq!(row_a.1, None);
        assert_eq!(row_a.2, 0);
        assert_eq!(row_a.3, None);

        // verify blob B's row: canonical file extracted, parent resolved.
        let row_b: (String, Option<String>, i64, Option<String>) = sqlx::query_as(
            "SELECT path, iroh_hash, external, parent_blake3 FROM blobz WHERE blake3 = ?",
        )
        .bind(&blake3_b)
        .fetch_one(&reliquary_pool)
        .await
        .expect("fetch blob b row");
        assert_eq!(row_b.1, None);
        assert_eq!(row_b.2, 0);
        assert_eq!(row_b.3, Some(blake3_a.clone()));
        let extracted_path = data_dir.join("blob-files").join(&row_b.0);
        assert_eq!(
            std::fs::read(&extracted_path).expect("read extracted file"),
            thumb_bytes
        );

        // --- second run: must be a clean no-op, proving idempotence ---
        let report2 = migrate_to_reliquary().await.expect("second migration run");
        assert_eq!(report2.total_live_blobs, 3);
        assert_eq!(report2.inserted, 0, "nothing new to insert on rerun");
        assert_eq!(report2.already_migrated, 2);
        assert_eq!(report2.unresolved_parents.len(), 1);
        assert_eq!(report2.unmigrated_blob_data, 1);
    }
}
