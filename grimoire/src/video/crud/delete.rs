//! delete + cross-cutting side-table cleanup for the video domain
//!
//! sqlite can't express a polymorphic FK on `(entity_type, entity_id)`, so
//! `entity_taxonz`/`playlist_itemz`/`playback_progressz` have no
//! `ON DELETE CASCADE` tied to `videoz`/`video_seasonz`/`video_seriez`.
//! every delete path here explicitly cleans up its own rows in those
//! tables (mirroring how `delete_album` already cleans up `entity_urlz`
//! today), rather than relying on the db to do it.

use sqlx::SqlitePool;

use super::entity_taxonz::VideoEntityType;
use crate::database;
use crate::error::ErrorDetail;
use crate::response::GrimoireResponse;
use crate::video::entities::{seasons, series, videos};

/// remove every `entity_taxonz`/`playlist_itemz`/`playback_progressz` row
/// for a single entity. best-effort per table - the first error is
/// returned, but callers proceed with soft-deleting the entity itself
/// regardless (matching `delete_album`'s existing cascade style).
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

/// soft-delete a video and clean up its `entity_taxonz`/`playlist_itemz`/
/// `playback_progressz` rows.
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

    let response = videos::delete_video(id, deleted_by).await;
    if !response.success {
        return response;
    }

    if let Err(e) = cleanup_entity_side_tables(&pool, VideoEntityType::Video, id).await {
        return GrimoireResponse::failure(
            "Video deleted, but failed to clean up related rows",
            vec![ErrorDetail::from(e)],
        );
    }

    GrimoireResponse::success_unit("Video deleted successfully")
}

/// soft-delete a video season, cascade-soft-delete every video in it, and
/// clean up `entity_taxonz`/`playlist_itemz`/`playback_progressz` rows for
/// the season and each of its videos.
pub async fn delete_video_season(season_id: &str, deleted_by: Option<String>) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

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

    for video_id in &video_ids {
        let response = videos::delete_video(video_id, deleted_by.clone()).await;
        if !response.success {
            return response;
        }
        if let Err(e) =
            cleanup_entity_side_tables(&pool, VideoEntityType::Video, video_id).await
        {
            return GrimoireResponse::failure(
                "Season videos deleted, but failed to clean up related rows",
                vec![ErrorDetail::from(e)],
            );
        }
    }

    let response = seasons::delete_video_season(season_id).await;
    if !response.success {
        return response;
    }

    if let Err(e) =
        cleanup_entity_side_tables(&pool, VideoEntityType::VideoSeason, season_id).await
    {
        return GrimoireResponse::failure(
            "Video season deleted, but failed to clean up related rows",
            vec![ErrorDetail::from(e)],
        );
    }

    GrimoireResponse::success_unit("Video season deleted successfully")
}

/// soft-delete a video series, cascade-soft-delete every season and video
/// under it, and clean up `entity_taxonz`/`playlist_itemz`/
/// `playback_progressz` rows for the series, each season, and each video.
pub async fn delete_video_series(series_id: &str, deleted_by: Option<String>) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

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

    for video_id in &video_ids {
        let response = videos::delete_video(video_id, deleted_by.clone()).await;
        if !response.success {
            return response;
        }
        if let Err(e) =
            cleanup_entity_side_tables(&pool, VideoEntityType::Video, video_id).await
        {
            return GrimoireResponse::failure(
                "Series videos deleted, but failed to clean up related rows",
                vec![ErrorDetail::from(e)],
            );
        }
    }

    for season_id in &season_ids {
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
    }

    let response = series::delete_video_series(series_id, deleted_by).await;
    if !response.success {
        return response;
    }

    if let Err(e) =
        cleanup_entity_side_tables(&pool, VideoEntityType::VideoSeries, series_id).await
    {
        return GrimoireResponse::failure(
            "Video series deleted, but failed to clean up related rows",
            vec![ErrorDetail::from(e)],
        );
    }

    GrimoireResponse::success_unit("Video series deleted successfully")
}
