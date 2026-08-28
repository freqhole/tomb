//! delete + cross-cutting side-table cleanup for the video domain
//!
//! sqlite can't express a polymorphic FK on `(entity_type, entity_id)`, so
//! `entity_taxonz`/`entity_tagz`/`playlist_itemz`/`playback_progressz` have
//! no `ON DELETE CASCADE` tied to `videoz`/`video_seasonz`/`video_seriez`.
//! every delete path here explicitly cleans up its own rows in those
//! tables (mirroring how `delete_album` already cleans up `entity_urlz`
//! today), rather than relying on the db to do it.

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use zod_gen_derive::ZodSchema;

use super::entity_taxonz::VideoEntityType;
use crate::blob_data::purge_blob_if_orphaned;
use crate::database;
use crate::error::ErrorDetail;
use crate::media_blobz::list_renditions;
use crate::response::GrimoireResponse;
use crate::video::entities::{seasons, series, videos};

/// result of a bulk video delete operation
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct BulkDeleteVideosResponse {
    pub success: bool,
    pub message: String,
    pub deleted_count: u32,
    pub failed_ids: Vec<String>,
}

/// remove every `entity_taxonz`/`entity_tagz`/`playlist_itemz`/
/// `playback_progressz` row for a single entity. best-effort per table -
/// the first error is returned, but callers proceed with soft-deleting the
/// entity itself regardless (matching `delete_album`'s existing cascade
/// style).
async fn cleanup_entity_side_tables(
    pool: &SqlitePool,
    entity_type: VideoEntityType,
    entity_id: &str,
) -> sqlx::Result<()> {
    let entity_type_str = entity_type.as_str();

    sqlx::query!(
        "DELETE FROM entity_taxonz WHERE entity_type = ? AND entity_id = ?",
        entity_type_str,
        entity_id
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        "DELETE FROM entity_tagz WHERE entity_type = ? AND entity_id = ?",
        entity_type_str,
        entity_id
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        "DELETE FROM playlist_itemz WHERE entity_type = ? AND entity_id = ?",
        entity_type_str,
        entity_id
    )
    .execute(pool)
    .await?;

    sqlx::query!(
        "DELETE FROM playback_progressz WHERE entity_type = ? AND entity_id = ?",
        entity_type_str,
        entity_id
    )
    .execute(pool)
    .await?;

    Ok(())
}

/// best-effort purge of one now-possibly-orphaned blob - logs and
/// continues rather than failing the delete that triggered it. never
/// touches a user-owned library file (see `is_app_managed_file`).
async fn purge_blob_best_effort(blob_id: &str, deleted_by: Option<String>) {
    if let Err(e) = purge_blob_if_orphaned(blob_id, deleted_by).await {
        tracing::warn!(
            blob_id = %blob_id,
            error = %e,
            "failed to check/purge possibly-orphaned blob after video delete"
        );
    }
}

async fn purge_poster_if_present(poster_blob_id: Option<&str>, deleted_by: Option<String>) {
    if let Some(poster_blob_id) = poster_blob_id {
        purge_blob_best_effort(poster_blob_id, deleted_by).await;
    }
}

/// soft-delete a video and clean up its `entity_taxonz`/`playlist_itemz`/
/// `playback_progressz` rows, then best-effort purge its now-possibly-
/// orphaned media blob, poster, and renditions (app-generated/app-data-dir
/// files only - never a user's own library file).
pub async fn delete_video(id: &str, deleted_by: Option<String>) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // fetch blob ids before soft-deleting so we know what to check for
    // orphaning afterward.
    let blob_ids: Option<(String, Option<String>)> = sqlx::query!(
        r#"SELECT media_blob_id as "media_blob_id!", poster_blob_id FROM videoz WHERE id = ?"#,
        id
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten()
    .map(|row| (row.media_blob_id, row.poster_blob_id));

    let response = videos::delete_video(id, deleted_by.clone()).await;
    if !response.success {
        return response;
    }

    if let Err(e) = cleanup_entity_side_tables(&pool, VideoEntityType::Video, id).await {
        return GrimoireResponse::failure(
            "Video deleted, but failed to clean up related rows",
            vec![ErrorDetail::from(e)],
        );
    }

    if let Some((media_blob_id, poster_blob_id)) = blob_ids {
        if let Ok(renditions) = list_renditions(&media_blob_id).await {
            for rendition in renditions {
                purge_blob_best_effort(&rendition.id, deleted_by.clone()).await;
            }
        }
        purge_blob_best_effort(&media_blob_id, deleted_by.clone()).await;
        purge_poster_if_present(poster_blob_id.as_deref(), deleted_by).await;
    }

    GrimoireResponse::success_unit("Video deleted successfully")
}

/// soft-delete a video season, cascade-soft-delete every video in it, and
/// clean up `entity_taxonz`/`playlist_itemz`/`playback_progressz` rows for
/// the season and each of its videos.
pub async fn delete_video_season(
    season_id: &str,
    deleted_by: Option<String>,
) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let poster_blob_id: Option<String> = sqlx::query!(
        "SELECT poster_blob_id FROM video_seasonz WHERE id = ?",
        season_id
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten()
    .and_then(|row| row.poster_blob_id);

    let video_ids: Vec<String> = match sqlx::query_scalar!(
        r#"SELECT id as "id!" FROM videoz WHERE season_id = ? AND deleted_at IS NULL"#,
        season_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(ids) => ids,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to fetch season videos",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // reuse delete_video (rather than videos::delete_video directly) so
    // each video's own blob/rendition purge happens for free.
    for video_id in &video_ids {
        let response = delete_video(video_id, deleted_by.clone()).await;
        if !response.success {
            return response;
        }
    }

    let response = seasons::delete_video_season(season_id).await;
    if !response.success {
        return response;
    }

    if let Err(e) = cleanup_entity_side_tables(&pool, VideoEntityType::VideoSeason, season_id).await
    {
        return GrimoireResponse::failure(
            "Video season deleted, but failed to clean up related rows",
            vec![ErrorDetail::from(e)],
        );
    }

    purge_poster_if_present(poster_blob_id.as_deref(), deleted_by).await;

    GrimoireResponse::success_unit("Video season deleted successfully")
}

/// soft-delete a video series, cascade-soft-delete every season and video
/// under it, and clean up `entity_taxonz`/`playlist_itemz`/
/// `playback_progressz` rows for the series, each season, and each video.
pub async fn delete_video_series(
    series_id: &str,
    deleted_by: Option<String>,
) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let poster_blob_id: Option<String> = sqlx::query!(
        "SELECT poster_blob_id FROM video_seriez WHERE id = ?",
        series_id
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten()
    .and_then(|row| row.poster_blob_id);

    // every video attached to the series - season-grouped and season-less alike.
    let video_ids: Vec<String> = match sqlx::query_scalar!(
        r#"SELECT id as "id!" FROM videoz WHERE series_id = ? AND deleted_at IS NULL"#,
        series_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(ids) => ids,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to fetch series videos",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let season_ids: Vec<String> = match sqlx::query_scalar!(
        r#"SELECT id as "id!" FROM video_seasonz WHERE series_id = ? AND deleted_at IS NULL"#,
        series_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(ids) => ids,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to fetch series seasons",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // reuse delete_video so each video's own blob/rendition purge happens
    // for free; note video_ids already covers every video under the
    // series (season-grouped or not), so seasons below only need their
    // own row + poster handled, not another video pass.
    for video_id in &video_ids {
        let response = delete_video(video_id, deleted_by.clone()).await;
        if !response.success {
            return response;
        }
    }

    for season_id in &season_ids {
        let season_poster_blob_id: Option<String> = sqlx::query!(
            "SELECT poster_blob_id FROM video_seasonz WHERE id = ?",
            season_id
        )
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten()
        .and_then(|row| row.poster_blob_id);

        let response = seasons::delete_video_season(season_id).await;
        if !response.success {
            return response;
        }
        if let Err(e) =
            cleanup_entity_side_tables(&pool, VideoEntityType::VideoSeason, season_id).await
        {
            return GrimoireResponse::failure(
                "Series seasons deleted, but failed to clean up related rows",
                vec![ErrorDetail::from(e)],
            );
        }

        purge_poster_if_present(season_poster_blob_id.as_deref(), deleted_by.clone()).await;
    }

    let response = series::delete_video_series(series_id, deleted_by.clone()).await;
    if !response.success {
        return response;
    }

    if let Err(e) = cleanup_entity_side_tables(&pool, VideoEntityType::VideoSeries, series_id).await
    {
        return GrimoireResponse::failure(
            "Video series deleted, but failed to clean up related rows",
            vec![ErrorDetail::from(e)],
        );
    }

    purge_poster_if_present(poster_blob_id.as_deref(), deleted_by).await;

    GrimoireResponse::success_unit("Video series deleted successfully")
}

/// soft-delete a video series if no non-deleted video still references it -
/// mirrors music's `delete_artist_if_unused`. returns `Ok(true)` if the
/// series was deleted, `Ok(false)` if it's still in use.
pub async fn delete_video_series_if_unused(series_id: &str) -> GrimoireResponse<bool> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let video_count = match sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM videoz WHERE series_id = ? AND deleted_at IS NULL"#,
        series_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(c) => c,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to check video series usage",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    if video_count > 0 {
        return GrimoireResponse::success("Video series is still in use", false);
    }

    let poster_blob_id: Option<String> = sqlx::query!(
        "SELECT poster_blob_id FROM video_seriez WHERE id = ?",
        series_id
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten()
    .and_then(|row| row.poster_blob_id);

    match sqlx::query!(
        "UPDATE video_seriez SET deleted_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND deleted_at IS NULL",
        series_id
    )
    .execute(&pool)
    .await
    {
        Ok(_) => {
            purge_poster_if_present(poster_blob_id.as_deref(), None).await;
            GrimoireResponse::success("Video series deleted successfully", true)
        }
        Err(e) => {
            GrimoireResponse::failure("Failed to delete video series", vec![ErrorDetail::from(e)])
        }
    }
}

/// soft-delete a video season if no non-deleted video still references it -
/// mirrors `delete_video_series_if_unused` one level down.
pub async fn delete_video_season_if_unused(season_id: &str) -> GrimoireResponse<bool> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let video_count = match sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM videoz WHERE season_id = ? AND deleted_at IS NULL"#,
        season_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(c) => c,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to check video season usage",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    if video_count > 0 {
        return GrimoireResponse::success("Video season is still in use", false);
    }

    let poster_blob_id: Option<String> = sqlx::query!(
        "SELECT poster_blob_id FROM video_seasonz WHERE id = ?",
        season_id
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten()
    .and_then(|row| row.poster_blob_id);

    match sqlx::query!(
        "UPDATE video_seasonz SET deleted_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND deleted_at IS NULL",
        season_id
    )
    .execute(&pool)
    .await
    {
        Ok(_) => {
            purge_poster_if_present(poster_blob_id.as_deref(), None).await;
            GrimoireResponse::success("Video season deleted successfully", true)
        }
        Err(e) => {
            GrimoireResponse::failure("Failed to delete video season", vec![ErrorDetail::from(e)])
        }
    }
}

/// bulk soft-delete videos (each via `delete_video`, so side-table cleanup
/// happens per id). best-effort - a failed id is recorded but doesn't stop
/// the rest from being deleted, mirroring `bulk_delete_songs`.
pub async fn bulk_delete_videos(
    video_ids: Vec<String>,
    deleted_by: Option<String>,
) -> BulkDeleteVideosResponse {
    let mut deleted_count: u32 = 0;
    let mut failed_ids = Vec::new();

    for video_id in video_ids {
        let response = delete_video(&video_id, deleted_by.clone()).await;
        if response.success {
            deleted_count += 1;
        } else {
            failed_ids.push(video_id);
        }
    }

    let success = failed_ids.is_empty();
    let message = if success {
        format!("deleted {} video(s)", deleted_count)
    } else {
        format!(
            "deleted {} video(s), {} failed",
            deleted_count,
            failed_ids.len()
        )
    };

    BulkDeleteVideosResponse {
        success,
        message,
        deleted_count,
        failed_ids,
    }
}
