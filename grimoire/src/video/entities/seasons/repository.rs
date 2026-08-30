//! video season service functions
//! clean business logic using sqlx::query_as! with no fallbacks
//!
//! `delete_video_season` here only soft-deletes the `video_seasonz` row
//! itself. the cascading workflow that also soft-deletes child videos and
//! cleans up `entity_taxonz`/`playlist_itemz`/`playback_progressz` rows
//! lives in `crate::video::crud::delete`.

use super::models::{CreateVideoSeasonRequest, UpdateVideoSeasonRequest, VideoSeason};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::response::GrimoireResponse;

/// create a new video season
pub async fn create_video_season(req: CreateVideoSeasonRequest) -> GrimoireResponse<VideoSeason> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let season = match sqlx::query_as!(
        VideoSeason,
        r#"INSERT INTO video_seasonz (series_id, season_number, title, description, poster_blob_id)
         VALUES (?, ?, ?, ?, ?)
         RETURNING
            id as "id!",
            series_id as "series_id!",
            season_number as "season_number!",
            title,
            description,
            poster_blob_id,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at"#,
        req.series_id,
        req.season_number,
        req.title,
        req.description,
        req.poster_blob_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(s) => s,
        Err(e) => {
            let err_str = e.to_string();
            if err_str.contains(
                "UNIQUE constraint failed: video_seasonz.series_id, video_seasonz.season_number",
            ) {
                return GrimoireResponse::failure(
                    "duplicate season",
                    vec![ErrorDetail::new(
                        "duplicate_video_season",
                        "Duplicate Video Season",
                        format!(
                            "season {} already exists for series {}",
                            req.season_number, req.series_id
                        ),
                    )],
                );
            }
            return GrimoireResponse::failure(
                "Failed to create video season",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    GrimoireResponse::success("Video season created successfully", season)
}

/// find a video season by its (series_id, season_number) pair - used by
/// the yt-dlp series-detection importer path to resolve a filename-parsed
/// season number against an existing season before creating a new one.
pub async fn find_video_season_by_number(
    series_id: &str,
    season_number: i64,
) -> GrimoireResponse<Option<VideoSeason>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let season_opt = match sqlx::query_as!(
        VideoSeason,
        r#"SELECT
            id as "id!",
            series_id as "series_id!",
            season_number as "season_number!",
            title,
            description,
            poster_blob_id,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at
         FROM video_seasonz
         WHERE series_id = ? AND season_number = ? AND deleted_at IS NULL
         LIMIT 1"#,
        series_id,
        season_number
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(opt) => opt,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to find video season by number",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Video season lookup completed", season_opt)
}

/// find an existing (series_id, season_number) season, or create one - the
/// review-flow counterpart to `create_video_season` that lets an uploader
/// without curation permissions introduce a brand new season as part of
/// reviewing their own import, without going through that admin-gated
/// route (see `offal::video::import_review`).
pub async fn find_or_create_video_season(
    series_id: &str,
    season_number: i64,
    title: Option<String>,
) -> GrimoireResponse<VideoSeason> {
    match find_video_season_by_number(series_id, season_number).await {
        GrimoireResponse {
            success: true,
            data: Some(Some(existing)),
            ..
        } => GrimoireResponse::success("Video season lookup completed", existing),
        GrimoireResponse {
            success: true,
            data: Some(None),
            ..
        } => {
            create_video_season(CreateVideoSeasonRequest {
                series_id: series_id.to_string(),
                season_number,
                title,
                description: None,
                poster_blob_id: None,
            })
            .await
        }
        response => GrimoireResponse::failure("failed to look up video season", response.errors),
    }
}

/// get video season by id
pub async fn get_video_season(id: &str) -> GrimoireResponse<VideoSeason> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let season_opt = match sqlx::query_as!(
        VideoSeason,
        r#"SELECT
            id as "id!",
            series_id as "series_id!",
            season_number as "season_number!",
            title,
            description,
            poster_blob_id,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at
         FROM video_seasonz
         WHERE id = ? AND deleted_at IS NULL"#,
        id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(opt) => opt,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to get video season",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    match season_opt {
        Some(season) => GrimoireResponse::success("Video season retrieved successfully", season),
        None => {
            let err = GrimoireError::VideoSeasonNotFound { id: id.to_string() };
            GrimoireResponse::failure("Video season not found", vec![ErrorDetail::from(&err)])
        }
    }
}

/// list every season in a series, ordered by season number, non-deleted only
/// list seasons. `series_id = Some(id)` scopes to one series (the
/// original per-series usage); `None` returns every non-deleted season
/// in the library in one call, ordered by series then season number -
/// used by graph viz bulk loading so it doesn't have to make one
/// `list_video_seasons` round trip per series (see
/// docs/graph-viz-video-domain-plan.md).
pub async fn list_video_seasons(series_id: Option<&str>) -> GrimoireResponse<Vec<VideoSeason>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let seasons = match sqlx::query_as!(
        VideoSeason,
        r#"SELECT
            id as "id!",
            series_id as "series_id!",
            season_number as "season_number!",
            title,
            description,
            poster_blob_id,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at
         FROM video_seasonz
         WHERE deleted_at IS NULL
           AND (?1 IS NULL OR series_id = ?1)
         ORDER BY series_id ASC, season_number ASC"#,
        series_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(seasons) => seasons,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to list video seasons",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Video seasons retrieved successfully", seasons)
}

/// update a video season
pub async fn update_video_season(req: UpdateVideoSeasonRequest) -> GrimoireResponse<VideoSeason> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let season = match sqlx::query_as!(
        VideoSeason,
        r#"UPDATE video_seasonz
            SET season_number = COALESCE(?, season_number),
                title = COALESCE(?, title),
                description = COALESCE(?, description),
                poster_blob_id = COALESCE(?, poster_blob_id),
                updated_at = unixepoch()
            WHERE id = ? AND deleted_at IS NULL
            RETURNING
                id as "id!",
                series_id as "series_id!",
                season_number as "season_number!",
                title,
                description,
                poster_blob_id,
                created_at as "created_at!",
                updated_at as "updated_at!",
                deleted_at"#,
        req.season_number,
        req.title,
        req.description,
        req.poster_blob_id,
        req.season_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(s)) => s,
        Ok(None) => {
            let err = GrimoireError::VideoSeasonNotFound {
                id: req.season_id.clone(),
            };
            return GrimoireResponse::failure(
                "Video season not found",
                vec![ErrorDetail::from(&err)],
            );
        }
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to update video season",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Video season updated successfully", season)
}

/// soft delete a video season row only - does not cascade to child videos
/// or clean up `entity_taxonz`/`playlist_itemz`/`playback_progressz`. see
/// `crate::video::crud::delete` for the full cascading workflow.
pub async fn delete_video_season(id: &str) -> GrimoireResponse<()> {
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
        "UPDATE video_seasonz SET deleted_at = unixepoch() WHERE id = ? AND deleted_at IS NULL",
        id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => result.rows_affected(),
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to delete video season",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    if rows_affected == 0 {
        let err = GrimoireError::VideoSeasonNotFound { id: id.to_string() };
        return GrimoireResponse::failure("Video season not found", vec![ErrorDetail::from(&err)]);
    }

    GrimoireResponse::success_unit("Video season deleted successfully")
}
