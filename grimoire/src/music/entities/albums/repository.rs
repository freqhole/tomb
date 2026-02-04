//! album service functions
//! album repository
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{Album, CreateAlbumRequest};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::music::crud::ImageMetadata;
use crate::response::GrimoireResponse;
use crate::JsonVec;
use time::OffsetDateTime;

/// create a new album
pub async fn create_album(req: CreateAlbumRequest) -> GrimoireResponse<Album> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let album_type = req.album_type.clone().unwrap_or_else(|| "album".to_string());
    let now = OffsetDateTime::now_utc().unix_timestamp();

    let album_id = match sqlx::query_scalar!(
        r#"INSERT INTO albumz (title, album_type, release_date, release_date_precision, label, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         RETURNING id"#,
        req.title,
        album_type,
        req.release_date,
        req.release_date_precision,
        req.label,
        req.created_by,
        req.created_by
    )
    .fetch_one(&pool)
    .await
    {
        Ok(Some(id)) => id,
        Ok(None) => {
            return GrimoireResponse::failure(
                "failed to get album id after insert",
                vec![],
            )
        }
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to create album",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // return the album directly without fetching from view
    // (the view filters out albums with song_count = 0)
    let album = Album {
        id: album_id,
        title: req.title,
        album_type,
        release_date: req.release_date,
        release_date_precision: req.release_date_precision,
        label: req.label,
        genres: None,
        genre_ids: None,
        images: None,
        song_count: 0,
        total_duration: 0,
        created_at: now,
        updated_at: now,
        deleted_at: None,
        deleted_by: None,
        created_by: req.created_by.clone(),
        updated_by: req.created_by,
    };

    GrimoireResponse::success("album created successfully", album)
}

/// list all albums (non-deleted only)
pub async fn list_albums(limit: Option<u32>, offset: Option<u32>) -> GrimoireResponse<Vec<Album>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };
    let limit = limit.unwrap_or(100).min(1000) as i64;
    let offset = offset.unwrap_or(0) as i64;

    let albums: Vec<Album> = match sqlx::query_as!(
        Album,
        r#"SELECT
            album_id as "id!",
            album_title as "title!",
            album_album_type as "album_type!",
            album_release_date as "release_date?",
            album_release_date_precision as "release_date_precision?",
            album_label as "label?",
            album_genres as "genres: crate::JsonVec<String>",
            album_genre_ids as "genre_ids: crate::JsonVec<String>",
            album_song_count as "song_count!",
            album_total_duration as "total_duration!",
            album_created_at as "created_at!",
            album_updated_at as "updated_at!",
            album_deleted_at as "deleted_at?",
            album_deleted_by as "deleted_by?",
            album_created_by as "created_by?",
            album_updated_by as "updated_by?",
            album_images as "images: JsonVec<ImageMetadata>"
           FROM album_query_view
           ORDER BY album_title ASC
           LIMIT ? OFFSET ?"#,
        limit,
        offset
    )
    .fetch_all(&pool)
    .await
    {
        Ok(albums) => albums,
        Err(e) => {
            return GrimoireResponse::failure("failed to list albums", vec![ErrorDetail::from(e)])
        }
    };

    GrimoireResponse::success("albums retrieved successfully", albums)
}

/// get album by id
pub async fn get_album(id: &str) -> GrimoireResponse<Album> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // fetch album from view
    let album = match sqlx::query_as!(
        Album,
        r#"SELECT
            album_id as "id!",
            album_title as "title!",
            album_album_type as "album_type!",
            album_release_date as "release_date?",
            album_release_date_precision as "release_date_precision?",
            album_label as "label?",
            album_genres as "genres: crate::JsonVec<String>",
            album_genre_ids as "genre_ids: crate::JsonVec<String>",
            album_song_count as "song_count!",
            album_total_duration as "total_duration!",
            album_created_at as "created_at!",
            album_updated_at as "updated_at!",
            album_deleted_at as "deleted_at?",
            album_deleted_by as "deleted_by?",
            album_created_by as "created_by?",
            album_updated_by as "updated_by?",
            album_images as "images: JsonVec<ImageMetadata>"
           FROM album_query_view
           WHERE album_id = ?"#,
        id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(album)) => album,
        Ok(None) => {
            let err = GrimoireError::AlbumNotFound { id: id.to_string() };
            return GrimoireResponse::failure("album not found", vec![ErrorDetail::from(&err)]);
        }
        Err(e) => {
            return GrimoireResponse::failure("failed to get album", vec![ErrorDetail::from(e)])
        }
    };

    GrimoireResponse::success("album retrieved successfully", album)
}

/// soft delete an album
pub async fn delete_album(id: &str, deleted_by: Option<String>) -> GrimoireResponse<()> {
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
        "UPDATE albumz SET deleted_at = unixepoch(), updated_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => result.rows_affected(),
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to delete album",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    if rows_affected == 0 {
        let err = GrimoireError::AlbumNotFound { id: id.to_string() };
        return GrimoireResponse::failure("Album not found", vec![ErrorDetail::from(&err)]);
    }

    // Cascade: soft-delete all songs in this album and remove them from playlists
    let now = OffsetDateTime::now_utc().unix_timestamp();
    let song_ids: Vec<String> = match sqlx::query_scalar!(
        r#"SELECT song_id as "song_id!" FROM album_songz WHERE album_id = ?"#,
        id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(ids) => ids,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to fetch album songs",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    for song_id in &song_ids {
        // Soft-delete the song
        if let Err(e) = sqlx::query!(
            "UPDATE songz SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
            now,
            now,
            deleted_by,
            song_id
        )
        .execute(&pool)
        .await
        {
            return GrimoireResponse::failure(
                "Failed to delete album song",
                vec![ErrorDetail::from(e)],
            );
        }

        // Remove from all playlists
        if let Err(e) = sqlx::query!("DELETE FROM playlist_songz WHERE song_id = ?", song_id)
            .execute(&pool)
            .await
        {
            return GrimoireResponse::failure(
                "Failed to remove song from playlists",
                vec![ErrorDetail::from(e)],
            );
        }
    }

    GrimoireResponse::success("Album deleted successfully", ())
}

/// get all image blob IDs for an album and its songs
/// excludes waveform type blobs, returns only thumbnail/original images
pub async fn get_album_images(album_id: &str) -> GrimoireResponse<Vec<String>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // fetch all image blob IDs:
    // 1. album images from album_imagez
    // 2. song images from song_imagez for this album
    let image_blob_ids = match sqlx::query_scalar!(
        r#"
        SELECT DISTINCT mb.id as "id!"
        FROM media_blobz mb
        WHERE mb.id IN (
            -- album images
            SELECT media_blob_id FROM album_imagez WHERE album_id = ?
            UNION
            -- song images for this album
            SELECT si.media_blob_id
            FROM song_imagez si
            JOIN album_songz asz ON si.song_id = asz.song_id
            WHERE asz.album_id = ?
        )
        AND mb.blob_type != 'waveform'
        AND mb.deleted_at IS NULL
        ORDER BY mb.created_at DESC
        "#,
        album_id,
        album_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(ids) => ids,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to fetch album images",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Album images retrieved successfully", image_blob_ids)
}
/// add an image to an album
pub async fn add_album_image(
    album_id: &str,
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
            "UPDATE album_imagez SET is_primary = 0 WHERE album_id = ?",
            album_id
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
        "INSERT INTO album_imagez (album_id, media_blob_id, is_primary) VALUES (?, ?, ?)",
        album_id,
        media_blob_id,
        is_primary
    )
    .execute(&pool)
    .await
    {
        Ok(_) => GrimoireResponse::success("Image added to album", ()),
        Err(e) => {
            GrimoireResponse::failure("Failed to add image to album", vec![ErrorDetail::from(e)])
        }
    }
}

/// remove an image from an album
pub async fn remove_album_image(album_id: &str, media_blob_id: &str) -> GrimoireResponse<()> {
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
        "DELETE FROM album_imagez WHERE album_id = ? AND media_blob_id = ?",
        album_id,
        media_blob_id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => {
            if result.rows_affected() == 0 {
                GrimoireResponse::failure("Image not found for album", vec![])
            } else {
                GrimoireResponse::success("Image removed from album", ())
            }
        }
        Err(e) => GrimoireResponse::failure(
            "Failed to remove image from album",
            vec![ErrorDetail::from(e)],
        ),
    }
}

/// set an image as the primary image for an album
pub async fn set_primary_album_image(album_id: &str, media_blob_id: &str) -> GrimoireResponse<()> {
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
        "UPDATE album_imagez SET is_primary = 0 WHERE album_id = ?",
        album_id
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
        "UPDATE album_imagez SET is_primary = 1 WHERE album_id = ? AND media_blob_id = ?",
        album_id,
        media_blob_id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => {
            if result.rows_affected() == 0 {
                GrimoireResponse::failure("Image not found for album", vec![])
            } else {
                GrimoireResponse::success("Primary image updated", ())
            }
        }
        Err(e) => {
            GrimoireResponse::failure("Failed to set primary image", vec![ErrorDetail::from(e)])
        }
    }
}

/// remove all images from an album
pub async fn clear_album_images(album_id: &str) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    match sqlx::query!("DELETE FROM album_imagez WHERE album_id = ?", album_id)
        .execute(&pool)
        .await
    {
        Ok(_) => GrimoireResponse::success("All images removed from album", ()),
        Err(e) => {
            GrimoireResponse::failure("Failed to clear album images", vec![ErrorDetail::from(e)])
        }
    }
}
