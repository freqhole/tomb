//! Hard deletion utilities for permanently removing old soft-deleted records
//! Properly handles FK constraints by cascading deletions and cleaning up relationships

use crate::database;
use crate::error::GrimoireResult;
use crate::response::GrimoireResponse;
use std::time::Instant;
use time::OffsetDateTime;

/// Options for hard deletion operations
#[derive(Debug, Clone)]
pub struct HardDeleteOptions {
    /// Minimum age in days before hard deletion (default: 30)
    pub retention_days: u32,
    /// Whether to also delete associated blob_data (default: true)
    pub delete_blob_data: bool,
    /// Whether to run in dry-run mode (default: false)
    pub dry_run: bool,
}

impl Default for HardDeleteOptions {
    fn default() -> Self {
        Self {
            retention_days: 30,
            delete_blob_data: true,
            dry_run: false,
        }
    }
}

/// Summary of hard deletion operation
#[derive(Debug, Clone, serde::Serialize)]
pub struct HardDeleteSummary {
    pub songs_deleted: u32,
    pub playlists_deleted: u32,
    pub artists_deleted: u32,
    pub albums_deleted: u32,
    pub tags_deleted: u32,
    pub genres_deleted: u32,
    pub media_blobs_deleted: u32,
    pub blob_data_deleted: u32,
    pub total_records_deleted: u32,
    pub duration_ms: u64,
    pub cutoff_timestamp: i64,
}

impl HardDeleteSummary {
    fn new(cutoff_timestamp: i64) -> Self {
        Self {
            songs_deleted: 0,
            playlists_deleted: 0,
            artists_deleted: 0,
            albums_deleted: 0,
            tags_deleted: 0,
            genres_deleted: 0,
            media_blobs_deleted: 0,
            blob_data_deleted: 0,
            total_records_deleted: 0,
            duration_ms: 0,
            cutoff_timestamp,
        }
    }

    fn add_totals(&mut self) {
        self.total_records_deleted = self.songs_deleted
            + self.playlists_deleted
            + self.artists_deleted
            + self.albums_deleted
            + self.tags_deleted
            + self.genres_deleted
            + self.media_blobs_deleted
            + self.blob_data_deleted;
    }
}

/// Hard delete all old soft-deleted records with proper cascade logic
///
/// Strategy:
/// 1. Cascade: songs referencing deleted blobs → soft-delete those songs
/// 2. Delete old songs: clean all relationships first, then delete song
/// 3. Delete old albums: cascade to remaining songs in album, then delete album
/// 4. Delete old artists: cascade to remaining albums/songs, then delete artist
/// 5. Delete old playlists: delete playlist only (never songs)
/// 6. Delete old tags: unlink from albums first
/// 7. Delete old genres: unlink from albums via album_taxonz junction first
///
/// Note: Blob cleanup is handled separately by filesystem sync, not here
pub async fn hard_delete_old_records(
    options: HardDeleteOptions,
) -> GrimoireResponse<HardDeleteSummary> {
    match hard_delete_old_records_internal(options).await {
        Ok(summary) => GrimoireResponse::success("Hard delete completed successfully", summary),
        Err(e) => GrimoireResponse::failure("Hard delete operation failed", vec![e.into()]),
    }
}

/// Internal implementation that returns Result
async fn hard_delete_old_records_internal(
    options: HardDeleteOptions,
) -> Result<HardDeleteSummary, crate::error::GrimoireError> {
    let start_time = Instant::now();

    let current_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("Time went backwards")
        .as_secs() as i64;
    let retention_seconds = (options.retention_days as i64) * 24 * 60 * 60;
    let cutoff_timestamp = current_time - retention_seconds;

    let mut summary = HardDeleteSummary::new(cutoff_timestamp);

    if options.dry_run {
        return dry_run_count_internal(cutoff_timestamp).await;
    }

    let pool = database::connect().await?;
    let mut tx = pool.begin().await?;

    // Step 0: Cascade from deleted blobs to songs
    let now = OffsetDateTime::now_utc().unix_timestamp();
    let songs_from_blobs: Vec<String> = sqlx::query_scalar!(
        r#"
        SELECT DISTINCT s.id as "id!"
        FROM songz s
        LEFT JOIN media_blobz mb ON s.media_blob_id = mb.id
        WHERE mb.deleted_at IS NOT NULL OR mb.id IS NULL
        "#
    )
    .fetch_all(&mut *tx)
    .await?;

    for song_id in &songs_from_blobs {
        sqlx::query!(
            "UPDATE songz SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
            now,
            now,
            song_id
        )
        .execute(&mut *tx)
        .await?;
    }

    // Step 1: Delete old songs
    let song_ids: Vec<String> = sqlx::query_scalar!(
        r#"SELECT id as "id!" FROM songz WHERE deleted_at IS NOT NULL AND deleted_at < ?"#,
        cutoff_timestamp
    )
    .fetch_all(&mut *tx)
    .await?;

    for song_id in &song_ids {
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
    summary.songs_deleted = song_ids.len() as u32;

    // Step 2: Delete old albums (cascade to remaining songs)
    let album_ids: Vec<String> = sqlx::query_scalar!(
        r#"SELECT id as "id!" FROM albumz WHERE deleted_at IS NOT NULL AND deleted_at < ?"#,
        cutoff_timestamp
    )
    .fetch_all(&mut *tx)
    .await?;

    for album_id in &album_ids {
        // Cascade to remaining songs in album
        let album_song_ids: Vec<String> = sqlx::query_scalar!(
            r#"SELECT song_id as "song_id!" FROM album_songz WHERE album_id = ?"#,
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

        // Clean up album relationships
        sqlx::query!("DELETE FROM artist_albumz WHERE album_id = ?", album_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query!("DELETE FROM album_tagz WHERE album_id = ?", album_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query!("DELETE FROM album_taxonz WHERE album_id = ?", album_id)
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
        sqlx::query!("DELETE FROM albumz WHERE id = ?", album_id)
            .execute(&mut *tx)
            .await?;
    }
    summary.albums_deleted = album_ids.len() as u32;

    // Step 3: Delete old artists (cascade to remaining albums/songs)
    let artist_ids: Vec<String> = sqlx::query_scalar!(
        r#"SELECT id as "id!" FROM artistz WHERE deleted_at IS NOT NULL AND deleted_at < ?"#,
        cutoff_timestamp
    )
    .fetch_all(&mut *tx)
    .await?;

    for artist_id in &artist_ids {
        // Cascade to remaining albums
        let artist_album_ids: Vec<String> = sqlx::query_scalar!(
            r#"SELECT album_id as "album_id!" FROM artist_albumz WHERE artist_id = ?"#,
            artist_id
        )
        .fetch_all(&mut *tx)
        .await?;

        for album_id in &artist_album_ids {
            let album_song_ids: Vec<String> = sqlx::query_scalar!(
                r#"SELECT song_id as "song_id!" FROM album_songz WHERE album_id = ?"#,
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

            sqlx::query!("DELETE FROM artist_albumz WHERE album_id = ?", album_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query!("DELETE FROM album_tagz WHERE album_id = ?", album_id)
                .execute(&mut *tx)
                .await?;
            sqlx::query!("DELETE FROM album_taxonz WHERE album_id = ?", album_id)
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
            sqlx::query!("DELETE FROM albumz WHERE id = ?", album_id)
                .execute(&mut *tx)
                .await?;
        }

        // Cascade to remaining songs directly linked to artist
        let artist_song_ids: Vec<String> = sqlx::query_scalar!(
            r#"SELECT song_id as "song_id!" FROM artist_songz WHERE artist_id = ?"#,
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
        sqlx::query!("DELETE FROM artistz WHERE id = ?", artist_id)
            .execute(&mut *tx)
            .await?;
    }
    summary.artists_deleted = artist_ids.len() as u32;

    // Step 4: Delete old playlists (DO NOT cascade to songs)
    let playlist_ids: Vec<String> = sqlx::query_scalar!(
        r#"SELECT id as "id!" FROM playlistz WHERE deleted_at IS NOT NULL AND deleted_at < ?"#,
        cutoff_timestamp
    )
    .fetch_all(&mut *tx)
    .await?;

    for playlist_id in &playlist_ids {
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
        sqlx::query!("DELETE FROM playlistz WHERE id = ?", playlist_id)
            .execute(&mut *tx)
            .await?;
    }
    summary.playlists_deleted = playlist_ids.len() as u32;

    // Step 5: Delete old tags (unlink from albums first)
    let tag_ids: Vec<String> = sqlx::query_scalar!(
        r#"SELECT id as "id!" FROM tagz WHERE deleted_at IS NOT NULL AND deleted_at < ?"#,
        cutoff_timestamp
    )
    .fetch_all(&mut *tx)
    .await?;

    for tag_id in &tag_ids {
        // Unlink from albums
        sqlx::query!("DELETE FROM album_tagz WHERE tag_id = ?", tag_id)
            .execute(&mut *tx)
            .await?;
        // Delete the tag
        sqlx::query!("DELETE FROM tagz WHERE id = ?", tag_id)
            .execute(&mut *tx)
            .await?;
    }
    summary.tags_deleted = tag_ids.len() as u32;

    // Step 6: Delete old genres (unlink from albums first via album_taxonz junction).
    // we only operate on taxons whose kind is 'genre' for parity with the legacy semantics.
    let genre_ids: Vec<String> = sqlx::query_scalar!(
        r#"SELECT t.id as "id!" FROM taxonz t
           JOIN taxon_kindz k ON k.id = t.kind_id AND k.slug = 'genre'
           WHERE t.deleted_at IS NOT NULL AND t.deleted_at < ?"#,
        cutoff_timestamp
    )
    .fetch_all(&mut *tx)
    .await?;

    for genre_id in &genre_ids {
        // Unlink from albums via taxon junction
        sqlx::query!("DELETE FROM album_taxonz WHERE taxon_id = ?", genre_id)
            .execute(&mut *tx)
            .await?;
        // Delete the taxon row
        sqlx::query!("DELETE FROM taxonz WHERE id = ?", genre_id)
            .execute(&mut *tx)
            .await?;
    }
    summary.genres_deleted = genre_ids.len() as u32;

    // Note: Blob cleanup is handled separately by filesystem sync, not here
    // If we delete blobs here, filesystem sync will just recreate them

    tx.commit().await?;

    summary.duration_ms = start_time.elapsed().as_millis() as u64;
    summary.add_totals();

    Ok(summary)
}

/// Internal dry run function
async fn dry_run_count_internal(
    cutoff_timestamp: i64,
) -> Result<HardDeleteSummary, crate::error::GrimoireError> {
    dry_run_count(cutoff_timestamp).await
}

async fn dry_run_count(cutoff_timestamp: i64) -> GrimoireResult<HardDeleteSummary> {
    let pool = database::connect().await?;
    let mut summary = HardDeleteSummary::new(cutoff_timestamp);

    let songs = sqlx::query!(
        "SELECT COUNT(*) as count FROM songz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        cutoff_timestamp
    )
    .fetch_one(&pool)
    .await?
    .count;
    summary.songs_deleted = songs as u32;

    let albums = sqlx::query!(
        "SELECT COUNT(*) as count FROM albumz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        cutoff_timestamp
    )
    .fetch_one(&pool)
    .await?
    .count;
    summary.albums_deleted = albums as u32;

    let artists = sqlx::query!(
        "SELECT COUNT(*) as count FROM artistz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        cutoff_timestamp
    )
    .fetch_one(&pool)
    .await?
    .count;
    summary.artists_deleted = artists as u32;

    let playlists = sqlx::query!(
        "SELECT COUNT(*) as count FROM playlistz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        cutoff_timestamp
    )
    .fetch_one(&pool)
    .await?
    .count;
    summary.playlists_deleted = playlists as u32;

    let tags = sqlx::query!(
        "SELECT COUNT(*) as count FROM tagz WHERE deleted_at IS NOT NULL AND deleted_at < ?",
        cutoff_timestamp
    )
    .fetch_one(&pool)
    .await?
    .count;
    summary.tags_deleted = tags as u32;

    let genres = sqlx::query!(
        r#"SELECT COUNT(*) as count FROM taxonz t
           JOIN taxon_kindz k ON k.id = t.kind_id AND k.slug = 'genre'
           WHERE t.deleted_at IS NOT NULL AND t.deleted_at < ?"#,
        cutoff_timestamp
    )
    .fetch_one(&pool)
    .await?
    .count;
    summary.genres_deleted = genres as u32;

    summary.add_totals();
    Ok(summary)
}
