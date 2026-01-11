//! song service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{CreateSongRequest, Song};
use crate::database;
use crate::error::{GrimoireError, GrimoireResult};
use crate::music::crud::remove_song_from_all_playlists;

/// create a new song
pub async fn create_song(req: CreateSongRequest) -> GrimoireResult<Song> {
    let pool = database::connect().await?;

    let song = sqlx::query_as!(
        Song,
        "INSERT INTO songz (
            media_blob_id, title, track_number, disc_number, duration, year, bpm, key_signature, lyrics,
            created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            thumbnail_blob_id,
            waveform_blob_id,
            title as \"title!\",
            track_number,
            disc_number,
            duration,
            year,
            bpm,
            key_signature,
            metadata,
            lyrics,
            processing_status,
            processing_notes,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at,
            deleted_by,
            created_by,
            updated_by",
        req.media_blob_id,
        req.title,
        req.track_number,
        req.disc_number,
        req.duration,
        req.year,
        req.bpm,
        req.key_signature,
        req.lyrics,
        req.created_by,
        req.created_by
    )
    .fetch_one(&pool)
    .await?;

    Ok(song)
}

/// list all songs (non-deleted only)
pub async fn list_songs(limit: Option<u32>, offset: Option<u32>) -> GrimoireResult<Vec<Song>> {
    let pool = database::connect().await?;
    let limit = limit.unwrap_or(100).min(1000) as i64;
    let offset = offset.unwrap_or(0) as i64;

    let songs = sqlx::query_as!(
        Song,
        "SELECT
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            thumbnail_blob_id,
            waveform_blob_id,
            title as \"title!\",
            track_number as \"track_number!\",
            disc_number as \"disc_number!\",
            duration,
            year,
            bpm,
            key_signature,
            metadata,
            lyrics,
            processing_status,
            processing_notes,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at,
            deleted_by,
            created_by,
            updated_by
         FROM songz
         WHERE deleted_at IS NULL
         ORDER BY created_at DESC
         LIMIT ? OFFSET ?",
        limit,
        offset
    )
    .fetch_all(&pool)
    .await?;

    Ok(songs)
}

/// get song by id
pub async fn get_song(id: &str) -> GrimoireResult<Song> {
    let pool = database::connect().await?;

    let song = sqlx::query_as!(
        Song,
        "SELECT
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            thumbnail_blob_id,
            waveform_blob_id,
            title as \"title!\",
            track_number as \"track_number!\",
            disc_number as \"disc_number!\",
            duration,
            year,
            bpm,
            key_signature,
            metadata,
            lyrics,
            processing_status,
            processing_notes,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at,
            deleted_by,
            created_by,
            updated_by
         FROM songz
         WHERE id = ? AND deleted_at IS NULL",
        id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| GrimoireError::SongNotFound { id: id.to_string() })?;

    Ok(song)
}

/// soft delete a song
pub async fn delete_song(id: &str, deleted_by: Option<String>) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    let rows_affected = sqlx::query!(
        "UPDATE songz SET deleted_at = unixepoch(), deleted_by = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        deleted_by,
        id
    )
    .execute(&pool)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(GrimoireError::SongNotFound { id: id.to_string() });
    }

    // Remove song from all playlists when soft-deleting
    match remove_song_from_all_playlists(id).await {
        crate::GrimoireResponse { success: true, .. } => Ok(()),
        response => {
            let error_msg = if !response.errors.is_empty() {
                response.errors[0].detail.clone()
            } else {
                response.message
            };
            Err(GrimoireError::ProcessingFailed { message: error_msg })
        }
    }
}
