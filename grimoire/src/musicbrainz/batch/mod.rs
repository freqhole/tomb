//! Batch processing utilities for MusicBrainz integration
//!
//! This module provides database queries and utilities for batch processing
//! songs with MusicBrainz data, including smart skip logic based on timestamps.

use crate::music::models::Song;
use crate::music::repository::MusicRepository;

use std::sync::Arc;

/// Get album groups that need processing for full scan
pub async fn get_album_groups_for_full_scan(
    repository: &Arc<MusicRepository>,
    limit: i64,
    offset: i64,
    force_rescan: bool,
) -> Result<Vec<Song>, sqlx::Error> {
    let query = if force_rescan {
        // Force rescan: get all songs regardless of musicbrainz data
        r#"
        SELECT id, media_blob_id, thumbnail_blob_id, waveform_blob_id, thumbnail_blob_ids,
               title, artist, album, album_artist, track_number, disc_number,
               duration, genre, year, bpm, key_signature, rating, is_favorite,
               tags, metadata, processing_status, processing_notes,
               deleted_at, deleted_by, created_at, updated_at, version
        FROM songs
        WHERE artist IS NOT NULL AND album IS NOT NULL
        AND trim(artist) != '' AND trim(album) != ''
        ORDER BY artist, album, track_number
        LIMIT $1 OFFSET $2
        "#
    } else {
        // Smart scan: prioritize albums that haven't been fully processed
        r#"
        SELECT id, media_blob_id, thumbnail_blob_id, waveform_blob_id, thumbnail_blob_ids,
               title, artist, album, album_artist, track_number, disc_number,
               duration, genre, year, bpm, key_signature, rating, is_favorite,
               tags, metadata, processing_status, processing_notes,
               deleted_at, deleted_by, created_at, updated_at, version
        FROM songs
        WHERE artist IS NOT NULL AND album IS NOT NULL
        AND trim(artist) != '' AND trim(album) != ''
        AND (
            metadata->'musicbrainz' IS NULL
            OR metadata->'musicbrainz'->>'status' != 'user_reviewed'
            OR (metadata->'musicbrainz'->>'scanned_at')::bigint < extract(epoch from updated_at)
        )
        ORDER BY artist, album, track_number
        LIMIT $1 OFFSET $2
        "#
    };

    let songs = sqlx::query_as::<_, Song>(&query)
        .bind(limit * 20) // Get more songs to form album groups
        .bind(offset * 20)
        .fetch_all(repository.pool())
        .await?;

    Ok(songs)
}

/// Get remaining individual songs for full scan (not part of complete albums)
pub async fn get_remaining_songs_for_full_scan(
    repository: &Arc<MusicRepository>,
    limit: i64,
    offset: i64,
    force_rescan: bool,
) -> Result<Vec<Song>, sqlx::Error> {
    let query = if force_rescan {
        // Force rescan: get all songs that weren't processed in album phase
        r#"
        SELECT id, media_blob_id, thumbnail_blob_id, waveform_blob_id, thumbnail_blob_ids,
               title, artist, album, album_artist, track_number, disc_number,
               duration, genre, year, bpm, key_signature, rating, is_favorite,
               tags, metadata, processing_status, processing_notes,
               deleted_at, deleted_by, created_at, updated_at, version
        FROM songs
        WHERE (artist IS NULL OR album IS NULL OR trim(artist) = '' OR trim(album) = '')
        ORDER BY artist, title
        LIMIT $1 OFFSET $2
        "#
    } else {
        // Smart scan: get songs that need processing
        r#"
        SELECT id, media_blob_id, thumbnail_blob_id, waveform_blob_id, thumbnail_blob_ids,
               title, artist, album, album_artist, track_number, disc_number,
               duration, genre, year, bpm, key_signature, rating, is_favorite,
               tags, metadata, processing_status, processing_notes,
               deleted_at, deleted_by, created_at, updated_at, version
        FROM songs
        WHERE (
            -- Songs without artist/album (can't be part of album processing)
            (artist IS NULL OR album IS NULL OR trim(artist) = '' OR trim(album) = '')
            OR
            -- Songs that haven't been scanned or need rescanning
            (
                metadata->'musicbrainz' IS NULL
                OR metadata->'musicbrainz'->>'status' != 'user_reviewed'
                OR (metadata->'musicbrainz'->>'scanned_at')::bigint < extract(epoch from updated_at)
            )
        )
        AND NOT EXISTS (
            -- Exclude songs that might be part of album groups we already processed
            SELECT 1 FROM songs s2
            WHERE s2.artist = songs.artist
            AND s2.album = songs.album
            AND s2.artist IS NOT NULL
            AND s2.album IS NOT NULL
            AND trim(s2.artist) != ''
            AND trim(s2.album) != ''
            HAVING COUNT(*) >= 3  -- Albums with 3+ tracks
        )
        ORDER BY artist, title
        LIMIT $1 OFFSET $2
        "#
    };

    let songs = sqlx::query_as::<_, Song>(&query)
        .bind(limit)
        .bind(offset)
        .fetch_all(repository.pool())
        .await?;

    Ok(songs)
}

/// Mark songs as user-reviewed to prevent re-scanning
pub async fn mark_songs_as_reviewed(
    repository: &Arc<MusicRepository>,
    song_id: Option<uuid::Uuid>,
    artist: Option<&str>,
    album: Option<&str>,
    all: bool,
) -> Result<u64, sqlx::Error> {
    if all {
        let result = sqlx::query(
            r#"
            UPDATE songs
            SET metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                '{musicbrainz,status}',
                '"user_reviewed"'::jsonb
            )
            WHERE metadata->'musicbrainz' IS NOT NULL
            "#,
        )
        .execute(repository.pool())
        .await?;

        Ok(result.rows_affected())
    } else if let Some(id) = song_id {
        let result = sqlx::query(
            r#"
            UPDATE songs
            SET metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                '{musicbrainz,status}',
                '"user_reviewed"'::jsonb
            )
            WHERE id = $1 AND metadata->'musicbrainz' IS NOT NULL
            "#,
        )
        .bind(id)
        .execute(repository.pool())
        .await?;

        Ok(result.rows_affected())
    } else if artist.is_some() || album.is_some() {
        let mut query = String::from(
            r#"
            UPDATE songs
            SET metadata = jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                '{musicbrainz,status}',
                '"user_reviewed"'::jsonb
            )
            WHERE metadata->'musicbrainz' IS NOT NULL
            "#,
        );

        let mut conditions = Vec::new();
        if let Some(artist_filter) = artist {
            conditions.push(format!("artist ILIKE '%{}%'", artist_filter));
        }
        if let Some(album_filter) = album {
            conditions.push(format!("album ILIKE '%{}%'", album_filter));
        }

        if !conditions.is_empty() {
            query.push_str(" AND ");
            query.push_str(&conditions.join(" AND "));
        }

        let result = sqlx::query(&query).execute(repository.pool()).await?;
        Ok(result.rows_affected())
    } else {
        Ok(0)
    }
}

/// Clear MusicBrainz metadata from songs
pub async fn clear_musicbrainz_data(
    repository: &Arc<MusicRepository>,
    song_id: Option<uuid::Uuid>,
    artist: Option<&str>,
    album: Option<&str>,
    all: bool,
) -> Result<u64, sqlx::Error> {
    if all {
        let result = sqlx::query(
            r#"
            UPDATE songs
            SET metadata = metadata - 'musicbrainz'
            WHERE metadata->'musicbrainz' IS NOT NULL
            "#,
        )
        .execute(repository.pool())
        .await?;

        Ok(result.rows_affected())
    } else if let Some(id) = song_id {
        let result = sqlx::query(
            r#"
            UPDATE songs
            SET metadata = metadata - 'musicbrainz'
            WHERE id = $1 AND metadata->'musicbrainz' IS NOT NULL
            "#,
        )
        .bind(id)
        .execute(repository.pool())
        .await?;

        Ok(result.rows_affected())
    } else if artist.is_some() || album.is_some() {
        let mut query = String::from(
            r#"
            UPDATE songs
            SET metadata = metadata - 'musicbrainz'
            WHERE metadata->'musicbrainz' IS NOT NULL
            "#,
        );

        let mut conditions = Vec::new();
        if let Some(artist_filter) = artist {
            conditions.push(format!("artist ILIKE '%{}%'", artist_filter));
        }
        if let Some(album_filter) = album {
            conditions.push(format!("album ILIKE '%{}%'", album_filter));
        }

        if !conditions.is_empty() {
            query.push_str(" AND ");
            query.push_str(&conditions.join(" AND "));
        }

        let result = sqlx::query(&query).execute(repository.pool()).await?;
        Ok(result.rows_affected())
    } else {
        Ok(0)
    }
}

/// Check if an individual song should be skipped based on scan timestamps
pub fn should_skip_song(song: &Song) -> bool {
    if let Some(musicbrainz_data) = song.metadata.get("musicbrainz") {
        // Check if user has reviewed this
        if musicbrainz_data.get("status").and_then(|s| s.as_str()) == Some("user_reviewed") {
            // Check if song was updated since last scan
            if let Some(scanned_at) = musicbrainz_data.get("scanned_at").and_then(|s| s.as_i64()) {
                return scanned_at >= song.updated_at.unix_timestamp();
            }
        }
    }
    false
}
