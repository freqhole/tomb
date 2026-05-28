//! rescan directories job processor
//!
//! rescans all tracked directories to find new/moved/deleted files
//! includes orphan detection to clean up missing files

use crate::blob_data;
use crate::jobs::{create_job_session, CreateJobSessionRequest, Job, JobError, JobType};
use crate::music::crud;
use crate::music::scanner::scan_directory;
use futures_util::TryStreamExt;
use serde_json::{json, Value};
use std::path::Path;
use tracing::{info, warn};

use super::scanned_directories::{get_deduplicated_directories, record_scanned_directory};
use crate::database;
use crate::media_blobz::MediaBlob;
use crate::response::GrimoireResponse;

/// process rescan directories job
///
/// rescans all tracked directories (or a specific one) and performs orphan detection
///
/// job parameters (optional):
/// - directory_id: specific directory to rescan (if omitted, rescans all)
/// - purge_missing_scan_dirs: bool (default true). drop scanned_directories rows
///   whose path no longer exists on disk before scanning.
/// - restore_reappeared: bool (default true). before the orphan-detection pass,
///   undelete any blob whose local_path now exists on disk (cascading to songs).
///
/// phases:
/// 0. purge_missing_scan_dirs (opt-out): drop scanned_directories rows for paths
///    that no longer exist on disk
/// 1. scan all tracked directories (deduplicated)
/// 2a. restore pass (opt-out): undelete blobs whose local_path now exists, cascade to songs
/// 2b. orphan detection: check all live blobs, soft delete if file missing
pub async fn process_rescan_directories_job(job: &Job) -> Result<Option<Value>, JobError> {
    info!("processing RescanDirectories job: {}", job.id);

    // initialize duplicate report for this rescan session
    crud::init_duplicate_report();

    let params: serde_json::Value = job.parameters()?;
    let specific_dir_id = params["directory_id"].as_str();
    let purge_missing_scan_dirs = params["purge_missing_scan_dirs"].as_bool().unwrap_or(true);
    let restore_reappeared = params["restore_reappeared"].as_bool().unwrap_or(true);

    // phase 0: purge scanned_directories rows whose path no longer exists on disk
    let mut purged_scan_dirs = 0usize;
    if purge_missing_scan_dirs {
        match purge_missing_scanned_directories().await {
            Ok(n) => purged_scan_dirs = n,
            Err(e) => warn!("phase 0 purge_missing_scanned_directories failed: {}", e),
        }
    }

    // get directories to scan
    let directories_response = if let Some(dir_id) = specific_dir_id {
        // rescan specific directory (not implemented - just rescan all for now)
        warn!(
            "specific directory_id not yet supported, rescanning all: {}",
            dir_id
        );
        get_deduplicated_directories().await
    } else {
        // rescan all tracked directories (deduplicated)
        get_deduplicated_directories().await
    };

    if !directories_response.success {
        return Err(JobError::ProcessingFailed {
            reason: directories_response.message,
        });
    }

    let directories = directories_response.data.unwrap_or_default();

    if directories.is_empty() {
        info!("no directories tracked for rescanning");
        return Ok(Some(json!({
            "message": "no directories to rescan",
            "scanned_count": 0,
            "found_count": 0,
            "deleted_count": 0,
        })));
    }

    info!("rescanning {} directories", directories.len());

    // phase 1: scan all directories
    let mut total_found = 0;

    // create a job session for all ProcessFile jobs created during rescan
    let session_request = CreateJobSessionRequest {
        job_type: JobType::ProcessFile,
        batch_size: None,
        created_by: Some(format!("rescan-{}", job.id)),
    };
    let session_response = create_job_session(session_request).await;
    let session_id = match session_response.data {
        Some(session) => session.id,
        None => {
            return Err(JobError::ProcessingFailed {
                reason: format!("failed to create job session: {}", session_response.message),
            });
        }
    };

    for dir in &directories {
        info!("rescanning directory: {}", dir.path);

        // scan directory recursively - creates ProcessFile jobs
        // skip_tracked_subdirs=false so rescan finds all new files everywhere
        let scan_result = scan_directory(&dir.path, &session_id, true, None, None, false).await;

        let found_count = if scan_result.success {
            scan_result.data.unwrap_or(0)
        } else {
            warn!("scan failed for {}: {}", dir.path, scan_result.message);
            0
        };

        total_found += found_count;

        // update directory scan metadata
        let _ = record_scanned_directory(&dir.path, found_count as i64, None).await;

        info!("scanned {}: found {} files", dir.path, found_count);
    }

    // phase 2a: restore pass — undelete blobs whose local_path now exists,
    // cascading to any songs that point at the restored blob. this repairs
    // libraries that were soft-deleted incorrectly (eg. files temporarily
    // missing during a move-dir or unmount).
    let mut restored_blobs = 0usize;
    let mut restored_songs = 0usize;
    if restore_reappeared {
        match restore_reappeared_blobs_and_songs().await {
            Ok((b, s)) => {
                restored_blobs = b;
                restored_songs = s;
                if b > 0 || s > 0 {
                    info!(
                        "restore pass: undeleted {} blobs and {} songs whose files now exist",
                        b, s
                    );
                }
            }
            Err(e) => warn!("phase 2a restore pass failed: {}", e),
        }
    }

    // phase 2b: orphan detection (stream blobs, check if files exist)
    info!("starting orphan detection...");

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("database connection failed: {}", e),
            })
        }
    };

    // stream all active blobs with local_path
    let mut blob_stream = sqlx::query_as!(
        MediaBlob,
        r#"
        SELECT id as "id!", sha256 as "sha256!", size, mime, source_client_id,
               local_path, filename, metadata, created_at as "created_at!", updated_at as "updated_at!",
               parent_blob_id, blob_type as "blob_type!", deleted_at, deleted_by,
               created_by, updated_by, width, height, blake3
        FROM media_blobz
        WHERE local_path IS NOT NULL
        AND deleted_at IS NULL
        ORDER BY id
        "#
    )
    .fetch(&pool);

    let mut checked = 0;
    let mut deleted = 0;

    while let Some(blob) = blob_stream
        .try_next()
        .await
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("failed to stream blobs: {}", e),
        })?
    {
        if let Some(local_path) = &blob.local_path {
            if !Path::new(local_path).exists() {
                // file is missing, soft delete blob and cascade to songs
                match soft_delete_blob_and_songs(&blob.id).await {
                    Ok(_) => {
                        deleted += 1;
                        info!("soft deleted missing file: {}", local_path);
                    }
                    Err(e) => {
                        warn!("failed to soft delete blob {}: {}", blob.id, e);
                    }
                }
            }
        }

        checked += 1;
        if checked % 1000 == 0 {
            info!(
                "orphan detection progress: checked {} blobs, deleted {}",
                checked, deleted
            );
        }
    }

    info!(
        "rescan complete: scanned {} directories, found {} files, checked {} blobs, deleted {} missing",
        directories.len(),
        total_found,
        checked,
        deleted
    );

    // clear caches and write reports
    if let Some(sid) = &job.session_id {
        blob_data::clear_scan_cache(sid).await;
    }
    if let Err(e) = crud::write_duplicate_report() {
        warn!("failed to write duplicate report: {}", e);
    }

    Ok(Some(json!({
        "scanned_directories": directories.len(),
        "files_found": total_found,
        "blobs_checked": checked,
        "blobs_deleted": deleted,
        "purged_scan_dirs": purged_scan_dirs,
        "restored_blobs": restored_blobs,
        "restored_songs": restored_songs,
        "message": "rescan complete"
    })))
}

/// purge `scanned_directories` rows whose `path` no longer exists on disk.
/// returns number of rows removed. caller decides whether to surface as warn/info.
pub async fn purge_missing_scanned_directories() -> Result<usize, String> {
    let pool = database::connect()
        .await
        .map_err(|e| format!("database connection failed: {}", e))?;

    let rows = sqlx::query!(r#"SELECT id as "id!", path FROM scanned_directories"#)
        .fetch_all(&pool)
        .await
        .map_err(|e| format!("failed to list scanned_directories: {}", e))?;

    let mut purged = 0usize;
    for r in rows {
        if !Path::new(&r.path).exists() {
            match sqlx::query!("DELETE FROM scanned_directories WHERE id = ?", r.id)
                .execute(&pool)
                .await
            {
                Ok(_) => {
                    purged += 1;
                    info!("purged missing scanned_directory: {} ({})", r.path, r.id);
                }
                Err(e) => warn!("failed to delete scanned_directory {}: {}", r.id, e),
            }
        }
    }
    Ok(purged)
}

/// restore previously soft-deleted music whose underlying file is back on disk.
///
/// two passes (both lenient — undelete regardless of who/when, since we have no
/// reliable way to distinguish cascade-deletes from explicit user deletes after
/// the fact):
///
/// 1. **blob-driven**: for every soft-deleted blob with a `local_path` that now
///    exists on disk, clear `deleted_at` on the blob and on every song pointing
///    at it.
/// 2. **song-driven**: for every soft-deleted song whose `media_blob_id` points
///    at a *live* blob whose `local_path` exists on disk, clear `deleted_at` on
///    the song. catches cases where songs were soft-deleted independently of
///    the blob (eg. by a half-applied dedup / scan-conflict path).
///
/// returns `(blobs_restored, songs_restored)`.
pub async fn restore_reappeared_blobs_and_songs() -> Result<(usize, usize), String> {
    let pool = database::connect()
        .await
        .map_err(|e| format!("database connection failed: {}", e))?;

    // ---- pass 1: blob-driven ----
    let rows = sqlx::query!(
        r#"
        SELECT id as "id!", local_path
        FROM media_blobz
        WHERE deleted_at IS NOT NULL
          AND local_path IS NOT NULL
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("failed to list soft-deleted blobs: {}", e))?;

    let mut blobs_restored = 0usize;
    let mut songs_restored = 0usize;

    for r in rows {
        let lp = match r.local_path {
            Some(p) => p,
            None => continue,
        };
        if !Path::new(&lp).exists() {
            continue;
        }

        let blob_res = sqlx::query!(
            r#"
            UPDATE media_blobz
            SET deleted_at = NULL, deleted_by = NULL, updated_at = unixepoch()
            WHERE id = ? AND deleted_at IS NOT NULL
            "#,
            r.id
        )
        .execute(&pool)
        .await;

        match blob_res {
            Ok(res) if res.rows_affected() > 0 => {
                blobs_restored += 1;
                info!("restored blob {} (file exists at {})", r.id, lp);
            }
            Ok(_) => continue,
            Err(e) => {
                warn!("failed to undelete blob {}: {}", r.id, e);
                continue;
            }
        }

        let song_res = sqlx::query!(
            r#"
            UPDATE songz
            SET deleted_at = NULL, deleted_by = NULL, updated_at = unixepoch()
            WHERE media_blob_id = ? AND deleted_at IS NOT NULL
            "#,
            r.id
        )
        .execute(&pool)
        .await;

        match song_res {
            Ok(res) => songs_restored += res.rows_affected() as usize,
            Err(e) => warn!("failed to undelete songs for blob {}: {}", r.id, e),
        }
    }

    // ---- pass 2: song-driven (orphan deletes where blob is still alive) ----
    let orphan_rows = sqlx::query!(
        r#"
        SELECT s.id as "id!", mb.local_path
        FROM songz s
        JOIN media_blobz mb ON mb.id = s.media_blob_id
        WHERE s.deleted_at IS NOT NULL
          AND mb.deleted_at IS NULL
          AND mb.local_path IS NOT NULL
        "#
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| format!("failed to list orphan-deleted songs: {}", e))?;

    for r in orphan_rows {
        let lp = match r.local_path {
            Some(p) => p,
            None => continue,
        };
        if !Path::new(&lp).exists() {
            continue;
        }

        let res = sqlx::query!(
            r#"
            UPDATE songz
            SET deleted_at = NULL, deleted_by = NULL, updated_at = unixepoch()
            WHERE id = ? AND deleted_at IS NOT NULL
            "#,
            r.id
        )
        .execute(&pool)
        .await;

        match res {
            Ok(r) if r.rows_affected() > 0 => {
                songs_restored += 1;
            }
            Ok(_) => {}
            Err(e) => warn!("failed to undelete orphan song: {}", e),
        }
    }

    Ok((blobs_restored, songs_restored))
}

/// public one-shot repair op. runs Phase 0 (purge missing scan dirs) and
/// Phase 2a (restore reappeared blobs+songs) without scanning the filesystem
/// for new files or running orphan-detection. safe to invoke from CLI / admin
/// dispatch when a library got incorrectly soft-deleted.
pub async fn repair_library_orphans() -> GrimoireResponse<Value> {
    let purged = match purge_missing_scanned_directories().await {
        Ok(n) => n,
        Err(e) => return GrimoireResponse::failure(e, vec![]),
    };
    let (blobs, songs) = match restore_reappeared_blobs_and_songs().await {
        Ok(t) => t,
        Err(e) => return GrimoireResponse::failure(e, vec![]),
    };
    GrimoireResponse::success(
        format!(
            "repair complete: purged {} missing scan dirs, restored {} blobs and {} songs",
            purged, blobs, songs
        ),
        json!({
            "purged_scan_dirs": purged,
            "restored_blobs": blobs,
            "restored_songs": songs,
        }),
    )
}

/// soft delete a blob and cascade to associated songs
async fn soft_delete_blob_and_songs(blob_id: &str) -> Result<(), String> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => return Err(format!("database connection failed: {}", e)),
    };

    // soft delete the blob
    let blob_result = sqlx::query!(
        "UPDATE media_blobz SET deleted_at = unixepoch() WHERE id = ? AND deleted_at IS NULL",
        blob_id
    )
    .execute(&pool)
    .await;

    if let Err(e) = blob_result {
        return Err(format!("failed to delete blob: {}", e));
    }

    // cascade: soft delete songs that use this blob
    let songs_result = sqlx::query!(
        "UPDATE songz SET deleted_at = unixepoch() WHERE media_blob_id = ? AND deleted_at IS NULL",
        blob_id
    )
    .execute(&pool)
    .await;

    if let Err(e) = songs_result {
        return Err(format!("failed to delete songs: {}", e));
    }

    Ok(())
}
