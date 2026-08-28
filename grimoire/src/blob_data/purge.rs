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
}
