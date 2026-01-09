//! Music maintenance commands

use super::MusicAction;
use crate::error::GrimoireResult;
use crate::maintenance::{
    cleanup_orphaned_media_blobs_older_than, hard_delete_old_records,
    run_full_maintenance_with_options, HardDeleteOptions,
};
use crate::media_blobz::find_media_blob_references;

pub async fn handle_check_blob_references(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::CheckBlobReferences { blob_id } = action {
        println!("checking references for media blob: {}", blob_id);
        match find_media_blob_references(&blob_id).await {
            Ok(refs) => {
                println!("Media blob {} reference summary:", blob_id);
                println!("  Song media references: {}", refs.song_media_references);
                println!(
                    "  Song thumbnail references: {}",
                    refs.song_thumbnail_references
                );
                println!(
                    "  Song waveform references: {}",
                    refs.song_waveform_references
                );
                println!(
                    "  Playlist thumbnail references: {}",
                    refs.playlist_thumbnail_references
                );
                println!(
                    "  Playlist image references: {}",
                    refs.playlist_image_references
                );
                println!(
                    "  Artist image references: {}",
                    refs.artist_image_references
                );
                println!("  Album image references: {}", refs.album_image_references);
                println!("  Song image references: {}", refs.song_image_references);
                println!("  Child blob references: {}", refs.child_blob_references);
                println!("  Total references: {}", refs.total_references());
                println!("  Can be safely deleted: {}", !refs.has_references());
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to check blob references: {}", e);
                Err(e.into())
            }
        }
    } else {
        unreachable!("handle_check_blob_references called with wrong action variant")
    }
}

pub async fn handle_cleanup_orphaned_blobs(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::CleanupOrphanedBlobs {
        min_age_days,
        dry_run,
    } = action
    {
        println!("cleaning up orphaned media blobs...");
        if dry_run {
            println!("DRY RUN MODE: No blobs will actually be deleted");
        }

        let result = cleanup_orphaned_media_blobs_older_than(min_age_days as f64).await;

        match result {
            Ok(summary) => {
                println!("Orphaned blob cleanup completed:");
                println!("  Found {} orphaned blobs", summary.orphaned_blobs_found);
                println!("  Deleted {} blobs", summary.orphaned_blobs_deleted);
                println!("  Failed {} deletions", summary.deletion_failures);
                println!("  Freed {} bytes", summary.bytes_freed);
                println!("  Duration: {}ms", summary.duration_ms);
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to cleanup orphaned blobs: {}", e);
                Err(e.into())
            }
        }
    } else {
        unreachable!("handle_cleanup_orphaned_blobs called with wrong action variant")
    }
}

pub async fn handle_hard_delete_old_records(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::HardDeleteOldRecords {
        retention_days,
        keep_blob_data,
        dry_run,
    } = action
    {
        println!("hard deleting old soft-deleted records...");
        if dry_run {
            println!("DRY RUN MODE: No records will actually be deleted");
        }

        let options = HardDeleteOptions {
            retention_days: retention_days as u32,
            delete_blob_data: !keep_blob_data,
            dry_run,
        };

        match hard_delete_old_records(options).await {
            Ok(summary) => {
                println!("Hard deletion completed:");
                println!("  Songs deleted: {}", summary.songs_deleted);
                println!("  Playlists deleted: {}", summary.playlists_deleted);
                println!("  Artists deleted: {}", summary.artists_deleted);
                println!("  Albums deleted: {}", summary.albums_deleted);
                println!("  Tags deleted: {}", summary.tags_deleted);
                println!("  Genres deleted: {}", summary.genres_deleted);
                println!("  Sub-genres deleted: {}", summary.sub_genres_deleted);
                println!("  Media blobs deleted: {}", summary.media_blobs_deleted);
                println!("  Blob data deleted: {}", summary.blob_data_deleted);
                println!("  Total records deleted: {}", summary.total_records_deleted);
                println!("  Duration: {}ms", summary.duration_ms);
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to hard delete old records: {}", e);
                Err(e.into())
            }
        }
    } else {
        unreachable!("handle_hard_delete_old_records called with wrong action variant")
    }
}

pub async fn handle_run_maintenance(action: MusicAction) -> GrimoireResult<()> {
    if let MusicAction::RunMaintenance {
        retention_days,
        dry_run,
    } = action
    {
        println!("running full maintenance...");
        if dry_run {
            println!("DRY RUN MODE: No records will actually be deleted");
        }

        let options = HardDeleteOptions {
            retention_days: retention_days as u32,
            delete_blob_data: true,
            dry_run,
        };

        match run_full_maintenance_with_options(options).await {
            Ok(result) => {
                println!("Full maintenance completed:");
                println!();
                println!("Orphaned blob cleanup:");
                println!(
                    "  Found {} orphaned blobs",
                    result.orphaned_blobs_cleaned.orphaned_blobs_found
                );
                println!(
                    "  Deleted {} blobs",
                    result.orphaned_blobs_cleaned.orphaned_blobs_deleted
                );
                println!(
                    "  Freed {} bytes",
                    result.orphaned_blobs_cleaned.bytes_freed
                );
                println!();
                println!("Hard deletion:");
                println!(
                    "  Songs deleted: {}",
                    result.hard_delete_summary.songs_deleted
                );
                println!(
                    "  Playlists deleted: {}",
                    result.hard_delete_summary.playlists_deleted
                );
                println!(
                    "  Artists deleted: {}",
                    result.hard_delete_summary.artists_deleted
                );
                println!(
                    "  Albums deleted: {}",
                    result.hard_delete_summary.albums_deleted
                );
                println!(
                    "  Tags deleted: {}",
                    result.hard_delete_summary.tags_deleted
                );
                println!(
                    "  Genres deleted: {}",
                    result.hard_delete_summary.genres_deleted
                );
                println!(
                    "  Sub-genres deleted: {}",
                    result.hard_delete_summary.sub_genres_deleted
                );
                println!(
                    "  Media blobs deleted: {}",
                    result.hard_delete_summary.media_blobs_deleted
                );
                println!(
                    "  Blob data deleted: {}",
                    result.hard_delete_summary.blob_data_deleted
                );
                println!();
                println!("Total duration: {}ms", result.total_duration_ms);
                Ok(())
            }
            Err(e) => {
                eprintln!("failed to run maintenance: {}", e);
                Err(e.into())
            }
        }
    } else {
        unreachable!("handle_run_maintenance called with wrong action variant")
    }
}
