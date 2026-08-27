//! video series service functions
//! clean business logic using sqlx::query_as! with no fallbacks
//!
//! `delete_video_series` here only soft-deletes the `video_seriez` row
//! itself. the cascading workflow that also soft-deletes child
//! seasons/videos and cleans up `entity_taxonz`/`playlist_itemz`/
//! `playback_progressz` rows lives in `crate::video::crud::delete`.

use super::models::{CreateVideoSeriesRequest, UpdateVideoSeriesRequest, VideoSeries};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::response::GrimoireResponse;

/// create a new video series
pub async fn create_video_series(req: CreateVideoSeriesRequest) -> GrimoireResponse<VideoSeries> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let series = match sqlx::query_as!(
        VideoSeries,
        r#"INSERT INTO video_seriez (title, description, poster_blob_id, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?)
         RETURNING
            id as "id!",
            title as "title!",
            description,
            poster_blob_id,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            created_by,
            updated_by,
            deleted_by"#,
        req.title,
        req.description,
        req.poster_blob_id,
        req.created_by,
        req.created_by
    )
    .fetch_one(&pool)
    .await
    {
        Ok(s) => s,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to create video series",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Video series created successfully", series)
}

/// find a video series by exact (case-insensitive) title match - used by
/// the yt-dlp series-detection importer path to resolve a filename-parsed
/// series name against an existing series before creating a new one.
pub async fn find_video_series_by_title(title: &str) -> GrimoireResponse<Option<VideoSeries>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let series_opt = match sqlx::query_as!(
        VideoSeries,
        r#"SELECT
            id as "id!",
            title as "title!",
            description,
            poster_blob_id,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            created_by,
            updated_by,
            deleted_by
         FROM video_seriez
         WHERE title = ? COLLATE NOCASE AND deleted_at IS NULL
         LIMIT 1"#,
        title
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(opt) => opt,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to find video series by title",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Video series lookup completed", series_opt)
}

/// find an existing series by (case-insensitive) title, or create one -
/// the review-flow counterpart to `create_video_series` that lets an
/// uploader without curation permissions introduce a brand new series as
/// part of reviewing their own import, without going through that
/// admin-gated route (see `offal::video::import_review::move_video`).
pub async fn find_or_create_video_series(
    title: &str,
    created_by: Option<String>,
) -> GrimoireResponse<VideoSeries> {
    match find_video_series_by_title(title).await {
        GrimoireResponse {
            success: true,
            data: Some(Some(existing)),
            ..
        } => GrimoireResponse::success("Video series lookup completed", existing),
        GrimoireResponse {
            success: true,
            data: Some(None),
            ..
        } => {
            create_video_series(CreateVideoSeriesRequest {
                title: title.to_string(),
                description: None,
                poster_blob_id: None,
                created_by,
            })
            .await
        }
        response => GrimoireResponse::failure("failed to look up video series", response.errors),
    }
}

/// get video series by id
pub async fn get_video_series(id: &str) -> GrimoireResponse<VideoSeries> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let series_opt = match sqlx::query_as!(
        VideoSeries,
        r#"SELECT
            id as "id!",
            title as "title!",
            description,
            poster_blob_id,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            created_by,
            updated_by,
            deleted_by
         FROM video_seriez
         WHERE id = ? AND deleted_at IS NULL"#,
        id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(opt) => opt,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to get video series",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    match series_opt {
        Some(series) => GrimoireResponse::success("Video series retrieved successfully", series),
        None => {
            let err = GrimoireError::VideoSeriesNotFound { id: id.to_string() };
            GrimoireResponse::failure("Video series not found", vec![ErrorDetail::from(&err)])
        }
    }
}

/// list all video series (non-deleted only)
pub async fn list_video_seriez(
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResponse<Vec<VideoSeries>> {
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

    let series = match sqlx::query_as!(
        VideoSeries,
        r#"SELECT
            id as "id!",
            title as "title!",
            description,
            poster_blob_id,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            created_by,
            updated_by,
            deleted_by
         FROM video_seriez
         WHERE deleted_at IS NULL
         ORDER BY title ASC
         LIMIT ? OFFSET ?"#,
        limit,
        offset
    )
    .fetch_all(&pool)
    .await
    {
        Ok(series) => series,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to list video series",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Video series retrieved successfully", series)
}

/// update a video series
pub async fn update_video_series(req: UpdateVideoSeriesRequest) -> GrimoireResponse<VideoSeries> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let series = match sqlx::query_as!(
        VideoSeries,
        r#"UPDATE video_seriez
            SET title = COALESCE(?, title),
                description = COALESCE(?, description),
                poster_blob_id = COALESCE(?, poster_blob_id),
                updated_by = COALESCE(?, updated_by),
                updated_at = unixepoch()
            WHERE id = ? AND deleted_at IS NULL
            RETURNING
                id as "id!",
                title as "title!",
                description,
                poster_blob_id,
                created_at as "created_at!",
                updated_at as "updated_at!",
                deleted_at,
                created_by,
                updated_by,
                deleted_by"#,
        req.title,
        req.description,
        req.poster_blob_id,
        req.updated_by,
        req.series_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(s)) => s,
        Ok(None) => {
            let err = GrimoireError::VideoSeriesNotFound {
                id: req.series_id.clone(),
            };
            return GrimoireResponse::failure(
                "Video series not found",
                vec![ErrorDetail::from(&err)],
            );
        }
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to update video series",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Video series updated successfully", series)
}

/// soft delete a video series row only - does not cascade to child
/// seasons/videos or clean up `entity_taxonz`/`playlist_itemz`/
/// `playback_progressz`. see `crate::video::crud::delete` for the full
/// cascading workflow.
pub async fn delete_video_series(id: &str, deleted_by: Option<String>) -> GrimoireResponse<()> {
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
        "UPDATE video_seriez SET deleted_at = unixepoch(), deleted_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => result.rows_affected(),
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to delete video series",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    if rows_affected == 0 {
        let err = GrimoireError::VideoSeriesNotFound { id: id.to_string() };
        return GrimoireResponse::failure("Video series not found", vec![ErrorDetail::from(&err)]);
    }

    GrimoireResponse::success_unit("Video series deleted successfully")
}
