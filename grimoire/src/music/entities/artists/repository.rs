//! artist service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{Artist, CreateArtistRequest, UpdateArtistRequest};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::response::GrimoireResponse;
use time::OffsetDateTime;

/// create a new artist
pub async fn create_artist(req: CreateArtistRequest) -> GrimoireResponse<Artist> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let artist = match sqlx::query_as!(
        Artist,
        r#"INSERT INTO artistz (name, created_by, updated_by)
         VALUES (?, ?, ?)
         RETURNING id as "id!", name as "name!",
                   created_at as "created_at!", updated_at as "updated_at!",
                   deleted_at, deleted_by, created_by, updated_by"#,
        req.name,
        req.created_by,
        req.created_by
    )
    .fetch_one(&pool)
    .await
    {
        Ok(a) => a,
        Err(e) => {
            return GrimoireResponse::failure("Failed to create artist", vec![ErrorDetail::from(e)])
        }
    };

    GrimoireResponse::success("Artist created successfully", artist)
}

/// list all artists (non-deleted only)
pub async fn list_artists(
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResponse<Vec<Artist>> {
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

    let artists = match sqlx::query_as!(
        Artist,
        r#"SELECT id as "id!", name as "name!",
                  created_at as "created_at!", updated_at as "updated_at!",
                  deleted_at, deleted_by, created_by, updated_by
           FROM artistz
           WHERE deleted_at IS NULL
           ORDER BY name ASC
           LIMIT ? OFFSET ?"#,
        limit,
        offset
    )
    .fetch_all(&pool)
    .await
    {
        Ok(a) => a,
        Err(e) => {
            return GrimoireResponse::failure("Failed to list artists", vec![ErrorDetail::from(e)])
        }
    };

    GrimoireResponse::success("Artists retrieved successfully", artists)
}

/// get artist by id
pub async fn get_artist(id: &str) -> GrimoireResponse<Artist> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let artist_opt = match sqlx::query_as!(
        Artist,
        r#"SELECT id as "id!", name as "name!",
                  created_at as "created_at!", updated_at as "updated_at!",
                  deleted_at, deleted_by, created_by, updated_by
           FROM artistz
           WHERE id = ? AND deleted_at IS NULL"#,
        id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(a) => a,
        Err(e) => {
            return GrimoireResponse::failure("Failed to get artist", vec![ErrorDetail::from(e)])
        }
    };

    match artist_opt {
        Some(artist) => GrimoireResponse::success("Artist retrieved successfully", artist),
        None => {
            let err = GrimoireError::ArtistNotFound { id: id.to_string() };
            GrimoireResponse::failure("Artist not found", vec![ErrorDetail::from(&err)])
        }
    }
}

/// soft delete an artist
pub async fn delete_artist(id: &str, deleted_by: Option<String>) -> GrimoireResponse<()> {
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
        "UPDATE artistz SET deleted_at = unixepoch(), deleted_by = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
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
                "Failed to delete artist",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    if rows_affected == 0 {
        let err = GrimoireError::ArtistNotFound { id: id.to_string() };
        return GrimoireResponse::failure("Artist not found", vec![ErrorDetail::from(&err)]);
    }

    // Cascade: soft-delete all albums by this artist
    let now = OffsetDateTime::now_utc().unix_timestamp();
    let album_ids: Vec<String> = match sqlx::query_scalar!(
        r#"SELECT album_id as "album_id!" FROM artist_albumz WHERE artist_id = ?"#,
        id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(ids) => ids,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to fetch artist albums",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    for album_id in &album_ids {
        // Soft-delete the album
        if let Err(e) = sqlx::query!(
            "UPDATE albumz SET deleted_at = ?, updated_at = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
            now,
            now,
            deleted_by,
            album_id
        )
        .execute(&pool)
        .await
        {
            return GrimoireResponse::failure(
                "Failed to delete artist album",
                vec![ErrorDetail::from(e)],
            );
        }

        // Cascade: soft-delete all songs in this album
        let song_ids: Vec<String> = match sqlx::query_scalar!(
            r#"SELECT song_id as "song_id!" FROM album_songz WHERE album_id = ?"#,
            album_id
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
                    "Failed to delete song",
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
    }

    // Also handle songs directly linked to artist (not via album)
    let direct_song_ids: Vec<String> = match sqlx::query_scalar!(
        r#"SELECT song_id as "song_id!" FROM artist_songz WHERE artist_id = ?"#,
        id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(ids) => ids,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to fetch artist songs",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    for song_id in &direct_song_ids {
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
                "Failed to delete artist song",
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

    GrimoireResponse::success("Artist deleted successfully", ())
}

/// update an artist's metadata
pub async fn update_artist(req: UpdateArtistRequest) -> GrimoireResponse<Artist> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // verify artist exists (including deleted ones)
    let existing = match sqlx::query_as!(
        Artist,
        r#"SELECT
                id as "id!",
                name as "name!",
                created_at as "created_at!",
                updated_at as "updated_at!",
                deleted_at,
                deleted_by,
                created_by,
                updated_by
            FROM artistz
            WHERE id = ?"#,
        req.artist_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(artist)) => artist,
        Ok(None) => {
            return GrimoireResponse::failure(
                "Artist not found",
                vec![ErrorDetail::new(
                    "not_found",
                    "Not Found",
                    "Artist not found",
                )],
            )
        }
        Err(e) => {
            return GrimoireResponse::failure("Failed to query artist", vec![ErrorDetail::from(e)])
        }
    };

    // if artist was deleted, undelete it
    if existing.deleted_at.is_some() {
        if let Err(e) = sqlx::query!(
            "UPDATE artistz SET deleted_at = NULL, deleted_by = NULL WHERE id = ?",
            req.artist_id
        )
        .execute(&pool)
        .await
        {
            return GrimoireResponse::failure(
                "Failed to undelete artist",
                vec![ErrorDetail::from(e)],
            );
        }
    }

    // update artist (only name can be updated, id stays the same)
    let updated = match sqlx::query_as!(
        Artist,
        r#"UPDATE artistz
            SET name = COALESCE(?, name),
                updated_by = COALESCE(?, updated_by),
                updated_at = unixepoch()
            WHERE id = ?
            RETURNING
                id as "id!",
                name as "name!",
                created_at as "created_at!",
                updated_at as "updated_at!",
                deleted_at,
                deleted_by,
                created_by,
                updated_by"#,
        req.name,
        req.updated_by,
        req.artist_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(artist) => artist,
        Err(e) => {
            return GrimoireResponse::failure("Failed to update artist", vec![ErrorDetail::from(e)])
        }
    };

    GrimoireResponse::success("Artist updated successfully", updated)
}

/// get all image blob IDs for an artist and its related entities
/// excludes waveform type blobs, returns only thumbnail/original images
pub async fn get_artist_images(artist_id: &str) -> GrimoireResponse<Vec<String>> {
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
    // 1. artist images from artist_imagez
    // 2. album images from album_imagez for albums by this artist
    // 3. song thumbnails from songs linked to this artist
    let image_blob_ids = match sqlx::query_scalar!(
        r#"
        SELECT DISTINCT mb.id as "id!"
        FROM media_blobz mb
        WHERE mb.id IN (
            -- artist images
            SELECT media_blob_id FROM artist_imagez WHERE artist_id = ?
            UNION
            -- album images for albums by this artist (via artist_albumz)
            SELECT ai.media_blob_id 
            FROM album_imagez ai
            JOIN artist_albumz aa ON ai.album_id = aa.album_id
            WHERE aa.artist_id = ?
            UNION
            -- song thumbnails for songs by this artist (via artist_songz)
            SELECT s.thumbnail_blob_id
            FROM songz s
            JOIN artist_songz asz ON s.id = asz.song_id
            WHERE asz.artist_id = ? AND s.deleted_at IS NULL AND s.thumbnail_blob_id IS NOT NULL
        )
        AND mb.blob_type != 'waveform'
        AND mb.deleted_at IS NULL
        ORDER BY mb.created_at DESC
        "#,
        artist_id,
        artist_id,
        artist_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(ids) => ids,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to fetch artist images",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Artist images retrieved successfully", image_blob_ids)
}
