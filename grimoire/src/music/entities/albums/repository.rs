//! album service functions
//! album repository
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{Album, CreateAlbumRequest};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::response::GrimoireResponse;
use time::OffsetDateTime;

/// create a new album
pub async fn create_album(req: CreateAlbumRequest) -> GrimoireResponse<Album> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let album_type = req.album_type.unwrap_or_else(|| "album".to_string());

    let album = match sqlx::query_as!(
        Album,
        r#"INSERT INTO albumz (title, album_type, release_date, release_date_precision, label, genre_id, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING
            id as "id!",
            title as "title!",
            album_type as "album_type!",
            release_date,
            release_date_precision,
            label,
            genre_id,
            song_count as "song_count!",
            total_duration as "total_duration!",
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            deleted_by,
            created_by,
            updated_by"#,
        req.title,
        album_type,
        req.release_date,
        req.release_date_precision,
        req.label,
        req.genre_id,
        req.created_by,
        req.created_by
    )
    .fetch_one(&pool)
    .await
    {
        Ok(a) => a,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to create album",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Album created successfully", album)
}

/// list all albums (non-deleted only)
pub async fn list_albums(limit: Option<u32>, offset: Option<u32>) -> GrimoireResponse<Vec<Album>> {
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

    let albums = match sqlx::query_as!(
        Album,
        r#"SELECT
            id as "id!",
            title as "title!",
            album_type as "album_type!",
            release_date,
            release_date_precision,
            label,
            genre_id,
            song_count as "song_count!",
            total_duration as "total_duration!",
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            deleted_by,
            created_by,
            updated_by
           FROM albumz
           WHERE deleted_at IS NULL
           ORDER BY title ASC
           LIMIT ? OFFSET ?"#,
        limit,
        offset
    )
    .fetch_all(&pool)
    .await
    {
        Ok(a) => a,
        Err(e) => {
            return GrimoireResponse::failure("Failed to list albums", vec![ErrorDetail::from(e)])
        }
    };

    GrimoireResponse::success("Albums retrieved successfully", albums)
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

    let album_opt = match sqlx::query_as!(
        Album,
        r#"SELECT
            id as "id!",
            title as "title!",
            album_type as "album_type!",
            release_date,
            release_date_precision,
            label,
            genre_id,
            song_count as "song_count!",
            total_duration as "total_duration!",
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            deleted_by,
            created_by,
            updated_by
           FROM albumz
           WHERE id = ? AND deleted_at IS NULL"#,
        id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(a) => a,
        Err(e) => {
            return GrimoireResponse::failure("Failed to get album", vec![ErrorDetail::from(e)])
        }
    };

    match album_opt {
        Some(album) => GrimoireResponse::success("Album retrieved successfully", album),
        None => {
            let err = GrimoireError::AlbumNotFound { id: id.to_string() };
            GrimoireResponse::failure("Album not found", vec![ErrorDetail::from(&err)])
        }
    }
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
