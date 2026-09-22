//! video service functions
//! clean business logic using sqlx::query_as! with no fallbacks
//!
//! `delete_video` here only soft-deletes the `videoz` row itself. the
//! cascading workflow that also cleans up `entity_taxonz`/`playlist_itemz`/
//! `playback_progressz` rows lives in `crate::video::crud::delete`.

use super::models::{CreateVideoRequest, UpdateVideoRequest, Video};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError, GrimoireResult};
use crate::music::crud::ImageMetadata;
use crate::response::GrimoireResponse;
use crate::JsonVec;

/// validates a video's `parent_video_id` (see `Video::parent_video_id`'s
/// doc comment) before it's written - shared by `create_video` and
/// `update_video`. rust-side validation, not a SQL CHECK, matching this
/// table's existing convention-over-constraint style (`content_type` is
/// validated the same way).
///
/// `own_id` is the video being created/updated (`None` for a brand new
/// video, which can't be its own parent yet) - used to reject a video
/// pointing at itself.
async fn validate_parent_video_id(
    pool: &sqlx::SqlitePool,
    parent_video_id: Option<&str>,
    series_id: Option<&str>,
    own_id: Option<&str>,
) -> GrimoireResult<()> {
    let Some(parent_id) = parent_video_id else {
        return Ok(());
    };

    if series_id.is_some() {
        return Err(GrimoireError::Validation {
            field: "parent_video_id".to_string(),
            message: "a video cannot have both parent_video_id and series_id set - it's either \
                      series-attached or movie-with-extras-attached, not both"
                .to_string(),
        });
    }

    if own_id == Some(parent_id) {
        return Err(GrimoireError::Validation {
            field: "parent_video_id".to_string(),
            message: "a video cannot be its own parent".to_string(),
        });
    }

    let parent = sqlx::query!(
        r#"SELECT content_type as "content_type!", parent_video_id
           FROM videoz WHERE id = ? AND deleted_at IS NULL"#,
        parent_id
    )
    .fetch_optional(pool)
    .await?;

    match parent {
        None => Err(GrimoireError::Validation {
            field: "parent_video_id".to_string(),
            message: format!("parent_video_id {parent_id} does not reference an existing video"),
        }),
        Some(p) if p.content_type != "movie" => Err(GrimoireError::Validation {
            field: "parent_video_id".to_string(),
            message: format!(
                "parent video {parent_id} must have content_type 'movie' (has '{}')",
                p.content_type
            ),
        }),
        Some(p) if p.parent_video_id.is_some() => Err(GrimoireError::Validation {
            field: "parent_video_id".to_string(),
            message: "cannot attach an extra to another extra (no chaining) - parent_video_id \
                      must point at a video with no parent of its own"
                .to_string(),
        }),
        Some(_) => Ok(()),
    }
}

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

    if let Err(e) = validate_parent_video_id(
        &pool,
        req.parent_video_id.as_deref(),
        req.series_id.as_deref(),
        None,
    )
    .await
    {
        return GrimoireResponse::failure("Invalid parent_video_id", vec![ErrorDetail::from(e)]);
    }

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
            poster_blob_id, duration_seconds, release_date, created_by, updated_by, media_blob_blake3,
            parent_video_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT blake3 FROM media_blobz WHERE id = ?), ?)
        RETURNING
            id as "id!",
            series_id,
            season_id,
            episode_number,
            content_type as "content_type!",
            title as "title!",
            description,
            media_blob_id as "media_blob_id!",
            media_blob_blake3 as "blake3?",
            parent_video_id,
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
        req.created_by,
        req.media_blob_id,
        req.parent_video_id
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
            media_blob_blake3 as "blake3?",
            parent_video_id,
            poster_blob_id,
            duration_seconds,
            release_date,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            created_by,
            updated_by,
            deleted_by,
            images as "images: JsonVec<ImageMetadata>",
            play_count as "play_count: i64"
         FROM video_query_view
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
        blake3: Option<String>,
        parent_video_id: Option<String>,
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
            v.media_blob_blake3 as blake3,
            v.parent_video_id,
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
        blake3: row.blake3,
        parent_video_id: row.parent_video_id,
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
            media_blob_blake3 as "blake3?",
            parent_video_id,
            poster_blob_id,
            duration_seconds,
            release_date,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            created_by,
            updated_by,
            deleted_by,
            images as "images: JsonVec<ImageMetadata>",
            play_count as "play_count: i64"
         FROM video_query_view
         WHERE series_id = ? AND deleted_at IS NULL
         ORDER BY
           (SELECT season_number FROM video_seasonz WHERE id = season_id) IS NULL,
           (SELECT season_number FROM video_seasonz WHERE id = season_id) ASC,
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
            media_blob_blake3 as "blake3?",
            parent_video_id,
            poster_blob_id,
            duration_seconds,
            release_date,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            created_by,
            updated_by,
            deleted_by,
            images as "images: JsonVec<ImageMetadata>",
            play_count as "play_count: i64"
         FROM video_query_view
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

/// list every "extra" (deleted scene, blooper, behind-the-scenes, trailer)
/// attached to a movie via `parent_video_id`, non-deleted only. see
/// `Video::parent_video_id`'s doc comment - this is intentionally a flat,
/// unordered-by-kind list (no `extra_kind` grouping in v1, oldest first).
pub async fn list_video_extras(parent_video_id: &str) -> GrimoireResponse<Vec<Video>> {
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
            media_blob_blake3 as "blake3?",
            parent_video_id,
            poster_blob_id,
            duration_seconds,
            release_date,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            created_by,
            updated_by,
            deleted_by,
            images as "images: JsonVec<ImageMetadata>",
            play_count as "play_count: i64"
         FROM video_query_view
         WHERE parent_video_id = ? AND deleted_at IS NULL
         ORDER BY created_at ASC"#,
        parent_video_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(videos) => videos,
        Err(e) => {
            return GrimoireResponse::failure("Failed to list extras", vec![ErrorDetail::from(e)])
        }
    };

    GrimoireResponse::success("Extras retrieved successfully", videos)
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
            media_blob_blake3 as "blake3?",
            parent_video_id,
            poster_blob_id,
            duration_seconds,
            release_date,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            created_by,
            updated_by,
            deleted_by,
            images as "images: JsonVec<ImageMetadata>",
            play_count as "play_count: i64"
         FROM video_query_view
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
            media_blob_blake3 as "blake3?",
            parent_video_id,
            poster_blob_id,
            duration_seconds,
            release_date,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            created_by,
            updated_by,
            deleted_by,
            images as "images: JsonVec<ImageMetadata>",
            play_count as "play_count: i64"
         FROM video_query_view
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
            media_blob_blake3 as "blake3?",
            parent_video_id,
            poster_blob_id,
            duration_seconds,
            release_date,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            created_by,
            updated_by,
            deleted_by,
            images as "images: JsonVec<ImageMetadata>",
            play_count as "play_count: i64"
         FROM video_query_view
         WHERE deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM entity_taxonz et
             JOIN taxonz t ON t.id = et.taxon_id
             WHERE et.entity_type = 'video' AND et.entity_id = video_query_view.id AND t.deleted_at IS NULL
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
            media_blob_blake3 as "blake3?",
            parent_video_id,
            poster_blob_id,
            duration_seconds,
            release_date,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            created_by,
            updated_by,
            deleted_by,
            images as "images: JsonVec<ImageMetadata>",
            play_count as "play_count: i64"
         FROM video_query_view
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

    // fetch the current series_id/parent_video_id so validate_parent_video_id
    // sees the EFFECTIVE post-update values (mirrors the UPDATE's own
    // clear-flag-or-COALESCE semantics below) rather than just this
    // request's raw fields - a caller changing only one of the two
    // mutually-exclusive fields must still be validated against the
    // other's current value.
    let current = match sqlx::query!(
        "SELECT series_id, parent_video_id FROM videoz WHERE id = ? AND deleted_at IS NULL",
        req.video_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(r)) => r,
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

    let effective_series_id = if req.clear_series_id {
        None
    } else {
        req.series_id.clone().or(current.series_id)
    };
    let effective_parent_video_id = if req.clear_parent_video_id {
        None
    } else {
        req.parent_video_id.clone().or(current.parent_video_id)
    };

    if let Err(e) = validate_parent_video_id(
        &pool,
        effective_parent_video_id.as_deref(),
        effective_series_id.as_deref(),
        Some(&req.video_id),
    )
    .await
    {
        return GrimoireResponse::failure("Invalid parent_video_id", vec![ErrorDetail::from(e)]);
    }

    let clear_series_flag = req.clear_series_id as i64;
    let clear_season_flag = (req.clear_series_id || req.clear_season_id) as i64;
    let clear_parent_video_flag = req.clear_parent_video_id as i64;

    let video = match sqlx::query_as!(
        Video,
        r#"UPDATE videoz
            SET series_id = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, series_id) END,
                season_id = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, season_id) END,
                episode_number = COALESCE(?, episode_number),
                content_type = COALESCE(?, content_type),
                title = COALESCE(?, title),
                description = COALESCE(?, description),
                parent_video_id = CASE WHEN ? = 1 THEN NULL ELSE COALESCE(?, parent_video_id) END,
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
                media_blob_blake3 as "blake3?",
                parent_video_id,
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
        clear_parent_video_flag,
        req.parent_video_id,
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

#[cfg(test)]
mod tests {
    use super::*;

    // touches the real db pool singleton - run one at a time, own process:
    // cargo test -p grimoire --lib -- --ignored --exact video::entities::videos::repository::tests::test_create_and_get_video_carries_blake3_through_the_view
    async fn init_test_env(data_dir: &std::path::Path) {
        let config_toml = format!(
            r#"data_dir = "{data_dir}"

[database]
filename = "grimoire.db"

[media]
max_fs_file_size = 104857600
supported_audio_formats = ["mp3", "flac"]

[musicbrainz]
enabled = false

[logging]
level = "warn"
"#,
            data_dir = data_dir.display()
        );
        let config_path = data_dir.join("freqhole-config.toml");
        std::fs::write(&config_path, config_toml).expect("write config");
        std::fs::write(data_dir.join("grimoire.db"), b"").expect("touch grimoire.db");

        crate::config::init_config(Some(config_path)).expect("init config");
        crate::database::run_migrations()
            .await
            .expect("run migrations");
    }

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singleton"]
    async fn test_create_and_get_video_carries_blake3_through_the_view() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;

        let pool = database::connect().await.expect("connect");
        sqlx::query(
            "INSERT INTO media_blobz (id, sha256, size, mime, blob_type, blake3)
             VALUES ('blob-with-hash', ?, 123, 'video/mp4', 'original', 'the-video-blake3')",
        )
        .bind("b".repeat(64))
        .execute(&pool)
        .await
        .expect("insert media_blobz row");

        let created = create_video(CreateVideoRequest {
            series_id: None,
            season_id: None,
            episode_number: None,
            content_type: Some("movie".to_string()),
            title: "test movie".to_string(),
            description: None,
            media_blob_id: "blob-with-hash".to_string(),
            parent_video_id: None,
            poster_blob_id: None,
            duration_seconds: None,
            release_date: None,
            created_by: None,
        })
        .await;
        assert!(created.is_success(), "create_video failed: {created:?}");
        let created_video = created.data.expect("created video data");
        assert_eq!(created_video.blake3.as_deref(), Some("the-video-blake3"));

        // get_video reads via video_query_view - confirms the view rewiring
        // (not just the insert path) surfaces the denormalized column.
        let fetched = get_video(&created_video.id).await;
        assert!(fetched.is_success(), "get_video failed: {fetched:?}");
        let fetched_video = fetched.data.expect("fetched video data");
        assert_eq!(fetched_video.blake3.as_deref(), Some("the-video-blake3"));

        // list_videos_unattached also reads via video_query_view - a second
        // independent code path exercising the same column/view plumbing.
        let listed = list_videos_unattached(Some(50), Some(0)).await;
        assert!(
            listed.is_success(),
            "list_videos_unattached failed: {listed:?}"
        );
        let listed_videos = listed.data.expect("listed videos");
        let listed_match = listed_videos
            .iter()
            .find(|v| v.id == created_video.id)
            .expect("created video present in unattached list");
        assert_eq!(listed_match.blake3.as_deref(), Some("the-video-blake3"));
    }

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singleton"]
    async fn test_parent_video_id_validation_and_extras_grouping() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;

        let pool = database::connect().await.expect("connect");
        for (i, (blob_id, blake3)) in [
            ("blob-movie", "movie-blake3"),
            ("blob-extra", "extra-blake3"),
            ("blob-clip", "clip-blake3"),
            ("blob-series-ep", "series-ep-blake3"),
        ]
        .into_iter()
        .enumerate()
        {
            let sha256 = format!("{i:064x}");
            sqlx::query(
                "INSERT INTO media_blobz (id, sha256, size, mime, blob_type, blake3)
                 VALUES (?, ?, 123, 'video/mp4', 'original', ?)",
            )
            .bind(blob_id)
            .bind(sha256)
            .bind(blake3)
            .execute(&pool)
            .await
            .expect("insert media_blobz row");
        }

        async fn make(content_type: &str, media_blob_id: &str) -> Video {
            create_video(CreateVideoRequest {
                series_id: None,
                season_id: None,
                episode_number: None,
                content_type: Some(content_type.to_string()),
                title: format!("test {content_type}"),
                description: None,
                media_blob_id: media_blob_id.to_string(),
                parent_video_id: None,
                poster_blob_id: None,
                duration_seconds: None,
                release_date: None,
                created_by: None,
            })
            .await
            .data
            .expect("create_video should succeed")
        }

        let movie = make("movie", "blob-movie").await;
        let clip = make("clip", "blob-clip").await;

        // happy path: an extra attached to a real movie succeeds and reads
        // back through both create_video's RETURNING and get_video's view.
        let extra = create_video(CreateVideoRequest {
            series_id: None,
            season_id: None,
            episode_number: None,
            content_type: Some("clip".to_string()),
            title: "deleted scene".to_string(),
            description: None,
            media_blob_id: "blob-extra".to_string(),
            parent_video_id: Some(movie.id.clone()),
            poster_blob_id: None,
            duration_seconds: None,
            release_date: None,
            created_by: None,
        })
        .await;
        assert!(extra.is_success(), "create_video (extra) failed: {extra:?}");
        let extra = extra.data.expect("extra data");
        assert_eq!(extra.parent_video_id.as_deref(), Some(movie.id.as_str()));
        let fetched = get_video(&extra.id).await.data.expect("get_video");
        assert_eq!(fetched.parent_video_id.as_deref(), Some(movie.id.as_str()));

        // reject: parent's content_type isn't "movie".
        let bad_parent_kind = create_video(CreateVideoRequest {
            series_id: None,
            season_id: None,
            episode_number: None,
            content_type: Some("clip".to_string()),
            title: "invalid parent kind".to_string(),
            description: None,
            media_blob_id: "blob-series-ep".to_string(),
            parent_video_id: Some(clip.id.clone()),
            poster_blob_id: None,
            duration_seconds: None,
            release_date: None,
            created_by: None,
        })
        .await;
        assert!(!bad_parent_kind.is_success());
        assert_eq!(bad_parent_kind.errors[0].error_type, "validation");

        // reject: chaining an extra onto another extra.
        let chained = update_video(UpdateVideoRequest {
            video_id: clip.id.clone(),
            series_id: None,
            season_id: None,
            episode_number: None,
            content_type: None,
            title: None,
            description: None,
            parent_video_id: Some(extra.id.clone()),
            poster_blob_id: None,
            duration_seconds: None,
            release_date: None,
            updated_by: None,
            clear_series_id: false,
            clear_season_id: false,
            clear_parent_video_id: false,
        })
        .await;
        assert!(!chained.is_success());

        // reject: series_id and parent_video_id both set.
        let both_set = update_video(UpdateVideoRequest {
            video_id: clip.id.clone(),
            series_id: Some("some-series-id".to_string()),
            season_id: None,
            episode_number: None,
            content_type: None,
            title: None,
            description: None,
            parent_video_id: Some(movie.id.clone()),
            poster_blob_id: None,
            duration_seconds: None,
            release_date: None,
            updated_by: None,
            clear_series_id: false,
            clear_season_id: false,
            clear_parent_video_id: false,
        })
        .await;
        assert!(!both_set.is_success());

        // reject: self-reference.
        let self_ref = update_video(UpdateVideoRequest {
            video_id: movie.id.clone(),
            series_id: None,
            season_id: None,
            episode_number: None,
            content_type: None,
            title: None,
            description: None,
            parent_video_id: Some(movie.id.clone()),
            poster_blob_id: None,
            duration_seconds: None,
            release_date: None,
            updated_by: None,
            clear_series_id: false,
            clear_season_id: false,
            clear_parent_video_id: false,
        })
        .await;
        assert!(!self_ref.is_success());
    }
}
