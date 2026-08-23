//! video service functions
//! clean business logic using sqlx::query_as! with no fallbacks
//!
//! `delete_video` here only soft-deletes the `videoz` row itself. the
//! cascading workflow that also cleans up `entity_taxonz`/`playlist_itemz`/
//! `playback_progressz` rows lives in `crate::video::crud::delete`.

use super::models::{CreateVideoRequest, UpdateVideoRequest, Video};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::response::GrimoireResponse;

/// create a new video
pub async fn create_video(req: CreateVideoRequest) -> GrimoireResponse<Video> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let video = match sqlx::query_as!(
        Video,
        r#"INSERT INTO videoz (
            series_id, season_id, episode_number, title, description, media_blob_id,
            poster_blob_id, duration_seconds, release_date, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING
            id as "id!",
            series_id,
            season_id,
            episode_number,
            title as "title!",
            description,
            media_blob_id as "media_blob_id!",
            poster_blob_id,
            duration_seconds,
            release_date,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            created_by,
            updated_by,
            deleted_by"#,
        req.series_id,
        req.season_id,
        req.episode_number,
        req.title,
        req.description,
        req.media_blob_id,
        req.poster_blob_id,
        req.duration_seconds,
        req.release_date,
        req.created_by,
        req.created_by
    )
    .fetch_one(&pool)
    .await
    {
        Ok(v) => v,
        Err(e) => {
            let err_str = e.to_string();
            if err_str.contains("UNIQUE constraint failed: videoz.media_blob_id") {
                return GrimoireResponse::failure(
                    "duplicate video",
                    vec![ErrorDetail::new(
                        "duplicate_video",
                        "Duplicate Video",
                        format!("a video already exists with blob_id {}", req.media_blob_id),
                    )],
                );
            }
            return GrimoireResponse::failure("Failed to create video", vec![ErrorDetail::from(e)]);
        }
    };

    GrimoireResponse::success("Video created successfully", video)
}

/// get video by id
pub async fn get_video(id: &str) -> GrimoireResponse<Video> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let video_opt = match sqlx::query_as!(
        Video,
        r#"SELECT
            id as "id!",
            series_id,
            season_id,
            episode_number,
            title as "title!",
            description,
            media_blob_id as "media_blob_id!",
            poster_blob_id,
            duration_seconds,
            release_date,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            created_by,
            updated_by,
            deleted_by
         FROM videoz
         WHERE id = ? AND deleted_at IS NULL"#,
        id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(opt) => opt,
        Err(e) => {
            return GrimoireResponse::failure("Failed to get video", vec![ErrorDetail::from(e)])
        }
    };

    match video_opt {
        Some(video) => GrimoireResponse::success("Video retrieved successfully", video),
        None => {
            let err = GrimoireError::VideoNotFound { id: id.to_string() };
            GrimoireResponse::failure("Video not found", vec![ErrorDetail::from(&err)])
        }
    }
}

/// list every video attached to a series (both season-grouped and
/// season-less episodes), non-deleted only
pub async fn list_videos_by_series(series_id: &str) -> GrimoireResponse<Vec<Video>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let videos = match sqlx::query_as!(
        Video,
        r#"SELECT
            id as "id!",
            series_id,
            season_id,
            episode_number,
            title as "title!",
            description,
            media_blob_id as "media_blob_id!",
            poster_blob_id,
            duration_seconds,
            release_date,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            created_by,
            updated_by,
            deleted_by
         FROM videoz
         WHERE series_id = ? AND deleted_at IS NULL
         ORDER BY episode_number ASC, created_at ASC"#,
        series_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(videos) => videos,
        Err(e) => {
            return GrimoireResponse::failure("Failed to list videos", vec![ErrorDetail::from(e)])
        }
    };

    GrimoireResponse::success("Videos retrieved successfully", videos)
}

/// list every video in a season, non-deleted only
pub async fn list_videos_by_season(season_id: &str) -> GrimoireResponse<Vec<Video>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let videos = match sqlx::query_as!(
        Video,
        r#"SELECT
            id as "id!",
            series_id,
            season_id,
            episode_number,
            title as "title!",
            description,
            media_blob_id as "media_blob_id!",
            poster_blob_id,
            duration_seconds,
            release_date,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            created_by,
            updated_by,
            deleted_by
         FROM videoz
         WHERE season_id = ? AND deleted_at IS NULL
         ORDER BY episode_number ASC, created_at ASC"#,
        season_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(videos) => videos,
        Err(e) => {
            return GrimoireResponse::failure("Failed to list videos", vec![ErrorDetail::from(e)])
        }
    };

    GrimoireResponse::success("Videos retrieved successfully", videos)
}

/// list standalone videos (no series at all - movies/clips), non-deleted only
pub async fn list_videos_unattached(
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResponse<Vec<Video>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };
    let limit = limit.unwrap_or(100).min(1000) as i64;
    let offset = offset.unwrap_or(0) as i64;

    let videos = match sqlx::query_as!(
        Video,
        r#"SELECT
            id as "id!",
            series_id,
            season_id,
            episode_number,
            title as "title!",
            description,
            media_blob_id as "media_blob_id!",
            poster_blob_id,
            duration_seconds,
            release_date,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            created_by,
            updated_by,
            deleted_by
         FROM videoz
         WHERE series_id IS NULL AND deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?"#,
        limit,
        offset
    )
    .fetch_all(&pool)
    .await
    {
        Ok(videos) => videos,
        Err(e) => {
            return GrimoireResponse::failure("Failed to list videos", vec![ErrorDetail::from(e)])
        }
    };

    GrimoireResponse::success("Videos retrieved successfully", videos)
}

/// update a video
pub async fn update_video(req: UpdateVideoRequest) -> GrimoireResponse<Video> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let video = match sqlx::query_as!(
        Video,
        r#"UPDATE videoz
            SET series_id = COALESCE(?, series_id),
                season_id = COALESCE(?, season_id),
                episode_number = COALESCE(?, episode_number),
                title = COALESCE(?, title),
                description = COALESCE(?, description),
                poster_blob_id = COALESCE(?, poster_blob_id),
                duration_seconds = COALESCE(?, duration_seconds),
                release_date = COALESCE(?, release_date),
                updated_by = COALESCE(?, updated_by),
                updated_at = unixepoch()
            WHERE id = ? AND deleted_at IS NULL
            RETURNING
                id as "id!",
                series_id,
                season_id,
                episode_number,
                title as "title!",
                description,
                media_blob_id as "media_blob_id!",
                poster_blob_id,
                duration_seconds,
                release_date,
                created_at as "created_at!",
                updated_at as "updated_at!",
                deleted_at,
                created_by,
                updated_by,
                deleted_by"#,
        req.series_id,
        req.season_id,
        req.episode_number,
        req.title,
        req.description,
        req.poster_blob_id,
        req.duration_seconds,
        req.release_date,
        req.updated_by,
        req.video_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(v)) => v,
        Ok(None) => {
            let err = GrimoireError::VideoNotFound {
                id: req.video_id.clone(),
            };
            return GrimoireResponse::failure("Video not found", vec![ErrorDetail::from(&err)]);
        }
        Err(e) => {
            return GrimoireResponse::failure("Failed to update video", vec![ErrorDetail::from(e)])
        }
    };

    GrimoireResponse::success("Video updated successfully", video)
}

/// soft delete a video row only - does not clean up `entity_taxonz`/
/// `playlist_itemz`/`playback_progressz`. see `crate::video::crud::delete`
/// for the full cascading workflow.
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

    let rows_affected = match sqlx::query!(
        "UPDATE videoz SET deleted_at = unixepoch(), deleted_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => result.rows_affected(),
        Err(e) => {
            return GrimoireResponse::failure("Failed to delete video", vec![ErrorDetail::from(e)])
        }
    };

    if rows_affected == 0 {
        let err = GrimoireError::VideoNotFound { id: id.to_string() };
        return GrimoireResponse::failure("Video not found", vec![ErrorDetail::from(&err)]);
    }

    GrimoireResponse::success_unit("Video deleted successfully")
}
