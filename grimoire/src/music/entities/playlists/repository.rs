//! playlist service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{CreatePlaylistRequest, Playlist, PlaylistSong, PlaylistWithCount};
use crate::database;
use crate::error::{GrimoireError, GrimoireResult};

/// create a new playlist
pub async fn create_playlist(req: CreatePlaylistRequest) -> GrimoireResult<Playlist> {
    let pool = database::connect_music().await?;

    let is_public = if req.is_public.unwrap_or(false) { 1 } else { 0 };
    let created_by_str = req.created_by_rowid.map(|id| id.to_string());
    let updated_by_str = req.created_by_rowid.map(|id| id.to_string());

    let playlist = sqlx::query_as!(
        Playlist,
        r#"INSERT INTO playlistz (title, description, is_public, created_by_rowid, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING
            rowid as "rowid!",
            id as "id!",
            title as "title!",
            description,
            is_public as "is_public!",
            thumbnail_blob_id,
            created_by_rowid,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            deleted_by,
            created_by,
            updated_by"#,
        req.title,
        req.description,
        is_public,
        req.created_by_rowid,
        created_by_str,
        updated_by_str
    )
    .fetch_one(&pool)
    .await?;

    Ok(playlist)
}

/// list all playlists (with song counts)
pub async fn list_playlists() -> GrimoireResult<Vec<PlaylistWithCount>> {
    let pool = database::connect_music().await?;

    let playlists = sqlx::query_as!(
        PlaylistWithCount,
        r#"SELECT
            p.rowid as "rowid!",
            p.id as "id!",
            p.title as "title!",
            p.description,
            p.is_public as "is_public!",
            p.thumbnail_blob_id,
            p.created_by_rowid,
            p.created_at as "created_at!",
            p.updated_at as "updated_at!",
            p.deleted_at,
            p.deleted_by,
            p.created_by,
            p.updated_by,
            COALESCE(COUNT(ps.song_rowid), 0) as "song_count!"
           FROM playlistz p
           LEFT JOIN playlist_songz ps ON p.rowid = ps.playlist_rowid
           WHERE p.deleted_at IS NULL
           GROUP BY p.rowid, p.id, p.title, p.description, p.is_public,
                   p.thumbnail_blob_id, p.created_by_rowid, p.created_at, p.updated_at,
                   p.deleted_at, p.deleted_by, p.created_by, p.updated_by
           ORDER BY p.title ASC"#
    )
    .fetch_all(&pool)
    .await?;

    Ok(playlists)
}

/// get playlist by id
pub async fn get_playlist(id: &str) -> GrimoireResult<Playlist> {
    let pool = database::connect_music().await?;

    let playlist = sqlx::query_as!(
        Playlist,
        r#"SELECT
            rowid as "rowid!",
            id as "id!",
            title as "title!",
            description,
            is_public as "is_public!",
            thumbnail_blob_id,
            created_by_rowid,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            deleted_by,
            created_by,
            updated_by
           FROM playlistz
           WHERE id = ? AND deleted_at IS NULL"#,
        id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| GrimoireError::PlaylistNotFound { id: id.to_string() })?;

    Ok(playlist)
}

/// soft delete a playlist
pub async fn delete_playlist(id: &str, deleted_by: Option<String>) -> GrimoireResult<()> {
    let pool = database::connect_music().await?;

    let rows_affected = sqlx::query!(
        "UPDATE playlistz SET deleted_at = unixepoch(), deleted_by = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        deleted_by,
        id
    )
    .execute(&pool)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(GrimoireError::PlaylistNotFound { id: id.to_string() });
    }

    Ok(())
}

/// add songs to a playlist
pub async fn add_songs_to_playlist(playlist_id: &str, song_ids: &[String]) -> GrimoireResult<()> {
    let pool = database::connect_music().await?;

    // Get playlist rowid
    let playlist_rowid = sqlx::query!(
        "SELECT rowid FROM playlistz WHERE id = ? AND deleted_at IS NULL",
        playlist_id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| GrimoireError::PlaylistNotFound {
        id: playlist_id.to_string(),
    })?
    .rowid;

    // Add each song using auto-positioning trigger (position = -1)
    for song_id in song_ids.iter() {
        // Get song rowid
        let song_rowid = sqlx::query!(
            "SELECT rowid FROM songz WHERE id = ? AND deleted_at IS NULL",
            song_id
        )
        .fetch_optional(&pool)
        .await?
        .ok_or_else(|| GrimoireError::SongNotFound {
            id: song_id.to_string(),
        })?
        .rowid;

        // Use -1 to trigger auto-positioning
        sqlx::query!(
            "INSERT INTO playlist_songz (playlist_rowid, song_rowid, position)
             VALUES (?, ?, -1)",
            playlist_rowid,
            song_rowid
        )
        .execute(&pool)
        .await?;
    }

    Ok(())
}

/// remove songs from a playlist
pub async fn remove_songs_from_playlist(
    playlist_id: &str,
    song_ids: Vec<String>,
) -> GrimoireResult<()> {
    let pool = database::connect_music().await?;

    // Get playlist rowid
    let playlist_rowid = sqlx::query!(
        "SELECT rowid FROM playlistz WHERE id = ? AND deleted_at IS NULL",
        playlist_id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| GrimoireError::PlaylistNotFound {
        id: playlist_id.to_string(),
    })?
    .rowid;

    // Remove songs
    for song_id in song_ids {
        let song_rowid = sqlx::query!("SELECT rowid FROM songz WHERE id = ?", song_id)
            .fetch_optional(&pool)
            .await?
            .ok_or_else(|| GrimoireError::SongNotFound {
                id: song_id.to_string(),
            })?
            .rowid;

        sqlx::query!(
            "DELETE FROM playlist_songz WHERE playlist_rowid = ? AND song_rowid = ?",
            playlist_rowid,
            song_rowid
        )
        .execute(&pool)
        .await?;
    }

    // Reorder remaining songs to fill gaps
    sqlx::query!(
        r#"UPDATE playlist_songz
           SET position = (
               SELECT ROW_NUMBER() OVER (ORDER BY position)
               FROM playlist_songz ps2
               WHERE ps2.playlist_rowid = playlist_songz.playlist_rowid
               AND ps2.position <= playlist_songz.position
           )
           WHERE playlist_rowid = ?"#,
        playlist_rowid
    )
    .execute(&pool)
    .await?;

    Ok(())
}

/// get songs in a playlist
pub async fn get_playlist_songs(playlist_id: &str) -> GrimoireResult<Vec<PlaylistSong>> {
    let pool = database::connect_music().await?;

    let playlist_songs = sqlx::query_as!(
        PlaylistSong,
        r#"SELECT
            ps.playlist_rowid as "playlist_rowid!",
            ps.song_rowid as "song_rowid!",
            ps.position as "position!",
            ps.added_at as "added_at!"
           FROM playlist_songz ps
           JOIN playlistz p ON p.rowid = ps.playlist_rowid
           WHERE p.id = ? AND p.deleted_at IS NULL
           ORDER BY ps.position ASC"#,
        playlist_id
    )
    .fetch_all(&pool)
    .await?;

    Ok(playlist_songs)
}

/// update the position of a song in a playlist
/// uses pure UPDATE approach without delete/insert to avoid constraint issues
pub async fn update_song_position(
    playlist_id: &str,
    song_id: &str,
    new_position: i64,
) -> GrimoireResult<()> {
    let pool = database::connect_music().await?;

    // Get playlist rowid
    let playlist_rowid = sqlx::query!(
        "SELECT rowid FROM playlistz WHERE id = ? AND deleted_at IS NULL",
        playlist_id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| GrimoireError::PlaylistNotFound {
        id: playlist_id.to_string(),
    })?
    .rowid;

    // Get song rowid and current position
    let song_info = sqlx::query!(
        "SELECT ps.song_rowid, ps.position
         FROM playlist_songz ps
         JOIN songz s ON ps.song_rowid = s.rowid
         WHERE ps.playlist_rowid = ? AND s.id = ?",
        playlist_rowid,
        song_id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| GrimoireError::SongNotInPlaylist {
        song_id: song_id.to_string(),
        playlist_id: playlist_id.to_string(),
    })?;

    let current_position = song_info.position;
    let song_rowid = song_info.song_rowid;

    if current_position == new_position {
        return Ok(()); // No change needed
    }

    // Start transaction for atomic position updates
    let mut tx = pool.begin().await?;

    // Temporarily move the target song to position 0 to avoid conflicts
    sqlx::query!(
        "UPDATE playlist_songz SET position = 0 WHERE playlist_rowid = ? AND song_rowid = ?",
        playlist_rowid,
        song_rowid
    )
    .execute(&mut *tx)
    .await?;

    if new_position > current_position {
        // Moving down: shift songs between current and new position up
        sqlx::query!(
            "UPDATE playlist_songz SET position = position - 1
             WHERE playlist_rowid = ? AND position > ? AND position <= ?",
            playlist_rowid,
            current_position,
            new_position
        )
        .execute(&mut *tx)
        .await?;
    } else {
        // Moving up: shift songs between new and current position down
        sqlx::query!(
            "UPDATE playlist_songz SET position = position + 1
             WHERE playlist_rowid = ? AND position >= ? AND position < ?",
            playlist_rowid,
            new_position,
            current_position
        )
        .execute(&mut *tx)
        .await?;
    }

    // Move the target song to its final position
    sqlx::query!(
        "UPDATE playlist_songz SET position = ? WHERE playlist_rowid = ? AND song_rowid = ?",
        new_position,
        playlist_rowid,
        song_rowid
    )
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(())
}
