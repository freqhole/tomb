//! playlist service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::super::shared::ImageMetadata;
use super::models::{CreatePlaylistRequest, Playlist, PlaylistSong, UpdatePlaylistRequest};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::response::GrimoireResponse;
use crate::JsonVec;

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
            playlist_id as "id!",
            playlist_title as "title!",
            playlist_description as "description?",
            playlist_is_public as "is_public!",
            playlist_created_by_id as "created_by_id?",
            playlist_created_at as "created_at!",
            playlist_updated_at as "updated_at!",
            playlist_deleted_at as "deleted_at?",
            playlist_deleted_by as "deleted_by?",
            playlist_created_by as "created_by?",
            playlist_updated_by as "updated_by?",
            playlist_song_count as "song_count!: i64",
            playlist_images as "images: JsonVec<ImageMetadata>"
        FROM playlist_query_view
        WHERE playlist_id = ?"#,
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
            playlist_id as "id!",
            playlist_title as "title!",
            playlist_description as "description?",
            playlist_is_public as "is_public!",
            playlist_created_by_id as "created_by_id?",
            playlist_created_at as "created_at!",
            playlist_updated_at as "updated_at!",
            playlist_deleted_at as "deleted_at?",
            playlist_deleted_by as "deleted_by?",
            playlist_created_by as "created_by?",
            playlist_updated_by as "updated_by?",
            playlist_song_count as "song_count!: i64",
            playlist_images as "images: JsonVec<ImageMetadata>"
        FROM playlist_query_view
        ORDER BY playlist_created_at DESC"#
    )
    .fetch_all(&pool)
    .await
    {
        Ok(playlists) => playlists,
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
            playlist_id as "id!",
            playlist_title as "title!",
            playlist_description as "description?",
            playlist_is_public as "is_public!",
            playlist_created_by_id as "created_by_id?",
            playlist_created_at as "created_at!",
            playlist_updated_at as "updated_at!",
            playlist_deleted_at as "deleted_at?",
            playlist_deleted_by as "deleted_by?",
            playlist_created_by as "created_by?",
            playlist_updated_by as "updated_by?",
            playlist_song_count as "song_count!: i64",
            playlist_images as "images: JsonVec<ImageMetadata>"
          FROM playlist_query_view
          WHERE playlist_id = ?"#,
        id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(opt) => opt,
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

    // Get current thumbnail blob IDs before removing them
    let current_thumbnail_blob_ids: Vec<String> = match sqlx::query_scalar!(
        "SELECT media_blob_id FROM playlist_imagez WHERE playlist_id = ?",
        id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(ids) => ids,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to query playlist images",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // Remove all thumbnails from playlist
    match sqlx::query!(
        "DELETE FROM playlist_imagez WHERE playlist_id = ?",
        id
    )
    .execute(&pool)
    .await {
        Ok(_) => {},
        Err(e) => return GrimoireResponse::failure("Failed to remove thumbnails", vec![ErrorDetail::from(e)]),
    };

    // Optionally clean up unused media blobs
    if cleanup_unused_blob {
        for blob_id in current_thumbnail_blob_ids {
            use crate::media_blobz::delete_media_blob_if_unused;
            match delete_media_blob_if_unused(&blob_id, deleted_by.clone()).await {
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
            updated_by = COALESCE(?, updated_by)
        WHERE id = ? AND deleted_at IS NULL",
        req.title,
        req.description,
        is_public_int,
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

/// add an image to a playlist
pub async fn add_playlist_image(
    playlist_id: &str,
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
            "UPDATE playlist_imagez SET is_primary = 0 WHERE playlist_id = ?",
            playlist_id
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
        "INSERT INTO playlist_imagez (playlist_id, media_blob_id, is_primary) VALUES (?, ?, ?)",
        playlist_id,
        media_blob_id,
        is_primary
    )
    .execute(&pool)
    .await
    {
        Ok(_) => GrimoireResponse::success("Image added to playlist", ()),
        Err(e) => GrimoireResponse::failure("Failed to add image to playlist", vec![ErrorDetail::from(e)]),
    }
}

/// remove an image from a playlist
pub async fn remove_playlist_image(playlist_id: &str, media_blob_id: &str) -> GrimoireResponse<()> {
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
        "DELETE FROM playlist_imagez WHERE playlist_id = ? AND media_blob_id = ?",
        playlist_id,
        media_blob_id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => {
            if result.rows_affected() == 0 {
                GrimoireResponse::failure("Image not found for playlist", vec![])
            } else {
                GrimoireResponse::success("Image removed from playlist", ())
            }
        }
        Err(e) => {
            GrimoireResponse::failure("Failed to remove image from playlist", vec![ErrorDetail::from(e)])
        }
    }
}

/// set an image as the primary image for a playlist
pub async fn set_primary_playlist_image(playlist_id: &str, media_blob_id: &str) -> GrimoireResponse<()> {
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
        "UPDATE playlist_imagez SET is_primary = 0 WHERE playlist_id = ?",
        playlist_id
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
        "UPDATE playlist_imagez SET is_primary = 1 WHERE playlist_id = ? AND media_blob_id = ?",
        playlist_id,
        media_blob_id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => {
            if result.rows_affected() == 0 {
                GrimoireResponse::failure("Image not found for playlist", vec![])
            } else {
                GrimoireResponse::success("Primary image updated", ())
            }
        }
        Err(e) => {
            GrimoireResponse::failure("Failed to set primary image", vec![ErrorDetail::from(e)])
        }
    }
}

/// remove all images from a playlist
pub async fn clear_playlist_images(playlist_id: &str) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    match sqlx::query!("DELETE FROM playlist_imagez WHERE playlist_id = ?", playlist_id)
        .execute(&pool)
        .await
    {
        Ok(_) => GrimoireResponse::success("All images removed from playlist", ()),
        Err(e) => {
            GrimoireResponse::failure("Failed to clear playlist images", vec![ErrorDetail::from(e)])
        }
    }
}

/// get all image blob IDs for a playlist and its related entities
/// includes: playlist images, and all artist/album/song images from playlist songs
/// excludes waveform type blobs
pub async fn get_playlist_images(playlist_id: &str) -> GrimoireResponse<Vec<String>> {
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
    // 1. playlist images from playlist_imagez
    // 2. artist images for artists of songs in playlist (via artist_songz)
    // 3. album images for albums of songs in playlist (via album_songz)
    // 4. song thumbnails for songs in playlist
    let image_blob_ids = match sqlx::query_scalar!(
        r#"
        SELECT DISTINCT mb.id as "id!"
        FROM media_blobz mb
        WHERE mb.id IN (
            -- playlist images
            SELECT media_blob_id FROM playlist_imagez WHERE playlist_id = ?
            UNION
            -- artist images for songs in playlist (via artist_songz)
            SELECT ai.media_blob_id
            FROM artist_imagez ai
            WHERE ai.artist_id IN (
                SELECT DISTINCT asz.artist_id
                FROM playlist_songz ps
                JOIN artist_songz asz ON ps.song_id = asz.song_id
                WHERE ps.playlist_id = ?
            )
            UNION
            -- album images for songs in playlist (via album_songz)
            SELECT ali.media_blob_id
            FROM album_imagez ali
            WHERE ali.album_id IN (
                SELECT DISTINCT absz.album_id
                FROM playlist_songz ps
                JOIN album_songz absz ON ps.song_id = absz.song_id
                WHERE ps.playlist_id = ?
            )
            UNION
            -- song images in playlist
            SELECT si.media_blob_id
            FROM playlist_songz ps
            JOIN song_imagez si ON ps.song_id = si.song_id
            WHERE ps.playlist_id = ?
        )
        AND mb.blob_type != 'waveform'
        AND mb.deleted_at IS NULL
        ORDER BY mb.created_at DESC
        "#,
        playlist_id,
        playlist_id,
        playlist_id,
        playlist_id
    )
    .fetch_all(&pool)
    .await
    {
        Ok(ids) => ids,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to fetch playlist images",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Playlist images retrieved successfully", image_blob_ids)
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
