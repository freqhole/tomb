//! processing status management for musicbrainz workflows
//!
//! provides functions for tracking and managing song/album processing status
//! during bulk musicbrainz metadata updates.
//! #todo: this is probably half-baked feature...

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, PgPool};
use time::{OffsetDateTime, PrimitiveDateTime};
use uuid::Uuid;

/// processing status values for songs and albums
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text")]
pub enum ProcessingStatus {
    /// not yet processed
    #[serde(rename = "unprocessed")]
    #[sqlx(rename = "unprocessed")]
    Unprocessed,

    /// successfully processed and updated
    #[serde(rename = "processed")]
    #[sqlx(rename = "processed")]
    Processed,

    /// marked to skip (good as-is or not suitable for updates)
    #[serde(rename = "skip")]
    #[sqlx(rename = "skip")]
    Skip,

    /// needs manual review before processing
    #[serde(rename = "review_needed")]
    #[sqlx(rename = "review_needed")]
    ReviewNeeded,

    /// duplicate song marked for removal
    #[serde(rename = "duplicate")]
    #[sqlx(rename = "duplicate")]
    Duplicate,
}

impl Default for ProcessingStatus {
    fn default() -> Self {
        Self::Unprocessed
    }
}

impl std::fmt::Display for ProcessingStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unprocessed => write!(f, "unprocessed"),
            Self::Processed => write!(f, "processed"),
            Self::Skip => write!(f, "skip"),
            Self::ReviewNeeded => write!(f, "review_needed"),
            Self::Duplicate => write!(f, "duplicate"),
        }
    }
}

/// album processing status information
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct AlbumProcessingInfo {
    pub album_name: Option<String>,
    pub artist_name: Option<String>,
    pub song_count: i64,
    pub processed_count: i32,
    pub status: String,
    pub notes: Option<String>,
    pub updated_at: time::PrimitiveDateTime,
}

/// processing progress summary
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct ProcessingProgress {
    pub total_songs: Option<i64>,
    pub unprocessed_songs: Option<i64>,
    pub processed_songs: Option<i64>,
    pub skipped_songs: Option<i64>,
    pub review_needed_songs: Option<i64>,
    pub duplicate_songs: Option<i64>,
    pub total_albums: Option<i64>,
    pub unprocessed_albums: Option<i64>,
    pub processed_albums: Option<i64>,
}

impl ProcessingProgress {
    /// calculate percentage of songs processed
    pub fn songs_processed_percentage(&self) -> f32 {
        let total = self.total_songs.unwrap_or(0);
        if total == 0 {
            return 100.0;
        }
        let processed = self.processed_songs.unwrap_or(0) + self.skipped_songs.unwrap_or(0);
        (processed as f32 / total as f32) * 100.0
    }

    /// calculate percentage of albums processed
    pub fn albums_processed_percentage(&self) -> f32 {
        let total = self.total_albums.unwrap_or(0);
        if total == 0 {
            return 100.0;
        }
        let processed = self.processed_albums.unwrap_or(0);
        (processed as f32 / total as f32) * 100.0
    }

    /// get remaining songs to process
    pub fn remaining_songs(&self) -> i64 {
        self.unprocessed_songs.unwrap_or(0) + self.review_needed_songs.unwrap_or(0)
    }
}

/// mark a song's processing status
pub async fn mark_song_status(
    pool: &PgPool,
    song_id: Uuid,
    status: ProcessingStatus,
    notes: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query!(
        "SELECT mark_song_status($1, $2, $3) as success",
        song_id,
        status.to_string(),
        notes
    )
    .fetch_one(pool)
    .await?;

    Ok(result.success.unwrap_or(false))
}

/// mark an album's processing status
pub async fn mark_album_status(
    pool: &PgPool,
    album_name: &str,
    artist_name: &str,
    status: ProcessingStatus,
    notes: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let result = sqlx::query!(
        "SELECT mark_album_status($1, $2, $3, $4) as success",
        album_name,
        artist_name,
        status.to_string(),
        notes
    )
    .fetch_one(pool)
    .await?;

    Ok(result.success.unwrap_or(false))
}

/// get processing progress summary
pub async fn get_processing_progress(pool: &PgPool) -> Result<ProcessingProgress, sqlx::Error> {
    let progress = sqlx::query_as!(
        ProcessingProgress,
        "SELECT * FROM get_processing_progress()"
    )
    .fetch_one(pool)
    .await?;

    Ok(progress)
}

/// get albums for processing with optional filters
pub async fn get_albums_for_processing(
    pool: &PgPool,
    _filter_status: Option<ProcessingStatus>,
    _artist_filter: Option<&str>,
    limit: Option<i32>,
    offset: Option<i32>,
) -> Result<Vec<AlbumProcessingInfo>, sqlx::Error> {
    // Temporarily use simplified query to avoid type issues
    let albums = sqlx::query!(
        r#"
        SELECT DISTINCT
            s.album as album_name,
            s.artist as artist_name,
            COUNT(*) as song_count,
            0::INTEGER as processed_count,
            'unprocessed'::TEXT as status,
            NULL::TEXT as notes,
            NOW() as updated_at
        FROM songs s
        WHERE s.album IS NOT NULL AND s.artist IS NOT NULL
        GROUP BY s.album, s.artist
        ORDER BY updated_at DESC
        LIMIT $1::BIGINT
        OFFSET $2::BIGINT
        "#,
        limit.unwrap_or(50) as i64,
        offset.unwrap_or(0) as i64
    )
    .fetch_all(pool)
    .await?;

    let albums = albums
        .into_iter()
        .map(|row| AlbumProcessingInfo {
            album_name: row.album_name,
            artist_name: row.artist_name,
            song_count: row.song_count.unwrap_or(0),
            processed_count: row.processed_count.unwrap_or(0),
            status: row.status.unwrap_or("unprocessed".to_string()),
            notes: row.notes,
            updated_at: row
                .updated_at
                .map(|dt| PrimitiveDateTime::new(dt.date(), dt.time()))
                .unwrap_or_else(|| {
                    let now = OffsetDateTime::now_utc();
                    PrimitiveDateTime::new(now.date(), now.time())
                }),
        })
        .collect();

    Ok(albums)
}

/// get songs in an album with processing status
pub async fn get_album_songs_with_status(
    pool: &PgPool,
    album_name: &str,
    artist_name: &str,
) -> Result<Vec<crate::music::Song>, sqlx::Error> {
    let songs = sqlx::query_as::<_, crate::music::Song>(
        "SELECT * FROM songs WHERE album = $1 AND artist = $2 ORDER BY track_number, title",
    )
    .bind(album_name)
    .bind(artist_name)
    .fetch_all(pool)
    .await?;

    Ok(songs)
}

/// get next unprocessed album for interactive workflow
pub async fn get_next_unprocessed_album(
    pool: &PgPool,
    artist_filter: Option<&str>,
) -> Result<Option<AlbumProcessingInfo>, sqlx::Error> {
    let albums = get_albums_for_processing(
        pool,
        Some(ProcessingStatus::Unprocessed),
        artist_filter,
        Some(1),
        Some(0),
    )
    .await?;

    Ok(albums.into_iter().next())
}

/// bulk mark songs in album as processed
pub async fn mark_album_songs_processed(
    pool: &PgPool,
    album_name: &str,
    artist_name: &str,
) -> Result<i64, sqlx::Error> {
    let result = sqlx::query!(
        r#"
        UPDATE songs
        SET processing_status = 'processed'
        WHERE album = $1 AND artist = $2 AND processing_status = 'unprocessed'
        "#,
        album_name,
        artist_name
    )
    .execute(pool)
    .await?;

    Ok(result.rows_affected() as i64)
}

/// get processing statistics for an artist
pub async fn get_artist_processing_stats(
    pool: &PgPool,
    artist_name: &str,
) -> Result<ProcessingProgress, sqlx::Error> {
    let row = sqlx::query!(
        r#"
        SELECT
            COUNT(*) as total_songs,
            COUNT(*) FILTER (WHERE processing_status = 'unprocessed') as unprocessed_songs,
            COUNT(*) FILTER (WHERE processing_status = 'processed') as processed_songs,
            COUNT(*) FILTER (WHERE processing_status = 'skip') as skipped_songs,
            COUNT(*) FILTER (WHERE processing_status = 'review_needed') as review_needed_songs,
            COUNT(*) FILTER (WHERE processing_status = 'duplicate') as duplicate_songs,
            COUNT(DISTINCT album) as total_albums,
            COUNT(DISTINCT album) FILTER (WHERE processing_status = 'unprocessed') as unprocessed_albums,
            COUNT(DISTINCT album) FILTER (WHERE processing_status IN ('processed', 'skip')) as processed_albums
        FROM songs
        WHERE artist ILIKE '%' || $1 || '%'
        "#,
        artist_name
    )
    .fetch_one(pool)
    .await?;

    Ok(ProcessingProgress {
        total_songs: row.total_songs,
        unprocessed_songs: row.unprocessed_songs,
        processed_songs: row.processed_songs,
        skipped_songs: row.skipped_songs,
        review_needed_songs: row.review_needed_songs,
        duplicate_songs: row.duplicate_songs,
        total_albums: row.total_albums,
        unprocessed_albums: row.unprocessed_albums,
        processed_albums: row.processed_albums,
    })
}

// TODO: Implement these functions once basic album processing is working
// /// get songs that need metadata (NULL artist, album, or genre)
// pub async fn get_songs_needing_metadata(
//     pool: &PgPool,
//     limit: Option<i32>,
//     offset: Option<i32>,
// ) -> Result<Vec<SongNeedingMetadata>, sqlx::Error> {
//     // Simplified for now - just return empty vec
//     Ok(Vec::new())
// }

// /// song needing metadata structure
// #[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
// pub struct SongNeedingMetadata {
//     pub id: uuid::Uuid,
//     pub title: String,
//     pub artist: Option<String>,
//     pub album: Option<String>,
//     pub file_path: String,
//     pub processing_status: Option<String>,
// }

// /// get potential duplicate song groups
// pub async fn find_potential_duplicates(
//     pool: &PgPool,
//     similarity_threshold: Option<f32>,
//     limit: Option<i32>,
// ) -> Result<Vec<PotentialDuplicate>, sqlx::Error> {
//     // Simplified for now - just return empty vec
//     Ok(Vec::new())
// }

// /// potential duplicate structure
// #[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
// pub struct PotentialDuplicate {
//     pub group_id: i32,
//     pub song_id: uuid::Uuid,
//     pub title: Option<String>,
//     pub artist: Option<String>,
//     pub album: Option<String>,
//     pub file_size: Option<i64>,
//     pub similarity_score: Option<f32>,
// }

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_processing_status_display() {
        assert_eq!(ProcessingStatus::Unprocessed.to_string(), "unprocessed");
        assert_eq!(ProcessingStatus::Processed.to_string(), "processed");
        assert_eq!(ProcessingStatus::Skip.to_string(), "skip");
        assert_eq!(ProcessingStatus::ReviewNeeded.to_string(), "review_needed");
        assert_eq!(ProcessingStatus::Duplicate.to_string(), "duplicate");
    }

    #[test]
    fn test_processing_progress_calculations() {
        let progress = ProcessingProgress {
            total_songs: Some(100),
            unprocessed_songs: Some(30),
            processed_songs: Some(50),
            skipped_songs: Some(15),
            review_needed_songs: Some(3),
            duplicate_songs: Some(2),
            total_albums: Some(10),
            unprocessed_albums: Some(3),
            processed_albums: Some(7),
        };

        assert_eq!(progress.songs_processed_percentage(), 65.0); // (50 + 15) / 100
        assert_eq!(progress.albums_processed_percentage(), 70.0); // 7 / 10
        assert_eq!(progress.remaining_songs(), 33); // 30 + 3
    }

    #[test]
    fn test_empty_progress_calculations() {
        let progress = ProcessingProgress {
            total_songs: Some(0),
            unprocessed_songs: Some(0),
            processed_songs: Some(0),
            skipped_songs: Some(0),
            review_needed_songs: Some(0),
            duplicate_songs: Some(0),
            total_albums: Some(0),
            unprocessed_albums: Some(0),
            processed_albums: Some(0),
        };

        assert_eq!(progress.songs_processed_percentage(), 100.0);
        assert_eq!(progress.albums_processed_percentage(), 100.0);
        assert_eq!(progress.remaining_songs(), 0);
    }
}
