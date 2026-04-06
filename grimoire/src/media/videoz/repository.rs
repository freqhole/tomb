//! video repository — CRUD operations for the videoz table

use super::models::{CreateVideoRequest, Video};
use crate::database;
use crate::error::GrimoireResult;

/// create a new video entity
pub async fn create_video(req: CreateVideoRequest) -> GrimoireResult<Video> {
    let pool = database::connect().await?;

    let video = sqlx::query_as!(
        Video,
        "INSERT INTO videoz (
            media_blob_id, title, description, original_filename,
            duration, width, height, codec, framerate, bitrate, metadata,
            created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            duration, width, height, codec, framerate, bitrate, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by",
        req.media_blob_id,
        req.title,
        req.description,
        req.original_filename,
        req.duration,
        req.width,
        req.height,
        req.codec,
        req.framerate,
        req.bitrate,
        req.metadata,
        req.created_by,
        req.created_by
    )
    .fetch_one(&pool)
    .await?;

    Ok(video)
}

/// get video entity by id
pub async fn get_video_by_id(id: &str) -> GrimoireResult<Video> {
    let pool = database::connect().await?;

    let video = sqlx::query_as!(
        Video,
        "SELECT
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            duration, width, height, codec, framerate, bitrate, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by
         FROM videoz
         WHERE id = ? AND deleted_at IS NULL
         LIMIT 1",
        id
    )
    .fetch_one(&pool)
    .await?;

    Ok(video)
}

/// get video entity by media blob id
pub async fn get_video_by_blob_id(media_blob_id: &str) -> GrimoireResult<Video> {
    let pool = database::connect().await?;

    let video = sqlx::query_as!(
        Video,
        "SELECT
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            duration, width, height, codec, framerate, bitrate, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by
         FROM videoz
         WHERE media_blob_id = ? AND deleted_at IS NULL
         LIMIT 1",
        media_blob_id
    )
    .fetch_one(&pool)
    .await?;

    Ok(video)
}

/// list video entities (non-deleted only)
pub async fn list_videos(limit: Option<u32>, offset: Option<u32>) -> GrimoireResult<Vec<Video>> {
    let pool = database::connect().await?;
    let limit = limit.unwrap_or(100).min(1000) as i64;
    let offset = offset.unwrap_or(0) as i64;

    let videos = sqlx::query_as!(
        Video,
        "SELECT
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            duration, width, height, codec, framerate, bitrate, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by
         FROM videoz
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?",
        limit,
        offset
    )
    .fetch_all(&pool)
    .await?;

    Ok(videos)
}

/// soft delete a video entity
pub async fn delete_video(id: &str, deleted_by: Option<String>) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    let rows_affected = sqlx::query!(
        "UPDATE videoz SET deleted_at = unixepoch(), deleted_by = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        deleted_by,
        id
    )
    .execute(&pool)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(crate::error::GrimoireError::ProcessingFailed {
            message: format!("video entity not found: {}", id),
        });
    }

    Ok(())
}

/// update video metadata fields (extracted from ffprobe)
pub async fn update_video_metadata(
    id: &str,
    duration: Option<i64>,
    width: Option<i64>,
    height: Option<i64>,
    codec: Option<String>,
    framerate: Option<f64>,
    bitrate: Option<i64>,
) -> GrimoireResult<Video> {
    let pool = database::connect().await?;

    let video = sqlx::query_as!(
        Video,
        "UPDATE videoz SET
            duration = COALESCE(?, duration),
            width = COALESCE(?, width),
            height = COALESCE(?, height),
            codec = COALESCE(?, codec),
            framerate = COALESCE(?, framerate),
            bitrate = COALESCE(?, bitrate)
         WHERE id = ? AND deleted_at IS NULL
         RETURNING
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            duration, width, height, codec, framerate, bitrate, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by",
        duration,
        width,
        height,
        codec,
        framerate,
        bitrate,
        id
    )
    .fetch_one(&pool)
    .await?;

    Ok(video)
}
