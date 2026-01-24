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
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let album_type = req.album_type.unwrap_or_else(|| "album".to_string());

    let album_id = match sqlx::query_scalar!(
        r#"INSERT INTO albumz (title, album_type, release_date, release_date_precision, label, genre_id, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id"#,
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

    // fetch the complete album with genre and sub_genres
    super::get_album(&album_id).await
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

    let mut albums: Vec<Album> = match sqlx::query!(
        r#"SELECT
            al.id as "id!",
            al.title as "title!",
            al.album_type as "album_type!",
            al.release_date,
            al.release_date_precision,
            al.label,
            al.genre_id,
            g.name as "genre?",
            al.song_count as "song_count!",
            al.total_duration as "total_duration!",
            al.created_at as "created_at!",
            al.updated_at as "updated_at!",
            al.deleted_at,
            al.deleted_by,
            al.created_by,
            al.updated_by
           FROM albumz al
           LEFT JOIN genrez g ON al.genre_id = g.id
           WHERE al.deleted_at IS NULL
           ORDER BY al.title ASC
           LIMIT ? OFFSET ?"#,
        limit,
        offset
    )
    .fetch_all(&pool)
    .await
    {
        Ok(rows) => rows.into_iter().map(|row| Album {
            id: row.id,
            title: row.title,
            album_type: row.album_type,
            release_date: row.release_date,
            release_date_precision: row.release_date_precision,
            label: row.label,
            genre_id: row.genre_id,
            genre: row.genre,
            sub_genres: None,
            song_count: row.song_count,
            total_duration: row.total_duration,
            created_at: row.created_at,
            updated_at: row.updated_at,
            deleted_at: row.deleted_at,
            deleted_by: row.deleted_by,
            created_by: row.created_by,
            updated_by: row.updated_by,
        }).collect(),
        Err(e) => {
            return GrimoireResponse::failure("failed to list albums", vec![ErrorDetail::from(e)])
        }
    };

    // fetch sub-genres for each album
    for album in albums.iter_mut() {
        let sub_genres: Vec<String> = sqlx::query_scalar!(
            r#"SELECT sg.name
               FROM album_sub_genrez asg
               INNER JOIN sub_genrez sg ON asg.sub_genre_id = sg.id
               WHERE asg.album_id = ?
               ORDER BY sg.name ASC"#,
            album.id
        )
        .fetch_all(&pool)
        .await
        .unwrap_or_default();

        album.sub_genres = if sub_genres.is_empty() {
            None
        } else {
            Some(sub_genres)
        };
    }

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

    // fetch base album data
    let row = match sqlx::query!(
        r#"SELECT
            al.id as "id!",
            al.title as "title!",
            al.album_type as "album_type!",
            al.release_date,
            al.release_date_precision,
            al.label,
            al.genre_id,
            g.name as "genre?",
            al.song_count as "song_count!",
            al.total_duration as "total_duration!",
            al.created_at as "created_at!",
            al.updated_at as "updated_at!",
            al.deleted_at,
            al.deleted_by,
            al.created_by,
            al.updated_by
           FROM albumz al
           LEFT JOIN genrez g ON al.genre_id = g.id
           WHERE al.id = ? AND al.deleted_at IS NULL"#,
        id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(r)) => r,
        Ok(None) => {
            let err = GrimoireError::AlbumNotFound { id: id.to_string() };
            return GrimoireResponse::failure("album not found", vec![ErrorDetail::from(&err)]);
        }
        Err(e) => {
            return GrimoireResponse::failure("failed to get album", vec![ErrorDetail::from(e)])
        }
    };

    let mut album = Album {
        id: row.id,
        title: row.title,
        album_type: row.album_type,
        release_date: row.release_date,
        release_date_precision: row.release_date_precision,
        label: row.label,
        genre_id: row.genre_id,
        genre: row.genre,
        sub_genres: None,
        song_count: row.song_count,
        total_duration: row.total_duration,
        created_at: row.created_at,
        updated_at: row.updated_at,
        deleted_at: row.deleted_at,
        deleted_by: row.deleted_by,
        created_by: row.created_by,
        updated_by: row.updated_by,
    };

    // fetch sub-genres for this album
    let sub_genres: Vec<String> = match sqlx::query_scalar!(
        r#"SELECT sg.name
           FROM album_sub_genrez asg
           INNER JOIN sub_genrez sg ON asg.sub_genre_id = sg.id
           WHERE asg.album_id = ?
           ORDER BY sg.name ASC"#,
        id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(names) => names,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to fetch sub-genres",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // populate sub_genres if not empty
    album.sub_genres = if sub_genres.is_empty() {
        None
    } else {
        Some(sub_genres)
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
