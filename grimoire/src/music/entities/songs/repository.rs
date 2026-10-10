//! song service functions
//! clean business logic using sqlx::query_as! with no fallbacks

use super::models::{CreateSongRequest, Song};
use crate::database;
use crate::error::{ErrorDetail, GrimoireError};
use crate::music::crud::remove_song_from_all_playlists;
use crate::music::crud::ImageMetadata;
use crate::music::EntityUrl;
use crate::response::GrimoireResponse;
use crate::GrimoireResult;
use crate::JsonVec;

/// create a new song
pub async fn create_song(req: CreateSongRequest) -> GrimoireResponse<Song> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let media_blob_id = req.media_blob_id.clone();
    let song = match sqlx::query_as!(
        Song,
        "INSERT INTO songz (
            media_blob_id, title, track_number, disc_number, duration, bpm, track_artist, metadata, lyrics,
            created_by, updated_by,
            media_blob_blake3, media_blob_mime, media_blob_size
        ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            (SELECT blake3 FROM media_blobz WHERE id = ?),
            (SELECT mime FROM media_blobz WHERE id = ?),
            (SELECT size FROM media_blobz WHERE id = ?)
        )
        RETURNING
            id as \"id!\",
            media_blob_id as \"media_blob_id!\",
            title as \"title!\",
            track_number,
            disc_number,
            duration,
            bpm,
            track_artist,
            metadata,
            lyrics,
            created_at as \"created_at!\",
            updated_at as \"updated_at!\",
            deleted_at,
            deleted_by,
            created_by,
            updated_by,
            NULL as \"images?: JsonVec<ImageMetadata>\",
            NULL as \"urls?: JsonVec<EntityUrl>\",
            NULL as \"created_by_username?: String\",
            NULL as \"updated_by_username?: String\",
            NULL as \"play_count?: i64\"",
        req.media_blob_id,
        req.title,
        req.track_number,
        req.disc_number,
        req.duration,
        req.bpm,
        req.track_artist,
        req.metadata,
        req.lyrics,
        req.created_by,
        req.created_by,
        media_blob_id,
        media_blob_id,
        media_blob_id
    )
    .fetch_one(&pool)
    .await
    {
        Ok(s) => s,
        Err(e) => {
            // detect UNIQUE constraint on media_blob_id - this means duplicate song
            let err_str = e.to_string();
            if err_str.contains("UNIQUE constraint failed: songz.media_blob_id") {
                return GrimoireResponse::failure(
                    "duplicate song",
                    vec![ErrorDetail::new(
                        "duplicate_song",
                        "Duplicate Song",
                        format!("a song already exists with blob_id {}", req.media_blob_id),
                    )],
                );
            }
            return GrimoireResponse::failure(
                "Failed to create song",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    GrimoireResponse::success("Song created successfully", song)
}

/// list all songs (non-deleted only)
pub async fn list_songs(limit: Option<u32>, offset: Option<u32>) -> GrimoireResponse<Vec<Song>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };
    let limit = limit.unwrap_or(100).min(1000) as i64;
    let offset = offset.unwrap_or(0) as i64;

    // query from song_query_view which includes images as JSON array
    let mut songs = match sqlx::query_as!(
        Song,
        r#"SELECT
            song_id as "id!",
            song_media_blob_id as "media_blob_id!",
            song_title as "title!",
            song_track_number as "track_number!",
            song_disc_number as "disc_number!",
            song_duration as duration,
            song_bpm as bpm,
            song_track_artist as track_artist,
            song_metadata as metadata,
            song_lyrics as lyrics,
            song_created_at as "created_at!",
            song_updated_at as "updated_at!",
            song_deleted_at as deleted_at,
            song_deleted_by as deleted_by,
            song_created_by as created_by,
            song_updated_by as updated_by,
            NULL as "created_by_username?: String",
            NULL as "updated_by_username?: String",
            song_images as "images?: JsonVec<ImageMetadata>",
            NULL as "urls?: JsonVec<EntityUrl>",
            song_play_count as "play_count?: i64"
         FROM song_query_view
         WHERE song_deleted_at IS NULL
         ORDER BY song_created_at DESC
         LIMIT ? OFFSET ?"#,
        limit,
        offset
    )
    .fetch_all(&pool)
    .await
    {
        Ok(songs) => songs,
        Err(e) => {
            return GrimoireResponse::failure("Failed to list songs", vec![ErrorDetail::from(e)])
        }
    };

    if let Err(e) =
        crate::music::crud::enrich_song_usernames(&pool, songs.iter_mut().collect()).await
    {
        return GrimoireResponse::failure(
            "Failed to resolve usernames",
            vec![ErrorDetail::from(e)],
        );
    }

    GrimoireResponse::success("Songs retrieved successfully", songs)
}

/// get song by id
pub async fn get_song(id: &str) -> GrimoireResponse<Song> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    let song_opt = match sqlx::query_as!(
        Song,
        r#"SELECT
            song_id as "id!",
            song_media_blob_id as "media_blob_id!",
            song_title as "title!",
            song_track_number as "track_number!",
            song_disc_number as "disc_number!",
            song_duration as "duration?",
            song_bpm as "bpm?",
            song_track_artist as "track_artist?",
            song_metadata as "metadata?",
            song_lyrics as "lyrics?",
            song_created_at as "created_at!",
            song_updated_at as "updated_at!",
            song_deleted_at as "deleted_at?",
            song_deleted_by as "deleted_by?",
            song_created_by as "created_by?",
            song_updated_by as "updated_by?",
            NULL as "created_by_username?: String",
            NULL as "updated_by_username?: String",
            song_images as "images?: JsonVec<ImageMetadata>",
            NULL as "urls?: JsonVec<EntityUrl>",
            song_play_count as "play_count?: i64"
         FROM song_query_view
         WHERE song_id = ? AND song_deleted_at IS NULL"#,
        id
    )
    .fetch_optional(&pool)
    .await
    {
        Ok(opt) => opt,
        Err(e) => {
            return GrimoireResponse::failure("Failed to get song", vec![ErrorDetail::from(e)])
        }
    };

    match song_opt {
        Some(mut song) => {
            if let Err(e) = crate::music::crud::enrich_song_usernames(
                &pool,
                std::iter::once(&mut song).collect(),
            )
            .await
            {
                return GrimoireResponse::failure(
                    "Failed to resolve usernames",
                    vec![ErrorDetail::from(e)],
                );
            }
            GrimoireResponse::success("Song retrieved successfully", song)
        }
        None => {
            let err = GrimoireError::SongNotFound { id: id.to_string() };
            GrimoireResponse::failure("Song not found", vec![ErrorDetail::from(&err)])
        }
    }
}

/// soft delete a song
pub async fn delete_song(id: &str, deleted_by: Option<String>) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // get album_id and artist_id before deleting (for orphan cleanup)
    let album_id: Option<String> =
        sqlx::query_scalar!("SELECT album_id FROM album_songz WHERE song_id = ?", id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();

    let artist_id: Option<String> =
        sqlx::query_scalar!("SELECT artist_id FROM artist_songz WHERE song_id = ?", id)
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten();

    let rows_affected = match sqlx::query!(
        "UPDATE songz SET deleted_at = unixepoch(), deleted_by = ?, updated_by = ? WHERE id = ? AND deleted_at IS NULL",
        deleted_by,
        deleted_by,
        id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => result.rows_affected(),
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to delete song",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    if rows_affected == 0 {
        let err = GrimoireError::SongNotFound { id: id.to_string() };
        return GrimoireResponse::failure("Song not found", vec![ErrorDetail::from(&err)]);
    }

    // remove from junction tables (triggers will update counts)
    let _ = sqlx::query!("DELETE FROM album_songz WHERE song_id = ?", id)
        .execute(&pool)
        .await;
    let _ = sqlx::query!("DELETE FROM artist_songz WHERE song_id = ?", id)
        .execute(&pool)
        .await;

    // remove song from all playlists when soft-deleting
    let playlist_removal = remove_song_from_all_playlists(id).await;
    if !playlist_removal.success {
        return GrimoireResponse::failure(
            "Failed to remove song from playlists",
            playlist_removal.errors,
        );
    }

    // check for orphaned album and artist (soft-delete if no more songs)
    if let Some(album_id) = album_id {
        let _ = crate::music::crud::delete_album_if_unused(&album_id).await;
    }
    if let Some(artist_id) = artist_id {
        let _ = crate::music::crud::delete_artist_if_unused(&artist_id).await;
    }

    GrimoireResponse::success("Song deleted successfully", ())
}

/// bulk delete multiple songs at once
pub async fn bulk_delete_songs(
    song_ids: Vec<String>,
    deleted_by: Option<String>,
) -> crate::music::crud::BulkDeleteSongsResponse {
    use crate::music::crud::BulkDeleteSongsResponse;

    let mut deleted_count: u32 = 0;
    let mut failed_ids = Vec::new();

    for song_id in song_ids {
        let result = delete_song(&song_id, deleted_by.clone()).await;
        if result.success {
            deleted_count += 1;
        } else {
            failed_ids.push(song_id);
        }
    }

    let success = failed_ids.is_empty();
    let message = if success {
        format!("deleted {} songs", deleted_count)
    } else {
        format!(
            "deleted {} songs, {} failed",
            deleted_count,
            failed_ids.len()
        )
    };

    BulkDeleteSongsResponse {
        success,
        message,
        deleted_count,
        failed_ids,
    }
}

/// get the media_blob_id for a song (used for parent blob lookups)
pub async fn get_song_media_blob_id(song_id: &str) -> GrimoireResult<String> {
    let pool = database::connect().await?;

    let media_blob_id: Option<String> = sqlx::query_scalar!(
        "SELECT media_blob_id FROM songz WHERE id = ? AND deleted_at IS NULL",
        song_id
    )
    .fetch_optional(&pool)
    .await?;

    media_blob_id.ok_or_else(|| GrimoireError::SongNotFound {
        id: song_id.to_string(),
    })
}

/// get a song ID by media blob blake3
///
/// returns the song ID if a non-deleted song exists with a media blob matching the blake3
pub async fn get_song_by_blake3(blake3: &str) -> GrimoireResult<Option<String>> {
    let pool = database::connect().await?;

    let song_id: Option<String> = sqlx::query_scalar!(
        r#"
        SELECT id as "id!"
        FROM songz
        WHERE media_blob_blake3 = ? AND deleted_at IS NULL
        LIMIT 1
        "#,
        blake3
    )
    .fetch_optional(&pool)
    .await?;

    Ok(song_id)
}

/// get all blake3 hashes for synced songs
///
/// returns all blake3 hashes from media blobs linked to non-deleted songs -
/// joins `media_blobz` directly.
pub async fn get_all_song_blake3s() -> GrimoireResult<Vec<String>> {
    let pool = database::connect().await?;

    let blake3s: Vec<String> = sqlx::query_scalar!(
        r#"
        SELECT DISTINCT mb.blake3 as "blake3!"
        FROM songz s
        JOIN media_blobz mb ON mb.id = s.media_blob_id
        WHERE mb.blake3 IS NOT NULL AND s.deleted_at IS NULL
        "#
    )
    .fetch_all(&pool)
    .await?;

    tracing::debug!("returning {} synced blake3s", blake3s.len());
    Ok(blake3s)
}

/// reorder a set of song ids (order of the input slice is ignored) into
/// "album order" - grouped by artist, then grouped by album, then by
/// disc/track number within the album, matching how a listener actually
/// wants to hear an album straight through. used by manifests that don't
/// already carry an explicit user-curated order (e.g. favorites/taxon/
/// tag/artist/album external-storage sync groups) - a real playlist's
/// own position order should never be run through this.
///
/// a song with no album mapping sorts by its own title after every album
/// it shares an artist with; a song with no artist mapping at all sorts
/// first (empty string sorts before any real name).
pub async fn sort_song_ids_by_album_order(song_ids: &[String]) -> GrimoireResult<Vec<String>> {
    if song_ids.is_empty() {
        return Ok(Vec::new());
    }

    let pool = database::connect().await?;
    let mut qb = sqlx::QueryBuilder::<sqlx::Sqlite>::new(
        r#"
        SELECT s.id AS song_id
        FROM songz s
        LEFT JOIN (
            SELECT ars.song_id AS song_id, MIN(ars.artist_id) AS artist_id
            FROM artist_songz ars
            GROUP BY ars.song_id
        ) armap ON armap.song_id = s.id
        LEFT JOIN artistz ar ON ar.id = armap.artist_id
        LEFT JOIN (
            SELECT als.song_id AS song_id, MIN(als.album_id) AS album_id
            FROM album_songz als
            GROUP BY als.song_id
        ) almap ON almap.song_id = s.id
        LEFT JOIN albumz al ON al.id = almap.album_id
        WHERE s.id IN (
        "#,
    );

    {
        let mut separated = qb.separated(", ");
        for id in song_ids {
            separated.push_bind(id);
        }
    }

    qb.push(
        r#")
        ORDER BY
            LOWER(COALESCE(ar.name, '')) ASC,
            LOWER(COALESCE(al.title, '')) ASC,
            almap.album_id ASC,
            COALESCE(s.disc_number, 1) ASC,
            COALESCE(s.track_number, 1) ASC,
            LOWER(s.title) ASC,
            s.id ASC"#,
    );

    let ids: Vec<String> = qb
        .build_query_scalar()
        .fetch_all(&pool)
        .await
        .map_err(GrimoireError::from)?;
    Ok(ids)
}

/// add an image to a song
///
/// if `created_by` is provided (as (user_id, username)), a feed event will be created
pub async fn add_song_image(
    song_id: &str,
    media_blob_id: &str,
    is_primary: bool,
    created_by: Option<(&str, &str)>,
) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            );
        }
    };

    // if setting as primary, unset other primary images first
    if is_primary {
        if let Err(e) = sqlx::query!(
            "UPDATE song_imagez SET is_primary = 0 WHERE song_id = ?",
            song_id
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

    // `OR IGNORE`: (song_id, media_blob_id) sharing the composite PRIMARY
    // KEY with an already-linked row is a legitimate "nothing to do"
    // outcome, not an error - re-linking the exact same pair happens
    // naturally on a retried/resumed batch, and a hard failure here
    // previously turned into an infinite batch loop (the caller's "not
    // yet linked" query kept re-selecting the same candidate every pass
    // since the link attempt itself never got anywhere - see
    // `create_media_blob`'s dedup-scoping fix for the other half of
    // this, 2026-10-09).
    match sqlx::query!(
        "INSERT OR IGNORE INTO song_imagez (song_id, media_blob_id, is_primary) VALUES (?, ?, ?)",
        song_id,
        media_blob_id,
        is_primary
    )
    .execute(&pool)
    .await
    {
        Ok(res) => {
            // create feed event if user provided and a row was actually inserted
            if res.rows_affected() > 0 {
                if let Some((user_id, username)) = created_by {
                    let _ = crate::music::analytics::feed_events::create_image_feed_event(
                        "song",
                        song_id,
                        media_blob_id,
                        user_id,
                        username,
                    )
                    .await;
                }
            }

            GrimoireResponse::success("Image added to song", ())
        }
        Err(e) => {
            GrimoireResponse::failure("Failed to add image to song", vec![ErrorDetail::from(e)])
        }
    }
}

/// remove an image from a song
pub async fn remove_song_image(song_id: &str, media_blob_id: &str) -> GrimoireResponse<()> {
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
        "DELETE FROM song_imagez WHERE song_id = ? AND media_blob_id = ?",
        song_id,
        media_blob_id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => {
            if result.rows_affected() == 0 {
                GrimoireResponse::failure("Image not found for song", vec![])
            } else {
                GrimoireResponse::success("Image removed from song", ())
            }
        }
        Err(e) => GrimoireResponse::failure(
            "Failed to remove image from song",
            vec![ErrorDetail::from(e)],
        ),
    }
}

/// set an image as the primary image for a song
pub async fn set_primary_song_image(song_id: &str, media_blob_id: &str) -> GrimoireResponse<()> {
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
        "UPDATE song_imagez SET is_primary = 0 WHERE song_id = ?",
        song_id
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
        "UPDATE song_imagez SET is_primary = 1 WHERE song_id = ? AND media_blob_id = ?",
        song_id,
        media_blob_id
    )
    .execute(&pool)
    .await
    {
        Ok(result) => {
            if result.rows_affected() == 0 {
                GrimoireResponse::failure("Image not found for song", vec![])
            } else {
                GrimoireResponse::success("Primary image updated", ())
            }
        }
        Err(e) => {
            GrimoireResponse::failure("Failed to set primary image", vec![ErrorDetail::from(e)])
        }
    }
}

/// remove all images from a song
pub async fn clear_song_images(song_id: &str) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    match sqlx::query!("DELETE FROM song_imagez WHERE song_id = ?", song_id)
        .execute(&pool)
        .await
    {
        Ok(_) => GrimoireResponse::success("All images removed from song", ()),
        Err(e) => {
            GrimoireResponse::failure("Failed to clear song images", vec![ErrorDetail::from(e)])
        }
    }
}

/// clear non-waveform images from a song (preserves waveform images)
pub async fn clear_song_artwork(song_id: &str) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to connect to database",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // delete song_imagez entries where the linked blob is not a waveform
    match sqlx::query!(
        r#"DELETE FROM song_imagez
           WHERE song_id = ?
           AND media_blob_id IN (
               SELECT mb.id FROM media_blobz mb
               WHERE mb.blob_type != 'waveform'
           )"#,
        song_id
    )
    .execute(&pool)
    .await
    {
        Ok(_) => GrimoireResponse::success("artwork cleared from song (waveforms preserved)", ()),
        Err(e) => {
            GrimoireResponse::failure("failed to clear song artwork", vec![ErrorDetail::from(e)])
        }
    }
}

/// bulk clear artwork from multiple songs (preserves waveform images)
pub async fn bulk_clear_song_artwork(
    song_ids: Vec<String>,
) -> crate::music::crud::BulkClearSongArtworkResponse {
    use crate::music::crud::BulkClearSongArtworkResponse;

    let mut cleared_count: u32 = 0;
    let mut failed_ids = Vec::new();

    for song_id in song_ids {
        let result = clear_song_artwork(&song_id).await;
        if result.success {
            cleared_count += 1;
        } else {
            failed_ids.push(song_id);
        }
    }

    let success = failed_ids.is_empty();
    let message = if success {
        format!("cleared artwork from {} songs", cleared_count)
    } else {
        format!(
            "cleared artwork from {} songs, {} failed",
            cleared_count,
            failed_ids.len()
        )
    };

    BulkClearSongArtworkResponse {
        success,
        message,
        cleared_count,
        failed_ids,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // same convention as media_blobz::service::tests - fresh tempdir db
    // per test, `#[ignore]` since it touches the real db pool singletons,
    // run one at a time, each its own process:
    // cargo test -p grimoire --lib -- --ignored --exact music::entities::songs::repository::tests::add_song_image_is_idempotent_on_duplicate_link
    async fn init_test_env(data_dir: &std::path::Path) {
        let config_toml = format!(
            r#"data_dir = "{data_dir}"

[database]
filename = "grimoire.db"

[media]
max_fs_file_size = 104857600
supported_audio_formats = ["mp3", "flac"]

[musicbrainz]
enabled = false

[logging]
level = "warn"
"#,
            data_dir = data_dir.display()
        );
        let config_path = data_dir.join("freqhole-config.toml");
        std::fs::write(&config_path, config_toml).expect("write config");
        std::fs::write(data_dir.join("grimoire.db"), b"").expect("touch grimoire.db");

        crate::config::init_config(Some(config_path)).expect("init config");
        database::run_migrations().await.expect("run migrations");
    }

    // confirmed real 2026-10-09: a hard-failing INSERT here (instead of
    // `INSERT OR IGNORE`) was half of a real infinite batch loop -
    // `repair_waveforms_batch` kept resolving a song's "new" waveform
    // blob to one already linked to that song under a different role
    // (content-hash dedup ignores blob_type, see `create_media_blob`'s
    // doc comment), so every attempt to (re-)link it hit this exact
    // (song_id, media_blob_id) PRIMARY KEY collision and errored instead
    // of being treated as "already linked, nothing to do".
    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn add_song_image_is_idempotent_on_duplicate_link() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;
        let pool = database::connect().await.expect("connect");

        sqlx::query(
            "INSERT INTO media_blobz (id, sha256, size, mime, blob_type, blake3)
             VALUES ('audioblob1', ?, 123, 'audio/mpeg', 'original', ?)",
        )
        .bind("a".repeat(64))
        .bind("b".repeat(64))
        .execute(&pool)
        .await
        .expect("insert audio blob");

        sqlx::query(
            "INSERT INTO media_blobz (id, sha256, size, mime, blob_type, blake3)
             VALUES ('imageblob1', ?, 456, 'image/webp', 'original', ?)",
        )
        .bind("c".repeat(64))
        .bind("d".repeat(64))
        .execute(&pool)
        .await
        .expect("insert image blob");

        sqlx::query(
            "INSERT INTO songz (id, media_blob_id, title) VALUES ('song1', 'audioblob1', 'Test Song')",
        )
        .execute(&pool)
        .await
        .expect("insert song");

        let first = add_song_image("song1", "imageblob1", false, None).await;
        assert!(
            first.success,
            "first link should succeed: {}",
            first.message
        );

        // same (song_id, media_blob_id) pair again - must succeed as a
        // no-op, not hard-fail on the PRIMARY KEY collision.
        let second = add_song_image("song1", "imageblob1", false, None).await;
        assert!(
            second.success,
            "re-linking an already-linked pair must be a no-op success, not an error: {}",
            second.message
        );

        let row_count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM song_imagez WHERE song_id = 'song1' AND media_blob_id = 'imageblob1'",
        )
        .fetch_one(&pool)
        .await
        .expect("count");
        assert_eq!(
            row_count, 1,
            "duplicate link attempt must not create a second row"
        );
    }
}
