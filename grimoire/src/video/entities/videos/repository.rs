//! video service functions
//! clean business logic using sqlx::query_as! with no fallbacks
//!
//! `delete_video` here only soft-deletes the `videoz` row itself. the
//! cascading workflow that also cleans up `entity_taxonz`/`playlist_itemz`/
//! `playback_progressz` rows lives in `crate::video::crud::delete`.

use super::models::{CreateVideoRequest, UpdateVideoRequest, Video};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::music::crud::ImageMetadata;
use crate::response::GrimoireResponse;
use crate::JsonVec;

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
            deleted_by,
            '[]' as "images: JsonVec<ImageMetadata>""#,
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
            deleted_by,
            (SELECT COALESCE(json_group_array(json_object('blob_id', media_blob_id, 'is_primary', is_primary, 'blob_type', blob_type)), '[]')
             FROM (SELECT media_blob_id, is_primary, blob_type FROM entity_imagez
                   WHERE entity_type = 'video' AND entity_id = videoz.id
                   ORDER BY is_primary DESC, created_at DESC)) as "images: JsonVec<ImageMetadata>"
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

/// get video by id with enriched media blob metadata
pub async fn get_video_with_metadata(
    id: &str,
) -> GrimoireResponse<crate::video::VideoWithMetadata> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // join videoz with media_blobz and userz to get enriched data
    #[derive(sqlx::FromRow)]
    struct QueryRow {
        video_id: String,
        series_id: Option<String>,
        season_id: Option<String>,
        episode_number: Option<i64>,
        video_title: String,
        description: Option<String>,
        media_blob_id: String,
        poster_blob_id: Option<String>,
        duration_seconds: Option<f64>,
        release_date: Option<String>,
        video_created_at: i64,
        video_updated_at: i64,
        deleted_at: Option<i64>,
        created_by: Option<String>,
        updated_by: Option<String>,
        deleted_by: Option<String>,
        blob_size: Option<i64>,
        blob_width: Option<i64>,
        blob_height: Option<i64>,
        blob_metadata: String,
        created_by_username: Option<String>,
        updated_by_username: Option<String>,
        images: String,
    }

    let result = sqlx::query_as::<_, QueryRow>(
        r#"SELECT
            v.id as video_id,
            v.series_id,
            v.season_id,
            v.episode_number,
            v.title as video_title,
            v.description,
            v.media_blob_id,
            v.poster_blob_id,
            v.duration_seconds,
            v.release_date,
            v.created_at as video_created_at,
            v.updated_at as video_updated_at,
            v.deleted_at,
            v.created_by,
            v.updated_by,
            v.deleted_by,
            b.size as blob_size,
            b.width as blob_width,
            b.height as blob_height,
            COALESCE(b.metadata, '{}') as blob_metadata,
            cu.username as created_by_username,
            uu.username as updated_by_username,
            COALESCE((SELECT json_group_array(json_object('blob_id', media_blob_id, 'is_primary', is_primary, 'blob_type', blob_type))
             FROM (SELECT media_blob_id, is_primary, blob_type FROM entity_imagez
                   WHERE entity_type = 'video' AND entity_id = v.id
                   ORDER BY is_primary DESC, created_at DESC)), '[]') as images
         FROM videoz v
         LEFT JOIN media_blobz b ON v.media_blob_id = b.id
         LEFT JOIN userz cu ON v.created_by = cu.id
         LEFT JOIN userz uu ON v.updated_by = uu.id
         WHERE v.id = ? AND v.deleted_at IS NULL"#,
    )
    .bind(id)
    .fetch_optional(&pool)
    .await;

    let row = match result {
        Ok(Some(r)) => r,
        Ok(None) => {
            let err = GrimoireError::VideoNotFound { id: id.to_string() };
            return GrimoireResponse::failure("Video not found", vec![ErrorDetail::from(&err)]);
        }
        Err(e) => {
            return GrimoireResponse::failure("Failed to get video", vec![ErrorDetail::from(e)])
        }
    };

    // parse metadata JSON to extract codec/container/bitrate/frame_rate
    let metadata: serde_json::Value = serde_json::from_str(&row.blob_metadata).unwrap_or_default();
    let codec = metadata
        .get("codec")
        .and_then(|c| c.as_str())
        .map(|s| s.to_string());
    let container = metadata
        .get("container")
        .and_then(|c| c.as_str())
        .map(|s| s.to_string());
    let bitrate = metadata.get("bitrate").and_then(|b| b.as_i64());
    let frame_rate = metadata.get("frame_rate").and_then(|f| f.as_f64());

    let images: Vec<ImageMetadata> = serde_json::from_str(&row.images).unwrap_or_default();

    let video = Video {
        id: row.video_id,
        series_id: row.series_id,
        season_id: row.season_id,
        episode_number: row.episode_number,
        title: row.video_title,
        description: row.description,
        media_blob_id: row.media_blob_id,
        poster_blob_id: row.poster_blob_id,
        duration_seconds: row.duration_seconds,
        release_date: row.release_date,
        created_at: row.video_created_at,
        updated_at: row.video_updated_at,
        deleted_at: row.deleted_at,
        created_by: row.created_by,
        updated_by: row.updated_by,
        deleted_by: row.deleted_by,
        images: Some(JsonVec(images)),
    };

    let video_with_metadata = crate::video::VideoWithMetadata {
        video,
        created_by_username: row.created_by_username,
        updated_by_username: row.updated_by_username,
        blob_size: row.blob_size,
        blob_width: row.blob_width,
        blob_height: row.blob_height,
        codec,
        container,
        bitrate,
        frame_rate,
    };

    GrimoireResponse::success("Video retrieved successfully", video_with_metadata)
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
            deleted_by,
            (SELECT COALESCE(json_group_array(json_object('blob_id', media_blob_id, 'is_primary', is_primary, 'blob_type', blob_type)), '[]')
             FROM (SELECT media_blob_id, is_primary, blob_type FROM entity_imagez
                   WHERE entity_type = 'video' AND entity_id = videoz.id
                   ORDER BY is_primary DESC, created_at DESC)) as "images: JsonVec<ImageMetadata>"
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
            deleted_by,
            (SELECT COALESCE(json_group_array(json_object('blob_id', media_blob_id, 'is_primary', is_primary, 'blob_type', blob_type)), '[]')
             FROM (SELECT media_blob_id, is_primary, blob_type FROM entity_imagez
                   WHERE entity_type = 'video' AND entity_id = videoz.id
                   ORDER BY is_primary DESC, created_at DESC)) as "images: JsonVec<ImageMetadata>"
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
            deleted_by,
            (SELECT COALESCE(json_group_array(json_object('blob_id', media_blob_id, 'is_primary', is_primary, 'blob_type', blob_type)), '[]')
             FROM (SELECT media_blob_id, is_primary, blob_type FROM entity_imagez
                   WHERE entity_type = 'video' AND entity_id = videoz.id
                   ORDER BY is_primary DESC, created_at DESC)) as "images: JsonVec<ImageMetadata>"
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
                deleted_by,
                '[]' as "images: JsonVec<ImageMetadata>""#,
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
