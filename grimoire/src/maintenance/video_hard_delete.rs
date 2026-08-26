//! hard deletion utilities for permanently removing old soft-deleted video
//! domain records (videoz/video_seasonz/video_seriez) - mirrors
//! `hard_delete.rs`'s song/album/artist pattern.
//!
//! like the music-domain version, blob/file cleanup is NOT done here - it's
//! a separate, domain-agnostic concern handled by
//! `crate::maintenance::cleanup_orphaned_media_blobs_older_than` (or a full
//! `run_full_maintenance` pass), which reclaims any blob left unreferenced
//! by this purge, including safely deleting its underlying file when (and
//! only when) that file is app-managed - see
//! `crate::blob_data::purge::reclaim_blob_bytes` for that rule.

use crate::database;
use crate::response::GrimoireResponse;
use crate::video::VideoEntityType;
use std::time::Instant;

/// options for video hard-deletion
#[derive(Debug, Clone)]
pub struct HardDeleteVideoOptions {
    /// minimum age in days since soft-deletion before hard deletion (default: 30)
    pub retention_days: u32,
    /// whether to run in dry-run mode (default: false)
    pub dry_run: bool,
}

impl Default for HardDeleteVideoOptions {
    fn default() -> Self {
        Self {
            retention_days: 30,
            dry_run: false,
        }
    }
}

/// summary of a video hard-deletion operation
#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct HardDeleteVideoSummary {
    pub videos_deleted: u32,
    pub seasons_deleted: u32,
    pub series_deleted: u32,
    pub total_records_deleted: u32,
    pub duration_ms: u64,
    pub cutoff_timestamp: i64,
}

impl HardDeleteVideoSummary {
    fn add_totals(&mut self) {
        self.total_records_deleted =
            self.videos_deleted + self.seasons_deleted + self.series_deleted;
    }
}

/// hard delete all old soft-deleted video records (videos, seasons, series),
/// cleaning up their side-table references. any media blobs this orphans
/// are reclaimed separately - see module docs.
pub async fn hard_delete_old_videos(
    options: HardDeleteVideoOptions,
) -> GrimoireResponse<HardDeleteVideoSummary> {
    match hard_delete_old_videos_internal(options).await {
        Ok(summary) => {
            GrimoireResponse::success("video hard delete completed successfully", summary)
        }
        Err(e) => GrimoireResponse::failure("video hard delete operation failed", vec![e.into()]),
    }
}

async fn hard_delete_old_videos_internal(
    options: HardDeleteVideoOptions,
) -> Result<HardDeleteVideoSummary, crate::error::GrimoireError> {
    let start_time = Instant::now();

    let current_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("time went backwards")
        .as_secs() as i64;
    let retention_seconds = (options.retention_days as i64) * 24 * 60 * 60;
    let cutoff_timestamp = current_time - retention_seconds;

    if options.dry_run {
        return dry_run_count(cutoff_timestamp).await;
    }

    let pool = database::connect().await?;

    let mut summary = HardDeleteVideoSummary {
        cutoff_timestamp,
        ..Default::default()
    };

    let mut tx = pool.begin().await?;

    // step 1: hard delete old videos
    let video_ids: Vec<String> = sqlx::query_scalar!(
        r#"SELECT id as "id!" FROM videoz WHERE deleted_at IS NOT NULL AND deleted_at < ?"#,
        cutoff_timestamp
    )
    .fetch_all(&mut *tx)
    .await?;

    for video_id in &video_ids {
        cleanup_video_entity_side_tables(&mut tx, VideoEntityType::Video, video_id).await?;
        sqlx::query!("DELETE FROM videoz WHERE id = ?", video_id)
            .execute(&mut *tx)
            .await?;
    }
    summary.videos_deleted = video_ids.len() as u32;

    // step 2: hard delete old video seasons (cascades to any lingering
    // videos still pointing at the season - normal deletion already
    // soft-deletes those videos alongside the season, so this is a
    // defensive catch-all, mirroring hard_delete.rs's album/artist cascade)
    let season_ids: Vec<String> = sqlx::query_scalar!(
        r#"SELECT id as "id!" FROM video_seasonz WHERE deleted_at IS NOT NULL AND deleted_at < ?"#,
        cutoff_timestamp
    )
    .fetch_all(&mut *tx)
    .await?;

    for season_id in &season_ids {
        let lingering_video_ids: Vec<String> = sqlx::query_scalar!(
            r#"SELECT id as "id!" FROM videoz WHERE season_id = ?"#,
            season_id
        )
        .fetch_all(&mut *tx)
        .await?;
        for video_id in &lingering_video_ids {
            cleanup_video_entity_side_tables(&mut tx, VideoEntityType::Video, video_id).await?;
            sqlx::query!("DELETE FROM videoz WHERE id = ?", video_id)
                .execute(&mut *tx)
                .await?;
            summary.videos_deleted += 1;
        }

        cleanup_video_entity_side_tables(&mut tx, VideoEntityType::VideoSeason, season_id).await?;
        sqlx::query!("DELETE FROM video_seasonz WHERE id = ?", season_id)
            .execute(&mut *tx)
            .await?;
    }
    summary.seasons_deleted = season_ids.len() as u32;

    // step 3: hard delete old video series (db-level ON DELETE CASCADE
    // already removes any remaining video_seasonz rows; videoz.series_id
    // is only ON DELETE SET NULL, so lingering videos need the same
    // defensive cleanup as step 2)
    let series_ids: Vec<String> = sqlx::query_scalar!(
        r#"SELECT id as "id!" FROM video_seriez WHERE deleted_at IS NOT NULL AND deleted_at < ?"#,
        cutoff_timestamp
    )
    .fetch_all(&mut *tx)
    .await?;

    for series_id in &series_ids {
        let lingering_video_ids: Vec<String> = sqlx::query_scalar!(
            r#"SELECT id as "id!" FROM videoz WHERE series_id = ?"#,
            series_id
        )
        .fetch_all(&mut *tx)
        .await?;
        for video_id in &lingering_video_ids {
            cleanup_video_entity_side_tables(&mut tx, VideoEntityType::Video, video_id).await?;
            sqlx::query!("DELETE FROM videoz WHERE id = ?", video_id)
                .execute(&mut *tx)
                .await?;
            summary.videos_deleted += 1;
        }

        cleanup_video_entity_side_tables(&mut tx, VideoEntityType::VideoSeries, series_id).await?;
        sqlx::query!("DELETE FROM video_seriez WHERE id = ?", series_id)
            .execute(&mut *tx)
            .await?;
    }
    summary.series_deleted = series_ids.len() as u32;

    tx.commit().await?;

    summary.duration_ms = start_time.elapsed().as_millis() as u64;
    summary.add_totals();

    Ok(summary)
}

/// remove every `entity_taxonz`/`entity_tagz`/`playlist_itemz`/
/// `playback_progressz`/`entity_imagez`/`user_favoritez`/`user_ratingz` row
/// for a single video-domain entity. any media blobs these tables (or the
/// entity row itself) referenced become unreferenced as a side effect and
/// are reclaimed by the separate, domain-agnostic blob purge pass.
async fn cleanup_video_entity_side_tables(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    entity_type: VideoEntityType,
    entity_id: &str,
) -> Result<(), sqlx::Error> {
    let entity_type_str = entity_type.as_str();

    sqlx::query!(
        "DELETE FROM entity_imagez WHERE entity_type = ? AND entity_id = ?",
        entity_type_str,
        entity_id
    )
    .execute(&mut **tx)
    .await?;

    sqlx::query!(
        "DELETE FROM entity_taxonz WHERE entity_type = ? AND entity_id = ?",
        entity_type_str,
        entity_id
    )
    .execute(&mut **tx)
    .await?;

    sqlx::query!(
        "DELETE FROM entity_tagz WHERE entity_type = ? AND entity_id = ?",
        entity_type_str,
        entity_id
    )
    .execute(&mut **tx)
    .await?;

    sqlx::query!(
        "DELETE FROM playlist_itemz WHERE entity_type = ? AND entity_id = ?",
        entity_type_str,
        entity_id
    )
    .execute(&mut **tx)
    .await?;

    sqlx::query!(
        "DELETE FROM playback_progressz WHERE entity_type = ? AND entity_id = ?",
        entity_type_str,
        entity_id
    )
    .execute(&mut **tx)
    .await?;

    sqlx::query!(
        "DELETE FROM user_favoritez WHERE target_type = ? AND target_id = ?",
        entity_type_str,
        entity_id
    )
    .execute(&mut **tx)
    .await?;

    sqlx::query!(
        "DELETE FROM user_ratingz WHERE target_type = ? AND target_id = ?",
        entity_type_str,
        entity_id
    )
    .execute(&mut **tx)
    .await?;

    Ok(())
}

async fn dry_run_count(
    cutoff_timestamp: i64,
) -> Result<HardDeleteVideoSummary, crate::error::GrimoireError> {
    let pool = database::connect().await?;
    let mut summary = HardDeleteVideoSummary {
        cutoff_timestamp,
        ..Default::default()
    };

    let videos = sqlx::query!(
        "SELECT COUNT(*) as count FROM videoz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        cutoff_timestamp
    )
    .fetch_one(&pool)
    .await?
    .count;
    summary.videos_deleted = videos as u32;

    let seasons = sqlx::query!(
        "SELECT COUNT(*) as count FROM video_seasonz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        cutoff_timestamp
    )
    .fetch_one(&pool)
    .await?
    .count;
    summary.seasons_deleted = seasons as u32;

    let series = sqlx::query!(
        "SELECT COUNT(*) as count FROM video_seriez WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        cutoff_timestamp
    )
    .fetch_one(&pool)
    .await?
    .count;
    summary.series_deleted = series as u32;

    summary.add_totals();
    Ok(summary)
}
