//! delete operations for music entities
//! handles soft deletes and relationship cleanup

use crate::database;
use crate::GrimoireResponse;
use time::OffsetDateTime;

/// soft delete an artist if they have no songs
/// returns true if deleted, false if still in use
pub async fn delete_artist_if_unused(artist_id: &str) -> GrimoireResponse<bool> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // Check if artist has any songs
    let song_count = match sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM artist_songz
        WHERE artist_id = ?
        "#,
        artist_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(c) => c,
        Err(e) => return GrimoireResponse::failure("Failed to check artist usage", vec![e.into()]),
    };

    if song_count > 0 {
        // Artist still has songs, don't delete
        return GrimoireResponse::success("Artist is still in use", false);
    }

    // No songs, safe to soft delete
    let now = OffsetDateTime::now_utc().unix_timestamp();
    match sqlx::query!(
        r#"
        UPDATE artistz
        SET deleted_at = ?1, updated_at = ?1
        WHERE id = ?2 AND deleted_at IS NULL
        "#,
        now,
        artist_id
    )
    .execute(&pool)
    .await
    {
        Ok(_) => GrimoireResponse::success("Artist deleted successfully", true),
        Err(e) => GrimoireResponse::failure("Failed to delete artist", vec![e.into()]),
    }
}

/// soft delete an album if it has no songs
/// returns true if deleted, false if still in use
pub async fn delete_album_if_unused(album_id: &str) -> GrimoireResponse<bool> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // Check if album has any songs
    let song_count = match sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM album_songz
        WHERE album_id = ?
        "#,
        album_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(c) => c,
        Err(e) => return GrimoireResponse::failure("Failed to check album usage", vec![e.into()]),
    };

    if song_count > 0 {
        // Album still has songs, don't delete
        return GrimoireResponse::success("Album is still in use", false);
    }

    // No songs, safe to soft delete
    let now = OffsetDateTime::now_utc().unix_timestamp();
    match sqlx::query!(
        r#"
        UPDATE albumz
        SET deleted_at = ?1, updated_at = ?1
        WHERE id = ?2 AND deleted_at IS NULL
        "#,
        now,
        album_id
    )
    .execute(&pool)
    .await
    {
        Ok(_) => GrimoireResponse::success("Album deleted successfully", true),
        Err(e) => GrimoireResponse::failure("Failed to delete album", vec![e.into()]),
    }
}

/// soft delete a genre if it's not used by any albums
/// returns true if deleted, false if still in use
pub async fn delete_genre_if_unused(genre_id: &str) -> GrimoireResponse<bool> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // check if genre is used by any albums via junction table
    let album_count = match sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM album_genrez ag
        JOIN albumz a ON ag.album_id = a.id
        WHERE ag.genre_id = ? AND a.deleted_at IS NULL
        "#,
        genre_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(c) => c,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to check genre usage in albums",
                vec![e.into()],
            )
        }
    };

    if album_count > 0 {
        // genre still in use, don't delete
        return GrimoireResponse::success("Genre is still in use by albums", false);
    }

    // not in use, safe to soft delete
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    match sqlx::query!(
        r#"
        UPDATE genrez
        SET deleted_at = ?, deleted_by = NULL
        WHERE id = ? AND deleted_at IS NULL
        "#,
        now,
        genre_id
    )
    .execute(&pool)
    .await
    {
        Ok(_) => GrimoireResponse::success("Genre deleted successfully", true),
        Err(e) => GrimoireResponse::failure("Failed to delete genre", vec![e.into()]),
    }
}

/// remove a song from all playlists
/// used when deleting a song to clean up playlist associations
pub async fn remove_song_from_all_playlists(song_id: &str) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // Remove from all playlists
    match sqlx::query!(
        r#"
        DELETE FROM playlist_songz
        WHERE song_id = ?
        "#,
        song_id
    )
    .execute(&pool)
    .await
    {
        Ok(_) => GrimoireResponse::success("Song removed from all playlists", ()),
        Err(e) => GrimoireResponse::failure("Failed to remove song from playlists", vec![e.into()]),
    }
}
