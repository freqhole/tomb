//! delete operations for music entities
//! handles soft deletes and relationship cleanup

use crate::database;
use crate::error::GrimoireResult;
use time::OffsetDateTime;

/// soft delete an artist if they have no songs
/// returns true if deleted, false if still in use
pub async fn delete_artist_if_unused(artist_id: &str) -> GrimoireResult<bool> {
    let pool = database::connect().await?;

    // Check if artist has any songs
    let song_count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM artist_songz
        WHERE artist_id = ?
        "#,
        artist_id
    )
    .fetch_one(&pool)
    .await?;

    if song_count > 0 {
        // Artist still has songs, don't delete
        return Ok(false);
    }

    // No songs, safe to soft delete
    let now = OffsetDateTime::now_utc().unix_timestamp();
    sqlx::query!(
        r#"
        UPDATE artistz
        SET deleted_at = ?1, updated_at = ?1
        WHERE id = ?2 AND deleted_at IS NULL
        "#,
        now,
        artist_id
    )
    .execute(&pool)
    .await?;

    Ok(true)
}

/// soft delete an album if it has no songs
/// returns true if deleted, false if still in use
pub async fn delete_album_if_unused(album_id: &str) -> GrimoireResult<bool> {
    let pool = database::connect().await?;

    // Check if album has any songs
    let song_count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM album_songz
        WHERE album_id = ?
        "#,
        album_id
    )
    .fetch_one(&pool)
    .await?;

    if song_count > 0 {
        // Album still has songs, don't delete
        return Ok(false);
    }

    // No songs, safe to soft delete
    let now = OffsetDateTime::now_utc().unix_timestamp();
    sqlx::query!(
        r#"
        UPDATE albumz
        SET deleted_at = ?1, updated_at = ?1
        WHERE id = ?2 AND deleted_at IS NULL
        "#,
        now,
        album_id
    )
    .execute(&pool)
    .await?;

    Ok(true)
}

/// soft delete a genre if it's not used by any albums
/// returns true if deleted, false if still in use
pub async fn delete_genre_if_unused(genre_id: &str) -> GrimoireResult<bool> {
    let pool = database::connect().await?;

    // Check if genre is used by any albums
    let album_count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM albumz
        WHERE genre_id = ? AND deleted_at IS NULL
        "#,
        genre_id
    )
    .fetch_one(&pool)
    .await?;

    if album_count > 0 {
        // Genre still in use, don't delete
        return Ok(false);
    }

    // Check if genre is used in sub-genres
    let sub_genre_count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM sub_genrez
        WHERE parent_genre_id = ?
        "#,
        genre_id
    )
    .fetch_one(&pool)
    .await?;

    if sub_genre_count > 0 {
        // Genre has sub-genres, don't delete
        return Ok(false);
    }

    // Not in use, safe to delete (genres don't have soft delete)
    sqlx::query!(
        r#"
        DELETE FROM genrez
        WHERE id = ?
        "#,
        genre_id
    )
    .execute(&pool)
    .await?;

    Ok(true)
}

/// remove a song from all playlists
/// used when deleting a song to clean up playlist associations
pub async fn remove_song_from_all_playlists(song_id: &str) -> GrimoireResult<()> {
    let pool = database::connect().await?;

    // Remove from all playlists
    sqlx::query!(
        r#"
        DELETE FROM playlist_songz
        WHERE song_id = ?
        "#,
        song_id
    )
    .execute(&pool)
    .await?;

    Ok(())
}

/// hard delete all soft-deleted entities older than specified days
/// this is a maintenance operation that permanently removes old deleted records
///
/// The key insight: we must cascade DOWN the ownership hierarchy (parent → child)
/// but clean up relationships where the entity is the TARGET.
///
/// Ownership hierarchy:
/// - Artist → Albums → Songs
/// - Playlist → (references songs, doesn't own them)
///
/// Strategy:
/// 1. Delete songs (bottom of hierarchy): clean relationships, delete song, check if parent album/artist should be deleted
/// 2. Delete albums (middle): cascade to remaining songs in album, delete album, check parent artist
/// 3. Delete artists (top): cascade to remaining albums/songs, delete artist
/// 4. Delete playlists (separate): only delete playlist relationships, never songs
/// 5. Cleanup orphaned media blobs
pub async fn cleanup_deleted_entities(days_old: i64) -> GrimoireResult<()> {
    let pool = database::connect().await?;
    let now = OffsetDateTime::now_utc().unix_timestamp();
    let threshold = now - (days_old * 86400); // days to seconds

    // Start a transaction for atomic operation
    let mut tx = pool.begin().await?;

    // === STEP 1: Delete old songs ===
    // Get IDs of songs to delete
    let song_ids: Vec<String> = sqlx::query_scalar!(
        "SELECT id FROM songz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        threshold
    )
    .fetch_all(&mut *tx)
    .await?;

    let mut songs_deleted = 0;
    for song_id in &song_ids {
        // Clean up song relationships (where song is the target)
        sqlx::query!("DELETE FROM artist_songz WHERE song_id = ?", song_id)
            .execute(&mut *tx)
            .await?;

        sqlx::query!("DELETE FROM album_songz WHERE song_id = ?", song_id)
            .execute(&mut *tx)
            .await?;

        sqlx::query!("DELETE FROM playlist_songz WHERE song_id = ?", song_id)
            .execute(&mut *tx)
            .await?;

        sqlx::query!("DELETE FROM song_imagez WHERE song_id = ?", song_id)
            .execute(&mut *tx)
            .await?;

        sqlx::query!("DELETE FROM music_play_eventz WHERE song_id = ?", song_id)
            .execute(&mut *tx)
            .await?;

        sqlx::query!(
            "DELETE FROM user_favoritez WHERE target_type = 'song' AND target_id = ?",
            song_id
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            "DELETE FROM user_ratingz WHERE target_type = 'song' AND target_id = ?",
            song_id
        )
        .execute(&mut *tx)
        .await?;

        // Delete the song itself
        sqlx::query!("DELETE FROM songz WHERE id = ?", song_id)
            .execute(&mut *tx)
            .await?;

        songs_deleted += 1;
    }

    // === STEP 2: Delete old albums ===
    // Get IDs of albums to delete
    let album_ids: Vec<String> = sqlx::query_scalar!(
        "SELECT id FROM albumz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        threshold
    )
    .fetch_all(&mut *tx)
    .await?;

    let mut albums_deleted = 0;
    for album_id in &album_ids {
        // First, cascade delete any remaining songs in this album
        // (these would be songs that weren't old enough to be deleted in step 1)
        let album_song_ids: Vec<String> = sqlx::query_scalar!(
            "SELECT song_id FROM album_songz WHERE album_id = ?",
            album_id
        )
        .fetch_all(&mut *tx)
        .await?;

        for song_id in &album_song_ids {
            // Delete song relationships
            sqlx::query!("DELETE FROM artist_songz WHERE song_id = ?", song_id)
                .execute(&mut *tx)
                .await?;

            sqlx::query!("DELETE FROM album_songz WHERE song_id = ?", song_id)
                .execute(&mut *tx)
                .await?;

            sqlx::query!("DELETE FROM playlist_songz WHERE song_id = ?", song_id)
                .execute(&mut *tx)
                .await?;

            sqlx::query!("DELETE FROM song_imagez WHERE song_id = ?", song_id)
                .execute(&mut *tx)
                .await?;

            sqlx::query!("DELETE FROM music_play_eventz WHERE song_id = ?", song_id)
                .execute(&mut *tx)
                .await?;

            sqlx::query!(
                "DELETE FROM user_favoritez WHERE target_type = 'song' AND target_id = ?",
                song_id
            )
            .execute(&mut *tx)
            .await?;

            sqlx::query!(
                "DELETE FROM user_ratingz WHERE target_type = 'song' AND target_id = ?",
                song_id
            )
            .execute(&mut *tx)
            .await?;

            // Delete the song
            sqlx::query!("DELETE FROM songz WHERE id = ?", song_id)
                .execute(&mut *tx)
                .await?;
        }

        // Now clean up album relationships (where album is the target)
        sqlx::query!("DELETE FROM artist_albumz WHERE album_id = ?", album_id)
            .execute(&mut *tx)
            .await?;

        sqlx::query!("DELETE FROM album_tagz WHERE album_id = ?", album_id)
            .execute(&mut *tx)
            .await?;

        sqlx::query!("DELETE FROM album_sub_genrez WHERE album_id = ?", album_id)
            .execute(&mut *tx)
            .await?;

        sqlx::query!("DELETE FROM album_imagez WHERE album_id = ?", album_id)
            .execute(&mut *tx)
            .await?;

        sqlx::query!("DELETE FROM music_play_eventz WHERE album_id = ?", album_id)
            .execute(&mut *tx)
            .await?;

        sqlx::query!(
            "DELETE FROM user_favoritez WHERE target_type = 'album' AND target_id = ?",
            album_id
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            "DELETE FROM user_ratingz WHERE target_type = 'album' AND target_id = ?",
            album_id
        )
        .execute(&mut *tx)
        .await?;

        // NULL out genre_id (FK to genrez)
        sqlx::query!("UPDATE albumz SET genre_id = NULL WHERE id = ?", album_id)
            .execute(&mut *tx)
            .await?;

        // Delete the album itself
        sqlx::query!("DELETE FROM albumz WHERE id = ?", album_id)
            .execute(&mut *tx)
            .await?;

        albums_deleted += 1;
    }

    // === STEP 3: Delete old artists ===
    // Get IDs of artists to delete
    let artist_ids: Vec<String> = sqlx::query_scalar!(
        "SELECT id FROM artistz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        threshold
    )
    .fetch_all(&mut *tx)
    .await?;

    let mut artists_deleted = 0;
    for artist_id in &artist_ids {
        // First, cascade delete any remaining albums by this artist
        let artist_album_ids: Vec<String> = sqlx::query_scalar!(
            "SELECT album_id FROM artist_albumz WHERE artist_id = ?",
            artist_id
        )
        .fetch_all(&mut *tx)
        .await?;

        for album_id in &artist_album_ids {
            // Cascade delete songs in this album
            let album_song_ids: Vec<String> = sqlx::query_scalar!(
                "SELECT song_id FROM album_songz WHERE album_id = ?",
                album_id
            )
            .fetch_all(&mut *tx)
            .await?;

            for song_id in &album_song_ids {
                sqlx::query!("DELETE FROM artist_songz WHERE song_id = ?", song_id)
                    .execute(&mut *tx)
                    .await?;
                sqlx::query!("DELETE FROM album_songz WHERE song_id = ?", song_id)
                    .execute(&mut *tx)
                    .await?;
                sqlx::query!("DELETE FROM playlist_songz WHERE song_id = ?", song_id)
                    .execute(&mut *tx)
                    .await?;
                sqlx::query!("DELETE FROM song_imagez WHERE song_id = ?", song_id)
                    .execute(&mut *tx)
                    .await?;
                sqlx::query!("DELETE FROM music_play_eventz WHERE song_id = ?", song_id)
                    .execute(&mut *tx)
                    .await?;
                sqlx::query!(
                    "DELETE FROM user_favoritez WHERE target_type = 'song' AND target_id = ?",
                    song_id
                )
                .execute(&mut *tx)
                .await?;
                sqlx::query!(
                    "DELETE FROM user_ratingz WHERE target_type = 'song' AND target_id = ?",
                    song_id
                )
                .execute(&mut *tx)
                .await?;
                sqlx::query!("DELETE FROM songz WHERE id = ?", song_id)
                    .execute(&mut *tx)
                    .await?;
            }

            // Delete album relationships
            sqlx::query!("DELETE FROM artist_albumz WHERE album_id = ?", album_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query!("DELETE FROM album_tagz WHERE album_id = ?", album_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query!("DELETE FROM album_sub_genrez WHERE album_id = ?", album_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query!("DELETE FROM album_imagez WHERE album_id = ?", album_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query!("DELETE FROM music_play_eventz WHERE album_id = ?", album_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query!(
                "DELETE FROM user_favoritez WHERE target_type = 'album' AND target_id = ?",
                album_id
            )
            .execute(&mut *tx)
            .await?;
            sqlx::query!(
                "DELETE FROM user_ratingz WHERE target_type = 'album' AND target_id = ?",
                album_id
            )
            .execute(&mut *tx)
            .await?;
            sqlx::query!("UPDATE albumz SET genre_id = NULL WHERE id = ?", album_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query!("DELETE FROM albumz WHERE id = ?", album_id)
                .execute(&mut *tx)
                .await?;
        }

        // Delete any remaining songs directly linked to artist (not via album)
        let artist_song_ids: Vec<String> = sqlx::query_scalar!(
            "SELECT song_id FROM artist_songz WHERE artist_id = ?",
            artist_id
        )
        .fetch_all(&mut *tx)
        .await?;

        for song_id in &artist_song_ids {
            sqlx::query!("DELETE FROM artist_songz WHERE song_id = ?", song_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query!("DELETE FROM album_songz WHERE song_id = ?", song_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query!("DELETE FROM playlist_songz WHERE song_id = ?", song_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query!("DELETE FROM song_imagez WHERE song_id = ?", song_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query!("DELETE FROM music_play_eventz WHERE song_id = ?", song_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query!(
                "DELETE FROM user_favoritez WHERE target_type = 'song' AND target_id = ?",
                song_id
            )
            .execute(&mut *tx)
            .await?;
            sqlx::query!(
                "DELETE FROM user_ratingz WHERE target_type = 'song' AND target_id = ?",
                song_id
            )
            .execute(&mut *tx)
            .await?;
            sqlx::query!("DELETE FROM songz WHERE id = ?", song_id)
                .execute(&mut *tx)
                .await?;
        }

        // Clean up artist relationships
        sqlx::query!("DELETE FROM artist_imagez WHERE artist_id = ?", artist_id)
            .execute(&mut *tx)
            .await?;

        sqlx::query!(
            "DELETE FROM music_play_eventz WHERE artist_id = ?",
            artist_id
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            "DELETE FROM user_favoritez WHERE target_type = 'artist' AND target_id = ?",
            artist_id
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            "DELETE FROM user_ratingz WHERE target_type = 'artist' AND target_id = ?",
            artist_id
        )
        .execute(&mut *tx)
        .await?;

        // Delete the artist itself
        sqlx::query!("DELETE FROM artistz WHERE id = ?", artist_id)
            .execute(&mut *tx)
            .await?;

        artists_deleted += 1;
    }

    // === STEP 4: Delete old playlists ===
    // Important: playlists only reference songs, they don't own them
    let playlist_ids: Vec<String> = sqlx::query_scalar!(
        "SELECT id FROM playlistz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        threshold
    )
    .fetch_all(&mut *tx)
    .await?;

    let mut playlists_deleted = 0;
    for playlist_id in &playlist_ids {
        // Clean up playlist relationships (DO NOT delete songs)
        sqlx::query!(
            "DELETE FROM playlist_songz WHERE playlist_id = ?",
            playlist_id
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            "DELETE FROM playlist_imagez WHERE playlist_id = ?",
            playlist_id
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            "DELETE FROM music_play_eventz WHERE playlist_id = ?",
            playlist_id
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            "DELETE FROM user_favoritez WHERE target_type = 'playlist' AND target_id = ?",
            playlist_id
        )
        .execute(&mut *tx)
        .await?;

        // Delete the playlist itself
        sqlx::query!("DELETE FROM playlistz WHERE id = ?", playlist_id)
            .execute(&mut *tx)
            .await?;

        playlists_deleted += 1;
    }

    // === STEP 5: Cleanup orphaned media blobs ===
    // Find blobs that are not referenced by any entity and are marked as deleted
    let orphaned_blobs = sqlx::query_scalar!(
        r#"
        SELECT id FROM media_blobz
        WHERE deleted_at IS NOT NULL
        AND id NOT IN (
            SELECT DISTINCT media_blob_id FROM songz WHERE media_blob_id IS NOT NULL
            UNION SELECT DISTINCT thumbnail_blob_id FROM songz WHERE thumbnail_blob_id IS NOT NULL
            UNION SELECT DISTINCT waveform_blob_id FROM songz WHERE waveform_blob_id IS NOT NULL
            UNION SELECT DISTINCT thumbnail_blob_id FROM playlistz WHERE thumbnail_blob_id IS NOT NULL
        )
        "#
    )
    .fetch_all(&mut *tx)
    .await?;

    let blobs_deleted = orphaned_blobs.len();
    for blob_id in &orphaned_blobs {
        sqlx::query!("DELETE FROM media_blobz WHERE id = ?", blob_id)
            .execute(&mut *tx)
            .await?;
    }

    // Commit the transaction
    tx.commit().await?;

    println!(
        "Cleanup complete: {} songs, {} albums, {} artists, {} playlists, {} orphaned blobs permanently deleted",
        songs_deleted, albums_deleted, artists_deleted, playlists_deleted, blobs_deleted
    );

    Ok(())
}
