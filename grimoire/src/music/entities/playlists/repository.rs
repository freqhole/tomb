//! playlist service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{
    CreatePlaylistRequest, Playlist, PlaylistSong, PlaylistWithCount, UpdatePlaylistRequest,
};
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
/// this probably could be deleted since we have query_playlists
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

/// update playlist metadata
pub async fn update_playlist(id: &str, req: UpdatePlaylistRequest) -> GrimoireResult<Playlist> {
    let pool = database::connect_music().await?;

    // Convert is_public boolean to integer for SQLite
    let is_public_int = req.is_public.map(|p| if p { 1 } else { 0 });

    // Single query that updates all provided fields using COALESCE
    // This keeps existing values when the request field is None
    let rows_affected = sqlx::query!(
        "UPDATE playlistz SET
            updated_at = unixepoch(),
            title = COALESCE(?, title),
            description = COALESCE(?, description),
            is_public = COALESCE(?, is_public),
            thumbnail_blob_id = COALESCE(?, thumbnail_blob_id),
            updated_by = COALESCE(?, updated_by)
        WHERE id = ? AND deleted_at IS NULL",
        req.title,
        req.description,
        is_public_int,
        req.thumbnail_blob_id,
        req.updated_by,
        id
    )
    .execute(&pool)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(GrimoireError::PlaylistNotFound { id: id.to_string() });
    }

    // Fetch and return the updated playlist
    let playlist = get_playlist(id).await?;
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
    // Single song reordering - delegate to the multiple song function
    update_songs_position(playlist_id, &[song_id], new_position).await
}

pub async fn update_songs_position(
    playlist_id: &str,
    song_ids: &[&str],
    new_position: i64,
) -> GrimoireResult<()> {
    let pool = database::connect_music().await?;

    // Step 1: Get all songs in playlist with their current positions
    let all_songs = sqlx::query!(
        "SELECT s.id, ps.position
         FROM playlist_songz ps
         JOIN playlistz p ON ps.playlist_rowid = p.rowid
         JOIN songz s ON ps.song_rowid = s.rowid
         WHERE p.id = ? AND p.deleted_at IS NULL
         ORDER BY ps.position",
        playlist_id
    )
    .fetch_all(&pool)
    .await?;

    // Step 2: Calculate new positions in Rust
    let mut final_positions = Vec::new();

    // Collect songs that aren't being moved
    let mut other_songs = Vec::new();
    for song in &all_songs {
        if !song_ids.contains(&song.id.as_str()) {
            other_songs.push(song.id.clone());
        }
    }

    // Build final order: insert moved songs at target position
    let insert_at = ((new_position - 1) as usize).min(other_songs.len());

    // Add songs before target position
    for (pos, song_id) in other_songs[..insert_at].iter().enumerate() {
        final_positions.push((song_id.clone(), pos as i64 + 1));
    }

    // Add moved songs at target position
    for (i, &song_id) in song_ids.iter().enumerate() {
        final_positions.push((song_id.to_string(), insert_at as i64 + 1 + i as i64));
    }

    // Add remaining songs after
    for (i, song_id) in other_songs[insert_at..].iter().enumerate() {
        let pos = insert_at as i64 + song_ids.len() as i64 + i as i64 + 1;
        final_positions.push((song_id.clone(), pos));
    }

    // Step 3: Use transaction for bulk update
    let mut tx = pool.begin().await?;

    // First, move all songs to negative positions to avoid UNIQUE constraint conflicts
    sqlx::query!(
        "UPDATE playlist_songz
         SET position = -position
         FROM playlistz p
         WHERE playlist_songz.playlist_rowid = p.rowid
           AND p.id = ?",
        playlist_id
    )
    .execute(&mut *tx)
    .await?;

    // Then update all positions to their final values
    for (song_id, position) in final_positions {
        sqlx::query!(
            "UPDATE playlist_songz
             SET position = ?
             FROM playlistz p, songz s
             WHERE playlist_songz.playlist_rowid = p.rowid
               AND playlist_songz.song_rowid = s.rowid
               AND p.id = ?
               AND s.id = ?",
            position,
            playlist_id,
            song_id
        )
        .execute(&mut *tx)
        .await?;
    }

    tx.commit().await?;
    Ok(())
}
