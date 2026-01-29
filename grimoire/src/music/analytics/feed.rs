//! Simplified feed system for music analytics
//!
//! Provides a unified feed of recent activity including:
//! - Recent listens (plays from music_play_eventz)
//! - Recent favorites (from user_favoritez)
//! - Recent albums (newly added to library)

use crate::database;
use crate::GrimoireResponse;
use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// Type of feed item
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FeedItemType {
    /// A song was recently played
    RecentListen,
    /// A song was recently favorited
    RecentFavorite,
    /// An album was recently added to the library
    RecentAlbum,
}

/// A single item in the activity feed
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct FeedItem {
    /// Unique identifier for this feed item
    pub id: String,
    /// Type of feed item
    pub feed_type: FeedItemType,
    /// Song ID (if applicable)
    pub song_id: Option<String>,
    /// Album ID (if applicable)
    pub album_id: Option<String>,
    /// Artist ID (if applicable)
    pub artist_id: Option<String>,
    /// Main title (song title or album title)
    pub title: String,
    /// Subtitle (artist name, album name, etc.)
    pub subtitle: Option<String>,
    /// Images for this item
    pub images: Option<Vec<crate::music::crud::ImageMetadata>>,
    /// When this activity occurred (unix timestamp)
    pub created_at: i64,
    /// User who performed the action (nullable for system actions)
    pub user_id: Option<String>,
    /// Username (if user_id is set)
    pub username: Option<String>,
    /// Play count (for recent listens - how many times played)
    pub play_count: Option<i64>,
}

/// Get recent listening activity
///
/// Returns songs that were recently played, ordered by most recent first.
/// Multiple plays of the same song are grouped together.
///
/// Returns (items, total_count) for pagination.
pub async fn get_recent_listens(limit: i64, offset: i64) -> GrimoireResponse<(Vec<FeedItem>, i64)> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // Get total count
    let count_result = match sqlx::query!(
        r#"
        SELECT COUNT(DISTINCT song_id) as count
        FROM music_play_eventz
        "#
    )
    .fetch_one(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure("Failed to get recent listens count", vec![e.into()])
        }
    };

    let total_count = count_result.count;

    // Get recent listens grouped by song
    let rows = sqlx::query!(
        r#"
        SELECT
            mpe.song_id as id,
            s.title,
            (SELECT json_group_array(json_object('media_blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
             FROM song_imagez si
             JOIN media_blobz mb ON si.media_blob_id = mb.id
             WHERE si.song_id = s.id) as "images?: String",
            MAX(mpe.created_at) as "created_at!: i64",
            COUNT(*) as "play_count!: i64",
            (SELECT a.id FROM artist_songz asz
             JOIN artistz a ON a.id = asz.artist_id
             WHERE asz.song_id = mpe.song_id
             LIMIT 1) as "artist_id?",
            (SELECT a.name FROM artist_songz asz
             JOIN artistz a ON a.id = asz.artist_id
             WHERE asz.song_id = mpe.song_id
             LIMIT 1) as "artist_name?",
            (SELECT alb.id FROM album_songz als
             JOIN albumz alb ON alb.id = als.album_id
             WHERE als.song_id = mpe.song_id
             LIMIT 1) as "album_id?",
            mpe.user_id,
            (SELECT u.username FROM user_accountz u
             WHERE u.id = mpe.user_id
             LIMIT 1) as "username?"
        FROM music_play_eventz mpe
        JOIN songz s ON s.id = mpe.song_id
        GROUP BY mpe.song_id
        ORDER BY MAX(mpe.created_at) DESC
        LIMIT ? OFFSET ?
        "#,
        limit,
        offset
    )
    .fetch_all(&pool)
    .await;

    let rows = match rows {
        Ok(r) => r,
        Err(e) => return GrimoireResponse::failure("Failed to get recent listens", vec![e.into()]),
    };

    let items = rows
        .into_iter()
        .map(|row| {
            let images = row.images
                .and_then(|json_str| serde_json::from_str::<Vec<crate::music::crud::ImageMetadata>>(&json_str).ok());
            FeedItem {
                id: row.id.clone(),
                feed_type: FeedItemType::RecentListen,
                song_id: Some(row.id),
                album_id: row.album_id,
                artist_id: row.artist_id,
                title: row.title,
                subtitle: row.artist_name,
                images,
                created_at: row.created_at,
                user_id: row.user_id,
                username: row.username,
                play_count: Some(row.play_count),
            }
        })
        .collect();

    GrimoireResponse::success(
        "Recent listens retrieved successfully",
        (items, total_count),
    )
}

/// Get recent favorites
///
/// Returns songs that were recently favorited, ordered by most recent first.
///
/// Returns (items, total_count) for pagination.
pub async fn get_recent_favorites(
    limit: i64,
    offset: i64,
) -> GrimoireResponse<(Vec<FeedItem>, i64)> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // Get total count
    let count_result = match sqlx::query!(
        r#"
        SELECT COUNT(*) as count
        FROM user_favoritez
        WHERE target_type = 'song'
        "#
    )
    .fetch_one(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "Failed to get recent favorites count",
                vec![e.into()],
            )
        }
    };

    let total_count = count_result.count;

    // Get recent favorites
    let rows = sqlx::query!(
        r#"
        SELECT
            uf.id as "id!",
            uf.target_id as "song_id!",
            s.title,
            (SELECT json_group_array(json_object('media_blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
             FROM song_imagez si
             JOIN media_blobz mb ON si.media_blob_id = mb.id
             WHERE si.song_id = s.id) as "images?: String",
            uf.created_at as "created_at!: i64",
            (SELECT a.id FROM artist_songz asz
             JOIN artistz a ON a.id = asz.artist_id
             WHERE asz.song_id = uf.target_id
             LIMIT 1) as "artist_id?",
            (SELECT a.name FROM artist_songz asz
             JOIN artistz a ON a.id = asz.artist_id
             WHERE asz.song_id = uf.target_id
             LIMIT 1) as "artist_name?",
            (SELECT alb.id FROM album_songz als
             JOIN albumz alb ON alb.id = als.album_id
             WHERE als.song_id = uf.target_id
             LIMIT 1) as "album_id?",
            uf.user_id,
            (SELECT u.username FROM user_accountz u
             WHERE u.id = uf.user_id) as "username?"
        FROM user_favoritez uf
        JOIN songz s ON s.id = uf.target_id
        WHERE uf.target_type = 'song'
        ORDER BY uf.created_at DESC
        LIMIT ? OFFSET ?
        "#,
        limit,
        offset
    )
    .fetch_all(&pool)
    .await;

    let rows = match rows {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure("Failed to get recent favorites", vec![e.into()])
        }
    };

    let items = rows
        .into_iter()
        .map(|row| {
            let images = row.images
                .and_then(|json_str| serde_json::from_str::<Vec<crate::music::crud::ImageMetadata>>(&json_str).ok());
            FeedItem {
                id: row.id,
                feed_type: FeedItemType::RecentFavorite,
                song_id: Some(row.song_id),
                album_id: row.album_id,
                artist_id: row.artist_id,
                title: row.title,
                subtitle: row.artist_name,
                images,
                created_at: row.created_at,
                user_id: Some(row.user_id),
                username: row.username,
                play_count: None,
            }
        })
        .collect();

    GrimoireResponse::success(
        "Recent favorites retrieved successfully",
        (items, total_count),
    )
}

/// Get recently added albums
///
/// Returns albums that were recently added to the library, ordered by most recent first.
///
/// Returns (items, total_count) for pagination.
pub async fn get_recent_albums(limit: i64, offset: i64) -> GrimoireResponse<(Vec<FeedItem>, i64)> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // Get total count
    let count_result = match sqlx::query!(
        r#"
        SELECT COUNT(*) as count
        FROM albumz
        WHERE deleted_at IS NULL
        "#
    )
    .fetch_one(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure("Failed to get recent albums count", vec![e.into()])
        }
    };

    let total_count = count_result.count;

    // Get recent albums
    let rows = sqlx::query!(
        r#"
        SELECT
            alb.id as "id!",
            alb.title as "title!",
            alb.created_at as "created_at!: i64",
            (SELECT a.id FROM artist_albumz aa
             JOIN artistz a ON a.id = aa.artist_id
             WHERE aa.album_id = alb.id
             LIMIT 1) as "artist_id?",
            (SELECT a.name FROM artist_albumz aa
             JOIN artistz a ON a.id = aa.artist_id
             WHERE aa.album_id = alb.id
             LIMIT 1) as "artist_name?",
            (SELECT json_group_array(json_object('media_blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
             FROM album_imagez ai
             JOIN media_blobz mb ON ai.media_blob_id = mb.id
             WHERE ai.album_id = alb.id) as "images?: String"
        FROM albumz alb
        WHERE alb.deleted_at IS NULL
        ORDER BY alb.created_at DESC
        LIMIT ? OFFSET ?
        "#,
        limit,
        offset
    )
    .fetch_all(&pool)
    .await;

    let rows = match rows {
        Ok(r) => r,
        Err(e) => return GrimoireResponse::failure("Failed to get recent albums", vec![e.into()]),
    };

    let items = rows
        .into_iter()
        .map(|row| {
            let images = row.images
                .and_then(|json_str| serde_json::from_str::<Vec<crate::music::crud::ImageMetadata>>(&json_str).ok());
            FeedItem {
                id: row.id.clone(),
                feed_type: FeedItemType::RecentAlbum,
                song_id: None,
                album_id: Some(row.id),
                artist_id: row.artist_id,
                title: row.title,
                subtitle: row.artist_name,
                images,
                created_at: row.created_at,
                user_id: None,
                username: None,
                play_count: None,
            }
        })
        .collect();

    GrimoireResponse::success("Recent albums retrieved successfully", (items, total_count))
}

/// Get combined activity feed
///
/// Returns a unified feed combining recent listens, favorites, and albums,
/// ordered by timestamp (most recent first).
///
/// Returns (items, total_count) for pagination.
pub async fn get_combined_feed(limit: i64, offset: i64) -> GrimoireResponse<(Vec<FeedItem>, i64)> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };

    // Get total count across all feed types
    let count_result = match sqlx::query!(
        r#"
        SELECT
            (SELECT COUNT(DISTINCT song_id) FROM music_play_eventz) +
            (SELECT COUNT(*) FROM user_favoritez WHERE target_type = 'song') +
            (SELECT COUNT(*) FROM albumz WHERE deleted_at IS NULL)
        as "total_count!: i64"
        "#
    )
    .fetch_one(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure("Failed to get combined feed count", vec![e.into()])
        }
    };

    let total_count = count_result.total_count;

    // Build unified feed with UNION
    // Note: We use created_at for ordering, so each subquery needs consistent columns
    let rows = sqlx::query!(
        r#"
        SELECT * FROM (
            -- Recent listens
            SELECT
                mpe.song_id as "id!",
                'recent_listen' as "feed_type!",
                mpe.song_id as "song_id!",
                (SELECT alb.id FROM album_songz als
                 JOIN albumz alb ON alb.id = als.album_id
                 WHERE als.song_id = mpe.song_id
                 LIMIT 1) as album_id,
                (SELECT a.id FROM artist_songz asz
                 JOIN artistz a ON a.id = asz.artist_id
                 WHERE asz.song_id = mpe.song_id
                 LIMIT 1) as artist_id,
                s.title as "title!",
                (SELECT a.name FROM artist_songz asz
                 JOIN artistz a ON a.id = asz.artist_id
                 WHERE asz.song_id = mpe.song_id
                 LIMIT 1) as subtitle,
                (SELECT json_group_array(json_object('media_blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
                 FROM song_imagez si
                 JOIN media_blobz mb ON si.media_blob_id = mb.id
                 WHERE si.song_id = s.id) as "images?: String",
                MAX(mpe.created_at) as created_at,
                mpe.user_id,
                (SELECT u.username FROM user_accountz u
                 WHERE u.id = mpe.user_id
                 LIMIT 1) as username,
                COUNT(*) as "play_count?: i64"
            FROM music_play_eventz mpe
            JOIN songz s ON s.id = mpe.song_id
            GROUP BY mpe.song_id

            UNION ALL

            -- Recent favorites
            SELECT
                uf.id as "id!",
                'recent_favorite' as "feed_type!",
                uf.target_id as "song_id!",
                (SELECT alb.id FROM album_songz als
                 JOIN albumz alb ON alb.id = als.album_id
                 WHERE als.song_id = uf.target_id
                 LIMIT 1) as album_id,
                (SELECT a.id FROM artist_songz asz
                 JOIN artistz a ON a.id = asz.artist_id
                 WHERE asz.song_id = uf.target_id
                 LIMIT 1) as artist_id,
                s.title as "title!",
                (SELECT a.name FROM artist_songz asz
                 JOIN artistz a ON a.id = asz.artist_id
                 WHERE asz.song_id = uf.target_id
                 LIMIT 1) as subtitle,
                (SELECT json_group_array(json_object('media_blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
                 FROM song_imagez si
                 JOIN media_blobz mb ON si.media_blob_id = mb.id
                 WHERE si.song_id = s.id) as "images?: String",
                uf.created_at,
                uf.user_id,
                (SELECT u.username FROM user_accountz u
                 WHERE u.id = uf.user_id) as username,
                NULL as "play_count?: i64"
            FROM user_favoritez uf
            JOIN songz s ON s.id = uf.target_id
            WHERE uf.target_type = 'song'

            UNION ALL

            -- Recent albums
            SELECT
                alb.id as "id!",
                'recent_album' as "feed_type!",
                NULL as song_id,
                alb.id as "album_id!",
                (SELECT a.id FROM artist_albumz aa
                 JOIN artistz a ON a.id = aa.artist_id
                 WHERE aa.album_id = alb.id
                 LIMIT 1) as artist_id,
                alb.title as "title!",
                (SELECT a.name FROM artist_albumz aa
                 JOIN artistz a ON a.id = aa.artist_id
                 WHERE aa.album_id = alb.id
                 LIMIT 1) as subtitle,
                (SELECT json_group_array(json_object('media_blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
                 FROM album_imagez ai
                 JOIN media_blobz mb ON ai.media_blob_id = mb.id
                 WHERE ai.album_id = alb.id) as "images?: String",
                alb.created_at,
                NULL as user_id,
                NULL as username,
                NULL as play_count
            FROM albumz alb
            WHERE alb.deleted_at IS NULL
        )
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
        "#,
        limit,
        offset
    )
    .fetch_all(&pool)
    .await;

    let rows = match rows {
        Ok(r) => r,
        Err(e) => return GrimoireResponse::failure("Failed to get combined feed", vec![e.into()]),
    };

    let items = rows
        .into_iter()
        .map(|row| {
            let feed_type = match row.feed_type.as_str() {
                "recent_listen" => FeedItemType::RecentListen,
                "recent_favorite" => FeedItemType::RecentFavorite,
                "recent_album" => FeedItemType::RecentAlbum,
                _ => FeedItemType::RecentListen, // fallback
            };

            let images = row.images
                .and_then(|json_str| serde_json::from_str::<Vec<crate::music::crud::ImageMetadata>>(&json_str).ok());

            FeedItem {
                id: row.id,
                feed_type,
                song_id: Some(row.song_id),
                album_id: row.album_id,
                artist_id: row.artist_id,
                title: row.title,
                subtitle: row.subtitle,
                images,
                created_at: row.created_at,
                user_id: row.user_id,
                username: row.username,
                play_count: row.play_count,
            }
        })
        .collect();

    GrimoireResponse::success("Combined feed retrieved successfully", (items, total_count))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // Requires database setup with test data
    async fn test_get_recent_listens() {
        let response = get_recent_listens(10, 0).await;
        assert!(response.success);
        let (items, total) = response.data.unwrap();
        assert!(total >= 0);
        assert!(items.len() <= 10);
    }

    #[tokio::test]
    #[ignore] // Requires database setup with test data
    async fn test_get_recent_favorites() {
        let response = get_recent_favorites(10, 0).await;
        assert!(response.success);
    }

    #[tokio::test]
    #[ignore] // Requires database setup with test data
    async fn test_get_recent_albums() {
        let response = get_recent_albums(10, 0).await;
        assert!(response.success);
    }

    #[tokio::test]
    #[ignore] // Requires database setup with test data
    async fn test_get_combined_feed() {
        let response = get_combined_feed(20, 0).await;
        assert!(response.success);
        let (items, total) = response.data.unwrap();
        assert!(total >= 0);
        assert!(items.len() <= 20);
    }
}
