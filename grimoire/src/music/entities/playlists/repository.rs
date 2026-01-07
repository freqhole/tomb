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
    let created_by_str = req.created_by_id.clone();
    let updated_by_str = req.created_by_id.clone();

    let playlist = sqlx::query_as!(
        Playlist,
        r#"INSERT INTO playlistz (title, description, is_public, created_by_id, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING
            id as "id!",
            title as "title!",
            description,
            is_public as "is_public!",
            thumbnail_blob_id,
            created_by_id,
            created_at as "created_at!",
            updated_at as "updated_at!",
            deleted_at,
            deleted_by,
            created_by,
            updated_by"#,
        req.title,
        req.description,
        is_public,
        req.created_by_id,
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
            p.id as "id!",
            p.title as "title!",
            p.description,
            p.is_public as "is_public!",
            p.thumbnail_blob_id,
            p.created_by_id,
            p.created_at as "created_at!",
            p.updated_at as "updated_at!",
            p.deleted_at,
            p.deleted_by,
            p.created_by,
            p.updated_by,
            COALESCE(COUNT(ps.song_id), 0) as "song_count!"
           FROM playlistz p
           LEFT JOIN playlist_songz ps ON p.id = ps.playlist_id
           WHERE p.deleted_at IS NULL
           GROUP BY p.id, p.title, p.description, p.is_public,
                   p.thumbnail_blob_id, p.created_by_id, p.created_at, p.updated_at,
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
            id as "id!",
            title as "title!",
            description,
            is_public as "is_public!",
            thumbnail_blob_id,
            created_by_id,
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

/// remove thumbnail from playlist and optionally clean up unused blob
pub async fn remove_playlist_thumbnail(
    id: &str,
    cleanup_unused_blob: bool,
    deleted_by: Option<String>,
) -> GrimoireResult<Playlist> {
    let pool = database::connect_music().await?;

    // Get current thumbnail blob ID before removing it
    let current_thumbnail_blob_id = sqlx::query!(
        "SELECT thumbnail_blob_id FROM playlistz WHERE id = ? AND deleted_at IS NULL",
        id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| GrimoireError::PlaylistNotFound { id: id.to_string() })?
    .thumbnail_blob_id;

    // Remove thumbnail from playlist
    let rows_affected = sqlx::query!(
        "UPDATE playlistz SET updated_at = unixepoch(), thumbnail_blob_id = NULL, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        id
    )
    .execute(&pool)
    .await?
    .rows_affected();

    if rows_affected == 0 {
        return Err(GrimoireError::PlaylistNotFound { id: id.to_string() });
    }

    // Optionally clean up unused media blob
    if cleanup_unused_blob {
        if let Some(blob_id) = current_thumbnail_blob_id {
            use crate::media_blobz::delete_media_blob_if_unused;
            match delete_media_blob_if_unused(&blob_id, deleted_by).await {
                Ok(deleted) => {
                    if deleted {
                        println!("Cleaned up unused media blob: {}", blob_id);
                    }
                }
                Err(e) => {
                    // Don't fail the thumbnail removal if cleanup fails
                    eprintln!("Warning: Failed to clean up media blob {}: {}", blob_id, e);
                }
            }
        }
    }

    // Return updated playlist
    get_playlist(id).await
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

    // Verify playlist exists
    sqlx::query!(
        "SELECT id FROM playlistz WHERE id = ? AND deleted_at IS NULL",
        playlist_id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| GrimoireError::PlaylistNotFound {
        id: playlist_id.to_string(),
    })?;

    // Add each song using auto-positioning trigger (position = -1)
    for song_id in song_ids.iter() {
        // Verify song exists
        sqlx::query!(
            "SELECT id FROM songz WHERE id = ? AND deleted_at IS NULL",
            song_id
        )
        .fetch_optional(&pool)
        .await?
        .ok_or_else(|| GrimoireError::SongNotFound {
            id: song_id.to_string(),
        })?;

        // Use -1 to trigger auto-positioning
        sqlx::query!(
            "INSERT INTO playlist_songz (playlist_id, song_id, position)
             VALUES (?, ?, -1)",
            playlist_id,
            song_id
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

    // Verify playlist exists
    sqlx::query!(
        "SELECT id FROM playlistz WHERE id = ? AND deleted_at IS NULL",
        playlist_id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| GrimoireError::PlaylistNotFound {
        id: playlist_id.to_string(),
    })?;

    // Remove songs
    for song_id in song_ids {
        sqlx::query!(
            "DELETE FROM playlist_songz WHERE playlist_id = ? AND song_id = ?",
            playlist_id,
            song_id
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
               WHERE ps2.playlist_id = playlist_songz.playlist_id
               AND ps2.position <= playlist_songz.position
           )
           WHERE playlist_id = ?"#,
        playlist_id
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
            ps.playlist_id as "playlist_id!",
            ps.song_id as "song_id!",
            ps.position as "position!",
            ps.added_at as "added_at!"
           FROM playlist_songz ps
           JOIN playlistz p ON p.id = ps.playlist_id
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
         JOIN playlistz p ON ps.playlist_id = p.id
         JOIN songz s ON ps.song_id = s.id
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
        if let Some(song_id) = &song.id {
            if !song_ids.contains(&song_id.as_str()) {
                other_songs.push(song_id.clone());
            }
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
         WHERE playlist_id = ?",
        playlist_id
    )
    .execute(&mut *tx)
    .await?;

    // Then update all positions to their final values
    for (song_id, position) in final_positions {
        sqlx::query!(
            "UPDATE playlist_songz
             SET position = ?
             WHERE playlist_id = ?
               AND song_id = ?",
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
