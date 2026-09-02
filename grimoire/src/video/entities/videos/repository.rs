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

    // defaults content_type to "series" when series_id is set, else "movie",
    // if the caller didn't specify one.
    let content_type = req.content_type.clone().unwrap_or_else(|| {
        if req.series_id.is_some() {
            "series".to_string()
        } else {
            "movie".to_string()
        }
    });

    let video = match sqlx::query_as!(
        Video,
        r#"INSERT INTO videoz (
            series_id, season_id, episode_number, content_type, title, description, media_blob_id,
            poster_blob_id, duration_seconds, release_date, created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING
            id as "id!",
            series_id,
            season_id,
            episode_number,
            content_type as "content_type!",
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
            '[]' as "images: JsonVec<ImageMetadata>",
            NULL as "play_count: i64""#,
        req.series_id,
        req.season_id,
        req.episode_number,
        content_type,
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
            content_type as "content_type!",
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
                   ORDER BY is_primary DESC, created_at DESC)) as "images: JsonVec<ImageMetadata>",
            (SELECT COUNT(*) FROM play_eventz WHERE entity_type = 'video' AND entity_id = videoz.id) as "play_count: i64"
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
        content_type: String,
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
        play_count: Option<i64>,
    }

    let result = sqlx::query_as::<_, QueryRow>(
        r#"SELECT
            v.id as video_id,
            v.series_id,
            v.season_id,
            v.episode_number,
            v.content_type,
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
                   ORDER BY is_primary DESC, created_at DESC)), '[]') as images,
            (SELECT COUNT(*) FROM play_eventz WHERE entity_type = 'video' AND entity_id = v.id) as play_count
         FROM videoz v
         LEFT JOIN media_blobz b ON v.media_blob_id = b.id
         LEFT JOIN user_accountz cu ON v.created_by = cu.id
         LEFT JOIN user_accountz uu ON v.updated_by = uu.id
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
            tracing::error!(video_id = %id, error = %e, "get_video_with_metadata: query failed");
            return GrimoireResponse::failure("Failed to get video", vec![ErrorDetail::from(e)]);
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
        content_type: row.content_type,
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
        play_count: row.play_count,
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
            content_type as "content_type!",
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
                   ORDER BY is_primary DESC, created_at DESC)) as "images: JsonVec<ImageMetadata>",
            (SELECT COUNT(*) FROM play_eventz WHERE entity_type = 'video' AND entity_id = videoz.id) as "play_count: i64"
         FROM videoz
         WHERE series_id = ? AND deleted_at IS NULL
         ORDER BY
           (SELECT season_number FROM video_seasonz WHERE id = videoz.season_id) IS NULL,
           (SELECT season_number FROM video_seasonz WHERE id = videoz.season_id) ASC,
           episode_number ASC,
           created_at ASC"#,
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
            content_type as "content_type!",
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
                   ORDER BY is_primary DESC, created_at DESC)) as "images: JsonVec<ImageMetadata>",
            (SELECT COUNT(*) FROM play_eventz WHERE entity_type = 'video' AND entity_id = videoz.id) as "play_count: i64"
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
            content_type as "content_type!",
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
                   ORDER BY is_primary DESC, created_at DESC)) as "images: JsonVec<ImageMetadata>",
            (SELECT COUNT(*) FROM play_eventz WHERE entity_type = 'video' AND entity_id = videoz.id) as "play_count: i64"
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

/// list the N most-recently-added videos (flat, non-clustered by series -
/// unlike `query_videos`' default sort, this is a true top-N by
/// `created_at`). used by the graph view's synthesized "recently added"
/// hub, mirroring `music::entities::relations::list_recently_added_albums`.
pub async fn list_recently_added_videos(limit: Option<u32>) -> GrimoireResponse<Vec<Video>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };
    let limit = limit.unwrap_or(200).min(1000) as i64;

    let videos = match sqlx::query_as!(
        Video,
        r#"SELECT
            id as "id!",
            series_id,
            season_id,
            episode_number,
            content_type as "content_type!",
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
                   ORDER BY is_primary DESC, created_at DESC)) as "images: JsonVec<ImageMetadata>",
            (SELECT COUNT(*) FROM play_eventz WHERE entity_type = 'video' AND entity_id = videoz.id) as "play_count: i64"
         FROM videoz
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT ?"#,
        limit
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

/// list videos with no `entity_taxonz` rows at all (across any taxon
/// kind). mirrors `music::entities::relations::list_unassigned_albums`'
/// "no taxon links whatsoever" semantics. only considers leaf `video`
/// entities (not series/season) - matches the count computed by
/// `taxonomy::repository::list_taxon_kinds`'s synthesized "unassigned"
/// hub.
pub async fn list_unassigned_videos(
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
    let limit = limit.unwrap_or(200).min(1000) as i64;
    let offset = offset.unwrap_or(0) as i64;

    let videos = match sqlx::query_as!(
        Video,
        r#"SELECT
            id as "id!",
            series_id,
            season_id,
            episode_number,
            content_type as "content_type!",
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
                   ORDER BY is_primary DESC, created_at DESC)) as "images: JsonVec<ImageMetadata>",
            (SELECT COUNT(*) FROM play_eventz WHERE entity_type = 'video' AND entity_id = videoz.id) as "play_count: i64"
         FROM videoz
         WHERE deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM entity_taxonz et
             JOIN taxonz t ON t.id = et.taxon_id
             WHERE et.entity_type = 'video' AND et.entity_id = videoz.id AND t.deleted_at IS NULL
           )
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

/// list videos linked to a taxon identified by `(kind_slug, value)`,
/// matching by the taxon's slug or label (case-insensitive) - mirrors
/// `music::entities::relations::list_albums_by_taxon_value`. used when
/// the graph drills into a (universal-domain) relation hub's value node
/// and needs that value's video members from a remote.
pub async fn list_videos_by_taxon_value(
    kind_slug: &str,
    value: &str,
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
    let limit = limit.unwrap_or(200).min(1000) as i64;
    let offset = offset.unwrap_or(0) as i64;

    let videos = match sqlx::query_as!(
        Video,
        r#"SELECT
            id as "id!",
            series_id,
            season_id,
            episode_number,
            content_type as "content_type!",
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
                   ORDER BY is_primary DESC, created_at DESC)) as "images: JsonVec<ImageMetadata>",
            (SELECT COUNT(*) FROM play_eventz WHERE entity_type = 'video' AND entity_id = videoz.id) as "play_count: i64"
         FROM videoz
         WHERE deleted_at IS NULL
           AND id IN (
             SELECT DISTINCT et.entity_id
               FROM entity_taxonz et
               JOIN taxonz t      ON t.id = et.taxon_id
               JOIN taxon_kindz k ON k.id = t.kind_id
              WHERE et.entity_type = 'video'
                AND k.slug = ?1
                AND (t.slug = ?2 OR LOWER(t.label) = LOWER(?2))
                AND t.deleted_at IS NULL
                AND k.deleted_at IS NULL
           )
         ORDER BY created_at DESC
         LIMIT ?3 OFFSET ?4"#,
        kind_slug,
        value,
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

    let clear_series_flag = req.clear_series_id as i64;
    let clear_season_flag = (req.clear_series_id || req.clear_season_id) as i64;

    let video = match sqlx::query_as!(
        Video,
        r#"UPDATE videoz
            SET series_id = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, series_id) END,
                season_id = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, season_id) END,
                episode_number = COALESCE(?, episode_number),
                content_type = COALESCE(?, content_type),
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
                content_type as "content_type!",
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
                '[]' as "images: JsonVec<ImageMetadata>",
                (SELECT COUNT(*) FROM play_eventz WHERE entity_type = 'video' AND entity_id = videoz.id) as "play_count: i64""#,
        clear_series_flag,
        req.series_id,
        clear_season_flag,
        req.season_id,
        req.episode_number,
        req.content_type,
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
