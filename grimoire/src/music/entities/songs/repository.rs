//! song service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{CreateSongRequest, Song};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::music::crud::remove_song_from_all_playlists;
use crate::response::GrimoireResponse;

/// create a new song
pub async fn create_song(req: CreateSongRequest) -> GrimoireResponse<Song> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let song = match sqlx::query_as!(
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
    .await
    {
        Ok(s) => s,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to create song",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Song created successfully", song)
}

/// list all songs (non-deleted only)
pub async fn list_songs(limit: Option<u32>, offset: Option<u32>) -> GrimoireResponse<Vec<Song>> {
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

    let songs = match sqlx::query_as!(
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
    .await
    {
        Ok(s) => s,
        Err(e) => {
            return GrimoireResponse::failure("Failed to list songs", vec![ErrorDetail::from(e)])
        }
    };

    GrimoireResponse::success("Songs retrieved successfully", songs)
}

/// get song by id
pub async fn get_song(id: &str) -> GrimoireResponse<Song> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let song_opt = match sqlx::query_as!(
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
    .await
    {
        Ok(s) => s,
        Err(e) => {
            return GrimoireResponse::failure("Failed to get song", vec![ErrorDetail::from(e)])
        }
    };

    match song_opt {
        Some(song) => GrimoireResponse::success("Song retrieved successfully", song),
        None => {
            let err = GrimoireError::SongNotFound { id: id.to_string() };
            GrimoireResponse::failure("Song not found", vec![ErrorDetail::from(&err)])
        }
    }
}

/// soft delete a song
pub async fn delete_song(id: &str, deleted_by: Option<String>) -> GrimoireResponse<()> {
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
        "UPDATE songz SET deleted_at = unixepoch(), deleted_by = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        deleted_by,
        id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => result.rows_affected(),
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to delete song",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    if rows_affected == 0 {
        let err = GrimoireError::SongNotFound { id: id.to_string() };
        return GrimoireResponse::failure("Song not found", vec![ErrorDetail::from(&err)]);
    }

    // Remove song from all playlists when soft-deleting
    let playlist_removal = remove_song_from_all_playlists(id).await;
    if !playlist_removal.success {
        return GrimoireResponse::failure(
            "Failed to remove song from playlists",
            playlist_removal.errors,
        );
    }

    GrimoireResponse::success("Song deleted successfully", ())
}
