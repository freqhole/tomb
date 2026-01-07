//! Maintenance utilities for grimoire
//! Provides functions for cleaning up orphaned data and hard deleting old records

mod hard_delete;
mod orphaned;

pub use crate::blob_data::{
    cleanup_orphaned_media_blobs, find_orphaned_media_blobs, OrphanedBlobSummary,
};
pub use hard_delete::{
    hard_delete_old_albums, hard_delete_old_artists, hard_delete_old_media_blobs,
    hard_delete_old_playlists, hard_delete_old_records, hard_delete_old_songs, HardDeleteOptions,
    HardDeleteSummary,
};
pub use orphaned::{
    cleanup_orphaned_genres, cleanup_orphaned_sub_genres, cleanup_orphaned_tags,
    OrphanedGenresSummary, OrphanedSubGenresSummary, OrphanedTagsSummary,
};

/// Default retention period for soft-deleted records (30 days)
pub const DEFAULT_RETENTION_DAYS: u32 = 30;

/// Comprehensive maintenance result
#[derive(Debug, Clone)]
pub struct MaintenanceResult {
    pub orphaned_blobs_cleaned: OrphanedBlobSummary,
    pub hard_delete_summary: HardDeleteSummary,
    pub total_duration_ms: u64,
}

/// Run all maintenance tasks with default settings
pub async fn run_full_maintenance() -> crate::error::GrimoireResult<MaintenanceResult> {
    run_full_maintenance_with_options(HardDeleteOptions::default()).await
}

/// Run all maintenance tasks with custom options
pub async fn run_full_maintenance_with_options(
    options: HardDeleteOptions,
) -> crate::error::GrimoireResult<MaintenanceResult> {
    let start_time = std::time::Instant::now();

    println!("Starting full maintenance...");

    // Step 1: Clean up orphaned media blobs
    println!("Cleaning up orphaned media blobs...");
    let orphaned_blobs_cleaned = cleanup_orphaned_media_blobs_older_than(7.0).await?;

    // Step 2: Hard delete old records
    println!("Hard deleting old records...");
    let hard_delete_summary = hard_delete_old_records(options).await?;

    let total_duration_ms = start_time.elapsed().as_millis() as u64;

    println!("Maintenance completed in {}ms", total_duration_ms);

    Ok(MaintenanceResult {
        orphaned_blobs_cleaned,
        hard_delete_summary,
        total_duration_ms,
    })
}

/// Clean up orphaned blobs older than specified days
/// Uses the blob_data purge functions but adds age filtering
pub async fn cleanup_orphaned_media_blobs_older_than(
    min_age_days: f64,
) -> crate::error::GrimoireResult<OrphanedBlobSummary> {
    use crate::blob_data::{find_orphaned_media_blobs, OrphanedBlob};
    use crate::media_blobz::delete_media_blob;
    use std::time::Instant;

    let start_time = Instant::now();

    // Find all orphaned blobs
    let all_orphaned_blobs = find_orphaned_media_blobs().await?;

    // Calculate age and filter
    let current_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("Time went backwards")
        .as_secs() as i64;
    let old_orphaned_blobs: Vec<_> = all_orphaned_blobs
        .into_iter()
        .filter(|blob| {
            let age_seconds = current_time - blob.created_at;
            let age_days = age_seconds as f64 / (24.0 * 60.0 * 60.0);
            age_days >= min_age_days
        })
        .collect();

    let mut deleted_count = 0;
    let mut failure_count = 0;
    let mut bytes_freed = 0u64;

    println!(
        "Deleting {} orphaned media blobs older than {} days...",
        old_orphaned_blobs.len(),
        min_age_days
    );

    for blob in &old_orphaned_blobs {
        let age_seconds = current_time - blob.created_at;
        let age_days = age_seconds as f64 / (24.0 * 60.0 * 60.0);
        println!(
            "  Deleting old orphaned blob: {} ({:.1} days old)",
            blob.id, age_days
        );

        match delete_media_blob(&blob.id, Some("maintenance_job".to_string())).await {
            Ok(()) => {
                deleted_count += 1;
                if let Some(size) = blob.size {
                    bytes_freed += size as u64;
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
        total_blobs_checked: old_orphaned_blobs.len() as u32,
        orphaned_blobs_found: old_orphaned_blobs.len() as u32,
        orphaned_blobs_deleted: deleted_count,
        deletion_failures: failure_count,
        bytes_freed,
        duration_ms,
    };

    println!(
        "Old orphaned blob cleanup completed: deleted {}/{} blobs, freed {} bytes ({}ms)",
        deleted_count,
        old_orphaned_blobs.len(),
        bytes_freed,
        duration_ms
    );

    Ok(summary)
}
