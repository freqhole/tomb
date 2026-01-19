//! playlist service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{CreatePlaylistRequest, Playlist, PlaylistSong, UpdatePlaylistRequest};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::response::GrimoireResponse;

/// create a new playlist
pub async fn create_playlist(req: CreatePlaylistRequest) -> GrimoireResponse<Playlist> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let is_public = if req.is_public.unwrap_or(false) { 1 } else { 0 };
    let created_by_str = req.created_by_id.clone();
    let updated_by_str = req.created_by_id.clone();

    let playlist_id = match sqlx::query!(
        r#"INSERT INTO playlistz (title, description, is_public, created_by_id, created_by, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING id"#,
        req.title,
        req.description,
        is_public,
        req.created_by_id,
        created_by_str,
        updated_by_str
    )
    .fetch_one(&pool)
    .await {
        Ok(row) => row.id,
        Err(e) => return GrimoireResponse::failure("Failed to create playlist", vec![ErrorDetail::from(e)]),
    };

    // Fetch with song count
    let playlist = match sqlx::query_as!(
        Playlist,
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
            COALESCE(COUNT(ps.song_id), 0) as "song_count!: i64"
        FROM playlistz p
        LEFT JOIN playlist_songz ps ON p.id = ps.playlist_id
        WHERE p.id = ?
        GROUP BY p.id"#,
        playlist_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to fetch created playlist",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Playlist created successfully", playlist)
}

/// list all playlists (with song counts)
/// this probably could be deleted since we have query_playlists
pub async fn list_playlists() -> GrimoireResponse<Vec<Playlist>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let playlists = match sqlx::query_as!(
        Playlist,
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
            COALESCE(COUNT(ps.song_id), 0) as "song_count: i64"
        FROM playlistz p
        LEFT JOIN playlist_songz ps ON p.id = ps.playlist_id
        WHERE p.deleted_at IS NULL
        GROUP BY p.id
        ORDER BY p.created_at DESC"#
    )
    .fetch_all(&pool)
    .await
    {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to list playlists",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Playlists retrieved successfully", playlists)
}

/// get playlist by id
pub async fn get_playlist(id: &str) -> GrimoireResponse<Playlist> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let playlist_opt = match sqlx::query_as!(
        Playlist,
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
            COALESCE(COUNT(ps.song_id), 0) as "song_count!: i64"
          FROM playlistz p
          LEFT JOIN playlist_songz ps ON p.id = ps.playlist_id
          WHERE p.id = ? AND p.deleted_at IS NULL
          GROUP BY p.id"#,
        id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to get playlist", vec![ErrorDetail::from(e)])
        }
    };

    match playlist_opt {
        Some(playlist) => GrimoireResponse::success("Playlist retrieved successfully", playlist),
        None => {
            let err = GrimoireError::PlaylistNotFound { id: id.to_string() };
            GrimoireResponse::failure("Playlist not found", vec![ErrorDetail::from(&err)])
        }
    }
}

/// remove thumbnail from playlist and optionally clean up unused blob
pub async fn remove_playlist_thumbnail(
    id: &str,
    cleanup_unused_blob: bool,
    deleted_by: Option<String>,
) -> GrimoireResponse<Playlist> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // Get current thumbnail blob ID before removing it
    let current_thumbnail_blob_id_opt = match sqlx::query!(
        "SELECT thumbnail_blob_id FROM playlistz WHERE id = ? AND deleted_at IS NULL",
        id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to query playlist",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let current_thumbnail_blob_id = match current_thumbnail_blob_id_opt {
        Some(row) => row.thumbnail_blob_id,
        None => {
            let err = GrimoireError::PlaylistNotFound { id: id.to_string() };
            return GrimoireResponse::failure("Playlist not found", vec![ErrorDetail::from(&err)]);
        }
    };

    // Remove thumbnail from playlist
    let rows_affected = match sqlx::query!(
        "UPDATE playlistz SET updated_at = unixepoch(), thumbnail_blob_id = NULL, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        id
    )
    .execute(&pool)
    .await {
        Ok(result) => result.rows_affected(),
        Err(e) => return GrimoireResponse::failure("Failed to remove thumbnail", vec![ErrorDetail::from(e)]),
    };

    if rows_affected == 0 {
        let err = GrimoireError::PlaylistNotFound { id: id.to_string() };
        return GrimoireResponse::failure("Playlist not found", vec![ErrorDetail::from(&err)]);
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
pub async fn update_playlist(id: &str, req: UpdatePlaylistRequest) -> GrimoireResponse<Playlist> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // Convert is_public boolean to integer for SQLite
    let is_public_int = req.is_public.map(|p| if p { 1 } else { 0 });

    // Single query that updates all provided fields using COALESCE
    // This keeps existing values when the request field is None
    let rows_affected = match sqlx::query!(
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
    .await
    {
        Ok(result) => result.rows_affected(),
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to update playlist",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    if rows_affected == 0 {
        let err = GrimoireError::PlaylistNotFound { id: id.to_string() };
        return GrimoireResponse::failure("Playlist not found", vec![ErrorDetail::from(&err)]);
    }

    // Fetch and return the updated playlist
    get_playlist(id).await
}

/// soft delete a playlist
pub async fn delete_playlist(id: &str, deleted_by: Option<String>) -> GrimoireResponse<()> {
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
        "UPDATE playlistz SET deleted_at = unixepoch(), deleted_by = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        deleted_by,
        id
    )
    .execute(&pool)
    .await {
        Ok(result) => result.rows_affected(),
        Err(e) => return GrimoireResponse::failure("Failed to delete playlist", vec![ErrorDetail::from(e)]),
    };

    if rows_affected == 0 {
        let err = GrimoireError::PlaylistNotFound { id: id.to_string() };
        return GrimoireResponse::failure("Playlist not found", vec![ErrorDetail::from(&err)]);
    }

    GrimoireResponse::success("Playlist deleted successfully", ())
}

/// add songs to a playlist
pub async fn add_songs_to_playlist(playlist_id: &str, song_ids: &[String]) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // Verify playlist exists
    let playlist_exists = match sqlx::query!(
        "SELECT id FROM playlistz WHERE id = ? AND deleted_at IS NULL",
        playlist_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to verify playlist",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    if playlist_exists.is_none() {
        let err = GrimoireError::PlaylistNotFound {
            id: playlist_id.to_string(),
        };
        return GrimoireResponse::failure("Playlist not found", vec![ErrorDetail::from(&err)]);
    }

    // Add each song using auto-positioning trigger (position = -1)
    for song_id in song_ids.iter() {
        // Verify song exists
        let song_exists = match sqlx::query!(
            "SELECT id FROM songz WHERE id = ? AND deleted_at IS NULL",
            song_id
        )
        .fetch_optional(&pool)
        .await
        {
            Ok(row) => row,
            Err(e) => {
                return GrimoireResponse::failure(
                    "Failed to verify song",
                    vec![ErrorDetail::from(e)],
                )
            }
        };

        if song_exists.is_none() {
            let err = GrimoireError::SongNotFound {
                id: song_id.to_string(),
            };
            return GrimoireResponse::failure("Song not found", vec![ErrorDetail::from(&err)]);
        }

        // Use -1 to trigger auto-positioning
        if let Err(e) = sqlx::query!(
            "INSERT INTO playlist_songz (playlist_id, song_id, position)
             VALUES (?, ?, -1)",
            playlist_id,
            song_id
        )
        .execute(&pool)
        .await
        {
            return GrimoireResponse::failure(
                "Failed to add song to playlist",
                vec![ErrorDetail::from(e)],
            );
        }
    }

    GrimoireResponse::success("Songs added to playlist successfully", ())
}

/// remove songs from a playlist
pub async fn remove_songs_from_playlist(
    playlist_id: &str,
    song_ids: Vec<String>,
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

    // Verify playlist exists
    let playlist_exists = match sqlx::query!(
        "SELECT id FROM playlistz WHERE id = ? AND deleted_at IS NULL",
        playlist_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(row) => row,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to verify playlist",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    if playlist_exists.is_none() {
        let err = GrimoireError::PlaylistNotFound {
            id: playlist_id.to_string(),
        };
        return GrimoireResponse::failure("Playlist not found", vec![ErrorDetail::from(&err)]);
    }

    // Remove songs
    for song_id in song_ids {
        if let Err(e) = sqlx::query!(
            "DELETE FROM playlist_songz WHERE playlist_id = ? AND song_id = ?",
            playlist_id,
            song_id
        )
        .execute(&pool)
        .await
        {
            return GrimoireResponse::failure(
                "Failed to remove song from playlist",
                vec![ErrorDetail::from(e)],
            );
        }
    }

    // Reorder remaining songs to fill gaps
    if let Err(e) = sqlx::query!(
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
    .await
    {
        return GrimoireResponse::failure("Failed to reorder songs", vec![ErrorDetail::from(e)]);
    }

    GrimoireResponse::success("Songs removed from playlist successfully", ())
}

/// get songs in a playlist
pub async fn get_playlist_songs(playlist_id: &str) -> GrimoireResponse<Vec<PlaylistSong>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let playlist_songs = match sqlx::query_as!(
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
    .await
    {
        Ok(songs) => songs,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to get playlist songs",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Playlist songs retrieved successfully", playlist_songs)
}

/// update the position of a song in a playlist
/// uses pure UPDATE approach without delete/insert to avoid constraint issues
pub async fn update_song_position(
    playlist_id: &str,
    song_id: &str,
    new_position: i64,
) -> GrimoireResponse<()> {
    // Single song reordering - delegate to the multiple song function
    update_songs_position(playlist_id, &[song_id], new_position).await
}

pub async fn update_songs_position(
    playlist_id: &str,
    song_ids: &[&str],
    new_position: i64,
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

    // Step 1: Get all songs in playlist with their current positions
    let all_songs = match sqlx::query!(
        "SELECT s.id, ps.position
         FROM playlist_songz ps
         JOIN playlistz p ON ps.playlist_id = p.id
         JOIN songz s ON ps.song_id = s.id
         WHERE p.id = ? AND p.deleted_at IS NULL
         ORDER BY ps.position",
        playlist_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(songs) => songs,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to fetch playlist songs",
                vec![ErrorDetail::from(e)],
            )
        }
    };

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
    let mut tx = match pool.begin().await {
        Ok(t) => t,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to begin transaction",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // First, move all songs to negative positions to avoid UNIQUE constraint conflicts
    if let Err(e) = sqlx::query!(
        "UPDATE playlist_songz
         SET position = -position
         WHERE playlist_id = ?",
        playlist_id
    )
    .execute(&mut *tx)
    .await
    {
        return GrimoireResponse::failure(
            "Failed to update song positions",
            vec![ErrorDetail::from(e)],
        );
    }

    // Then update all positions to their final values
    for (song_id, position) in final_positions {
        if let Err(e) = sqlx::query!(
            "UPDATE playlist_songz
             SET position = ?
             WHERE playlist_id = ?
               AND song_id = ?",
            position,
            playlist_id,
            song_id
        )
        .execute(&mut *tx)
        .await
        {
            return GrimoireResponse::failure(
                "Failed to set final song positions",
                vec![ErrorDetail::from(e)],
            );
        }
    }

    if let Err(e) = tx.commit().await {
        return GrimoireResponse::failure(
            "Failed to commit transaction",
            vec![ErrorDetail::from(e)],
        );
    }

    GrimoireResponse::success("Song positions updated successfully", ())
}

/// compute ETag for a playlist based on playlist and song metadata
/// combines playlist updated_at with max song updated_at for cache invalidation
pub async fn compute_playlist_etag(playlist_id: &str) -> GrimoireResponse<String> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // get playlist updated_at
    let playlist_updated = match sqlx::query!(
        r#"SELECT updated_at as "updated_at!" FROM playlistz WHERE id = ? AND deleted_at IS NULL"#,
        playlist_id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(Some(row)) => row.updated_at,
        Ok(None) => {
            return GrimoireResponse::failure(
                "Playlist not found",
                vec![ErrorDetail::new(
                    "not_found",
                    "Playlist not found",
                    "Playlist does not exist",
                )],
            )
        }
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to fetch playlist",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // get max song updated_at from songs in this playlist
    let max_song_updated = match sqlx::query!(
        r#"SELECT COALESCE(MAX(s.updated_at), 0) as "max_updated!"
           FROM playlist_songz ps
           JOIN songz s ON ps.song_id = s.id
           WHERE ps.playlist_id = ? AND s.deleted_at IS NULL"#,
        playlist_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(row) => row.max_updated,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to fetch playlist songs",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // combine both timestamps to create etag
    // use max of playlist updated_at and song updated_at
    let etag_timestamp = playlist_updated.max(max_song_updated);

    // format as simple string: "W/<timestamp>"
    // W/ prefix indicates weak ETag (content-based, not byte-for-byte)
    let etag = format!("W/\"{}\"", etag_timestamp);

    GrimoireResponse::success("ETag computed", etag)
}
