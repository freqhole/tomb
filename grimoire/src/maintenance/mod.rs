//! maintenance utilities for grimoire
//! provides functions for cleaning up orphaned data and hard deleting old records

use crate::response::GrimoireResponse;

mod hard_delete;
mod orphaned;
mod reorganize_library;
pub(crate) mod repair_library_images;
mod repair_video_images;
mod video_hard_delete;

pub use crate::blob_data::{
    cleanup_contentless_media_blobs, cleanup_orphaned_media_blobs, find_contentless_media_blobs,
    find_orphaned_media_blobs, ContentlessBlob, ContentlessBlobSummary, OrphanedBlobSummary,
};
pub use hard_delete::{hard_delete_old_records, HardDeleteOptions, HardDeleteSummary};
pub use orphaned::{
    cleanup_orphaned_albums, cleanup_orphaned_artists, cleanup_orphaned_genres,
    cleanup_orphaned_tags, cleanup_orphaned_taxons, cleanup_orphaned_video_series,
    OrphanedAlbumsSummary, OrphanedArtistsSummary, OrphanedGenresSummary, OrphanedTagsSummary,
    OrphanedTaxonsSummary, OrphanedVideoSeriesSummary,
};
pub use reorganize_library::{
    cleanup_claimed_paths, cleanup_if_fully_done, default_music_source_dir,
    default_video_source_dir, list_candidate_song_ids, list_candidate_video_ids,
    register_target_directory, reorganize_library_sync, reorganize_songs_batch,
    reorganize_videos_batch, validate_target_directory, ReorganizeLibraryResult,
    REORGANIZE_BATCH_SIZE,
};
pub use repair_library_images::{
    repair_directories_batch, repair_library_images_sync, repair_waveforms_batch,
    DirectoryBatchOutcome, RepairLibraryImagesOptions, RepairLibraryImagesPhase,
    RepairLibraryImagesResult, WaveformBatchOutcome, DIRECTORY_BATCH_SIZE, WAVEFORM_BATCH_SIZE,
};
pub use repair_video_images::{
    repair_video_thumbnails_batch, repair_video_waveforms_batch, VIDEO_THUMBNAIL_BATCH_SIZE,
};
pub use video_hard_delete::{
    hard_delete_old_videos, HardDeleteVideoOptions, HardDeleteVideoSummary,
};

/// Default retention period for soft-deleted records (30 days)
pub const DEFAULT_RETENTION_DAYS: u32 = 30;

/// Comprehensive maintenance result
#[derive(Debug, Clone, serde::Serialize)]
pub struct MaintenanceResult {
    pub orphaned_blobs_cleaned: OrphanedBlobSummary,
    pub hard_delete_summary: HardDeleteSummary,
    pub total_duration_ms: u64,
}

/// Run all maintenance tasks with default settings
pub async fn run_full_maintenance() -> GrimoireResponse<MaintenanceResult> {
    run_full_maintenance_with_options(HardDeleteOptions::default()).await
}

/// Run all maintenance tasks with custom options
pub async fn run_full_maintenance_with_options(
    options: HardDeleteOptions,
) -> GrimoireResponse<MaintenanceResult> {
    let start_time = std::time::Instant::now();

    println!("Starting full maintenance...");

    // Step 1: Clean up orphaned media blobs
    println!("Cleaning up orphaned media blobs...");
    let blobs_response = cleanup_orphaned_media_blobs_older_than(7.0, options.dry_run).await;
    let orphaned_blobs_cleaned = match blobs_response.data {
        Some(data) => data,
        None => {
            return GrimoireResponse::failure(
                "Failed to clean up orphaned blobs",
                blobs_response.errors,
            )
        }
    };

    // Step 2: Hard delete old records
    println!("Hard deleting old records...");
    let delete_response = hard_delete_old_records(options).await;
    let hard_delete_summary = match delete_response.data {
        Some(data) => data,
        None => {
            return GrimoireResponse::failure(
                "Failed to hard delete old records",
                delete_response.errors,
            )
        }
    };

    let total_duration_ms = start_time.elapsed().as_millis() as u64;

    println!("Maintenance completed in {}ms", total_duration_ms);

    let result = MaintenanceResult {
        orphaned_blobs_cleaned,
        hard_delete_summary,
        total_duration_ms,
    };

    GrimoireResponse::success("Full maintenance completed successfully", result)
}

/// Clean up orphaned blobs older than specified days
/// Uses the blob_data purge functions but adds age filtering.
/// `dry_run=true` finds and sizes candidates without deleting anything.
pub async fn cleanup_orphaned_media_blobs_older_than(
    min_age_days: f64,
    dry_run: bool,
) -> GrimoireResponse<OrphanedBlobSummary> {
    use crate::blob_data::{find_orphaned_media_blobs, reclaim_blob_bytes, ReclaimOutcome};
    use crate::config::get_config;
    use crate::media_blobz::delete_media_blob;
    use std::time::Instant;

    let start_time = Instant::now();

    // Find all orphaned blobs
    let blobs_result = find_orphaned_media_blobs().await;
    let all_orphaned_blobs = match blobs_result {
        response if response.success => match response.data {
            Some(blobs) => blobs,
            None => {
                return GrimoireResponse::failure(
                    "Failed to find orphaned media blobs",
                    vec![crate::error::ErrorDetail::new(
                        "no_data",
                        "No Data",
                        "Find operation succeeded but returned no data",
                    )],
                )
            }
        },
        response => {
            return GrimoireResponse::failure(
                "Failed to find orphaned media blobs",
                response.errors,
            )
        }
    };

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

    if dry_run {
        let bytes_would_free: u64 = old_orphaned_blobs
            .iter()
            .filter_map(|blob| blob.size)
            .map(|size| size as u64)
            .sum();
        let summary = OrphanedBlobSummary {
            total_blobs_checked: old_orphaned_blobs.len() as u32,
            orphaned_blobs_found: old_orphaned_blobs.len() as u32,
            orphaned_blobs_deleted: 0,
            deletion_failures: 0,
            bytes_freed: bytes_would_free,
            files_deleted: 0,
            files_skipped_user_owned: 0,
            duration_ms: start_time.elapsed().as_millis() as u64,
        };
        return GrimoireResponse::success("dry run: nothing deleted", summary);
    }

    let mut deleted_count = 0;
    let mut failure_count = 0;
    let mut bytes_freed = 0u64;
    let mut files_deleted = 0u32;
    let mut files_skipped_user_owned = 0u32;
    let data_dir = get_config().data_dir;

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
        total_blobs_checked: old_orphaned_blobs.len() as u32,
        orphaned_blobs_found: old_orphaned_blobs.len() as u32,
        orphaned_blobs_deleted: deleted_count,
        deletion_failures: failure_count,
        bytes_freed,
        files_deleted,
        files_skipped_user_owned,
        duration_ms,
    };

    println!(
        "Old orphaned blob cleanup completed: deleted {}/{} blobs, freed {} bytes ({}ms)",
        deleted_count,
        old_orphaned_blobs.len(),
        bytes_freed,
        duration_ms
    );

    GrimoireResponse::success("Orphaned blobs cleanup completed", summary)
}
