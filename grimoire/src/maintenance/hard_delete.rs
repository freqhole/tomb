//! Hard deletion utilities for permanently removing old soft-deleted records
//! Provides functions for cleaning up records that have been soft-deleted for a specified period

use crate::database;
use crate::error::GrimoireResult;
use std::time::Instant;

/// Options for hard deletion operations
#[derive(Debug, Clone)]
pub struct HardDeleteOptions {
    /// Minimum age in days before hard deletion (default: 30)
    pub retention_days: u32,
    /// Whether to also delete associated blob_data (default: true)
    pub delete_blob_data: bool,
    /// Whether to run in dry-run mode (default: false)
    pub dry_run: bool,
}

impl Default for HardDeleteOptions {
    fn default() -> Self {
        Self {
            retention_days: 30,
            delete_blob_data: true,
            dry_run: false,
        }
    }
}

/// Summary of hard deletion operation
#[derive(Debug, Clone)]
pub struct HardDeleteSummary {
    pub songs_deleted: u32,
    pub playlists_deleted: u32,
    pub artists_deleted: u32,
    pub albums_deleted: u32,
    pub media_blobs_deleted: u32,
    pub blob_data_deleted: u32,
    pub total_records_deleted: u32,
    pub duration_ms: u64,
    pub cutoff_timestamp: i64,
}

impl HardDeleteSummary {
    fn new(cutoff_timestamp: i64) -> Self {
        Self {
            songs_deleted: 0,
            playlists_deleted: 0,
            artists_deleted: 0,
            albums_deleted: 0,
            media_blobs_deleted: 0,
            blob_data_deleted: 0,
            total_records_deleted: 0,
            duration_ms: 0,
            cutoff_timestamp,
        }
    }

    fn add_totals(&mut self) {
        self.total_records_deleted = self.songs_deleted
            + self.playlists_deleted
            + self.artists_deleted
            + self.albums_deleted
            + self.media_blobs_deleted
            + self.blob_data_deleted;
    }
}

/// Hard delete all old soft-deleted records
pub async fn hard_delete_old_records(
    options: HardDeleteOptions,
) -> GrimoireResult<HardDeleteSummary> {
    let start_time = Instant::now();

    // Calculate cutoff timestamp (current time - retention days)
    let current_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("Time went backwards")
        .as_secs() as i64;
    let retention_seconds = (options.retention_days as i64) * 24 * 60 * 60;
    let cutoff_timestamp = current_time - retention_seconds;

    let mut summary = HardDeleteSummary::new(cutoff_timestamp);

    println!(
        "Starting hard deletion of records older than {} days (cutoff: {})",
        options.retention_days, cutoff_timestamp
    );

    if options.dry_run {
        println!("DRY RUN MODE: No records will actually be deleted");
    }

    // Delete in order to respect foreign key constraints
    // Songs first (they reference everything)
    summary.songs_deleted = hard_delete_old_songs(cutoff_timestamp, options.dry_run).await?;

    // Then playlists
    summary.playlists_deleted =
        hard_delete_old_playlists(cutoff_timestamp, options.dry_run).await?;

    // Then albums and artists (they can reference each other)
    summary.albums_deleted = hard_delete_old_albums(cutoff_timestamp, options.dry_run).await?;
    summary.artists_deleted = hard_delete_old_artists(cutoff_timestamp, options.dry_run).await?;

    // Finally media blobs and their data
    summary.media_blobs_deleted =
        hard_delete_old_media_blobs(cutoff_timestamp, options.dry_run).await?;

    if options.delete_blob_data {
        summary.blob_data_deleted =
            hard_delete_old_blob_data(cutoff_timestamp, options.dry_run).await?;
    }

    summary.duration_ms = start_time.elapsed().as_millis() as u64;
    summary.add_totals();

    println!(
        "Hard deletion completed: {} total records deleted ({}ms)",
        summary.total_records_deleted, summary.duration_ms
    );

    Ok(summary)
}

/// Hard delete old soft-deleted songs
pub async fn hard_delete_old_songs(cutoff_timestamp: i64, dry_run: bool) -> GrimoireResult<u32> {
    let pool = database::connect().await?;

    if dry_run {
        let count = sqlx::query!(
            "SELECT COUNT(*) as count FROM songz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
            cutoff_timestamp
        )
        .fetch_one(&pool)
        .await?
        .count;
        println!("Would delete {} old songs", count);
        return Ok(count as u32);
    }

    let result = sqlx::query!(
        "DELETE FROM songz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        cutoff_timestamp
    )
    .execute(&pool)
    .await?;

    let deleted = result.rows_affected() as u32;
    println!("Hard deleted {} old songs", deleted);
    Ok(deleted)
}

/// Hard delete old soft-deleted playlists
pub async fn hard_delete_old_playlists(
    cutoff_timestamp: i64,
    dry_run: bool,
) -> GrimoireResult<u32> {
    let pool = database::connect().await?;

    if dry_run {
        let count = sqlx::query!(
            "SELECT COUNT(*) as count FROM playlistz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
            cutoff_timestamp
        )
        .fetch_one(&pool)
        .await?
        .count;
        println!("Would delete {} old playlists", count);
        return Ok(count as u32);
    }

    let result = sqlx::query!(
        "DELETE FROM playlistz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        cutoff_timestamp
    )
    .execute(&pool)
    .await?;

    let deleted = result.rows_affected() as u32;
    println!("Hard deleted {} old playlists", deleted);
    Ok(deleted)
}

/// Hard delete old soft-deleted albums
pub async fn hard_delete_old_albums(cutoff_timestamp: i64, dry_run: bool) -> GrimoireResult<u32> {
    let pool = database::connect().await?;

    if dry_run {
        let count = sqlx::query!(
            "SELECT COUNT(*) as count FROM albumz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
            cutoff_timestamp
        )
        .fetch_one(&pool)
        .await?
        .count;
        println!("Would delete {} old albums", count);
        return Ok(count as u32);
    }

    let result = sqlx::query!(
        "DELETE FROM albumz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        cutoff_timestamp
    )
    .execute(&pool)
    .await?;

    let deleted = result.rows_affected() as u32;
    println!("Hard deleted {} old albums", deleted);
    Ok(deleted)
}

/// Hard delete old soft-deleted artists
pub async fn hard_delete_old_artists(cutoff_timestamp: i64, dry_run: bool) -> GrimoireResult<u32> {
    let pool = database::connect().await?;

    if dry_run {
        let count = sqlx::query!(
            "SELECT COUNT(*) as count FROM artistz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
            cutoff_timestamp
        )
        .fetch_one(&pool)
        .await?
        .count;
        println!("Would delete {} old artists", count);
        return Ok(count as u32);
    }

    let result = sqlx::query!(
        "DELETE FROM artistz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        cutoff_timestamp
    )
    .execute(&pool)
    .await?;

    let deleted = result.rows_affected() as u32;
    println!("Hard deleted {} old artists", deleted);
    Ok(deleted)
}

/// Hard delete old soft-deleted media blobs
pub async fn hard_delete_old_media_blobs(
    cutoff_timestamp: i64,
    dry_run: bool,
) -> GrimoireResult<u32> {
    let pool = database::connect().await?;

    if dry_run {
        let count = sqlx::query!(
            "SELECT COUNT(*) as count FROM media_blobz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
            cutoff_timestamp
        )
        .fetch_one(&pool)
        .await?
        .count;
        println!("Would delete {} old media blobs", count);
        return Ok(count as u32);
    }

    let result = sqlx::query!(
        "DELETE FROM media_blobz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        cutoff_timestamp
    )
    .execute(&pool)
    .await?;

    let deleted = result.rows_affected() as u32;
    println!("Hard deleted {} old media blobs", deleted);
    Ok(deleted)
}

/// Hard delete old blob data for deleted media blobs
async fn hard_delete_old_blob_data(cutoff_timestamp: i64, dry_run: bool) -> GrimoireResult<u32> {
    let pool = database::connect().await?;

    if dry_run {
        let count = sqlx::query!(
            "SELECT COUNT(*) as count FROM blob_data bd
             WHERE NOT EXISTS (
                 SELECT 1 FROM media_blobz mb WHERE mb.id = bd.id AND mb.deleted_at IS NULL
             )"
        )
        .fetch_one(&pool)
        .await?
        .count;
        println!("Would delete {} orphaned blob_data records", count);
        return Ok(count as u32);
    }

    // Delete blob_data for media_blobs that no longer exist or are deleted
    let result = sqlx::query!(
        "DELETE FROM blob_data
         WHERE NOT EXISTS (
             SELECT 1 FROM media_blobz mb WHERE mb.id = blob_data.id AND mb.deleted_at IS NULL
         )"
    )
    .execute(&pool)
    .await?;

    let deleted = result.rows_affected() as u32;
    println!("Hard deleted {} orphaned blob_data records", deleted);
    Ok(deleted)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hard_delete_options_default() {
        let options = HardDeleteOptions::default();
        assert_eq!(options.retention_days, 30);
        assert!(options.delete_blob_data);
        assert!(!options.dry_run);
    }

    #[test]
    fn test_hard_delete_summary_new() {
        let cutoff = 1000000000;
        let summary = HardDeleteSummary::new(cutoff);
        assert_eq!(summary.cutoff_timestamp, cutoff);
        assert_eq!(summary.total_records_deleted, 0);
    }

    #[test]
    fn test_hard_delete_summary_add_totals() {
        let mut summary = HardDeleteSummary::new(1000000000);
        summary.songs_deleted = 5;
        summary.playlists_deleted = 3;
        summary.media_blobs_deleted = 2;

        summary.add_totals();
        assert_eq!(summary.total_records_deleted, 10);
    }
}
