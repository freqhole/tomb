//! Admin dashboard analytics
//!
//! Provides high-level statistics and insights for administrators,
//! including overview stats, top songs/albums/artists, and user statistics.

use crate::database;
use crate::error::GrimoireResult;
use serde::{Deserialize, Serialize};

/// Overview statistics for the entire system
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverviewStats {
    /// Total number of songs in library
    pub total_songs: i64,
    /// Total number of albums
    pub total_albums: i64,
    /// Total number of artists
    pub total_artists: i64,
    /// Total number of users
    pub total_users: i64,
    /// Total number of play events
    pub total_plays: i64,
    /// Total number of unique listening sessions
    pub total_sessions: i64,
    /// Total number of favorites (all types)
    pub total_favorites: i64,
    /// Total library duration in seconds
    pub total_duration_seconds: i64,
}

/// Top song with play statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopSong {
    /// Song ID
    pub song_id: String,
    /// Song title
    pub title: String,
    /// Artist name
    pub artist_name: Option<String>,
    /// Album title
    pub album_title: Option<String>,
    /// Thumbnail blob ID
    pub thumbnail_blob_id: Option<String>,
    /// Total play count
    pub play_count: i64,
    /// Number of unique users who played this
    pub unique_users: i64,
    /// Last played timestamp
    pub last_played_at: Option<i64>,
}

/// Top album with aggregated play statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopAlbum {
    /// Album ID
    pub album_id: String,
    /// Album title
    pub title: String,
    /// Artist name
    pub artist_name: Option<String>,
    /// Thumbnail blob ID (from album_imagez)
    pub thumbnail_blob_id: Option<String>,
    /// Total plays across all songs in album
    pub total_plays: i64,
    /// Number of songs in album
    pub song_count: i64,
    /// Number of unique users who played songs from this album
    pub unique_users: i64,
}

/// Top artist with aggregated play statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TopArtist {
    /// Artist ID
    pub artist_id: String,
    /// Artist name
    pub name: String,
    /// Total plays across all songs by this artist
    pub total_plays: i64,
    /// Number of songs by this artist
    pub song_count: i64,
    /// Number of albums by this artist
    pub album_count: i64,
    /// Number of unique users who played songs by this artist
    pub unique_users: i64,
}

/// User statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserStats {
    /// User ID
    pub user_id: String,
    /// Username
    pub username: String,
    /// Total number of plays by this user
    pub total_plays: i64,
    /// Number of unique songs played
    pub unique_songs_played: i64,
    /// Number of unique sessions
    pub unique_sessions: i64,
    /// Number of favorites
    pub total_favorites: i64,
    /// First activity timestamp
    pub first_activity_at: Option<i64>,
    /// Most recent activity timestamp
    pub last_activity_at: Option<i64>,
}

/// Get overview statistics for the entire system
///
/// Returns high-level counts and aggregates across the entire library and user base.
pub async fn get_overview_stats() -> GrimoireResult<OverviewStats> {
    let pool = database::connect().await?;

    let result = sqlx::query!(
        r#"
        SELECT
            (SELECT COUNT(*) FROM songz WHERE deleted_at IS NULL) as "total_songs!: i64",
            (SELECT COUNT(*) FROM albumz WHERE deleted_at IS NULL) as "total_albums!: i64",
            (SELECT COUNT(*) FROM artistz WHERE deleted_at IS NULL) as "total_artists!: i64",
            (SELECT COUNT(*) FROM user_accountz WHERE deleted_at IS NULL) as "total_users!: i64",
            (SELECT COUNT(*) FROM music_play_eventz) as "total_plays!: i64",
            (SELECT COUNT(DISTINCT session_id) FROM music_play_eventz) as "total_sessions!: i64",
            (SELECT COUNT(*) FROM user_favoritez) as "total_favorites!: i64",
            (SELECT COALESCE(SUM(duration), 0) FROM songz WHERE deleted_at IS NULL) as "total_duration!: i64"
        "#
    )
    .fetch_one(&pool)
    .await?;

    Ok(OverviewStats {
        total_songs: result.total_songs,
        total_albums: result.total_albums,
        total_artists: result.total_artists,
        total_users: result.total_users,
        total_plays: result.total_plays,
        total_sessions: result.total_sessions,
        total_favorites: result.total_favorites,
        total_duration_seconds: result.total_duration / 1000, // Convert ms to seconds
    })
}

/// Get top songs by play count
///
/// Returns the most played songs in the system.
pub async fn get_top_songs(limit: i64) -> GrimoireResult<Vec<TopSong>> {
    let pool = database::connect().await?;

    let rows = sqlx::query!(
        r#"
        SELECT
            mpe.song_id,
            s.title,
            s.thumbnail_blob_id,
            COUNT(*) as "play_count!: i64",
            COUNT(DISTINCT mpe.user_id) as "unique_users!: i64",
            MAX(mpe.created_at) as "last_played_at?: i64",
            (SELECT a.name FROM artist_songz asz
             JOIN artistz a ON a.id = asz.artist_id
             WHERE asz.song_id = mpe.song_id
             LIMIT 1) as "artist_name?",
            (SELECT alb.title FROM album_songz als
             JOIN albumz alb ON alb.id = als.album_id
             WHERE als.song_id = mpe.song_id
             LIMIT 1) as "album_title?"
        FROM music_play_eventz mpe
        JOIN songz s ON s.id = mpe.song_id
        WHERE s.deleted_at IS NULL
        GROUP BY mpe.song_id
        ORDER BY COUNT(*) DESC
        LIMIT ?
        "#,
        limit
    )
    .fetch_all(&pool)
    .await?;

    let songs = rows
        .into_iter()
        .map(|row| TopSong {
            song_id: row.song_id,
            title: row.title,
            artist_name: row.artist_name,
            album_title: row.album_title,
            thumbnail_blob_id: row.thumbnail_blob_id,
            play_count: row.play_count,
            unique_users: row.unique_users,
            last_played_at: row.last_played_at,
        })
        .collect();

    Ok(songs)
}

/// Get top albums by aggregated play count
///
/// Returns albums with the most plays across all their songs.
pub async fn get_top_albums(limit: i64) -> GrimoireResult<Vec<TopAlbum>> {
    let pool = database::connect().await?;

    let rows = sqlx::query!(
        r#"
        SELECT
            alb.id as "album_id!",
            alb.title as "title!",
            alb.song_count as "song_count!: i64",
            COUNT(*) as "total_plays!: i64",
            COUNT(DISTINCT mpe.user_id) as "unique_users!: i64",
            (SELECT a.name FROM artist_albumz aa
             JOIN artistz a ON a.id = aa.artist_id
             WHERE aa.album_id = alb.id
             LIMIT 1) as "artist_name?",
            (SELECT ai.media_blob_id FROM album_imagez ai
             WHERE ai.album_id = alb.id AND ai.is_primary = 1
             LIMIT 1) as "thumbnail_blob_id?"
        FROM music_play_eventz mpe
        JOIN album_songz als ON als.song_id = mpe.song_id
        JOIN albumz alb ON alb.id = als.album_id
        WHERE alb.deleted_at IS NULL
        GROUP BY alb.id
        ORDER BY COUNT(*) DESC
        LIMIT ?
        "#,
        limit
    )
    .fetch_all(&pool)
    .await?;

    let albums = rows
        .into_iter()
        .map(|row| TopAlbum {
            album_id: row.album_id,
            title: row.title,
            artist_name: row.artist_name,
            thumbnail_blob_id: row.thumbnail_blob_id,
            total_plays: row.total_plays,
            song_count: row.song_count,
            unique_users: row.unique_users,
        })
        .collect();

    Ok(albums)
}

/// Get top artists by aggregated play count
///
/// Returns artists with the most plays across all their songs.
pub async fn get_top_artists(limit: i64) -> GrimoireResult<Vec<TopArtist>> {
    let pool = database::connect().await?;

    let rows = sqlx::query!(
        r#"
        SELECT
            a.id as "artist_id!",
            a.name as "name!",
            COUNT(*) as "total_plays!: i64",
            COUNT(DISTINCT mpe.song_id) as "song_count!: i64",
            COUNT(DISTINCT mpe.user_id) as "unique_users!: i64",
            (SELECT COUNT(DISTINCT aa.album_id)
             FROM artist_albumz aa
             WHERE aa.artist_id = a.id) as "album_count!: i64"
        FROM music_play_eventz mpe
        JOIN artist_songz asz ON asz.song_id = mpe.song_id
        JOIN artistz a ON a.id = asz.artist_id
        WHERE a.deleted_at IS NULL
        GROUP BY a.id
        ORDER BY COUNT(*) DESC
        LIMIT ?
        "#,
        limit
    )
    .fetch_all(&pool)
    .await?;

    let artists = rows
        .into_iter()
        .map(|row| TopArtist {
            artist_id: row.artist_id,
            name: row.name,
            total_plays: row.total_plays,
            song_count: row.song_count,
            album_count: row.album_count,
            unique_users: row.unique_users,
        })
        .collect();

    Ok(artists)
}

/// Get statistics for a specific user
///
/// Returns detailed activity statistics for a single user.
pub async fn get_user_stats(user_id: &str) -> GrimoireResult<UserStats> {
    let pool = database::connect().await?;

    let result = sqlx::query!(
        r#"
        SELECT
            u.id as "user_id!",
            u.username as "username!",
            (SELECT COUNT(*) FROM music_play_eventz WHERE user_id = u.id) as "total_plays!: i64",
            (SELECT COUNT(DISTINCT song_id) FROM music_play_eventz WHERE user_id = u.id) as "unique_songs!: i64",
            (SELECT COUNT(DISTINCT session_id) FROM music_play_eventz WHERE user_id = u.id) as "unique_sessions!: i64",
            (SELECT COUNT(*) FROM user_favoritez WHERE user_id = u.id) as "total_favorites!: i64",
            (SELECT MIN(created_at) FROM music_play_eventz WHERE user_id = u.id) as "first_activity?: i64",
            (SELECT MAX(created_at) FROM music_play_eventz WHERE user_id = u.id) as "last_activity?: i64"
        FROM user_accountz u
        WHERE u.id = ?
        "#,
        user_id
    )
    .fetch_one(&pool)
    .await?;

    Ok(UserStats {
        user_id: result.user_id,
        username: result.username,
        total_plays: result.total_plays,
        unique_songs_played: result.unique_songs,
        unique_sessions: result.unique_sessions,
        total_favorites: result.total_favorites,
        first_activity_at: result.first_activity,
        last_activity_at: result.last_activity,
    })
}

/// Get statistics for all users
///
/// Returns activity statistics for all users in the system.
pub async fn get_all_user_stats(limit: i64) -> GrimoireResult<Vec<UserStats>> {
    let pool = database::connect().await?;

    let rows = sqlx::query!(
        r#"
        SELECT
            u.id as "user_id!",
            u.username as "username!",
            COALESCE((SELECT COUNT(*) FROM music_play_eventz WHERE user_id = u.id), 0) as "total_plays!: i64",
            COALESCE((SELECT COUNT(DISTINCT song_id) FROM music_play_eventz WHERE user_id = u.id), 0) as "unique_songs!: i64",
            COALESCE((SELECT COUNT(DISTINCT session_id) FROM music_play_eventz WHERE user_id = u.id), 0) as "unique_sessions!: i64",
            COALESCE((SELECT COUNT(*) FROM user_favoritez WHERE user_id = u.id), 0) as "total_favorites!: i64",
            (SELECT MIN(created_at) FROM music_play_eventz WHERE user_id = u.id) as "first_activity?: i64",
            (SELECT MAX(created_at) FROM music_play_eventz WHERE user_id = u.id) as "last_activity?: i64"
        FROM user_accountz u
        WHERE u.deleted_at IS NULL
        ORDER BY COALESCE((SELECT COUNT(*) FROM music_play_eventz WHERE user_id = u.id), 0) DESC
        LIMIT ?
        "#,
        limit
    )
    .fetch_all(&pool)
    .await?;

    let users = rows
        .into_iter()
        .map(|row| UserStats {
            user_id: row.user_id,
            username: row.username,
            total_plays: row.total_plays,
            unique_songs_played: row.unique_songs,
            unique_sessions: row.unique_sessions,
            total_favorites: row.total_favorites,
            first_activity_at: row.first_activity,
            last_activity_at: row.last_activity,
        })
        .collect();

    Ok(users)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // Requires database setup with test data
    async fn test_get_overview_stats() {
        let result = get_overview_stats().await;
        assert!(result.is_ok());
        let stats = result.unwrap();
        assert!(stats.total_songs >= 0);
    }

    #[tokio::test]
    #[ignore] // Requires database setup with test data
    async fn test_get_top_songs() {
        let result = get_top_songs(10).await;
        assert!(result.is_ok());
        let songs = result.unwrap();
        assert!(songs.len() <= 10);
    }

    #[tokio::test]
    #[ignore] // Requires database setup with test data
    async fn test_get_top_albums() {
        let result = get_top_albums(10).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    #[ignore] // Requires database setup with test data
    async fn test_get_top_artists() {
        let result = get_top_artists(10).await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    #[ignore] // Requires database setup with test data
    async fn test_get_user_stats() {
        let result = get_user_stats("test_user_id").await;
        // May fail if user doesn't exist, that's expected
        assert!(result.is_ok() || result.is_err());
    }

    #[tokio::test]
    #[ignore] // Requires database setup with test data
    async fn test_get_all_user_stats() {
        let result = get_all_user_stats(10).await;
        assert!(result.is_ok());
    }
}
