//! rescan directories job processor
//!
//! rescans all tracked directories to find new/moved/deleted files
//! includes orphan detection to clean up missing files

use crate::jobs::{Job, JobError};
use crate::music::scanner::scan_directory;
use futures_util::TryStreamExt;
use serde_json::{json, Value};
use std::path::Path;
use tracing::{info, warn};

use super::scanned_directories::{get_deduplicated_directories, record_scanned_directory};
use crate::database;
use crate::media_blobz::MediaBlob;

/// process rescan directories job
///
/// rescans all tracked directories (or a specific one) and performs orphan detection
///
/// job parameters (optional):
/// - directory_id: specific directory to rescan (if omitted, rescans all)
///
/// phases:
/// 1. scan all tracked directories (deduplicated)
/// 2. orphan detection: check all blobs, soft delete if file missing
pub async fn process_rescan_directories_job(job: &Job) -> Result<Option<Value>, JobError> {
    info!("processing RescanDirectories job: {}", job.id);

    let params: serde_json::Value = job.parameters()?;
    let specific_dir_id = params["directory_id"].as_str();

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

    for dir in &directories {
        info!("rescanning directory: {}", dir.path);

        // create a session for this scan
        let session_id = format!("rescan-{}", job.id);

        // scan directory recursively - creates ProcessFile jobs
        let scan_result = scan_directory(&dir.path, &session_id, true, None, None).await;

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

    // phase 2: orphan detection (stream blobs, check if files exist)
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
               created_by, updated_by
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

    Ok(Some(json!({
        "scanned_directories": directories.len(),
        "files_found": total_found,
        "blobs_checked": checked,
        "blobs_deleted": deleted,
        "message": "rescan complete"
    })))
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
