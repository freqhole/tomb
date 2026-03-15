//! song service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{CreateSongRequest, Song};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::music::crud::remove_song_from_all_playlists;
use crate::music::crud::ImageMetadata;
use crate::music::EntityUrl;
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
            media_blob_id, title, track_number, disc_number, duration, bpm, track_artist, metadata, lyrics,
            created_by, updated_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title as \"title!\",
            track_number,
            disc_number,
            duration,
            bpm,
            track_artist,
            metadata,
            lyrics,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at,
            deleted_by,
            created_by,
            updated_by,
            NULL as \"images?: JsonVec<ImageMetadata>\",
            NULL as \"urls?: JsonVec<EntityUrl>\",
            NULL as \"created_by_username?: String\",
            NULL as \"updated_by_username?: String\"",
        req.media_blob_id,
        req.title,
        req.track_number,
        req.disc_number,
        req.duration,
        req.bpm,
        req.track_artist,
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
            // detect UNIQUE constraint on media_blob_id - this means duplicate song
            let err_str = e.to_string();
            if err_str.contains("UNIQUE constraint failed: songz.media_blob_id") {
                return GrimoireResponse::failure(
                    "duplicate song",
                    vec![ErrorDetail::new(
                        "duplicate_song",
                        "Duplicate Song",
                        &format!("a song already exists with blob_id {}", req.media_blob_id),
                    )],
                );
            }
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
            song_bpm as bpm,
            song_track_artist as track_artist,
            song_metadata as metadata,
            song_lyrics as lyrics,
            song_created_at as "created_at!",
            song_updated_at as "updated_at!",
            song_deleted_at as deleted_at,
            song_deleted_by as deleted_by,
            song_created_by as created_by,
            song_updated_by as updated_by,
            song_created_by_username as created_by_username,
            song_updated_by_username as updated_by_username,
            song_images as "images?: JsonVec<ImageMetadata>",
            NULL as "urls?: JsonVec<EntityUrl>"
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
            song_bpm as "bpm?",
            song_track_artist as "track_artist?",
            song_metadata as "metadata?",
            song_lyrics as "lyrics?",
            song_created_at as "created_at!",
            song_updated_at as "updated_at!",
            song_deleted_at as "deleted_at?",
            song_deleted_by as "deleted_by?",
            song_created_by as "created_by?",
            song_updated_by as "updated_by?",
            song_created_by_username as "created_by_username?",
            song_updated_by_username as "updated_by_username?",
            song_images as "images?: JsonVec<ImageMetadata>",
            NULL as "urls?: JsonVec<EntityUrl>"
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

/// bulk delete multiple songs at once
pub async fn bulk_delete_songs(
    song_ids: Vec<String>,
    deleted_by: Option<String>,
) -> crate::music::crud::BulkDeleteSongsResponse {
    use crate::music::crud::BulkDeleteSongsResponse;

    let mut deleted_count: u32 = 0;
    let mut failed_ids = Vec::new();

    for song_id in song_ids {
        let result = delete_song(&song_id, deleted_by.clone()).await;
        if result.success {
            deleted_count += 1;
        } else {
            failed_ids.push(song_id);
        }
    }

    let success = failed_ids.is_empty();
    let message = if success {
        format!("deleted {} songs", deleted_count)
    } else {
        format!(
            "deleted {} songs, {} failed",
            deleted_count,
            failed_ids.len()
        )
    };

    BulkDeleteSongsResponse {
        success,
        message,
        deleted_count,
        failed_ids,
    }
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
///
/// if `created_by` is provided (as (user_id, username)), a feed event will be created
pub async fn add_song_image(
    song_id: &str,
    media_blob_id: &str,
    is_primary: bool,
    created_by: Option<(&str, &str)>,
) -> GrimoireResponse<()> {
    tracing::info!(
        "add_song_image called: song_id={}, media_blob_id={}, is_primary={}",
        song_id,
        media_blob_id,
        is_primary
    );

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            tracing::error!("add_song_image: failed to connect to database: {:?}", e);
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    // check if this image already exists for this song
    let existing = sqlx::query_scalar!(
        "SELECT COUNT(*) as count FROM song_imagez WHERE song_id = ? AND media_blob_id = ?",
        song_id,
        media_blob_id
    )
    .fetch_one(&pool)
    .await;

    tracing::info!(
        "add_song_image: existing check result for song_id={}, media_blob_id={}: {:?}",
        song_id,
        media_blob_id,
        existing
    );

    // check if the media_blob_id exists in media_blobz
    let blob_exists = sqlx::query_scalar!(
        "SELECT COUNT(*) as count FROM media_blobz WHERE id = ?",
        media_blob_id
    )
    .fetch_one(&pool)
    .await;

    tracing::info!(
        "add_song_image: media_blob exists check for media_blob_id={}: {:?}",
        media_blob_id,
        blob_exists
    );

    // check if the song exists
    let song_exists =
        sqlx::query_scalar!("SELECT COUNT(*) as count FROM songz WHERE id = ?", song_id)
            .fetch_one(&pool)
            .await;

    tracing::info!(
        "add_song_image: song exists check for song_id={}: {:?}",
        song_id,
        song_exists
    );

    // if setting as primary, unset other primary images first
    if is_primary {
        if let Err(e) = sqlx::query!(
            "UPDATE song_imagez SET is_primary = 0 WHERE song_id = ?",
            song_id
        )
        .execute(&pool)
        .await
        {
            tracing::error!("add_song_image: failed to unset primary: {:?}", e);
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
        Ok(_) => {
            tracing::info!("add_song_image: successfully added image");

            // fire-and-forget: create feed event if user provided
            if let Some((user_id, username)) = created_by {
                let user_id = user_id.to_string();
                let username = username.to_string();
                let song_id = song_id.to_string();
                let media_blob_id = media_blob_id.to_string();
                tokio::spawn(async move {
                    let _ = crate::music::analytics::feed_events::create_image_feed_event(
                        "song",
                        &song_id,
                        &media_blob_id,
                        &user_id,
                        &username,
                    )
                    .await;
                });
            }

            GrimoireResponse::success("Image added to song", ())
        }
        Err(e) => {
            tracing::error!("add_song_image: INSERT failed: {:?}", e);
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

/// clear non-waveform images from a song (preserves waveform images)
pub async fn clear_song_artwork(song_id: &str) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // delete song_imagez entries where the linked blob is not a waveform
    match sqlx::query!(
        r#"DELETE FROM song_imagez
           WHERE song_id = ?
           AND media_blob_id IN (
               SELECT mb.id FROM media_blobz mb
               WHERE mb.blob_type != 'waveform'
           )"#,
        song_id
    )
    .execute(&pool)
    .await
    {
        Ok(_) => GrimoireResponse::success("artwork cleared from song (waveforms preserved)", ()),
        Err(e) => {
            GrimoireResponse::failure("failed to clear song artwork", vec![ErrorDetail::from(e)])
        }
    }
}

/// bulk clear artwork from multiple songs (preserves waveform images)
pub async fn bulk_clear_song_artwork(
    song_ids: Vec<String>,
) -> crate::music::crud::BulkClearSongArtworkResponse {
    use crate::music::crud::BulkClearSongArtworkResponse;

    let mut cleared_count: u32 = 0;
    let mut failed_ids = Vec::new();

    for song_id in song_ids {
        let result = clear_song_artwork(&song_id).await;
        if result.success {
            cleared_count += 1;
        } else {
            failed_ids.push(song_id);
        }
    }

    let success = failed_ids.is_empty();
    let message = if success {
        format!("cleared artwork from {} songs", cleared_count)
    } else {
        format!(
            "cleared artwork from {} songs, {} failed",
            cleared_count,
            failed_ids.len()
        )
    };

    BulkClearSongArtworkResponse {
        success,
        message,
        cleared_count,
        failed_ids,
    }
}
