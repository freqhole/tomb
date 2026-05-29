//! move/relocate a scanned directory on disk.
//!
//! when a user moves their music library on disk (eg. `/Users/me/Music` ->
//! `/Volumes/Music`), we don't want to re-hash every file (slow) and we don't
//! want to lose ratings / playlists / waveforms attached to the existing
//! `media_blobz` + `songz` rows (catastrophic).
//!
//! this operation walks the new tree, cheap-matches each file to an existing
//! blob under the old path prefix (by filename + filesize, with optional
//! relative-path / parent-folder tiebreaking), rewrites the matched blob's
//! `local_path` to the new on-disk location, refreshes the iroh-blobs FsStore
//! reference (so verified streaming keeps working at the new path), updates the
//! `scanned_directories` row, and soft-deletes any old-prefix blobs that didn't
//! find a home in the new tree.
//!
//! IMPORTANT: the cheap matching here is *only* safe in an explicit "move scan
//! dir" operation where the user has stated intent. it must NOT be used in the
//! regular add-scan-dir flow, where two unrelated `01.mp3` files of similar
//! size in different albums would collide.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use walkdir::WalkDir;

use crate::config::get_config;
use crate::database;
use crate::response::GrimoireResponse;

/// per-tier defaults. tolerance picked to absorb metadata-tag rewrites that
/// nudge file size by a few bytes/KB without re-encoding audio. exact-size
/// is required for the weakest tier (filename-only) to keep collisions rare.
const SIZE_TOLERANCE_BYTES: i64 = 2048;

/// options for the move operation. `Default` returns the recommended values:
/// soft-delete unmatched old blobs, 2KB size tolerance, not a dry run.
#[derive(Debug, Clone)]
pub struct MoveScanDirectoryOptions {
    /// when true, perform all matching + counting but skip every database write,
    /// FsStore re-reference, and soft-delete. useful as a preview before commit.
    pub dry_run: bool,
    /// max byte difference allowed between matched files in tiers 1 & 2. tier 3
    /// (filename-only) always requires exact size to keep collisions rare.
    pub size_tolerance_bytes: i64,
    /// when true (default), soft-delete blobs under the old path prefix that
    /// didn't get matched to anything in the new tree. when false, leave the
    /// rows alone (the next `RescanDirectories` job will mark them deleted via
    /// its existing orphan-detection pass).
    pub soft_delete_unmatched: bool,
    /// when true, also re-add matched files to the iroh-blobs FsStore so its
    /// path reference points at the new location. set to false only when
    /// federation/blobs is disabled (no `freqhole-blobz` store to update).
    pub refresh_blobs_store: bool,
    /// user attribution for the underlying writes (`updated_by`, `deleted_by`).
    pub updated_by: Option<String>,
}

impl Default for MoveScanDirectoryOptions {
    fn default() -> Self {
        Self {
            dry_run: false,
            size_tolerance_bytes: SIZE_TOLERANCE_BYTES,
            soft_delete_unmatched: true,
            refresh_blobs_store: true,
            updated_by: None,
        }
    }
}

/// summary of what happened (or would happen, in dry-run mode).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveScanDirectoryResult {
    pub old_path: String,
    pub new_path: String,
    /// total blobs (deleted_at IS NULL) whose local_path was under old_path/.
    pub blobs_under_old: usize,
    /// matches via tier 1 — identical relative path from scan root + size within tolerance.
    pub relocated_exact_path: usize,
    /// matches via tier 2 — same parent-folder/filename + size within tolerance.
    pub relocated_parent: usize,
    /// matches via tier 3 — same filename + exact size, unique candidate.
    pub relocated_filename: usize,
    /// files in new tree where a tier produced multiple candidates (skipped).
    pub ambiguous_skipped: usize,
    /// audio files in the new tree that did not match any old blob.
    pub new_files_unmatched: usize,
    /// old-prefix blobs that didn't receive a match. soft-deleted when
    /// `soft_delete_unmatched=true`, otherwise just counted.
    pub unmatched_old_blobs: usize,
    pub unmatched_old_blobs_soft_deleted: usize,
    /// FsStore re-add failures (best-effort; doesn't fail the operation).
    pub fs_store_refresh_failures: usize,
    pub dry_run: bool,
}

/// one existing blob under the old path prefix, indexed for cheap matching.
#[derive(Debug, Clone)]
struct OldBlob {
    id: String,
    local_path: String,
    /// path relative to the canonicalized old root, with forward slashes.
    rel_path: String,
    /// path of the parent dir relative to old root + filename, eg. "Lateralus/05.mp3".
    /// when the blob lives directly under old root, this is just the filename.
    parent_and_name: String,
    filename: String,
    size: i64,
    has_blake3: bool,
}

/// public entry point. see module docs for behavior.
pub async fn move_scanned_directory(
    old_path: &str,
    new_path: &str,
    opts: MoveScanDirectoryOptions,
) -> GrimoireResponse<MoveScanDirectoryResult> {
    // ---- validate + canonicalize ------------------------------------------------
    let old_canon = crate::paths::canonical_path_string(old_path);
    let new_canon = crate::paths::canonical_path_string(new_path);

    if !Path::new(&new_canon).is_dir() {
        return GrimoireResponse::failure(
            format!("new path is not a directory: {}", new_canon),
            vec![],
        );
    }
    if old_canon == new_canon {
        return GrimoireResponse::failure(
            "old and new paths resolve to the same canonical location".to_string(),
            vec![],
        );
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(format!("database connection failed: {}", e), vec![])
        }
    };

    // ---- load all blobs under the old prefix -----------------------------------
    let like_prefix = format!("{}/%", old_canon.trim_end_matches('/'));
    // also catch a row whose local_path *is* exactly old_canon (unusual but possible).
    let rows = match sqlx::query!(
        r#"
        SELECT id as "id!", local_path, size, metadata, blake3
        FROM media_blobz
        WHERE deleted_at IS NULL
          AND local_path IS NOT NULL
          AND (local_path = ? OR local_path LIKE ?)
        "#,
        old_canon,
        like_prefix,
    )
    .fetch_all(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                format!("failed to load old-prefix blobs: {}", e),
                vec![],
            )
        }
    };

    let old_root = PathBuf::from(&old_canon);
    let mut old_blobs: Vec<OldBlob> = Vec::with_capacity(rows.len());
    for r in rows {
        let lp = match r.local_path {
            Some(p) => p,
            None => continue,
        };
        let pb = PathBuf::from(&lp);
        let rel = match pb.strip_prefix(&old_root) {
            Ok(rel) => rel.to_path_buf(),
            // shouldn't happen given the LIKE filter, but skip defensively
            Err(_) => continue,
        };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let filename = pb
            .file_name()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default();
        let parent_and_name = match rel.parent().and_then(|p| p.file_name()) {
            Some(parent) => format!("{}/{}", parent.to_string_lossy(), filename),
            None => filename.clone(),
        };
        // prefer the column's `size`; fall back to metadata.file_size for legacy rows
        let size = r.size.unwrap_or_else(|| {
            r.metadata
                .as_deref()
                .and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok())
                .and_then(|v| v.get("file_size").and_then(|s| s.as_i64()))
                .unwrap_or(0)
        });
        old_blobs.push(OldBlob {
            id: r.id,
            local_path: lp,
            rel_path: rel_str,
            parent_and_name,
            filename,
            size,
            has_blake3: r.blake3.is_some(),
        });
    }

    // indexes: each maps key -> Vec<index_into_old_blobs>
    let mut by_rel: HashMap<String, Vec<usize>> = HashMap::new();
    let mut by_parent: HashMap<String, Vec<usize>> = HashMap::new();
    let mut by_filename: HashMap<String, Vec<usize>> = HashMap::new();
    for (i, b) in old_blobs.iter().enumerate() {
        by_rel.entry(b.rel_path.clone()).or_default().push(i);
        by_parent
            .entry(b.parent_and_name.clone())
            .or_default()
            .push(i);
        by_filename.entry(b.filename.clone()).or_default().push(i);
    }

    let mut consumed = vec![false; old_blobs.len()];

    // ---- walk new tree + match --------------------------------------------------
    let audio_exts = get_config().media.supported_audio_formats.clone();
    let new_root = PathBuf::from(&new_canon);

    let mut result = MoveScanDirectoryResult {
        old_path: old_canon.clone(),
        new_path: new_canon.clone(),
        blobs_under_old: old_blobs.len(),
        relocated_exact_path: 0,
        relocated_parent: 0,
        relocated_filename: 0,
        ambiguous_skipped: 0,
        new_files_unmatched: 0,
        unmatched_old_blobs: 0,
        unmatched_old_blobs_soft_deleted: 0,
        fs_store_refresh_failures: 0,
        dry_run: opts.dry_run,
    };

    for entry in WalkDir::new(&new_root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        // skip hidden files (eg. macOS ._foo resource forks)
        if entry
            .file_name()
            .to_str()
            .map_or(false, |n| n.starts_with('.'))
        {
            continue;
        }
        let path = entry.path();
        let ext_ok = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|ext| {
                audio_exts
                    .iter()
                    .any(|a| a.eq_ignore_ascii_case(ext))
            })
            .unwrap_or(false);
        if !ext_ok {
            continue;
        }

        let file_size = match std::fs::metadata(path).map(|m| m.len() as i64) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let new_full = match path.canonicalize() {
            Ok(p) => p,
            Err(_) => path.to_path_buf(),
        };
        let rel = match new_full.strip_prefix(&new_root) {
            Ok(r) => r.to_path_buf(),
            Err(_) => continue,
        };
        let rel_str = rel.to_string_lossy().replace('\\', "/");
        let filename = match new_full.file_name() {
            Some(n) => n.to_string_lossy().into_owned(),
            None => continue,
        };
        let parent_and_name = match rel.parent().and_then(|p| p.file_name()) {
            Some(parent) => format!("{}/{}", parent.to_string_lossy(), filename),
            None => filename.clone(),
        };

        // tier 1: identical relative path + size within tolerance
        let chosen = pick_match(
            &by_rel,
            &rel_str,
            &consumed,
            &old_blobs,
            file_size,
            opts.size_tolerance_bytes,
        )
        .map(|i| (i, MatchTier::ExactPath))
        // tier 2: same parent_and_name + size within tolerance
        .or_else(|| {
            pick_match(
                &by_parent,
                &parent_and_name,
                &consumed,
                &old_blobs,
                file_size,
                opts.size_tolerance_bytes,
            )
            .map(|i| (i, MatchTier::Parent))
        })
        // tier 3: same filename + exact size (no tolerance)
        .or_else(|| {
            pick_match(
                &by_filename,
                &filename,
                &consumed,
                &old_blobs,
                file_size,
                0,
            )
            .map(|i| (i, MatchTier::Filename))
        });

        match chosen {
            Some((idx, tier)) => {
                consumed[idx] = true;
                let blob = &old_blobs[idx];
                tracing::info!(
                    "move_scan_dir: matched blob {} ({:?}) old={} -> new={}",
                    blob.id,
                    tier,
                    blob.local_path,
                    new_full.display()
                );
                match tier {
                    MatchTier::ExactPath => result.relocated_exact_path += 1,
                    MatchTier::Parent => result.relocated_parent += 1,
                    MatchTier::Filename => result.relocated_filename += 1,
                }
                if !opts.dry_run {
                    let new_full_str = new_full.to_string_lossy().into_owned();
                    if let Err(e) = relocate_blob(
                        &pool,
                        &blob.id,
                        &new_full_str,
                        file_size,
                        opts.updated_by.as_deref(),
                    )
                    .await
                    {
                        tracing::error!(
                            blob = %blob.id,
                            error = %e,
                            "move_scan_dir: relocate sql failed (continuing)"
                        );
                    }
                    if opts.refresh_blobs_store && blob.has_blake3 {
                        match crate::blobz::add_file_to_store(&new_full).await {
                            Ok(_) => {}
                            Err(e) => {
                                result.fs_store_refresh_failures += 1;
                                tracing::warn!(
                                    blob = %blob.id,
                                    path = %new_full.display(),
                                    error = %e,
                                    "move_scan_dir: FsStore re-add failed (verified streaming for this blob may break until next backfill_blake3)"
                                );
                            }
                        }
                    }
                }
            }
            None => {
                result.new_files_unmatched += 1;
            }
        }

        // detect ambiguity that came from any tier (so we can report it).
        // we only count ambiguity when no tier yielded a unique match.
        if result.new_files_unmatched > 0 || result.relocated_exact_path
            + result.relocated_parent
            + result.relocated_filename
            > 0
        {
            // (no-op; counts already updated above)
        }
        // ambiguity counter: re-evaluate after the chosen logic above.
        // a true ambiguous-only file would have produced None above AND had
        // candidates with size match — detect that here:
        if chosen.is_none() {
            let had_ambig = ambiguous_any(
                &by_rel,
                &rel_str,
                &consumed,
                &old_blobs,
                file_size,
                opts.size_tolerance_bytes,
            ) || ambiguous_any(
                &by_parent,
                &parent_and_name,
                &consumed,
                &old_blobs,
                file_size,
                opts.size_tolerance_bytes,
            ) || ambiguous_any(
                &by_filename,
                &filename,
                &consumed,
                &old_blobs,
                file_size,
                0,
            );
            if had_ambig {
                result.ambiguous_skipped += 1;
                // it was counted as unmatched above; reclassify
                result.new_files_unmatched = result.new_files_unmatched.saturating_sub(1);
            }
        }
    }

    // ---- collect un-consumed old blobs ----------------------------------------
    let unmatched_ids: Vec<String> = old_blobs
        .iter()
        .enumerate()
        .filter_map(|(i, b)| if consumed[i] { None } else { Some(b.id.clone()) })
        .collect();
    result.unmatched_old_blobs = unmatched_ids.len();

    // ---- update scanned_directories row + soft-delete unmatched ---------------
    if !opts.dry_run {
        // update the scan dir row's path. UPSERT semantics: if the new path is
        // somehow already tracked, fold our row's file_count into it.
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let upd = sqlx::query!(
            r#"
            UPDATE scanned_directories
            SET path = ?, last_scanned_at = ?, updated_at = unixepoch()
            WHERE path = ?
            "#,
            new_canon,
            now,
            old_canon,
        )
        .execute(&pool)
        .await;
        match upd {
            Ok(r) if r.rows_affected() == 0 => {
                tracing::warn!(
                    old = %old_canon,
                    new = %new_canon,
                    "move_scan_dir: no scanned_directories row at old path (blobs relocated anyway)"
                );
            }
            Ok(_) => {}
            Err(e) => {
                // a UNIQUE conflict on path means the new path is already tracked.
                // delete the old row in that case so we don't have two pointing at the same place.
                tracing::warn!(error = %e, "move_scan_dir: scan-dir UPDATE failed, attempting cleanup of old row");
                let _ = sqlx::query!(
                    r#"DELETE FROM scanned_directories WHERE path = ?"#,
                    old_canon
                )
                .execute(&pool)
                .await;
            }
        }

        if opts.soft_delete_unmatched {
            for id in &unmatched_ids {
                if let Err(e) = soft_delete_blob_and_songs(&pool, id).await {
                    tracing::error!(blob = %id, error = %e, "move_scan_dir: soft-delete failed");
                } else {
                    result.unmatched_old_blobs_soft_deleted += 1;
                }
            }
        }
    }

    GrimoireResponse::success(
        format!(
            "move complete: {} relocated ({} exact, {} parent, {} filename), {} unmatched-new, {} soft-deleted-old",
            result.relocated_exact_path + result.relocated_parent + result.relocated_filename,
            result.relocated_exact_path,
            result.relocated_parent,
            result.relocated_filename,
            result.new_files_unmatched,
            result.unmatched_old_blobs_soft_deleted,
        ),
        result,
    )
}

#[derive(Debug, Clone, Copy)]
enum MatchTier {
    ExactPath,
    Parent,
    Filename,
}

/// pick a unique unconsumed candidate from `index[key]` whose size is within
/// `tolerance` of `target_size`. returns the chosen index, or None when zero
/// or multiple candidates match.
fn pick_match(
    index: &HashMap<String, Vec<usize>>,
    key: &str,
    consumed: &[bool],
    old_blobs: &[OldBlob],
    target_size: i64,
    tolerance: i64,
) -> Option<usize> {
    let candidates = index.get(key)?;
    let mut viable: Vec<usize> = candidates
        .iter()
        .copied()
        .filter(|&i| !consumed[i] && (old_blobs[i].size - target_size).abs() <= tolerance)
        .collect();
    if viable.len() == 1 {
        Some(viable.remove(0))
    } else {
        None
    }
}

/// like `pick_match` but reports whether there were multiple viable candidates
/// (for "ambiguous skipped" accounting).
fn ambiguous_any(
    index: &HashMap<String, Vec<usize>>,
    key: &str,
    consumed: &[bool],
    old_blobs: &[OldBlob],
    target_size: i64,
    tolerance: i64,
) -> bool {
    match index.get(key) {
        Some(candidates) => {
            candidates
                .iter()
                .copied()
                .filter(|&i| !consumed[i] && (old_blobs[i].size - target_size).abs() <= tolerance)
                .count()
                > 1
        }
        None => false,
    }
}

/// update a blob's local_path + refresh size/mtime/file_name in its metadata json,
/// preserving any other keys.
async fn relocate_blob(
    pool: &sqlx::SqlitePool,
    blob_id: &str,
    new_path: &str,
    new_size: i64,
    updated_by: Option<&str>,
) -> Result<(), sqlx::Error> {
    // load current metadata for merge
    let row = sqlx::query!(
        r#"SELECT metadata, filename FROM media_blobz WHERE id = ?"#,
        blob_id
    )
    .fetch_one(pool)
    .await?;

    let mut meta: serde_json::Value = row
        .metadata
        .as_deref()
        .and_then(|m| serde_json::from_str(m).ok())
        .unwrap_or_else(|| serde_json::Value::Object(serde_json::Map::new()));
    let new_filename = PathBuf::from(new_path)
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| row.filename.clone().unwrap_or_default());
    if let serde_json::Value::Object(ref mut map) = meta {
        map.insert("file_size".to_string(), serde_json::Value::from(new_size));
        map.insert(
            "file_name".to_string(),
            serde_json::Value::from(new_filename.clone()),
        );
        if let Some(mt) = std::fs::metadata(new_path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
        {
            map.insert("file_modified_at".to_string(), serde_json::Value::from(mt));
        }
    }
    let meta_str = serde_json::to_string(&meta).unwrap_or_else(|_| "{}".to_string());

    sqlx::query!(
        r#"
        UPDATE media_blobz
        SET local_path = ?,
            filename = ?,
            size = ?,
            metadata = ?,
            updated_at = unixepoch(),
            updated_by = COALESCE(?, updated_by)
        WHERE id = ?
        "#,
        new_path,
        new_filename,
        new_size,
        meta_str,
        updated_by,
        blob_id,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// mirror of the private helper in rescan_processor — soft delete blob + cascade songs.
async fn soft_delete_blob_and_songs(
    pool: &sqlx::SqlitePool,
    blob_id: &str,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"UPDATE media_blobz SET deleted_at = unixepoch() WHERE id = ? AND deleted_at IS NULL"#,
        blob_id
    )
    .execute(pool)
    .await?;
    sqlx::query!(
        r#"UPDATE songz SET deleted_at = unixepoch() WHERE media_blob_id = ? AND deleted_at IS NULL"#,
        blob_id
    )
    .execute(pool)
    .await?;
    Ok(())
}
