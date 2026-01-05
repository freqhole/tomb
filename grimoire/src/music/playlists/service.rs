//! playlist service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{CreatePlaylistRequest, Playlist, PlaylistSong, PlaylistWithCount};
use crate::database;
use crate::error::{GrimoireError, GrimoireResult};

/// create a new playlist
pub async fn create_playlist(
    req: CreatePlaylistRequest,
    music_db_path: &str,
) -> GrimoireResult<Playlist> {
    let pool = database::connect_music(music_db_path).await?;

    let is_public = if req.is_public.unwrap_or(false) { 1 } else { 0 };

    let playlist = sqlx::query_as!(
        Playlist,
        r#"INSERT INTO playlistz (title, description, is_public, created_by_rowid, created_at, updated_at)
         VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
         RETURNING
            rowid as "rowid!",
            id as "id!",
            title as "title!",
            description,
            is_public as "is_public!",
            created_by_rowid,
            created_at,
            updated_at"#,
        req.title,
        req.description,
        is_public,
        req.created_by_rowid
    )
    .fetch_one(&pool)
    .await?;

    Ok(playlist)
}

/// list all playlists (with song counts)
pub async fn list_playlists(music_db_path: &str) -> GrimoireResult<Vec<PlaylistWithCount>> {
    let pool = database::connect_music(music_db_path).await?;

    let playlists = sqlx::query_as!(
        PlaylistWithCount,
        r#"SELECT
            p.rowid as "rowid!",
            p.id as "id!",
            p.title as "title!",
            p.description,
            p.is_public as "is_public!",
            p.created_by_rowid,
            p.created_at,
            p.updated_at,
            COALESCE(COUNT(ps.song_rowid), 0) as "song_count!"
           FROM playlistz p
           LEFT JOIN playlist_songz ps ON p.rowid = ps.playlist_rowid
           GROUP BY p.rowid, p.id, p.title, p.description, p.is_public,
                   p.created_by_rowid, p.created_at, p.updated_at
           ORDER BY p.title ASC"#
    )
    .fetch_all(&pool)
    .await?;

    Ok(playlists)
}

/// get playlist by id
pub async fn get_playlist(id: &str, music_db_path: &str) -> GrimoireResult<Playlist> {
    let pool = database::connect_music(music_db_path).await?;

    let playlist = sqlx::query_as!(
        Playlist,
        r#"SELECT
            rowid as "rowid!",
            id as "id!",
            title as "title!",
            description,
            is_public as "is_public!",
            created_by_rowid,
            created_at,
            updated_at
           FROM playlistz
           WHERE id = ?"#,
        id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| GrimoireError::PlaylistNotFound { id: id.to_string() })?;

    Ok(playlist)
}

/// delete a playlist
pub async fn delete_playlist(id: &str, music_db_path: &str) -> GrimoireResult<()> {
    let pool = database::connect_music(music_db_path).await?;

    // First delete all playlist songs
    sqlx::query!(
        "DELETE FROM playlist_songz WHERE playlist_rowid = (SELECT rowid FROM playlistz WHERE id = ?)",
        id
    )
    .execute(&pool)
    .await?;

    // Then delete the playlist
    let rows_affected = sqlx::query!("DELETE FROM playlistz WHERE id = ?", id)
        .execute(&pool)
        .await?
        .rows_affected();

    if rows_affected == 0 {
        return Err(GrimoireError::PlaylistNotFound { id: id.to_string() });
    }

    Ok(())
}

/// add songs to a playlist
pub async fn add_songs_to_playlist(
    playlist_id: &str,
    song_ids: &[String],
    music_db_path: &str,
) -> GrimoireResult<()> {
    let pool = database::connect_music(music_db_path).await?;

    // Get playlist rowid
    let playlist_rowid = sqlx::query!("SELECT rowid FROM playlistz WHERE id = ?", playlist_id)
        .fetch_optional(&pool)
        .await?
        .ok_or_else(|| GrimoireError::PlaylistNotFound {
            id: playlist_id.to_string(),
        })?
        .rowid;

    // Get current max position
    let max_position = sqlx::query!(
        "SELECT COALESCE(MAX(position), 0) as \"max_pos!: i64\" FROM playlist_songz WHERE playlist_rowid = ?",
        playlist_rowid
    )
    .fetch_one(&pool)
    .await?
    .max_pos;

    // Add each song
    for (i, song_id) in song_ids.iter().enumerate() {
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

        let position = max_position + (i as i64) + 1;

        sqlx::query!(
            "INSERT INTO playlist_songz (playlist_rowid, song_rowid, position, added_at)
             VALUES (?, ?, ?, unixepoch())",
            playlist_rowid,
            song_rowid,
            position
        )
        .execute(&pool)
        .await?;
    }

    Ok(())
}

/// remove songs from a playlist
pub async fn remove_songs_from_playlist(
    playlist_id: &str,
    song_ids: &[String],
    music_db_path: &str,
) -> GrimoireResult<()> {
    let pool = database::connect_music(music_db_path).await?;

    // Get playlist rowid
    let playlist_rowid = sqlx::query!("SELECT rowid FROM playlistz WHERE id = ?", playlist_id)
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
pub async fn get_playlist_songs(
    playlist_id: &str,
    music_db_path: &str,
) -> GrimoireResult<Vec<PlaylistSong>> {
    let pool = database::connect_music(music_db_path).await?;

    let playlist_songs = sqlx::query_as!(
        PlaylistSong,
        r#"SELECT
            ps.playlist_rowid as "playlist_rowid!",
            ps.song_rowid as "song_rowid!",
            ps.position as "position!",
            ps.added_at as "added_at!"
           FROM playlist_songz ps
           JOIN playlistz p ON p.rowid = ps.playlist_rowid
           WHERE p.id = ?
           ORDER BY ps.position ASC"#,
        playlist_id
    )
    .fetch_all(&pool)
    .await?;

    Ok(playlist_songs)
}
