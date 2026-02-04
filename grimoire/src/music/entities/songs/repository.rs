//! song service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{CreateSongRequest, Song};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::music::crud::remove_song_from_all_playlists;
use crate::music::crud::ImageMetadata;
use crate::response::GrimoireResponse;
use crate::GrimoireResult;
use crate::JsonVec;

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
            media_blob_id, title, track_number, disc_number, duration, year, bpm, key_signature, metadata, lyrics,
            created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
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
            updated_by,
            NULL as \"images?: JsonVec<ImageMetadata>\"",
        req.media_blob_id,
        req.title,
        req.track_number,
        req.disc_number,
        req.duration,
        req.year,
        req.bpm,
        req.key_signature,
        req.metadata,
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

    // query from song_query_view which includes images as JSON array
    let songs = match sqlx::query_as!(
        Song,
        r#"SELECT
            song_id as "id!",
            song_media_blob_id as "media_blob_id!",
            song_title as "title!",
            song_track_number as "track_number!",
            song_disc_number as "disc_number!",
            song_duration as duration,
            song_year as year,
            song_bpm as bpm,
            song_key_signature as key_signature,
            song_metadata as metadata,
            song_lyrics as lyrics,
            song_processing_status as processing_status,
            song_processing_notes as processing_notes,
            song_created_at as "created_at!",
            song_updated_at as "updated_at!",
            song_deleted_at as deleted_at,
            song_deleted_by as deleted_by,
            song_created_by as created_by,
            song_updated_by as updated_by,
            song_images as "images?: JsonVec<ImageMetadata>"
         FROM song_query_view
         WHERE song_deleted_at IS NULL
         ORDER BY song_created_at DESC
         LIMIT ? OFFSET ?"#,
        limit,
        offset
    )
    .fetch_all(&pool)
    .await
    {
        Ok(songs) => songs,
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
        r#"SELECT
            song_id as "id!",
            song_media_blob_id as "media_blob_id!",
            song_title as "title!",
            song_track_number as "track_number!",
            song_disc_number as "disc_number!",
            song_duration as "duration?",
            song_year as "year?",
            song_bpm as "bpm?",
            song_key_signature as "key_signature?",
            song_metadata as "metadata?",
            song_lyrics as "lyrics?",
            song_processing_status as "processing_status?",
            song_processing_notes as "processing_notes?",
            song_created_at as "created_at!",
            song_updated_at as "updated_at!",
            song_deleted_at as "deleted_at?",
            song_deleted_by as "deleted_by?",
            song_created_by as "created_by?",
            song_updated_by as "updated_by?",
            song_images as "images?: JsonVec<ImageMetadata>"
         FROM song_query_view
         WHERE song_id = ? AND song_deleted_at IS NULL"#,
        id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(opt) => opt,
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

    // get album_id and artist_id before deleting (for orphan cleanup)
    let album_id: Option<String> =
        sqlx::query_scalar!("SELECT album_id FROM album_songz WHERE song_id = ?", id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();

    let artist_id: Option<String> =
        sqlx::query_scalar!("SELECT artist_id FROM artist_songz WHERE song_id = ?", id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();

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

    // remove from junction tables (triggers will update counts)
    let _ = sqlx::query!("DELETE FROM album_songz WHERE song_id = ?", id)
        .execute(&pool)
        .await;
    let _ = sqlx::query!("DELETE FROM artist_songz WHERE song_id = ?", id)
        .execute(&pool)
        .await;

    // remove song from all playlists when soft-deleting
    let playlist_removal = remove_song_from_all_playlists(id).await;
    if !playlist_removal.success {
        return GrimoireResponse::failure(
            "Failed to remove song from playlists",
            playlist_removal.errors,
        );
    }

    // check for orphaned album and artist (soft-delete if no more songs)
    if let Some(album_id) = album_id {
        let _ = crate::music::crud::delete_album_if_unused(&album_id).await;
    }
    if let Some(artist_id) = artist_id {
        let _ = crate::music::crud::delete_artist_if_unused(&artist_id).await;
    }

    GrimoireResponse::success("Song deleted successfully", ())
}

/// get the media_blob_id for a song (used for parent blob lookups)
pub async fn get_song_media_blob_id(song_id: &str) -> GrimoireResult<String> {
    let pool = database::connect().await?;

    let media_blob_id: Option<String> = sqlx::query_scalar!(
        "SELECT media_blob_id FROM songz WHERE id = ? AND deleted_at IS NULL",
        song_id
    )
    .fetch_optional(&pool)
    .await?;

    media_blob_id.ok_or_else(|| GrimoireError::SongNotFound {
        id: song_id.to_string(),
    })
}
/// add an image to a song
pub async fn add_song_image(
    song_id: &str,
    media_blob_id: &str,
    is_primary: bool,
) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // if setting as primary, unset other primary images first
    if is_primary {
        if let Err(e) = sqlx::query!(
            "UPDATE song_imagez SET is_primary = 0 WHERE song_id = ?",
            song_id
        )
        .execute(&pool)
        .await
        {
            return GrimoireResponse::failure(
                "Failed to unset existing primary images",
                vec![ErrorDetail::from(e)],
            );
        }
    }

    // insert new image
    match sqlx::query!(
        "INSERT INTO song_imagez (song_id, media_blob_id, is_primary) VALUES (?, ?, ?)",
        song_id,
        media_blob_id,
        is_primary
    )
    .execute(&pool)
    .await
    {
        Ok(_) => GrimoireResponse::success("Image added to song", ()),
        Err(e) => {
            GrimoireResponse::failure("Failed to add image to song", vec![ErrorDetail::from(e)])
        }
    }
}

/// remove an image from a song
pub async fn remove_song_image(song_id: &str, media_blob_id: &str) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    match sqlx::query!(
        "DELETE FROM song_imagez WHERE song_id = ? AND media_blob_id = ?",
        song_id,
        media_blob_id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => {
            if result.rows_affected() == 0 {
                GrimoireResponse::failure("Image not found for song", vec![])
            } else {
                GrimoireResponse::success("Image removed from song", ())
            }
        }
        Err(e) => GrimoireResponse::failure(
            "Failed to remove image from song",
            vec![ErrorDetail::from(e)],
        ),
    }
}

/// set an image as the primary image for a song
pub async fn set_primary_song_image(song_id: &str, media_blob_id: &str) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // unset all primary flags
    if let Err(e) = sqlx::query!(
        "UPDATE song_imagez SET is_primary = 0 WHERE song_id = ?",
        song_id
    )
    .execute(&pool)
    .await
    {
        return GrimoireResponse::failure(
            "Failed to unset existing primary images",
            vec![ErrorDetail::from(e)],
        );
    }

    // set the specified image as primary
    match sqlx::query!(
        "UPDATE song_imagez SET is_primary = 1 WHERE song_id = ? AND media_blob_id = ?",
        song_id,
        media_blob_id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => {
            if result.rows_affected() == 0 {
                GrimoireResponse::failure("Image not found for song", vec![])
            } else {
                GrimoireResponse::success("Primary image updated", ())
            }
        }
        Err(e) => {
            GrimoireResponse::failure("Failed to set primary image", vec![ErrorDetail::from(e)])
        }
    }
}

/// remove all images from a song
pub async fn clear_song_images(song_id: &str) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    match sqlx::query!("DELETE FROM song_imagez WHERE song_id = ?", song_id)
        .execute(&pool)
        .await
    {
        Ok(_) => GrimoireResponse::success("All images removed from song", ()),
        Err(e) => {
            GrimoireResponse::failure("Failed to clear song images", vec![ErrorDetail::from(e)])
        }
    }
}
