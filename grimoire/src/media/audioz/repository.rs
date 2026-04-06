//! audio repository — CRUD operations for the audioz table

use super::models::{Audio, CreateAudioRequest};
use crate::database;
use crate::error::GrimoireResult;

/// create a new audio entity
pub async fn create_audio(req: CreateAudioRequest) -> GrimoireResult<Audio> {
    let pool = database::connect().await?;

    let audio = sqlx::query_as!(
        Audio,
        "INSERT INTO audioz (
            media_blob_id, title, description, original_filename,
            duration, sample_rate, channels, bitrate, metadata,
            created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            duration, sample_rate, channels, bitrate, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by",
        req.media_blob_id,
        req.title,
        req.description,
        req.original_filename,
        req.duration,
        req.sample_rate,
        req.channels,
        req.bitrate,
        req.metadata,
        req.created_by,
        req.created_by
    )
    .fetch_one(&pool)
    .await?;

    Ok(audio)
}

/// get audio entity by id
pub async fn get_audio_by_id(id: &str) -> GrimoireResult<Audio> {
    let pool = database::connect().await?;

    let audio = sqlx::query_as!(
        Audio,
        "SELECT
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            duration, sample_rate, channels, bitrate, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by
         FROM audioz
         WHERE id = ? AND deleted_at IS NULL
         LIMIT 1",
        id
    )
    .fetch_one(&pool)
    .await?;

    Ok(audio)
}

/// get audio entity by media blob id
pub async fn get_audio_by_blob_id(media_blob_id: &str) -> GrimoireResult<Audio> {
    let pool = database::connect().await?;

    let audio = sqlx::query_as!(
        Audio,
        "SELECT
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            duration, sample_rate, channels, bitrate, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by
         FROM audioz
         WHERE media_blob_id = ? AND deleted_at IS NULL
         LIMIT 1",
        media_blob_id
    )
    .fetch_one(&pool)
    .await?;

    Ok(audio)
}

/// list audio entities (non-deleted only)
pub async fn list_audio(limit: Option<u32>, offset: Option<u32>) -> GrimoireResult<Vec<Audio>> {
    let pool = database::connect().await?;
    let limit = limit.unwrap_or(100).min(1000) as i64;
    let offset = offset.unwrap_or(0) as i64;

    let audio_list = sqlx::query_as!(
        Audio,
        "SELECT
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title, description, original_filename,
            duration, sample_rate, channels, bitrate, metadata,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at, deleted_by, created_by, updated_by
         FROM audioz
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?",
        limit,
        offset
    )
    .fetch_all(&pool)
    .await?;

    Ok(audio_list)
}

/// soft delete an audio entity
pub async fn delete_audio(id: &str, deleted_by: Option<String>) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    let rows_affected = sqlx::query!(
        "UPDATE audioz SET deleted_at = unixepoch(), deleted_by = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        deleted_by,
        id
    )
    .execute(&pool)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(crate::error::GrimoireError::ProcessingFailed {
            message: format!("audio entity not found: {}", id),
        });
    }

    Ok(())
}
