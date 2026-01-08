//! album service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{Album, CreateAlbumRequest};
use crate::database;
use crate::error::{GrimoireError, GrimoireResult};

/// create a new album
pub async fn create_album(req: CreateAlbumRequest) -> GrimoireResult<Album> {
    let pool = database::connect().await?;

    let album_type = req.album_type.unwrap_or_else(|| "album".to_string());

    let album = sqlx::query_as!(
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
    .await?;

    Ok(album)
}

/// list all albums (non-deleted only)
pub async fn list_albums() -> GrimoireResult<Vec<Album>> {
    let pool = database::connect().await?;

    let albums = sqlx::query_as!(
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
           LIMIT 100"#
    )
    .fetch_all(&pool)
    .await?;

    Ok(albums)
}

/// get album by id
pub async fn get_album(id: &str) -> GrimoireResult<Album> {
    let pool = database::connect().await?;

    let album = sqlx::query_as!(
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
    .await?
    .ok_or_else(|| GrimoireError::AlbumNotFound { id: id.to_string() })?;

    Ok(album)
}

/// soft delete an album
pub async fn delete_album(id: &str, deleted_by: Option<String>) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    let rows_affected = sqlx::query!(
        "UPDATE albumz SET deleted_at = unixepoch(), updated_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        id
    )
    .execute(&pool)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(GrimoireError::AlbumNotFound { id: id.to_string() });
    }

    Ok(())
}
