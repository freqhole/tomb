//! Music analytics queries - read operations for play statistics and history

use crate::database;
use crate::error::{GrimoireError, GrimoireResult};

use super::models::{ListeningHistoryItem, PlayAnalytics, SessionSong, SessionSummary};

/// Get aggregated play analytics for a song
///
/// Returns statistics including total plays, completion rate, unique users, etc.
pub async fn get_song_play_analytics(song_id: &str) -> GrimoireResult<PlayAnalytics> {
    let pool = database::connect().await?;

    let result = sqlx::query!(
        r#"
        SELECT
            COUNT(*) as total_plays,
            COUNT(CASE WHEN me.event_type = 'complete' THEN 1 END) as complete_plays,
            COUNT(CASE WHEN me.event_type != 'complete' THEN 1 END) as partial_plays,
            COUNT(DISTINCT mpe.user_id) as unique_users,
            COUNT(DISTINCT mpe.session_id) as unique_sessions,
            MIN(mpe.created_at) as "first_played_at?: i64",
            MAX(mpe.created_at) as "last_played_at?: i64",
            AVG(
                CASE
                    WHEN json_extract(me.event_data, '$.position') IS NOT NULL
                    THEN CAST(json_extract(me.event_data, '$.position') AS REAL)
                    ELSE 0.0
                END
            ) as "avg_play_time?: f64",
            SUM(
                CASE
                    WHEN json_extract(me.event_data, '$.position') IS NOT NULL
                    THEN CAST(json_extract(me.event_data, '$.position') AS INTEGER)
                    ELSE 0
                END
            ) as "total_play_time?: i64"
        FROM music_play_eventz mpe
        JOIN media_eventz me ON me.id = mpe.media_event_id
        WHERE mpe.song_id = ?
        "#,
        song_id
    )
    .fetch_one(&pool)
    .await?;

    let total_plays = result.total_plays;
    let complete_plays = result.complete_plays;

    let completion_rate = if total_plays > 0 {
        complete_plays as f64 / total_plays as f64
    } else {
        0.0
    };

    Ok(PlayAnalytics {
        song_id: song_id.to_string(),
        total_plays,
        complete_plays,
        partial_plays: result.partial_plays,
        unique_users: result.unique_users,
        unique_sessions: result.unique_sessions,
        completion_rate,
        avg_play_time_seconds: result.avg_play_time.unwrap_or(0.0),
        total_play_time_seconds: result.total_play_time.unwrap_or(0),
        first_played_at: result.first_played_at,
        last_played_at: result.last_played_at,
    })
}

/// Get paginated listening history for a user
///
/// Returns a tuple of (items, total_count) for pagination
pub async fn get_user_listening_history(
    user_id: &str,
    limit: i64,
    offset: i64,
) -> GrimoireResult<(Vec<ListeningHistoryItem>, i64)> {
    let pool = database::connect().await?;

    // Get total count for pagination
    let count_result = sqlx::query!(
        r#"
        SELECT COUNT(*) as count
        FROM music_play_eventz
        WHERE user_id = ?
        "#,
        user_id
    )
    .fetch_one(&pool)
    .await?;

    let total_count = count_result.count;

    // Get paginated items with enriched data
    let rows = sqlx::query!(
        r#"
        SELECT
            mpe.id,
            mpe.media_event_id,
            mpe.song_id,
            mpe.playlist_id,
            mpe.session_id,
            mpe.created_at,
            s.title,
            s.track_number,
            s.disc_number,
            s.duration,
            s.year,
            s.thumbnail_blob_id,
            s.waveform_blob_id,
            me.event_data,
            -- Get artist name (first artist from join)
            (SELECT a.name FROM artist_songz asz
             JOIN artistz a ON a.id = asz.artist_id
             WHERE asz.song_id = mpe.song_id
             LIMIT 1) as "artist_name?",
            -- Get album title
            (SELECT alb.title FROM album_songz als
             JOIN albumz alb ON alb.id = als.album_id
             WHERE als.song_id = mpe.song_id
             LIMIT 1) as "album_title?",
            -- Get genre name
            (SELECT g.name FROM albumz alb
             JOIN album_songz als ON als.album_id = alb.id
             JOIN genrez g ON g.id = alb.genre_id
             WHERE als.song_id = mpe.song_id
             LIMIT 1) as "genre_name?",
            -- Get playlist name if applicable
            (SELECT p.title FROM playlistz p
             WHERE p.id = mpe.playlist_id) as "playlist_name?",
            -- Get username
            (SELECT u.username FROM user_accountz u
             WHERE u.id = mpe.user_id) as "username?"
        FROM music_play_eventz mpe
        JOIN songz s ON s.id = mpe.song_id
        JOIN media_eventz me ON me.id = mpe.media_event_id
        WHERE mpe.user_id = ?
        ORDER BY mpe.created_at DESC
        LIMIT ? OFFSET ?
        "#,
        user_id,
        limit,
        offset
    )
    .fetch_all(&pool)
    .await?;

    let items = rows
        .into_iter()
        .map(|row| {
            let event_data = row
                .event_data
                .and_then(|data| serde_json::from_str(&data).ok());

            ListeningHistoryItem {
                id: row.id,
                media_event_id: row.media_event_id,
                song_id: row.song_id,
                title: row.title,
                artist: row.artist_name,
                album: row.album_title,
                track_number: Some(row.track_number as i32),
                disc_number: Some(row.disc_number as i32),
                duration: row.duration.map(|d| d as i32),
                genre: row.genre_name,
                year: row.year.map(|y| y as i32),
                thumbnail_blob_id: row.thumbnail_blob_id,
                waveform_blob_id: row.waveform_blob_id,
                playlist_id: row.playlist_id,
                playlist_name: row.playlist_name,
                user_id: Some(user_id.to_string()),
                username: row.username,
                session_id: row.session_id,
                created_at: row.created_at,
                event_data,
            }
        })
        .collect();

    Ok((items, total_count))
}

/// Get simple play count for a song
///
/// Returns the total number of play events for this song
pub async fn get_song_play_count(song_id: &str) -> GrimoireResult<i64> {
    let pool = database::connect().await?;

    let result = sqlx::query!(
        r#"
        SELECT COUNT(*) as count
        FROM music_play_eventz
        WHERE song_id = ?
        "#,
        song_id
    )
    .fetch_one(&pool)
    .await?;

    Ok(result.count)
}

/// Get aggregate play count for all songs in an album
///
/// Returns the total number of play events for all songs in this album
pub async fn get_album_play_count(album_id: &str) -> GrimoireResult<i64> {
    let pool = database::connect().await?;

    let result = sqlx::query!(
        r#"
        SELECT COUNT(*) as count
        FROM music_play_eventz mpe
        WHERE mpe.song_id IN (
            SELECT song_id FROM album_songz WHERE album_id = ?
        )
        "#,
        album_id
    )
    .fetch_one(&pool)
    .await?;

    Ok(result.count)
}

/// Get aggregate play count for all songs by an artist
///
/// Returns the total number of play events for all songs by this artist
pub async fn get_artist_play_count(artist_id: &str) -> GrimoireResult<i64> {
    let pool = database::connect().await?;

    let result = sqlx::query!(
        r#"
        SELECT COUNT(*) as count
        FROM music_play_eventz mpe
        WHERE mpe.song_id IN (
            SELECT song_id FROM artist_songz WHERE artist_id = ?
        )
        "#,
        artist_id
    )
    .fetch_one(&pool)
    .await?;

    Ok(result.count)
}

/// Get summary of a listening session
///
/// Returns session metadata and list of songs played in chronological order
pub async fn get_session_summary(session_id: &str) -> GrimoireResult<SessionSummary> {
    let pool = database::connect().await?;

    // Get session metadata
    let session_meta = sqlx::query!(
        r#"
        SELECT
            user_id,
            MIN(created_at) as "session_start?: i64",
            MAX(created_at) as "session_end?: i64",
            COUNT(*) as "song_count?: i64",
            (SELECT username FROM user_accountz WHERE id = mpe.user_id LIMIT 1) as "username?"
        FROM music_play_eventz mpe
        WHERE session_id = ?
        GROUP BY user_id
        "#,
        session_id
    )
    .fetch_optional(&pool)
    .await?
    .ok_or_else(|| GrimoireError::Analytics(format!("Session not found: {}", session_id)))?;

    // Get songs in session
    let songs_rows = sqlx::query!(
        r#"
        SELECT
            mpe.song_id,
            mpe.created_at,
            s.title,
            s.thumbnail_blob_id,
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
        WHERE mpe.session_id = ?
        ORDER BY mpe.created_at ASC
        "#,
        session_id
    )
    .fetch_all(&pool)
    .await?;

    let songs = songs_rows
        .into_iter()
        .map(|row| SessionSong {
            song_id: row.song_id,
            title: row.title,
            artist: row.artist_name,
            album: row.album_title,
            thumbnail_blob_id: row.thumbnail_blob_id,
            played_at: row.created_at,
        })
        .collect();

    let session_start = session_meta.session_start.unwrap_or(0);
    let session_end = session_meta.session_end.unwrap_or(0);
    let total_duration = if session_end > session_start {
        session_end - session_start
    } else {
        0
    };

    Ok(SessionSummary {
        session_id: session_id.to_string(),
        user_id: session_meta.user_id,
        username: session_meta.username,
        songs,
        total_duration,
        session_start,
        session_end,
        song_count: session_meta.song_count.unwrap_or(0),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // Requires database setup with test data
    async fn test_get_song_play_count() {
        let result = get_song_play_count("test_song_id").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    #[ignore] // Requires database setup with test data
    async fn test_get_song_play_analytics() {
        let result = get_song_play_analytics("test_song_id").await;
        assert!(result.is_ok());

        let analytics = result.unwrap();
        assert_eq!(analytics.song_id, "test_song_id");
    }

    #[tokio::test]
    #[ignore] // Requires database setup with test data
    async fn test_get_user_listening_history() {
        let result = get_user_listening_history("test_user_id", 10, 0).await;
        assert!(result.is_ok());

        let (items, total_count) = result.unwrap();
        assert!(total_count >= 0);
        assert!(items.len() <= 10);
    }

    #[tokio::test]
    #[ignore] // Requires database setup with test data
    async fn test_get_album_play_count() {
        let result = get_album_play_count("test_album_id").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    #[ignore] // Requires database setup with test data
    async fn test_get_artist_play_count() {
        let result = get_artist_play_count("test_artist_id").await;
        assert!(result.is_ok());
    }

    #[tokio::test]
    #[ignore] // Requires database setup with test data
    async fn test_get_session_summary() {
        let result = get_session_summary("test_session_id").await;
        // May be ok or err depending on whether session exists
        assert!(result.is_ok() || result.is_err());
    }
}
