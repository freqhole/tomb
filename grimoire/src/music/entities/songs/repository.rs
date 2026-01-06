//! song service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{CreateSongRequest, Song};
use crate::database;
use crate::error::{GrimoireError, GrimoireResult};

/// create a new song
pub async fn create_song(req: CreateSongRequest) -> GrimoireResult<Song> {
    let pool = database::connect_music().await?;

    let song = sqlx::query_as!(
        Song,
        "INSERT INTO songz (
            media_blob_id, title, track_number, disc_number, duration, year, bpm, key_signature, lyrics,
            created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING
            rowid as \"rowid!\",
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
pub async fn list_songs() -> GrimoireResult<Vec<Song>> {
    let pool = database::connect_music().await?;

    let songs = sqlx::query_as!(
        Song,
        "SELECT
            rowid as \"rowid!\",
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
         LIMIT 100"
    )
    .fetch_all(&pool)
    .await?;

    Ok(songs)
}

/// get song by id
pub async fn get_song(id: &str) -> GrimoireResult<Song> {
    let pool = database::connect_music().await?;

    let song = sqlx::query_as!(
        Song,
        "SELECT
            rowid as \"rowid!\",
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
    let pool = database::connect_music().await?;
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

    Ok(())
}
