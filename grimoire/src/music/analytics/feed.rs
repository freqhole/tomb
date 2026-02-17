//! feed system for music analytics
//!
//! provides a unified feed of recent activity including:
//! - recent listens (plays from music_play_eventz)
//! - recent favorites (from user_favoritez)
//! - recent albums (newly added to library)
//! - recent ratings (from user_ratingz)
//! - recent playlists (new or updated)
//! - listen sessions (from listen_sessionz)

use crate::database;
use crate::GrimoireResponse;
use serde::{Deserialize, Serialize};
use zod_gen::ZodSchema as ZodSchemaTrait;
use zod_gen_derive::ZodSchema;

/// type of feed item
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FeedItemType {
    /// a song was recently played
    RecentListen,
    /// a song was recently favorited
    RecentFavorite,
    /// an album was recently added to the library
    RecentAlbum,
    /// an entity was recently rated
    RecentRating,
    /// a playlist was recently created or updated
    RecentPlaylist,
    /// a listen session (user listening through an entity)
    ListenSession,
    /// a new image was added to an entity (song, album, artist, playlist)
    NewImage,
}

impl ZodSchemaTrait for FeedItemType {
    fn zod_schema() -> String {
        r#"z.union([z.literal("recent_listen"), z.literal("recent_favorite"), z.literal("recent_album"), z.literal("recent_rating"), z.literal("recent_playlist"), z.literal("listen_session"), z.literal("new_image")])"#.to_string()
    }
}

/// a single item in the activity feed
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct FeedItem {
    /// unique identifier for this feed item
    pub id: String,
    /// type of feed item
    pub feed_type: FeedItemType,
    /// song id (if applicable)
    pub song_id: Option<String>,
    /// album id (if applicable)
    pub album_id: Option<String>,
    /// artist id (if applicable)
    pub artist_id: Option<String>,
    /// playlist id (if applicable)
    pub playlist_id: Option<String>,
    /// main title (song title or album title)
    pub title: String,
    /// subtitle (artist name, album name, etc.)
    pub subtitle: Option<String>,
    /// images for this item
    pub images: Option<Vec<crate::music::crud::ImageMetadata>>,
    /// when this activity occurred (unix timestamp)
    pub created_at: i64,
    /// user who performed the action (nullable for system actions)
    pub user_id: Option<String>,
    /// username (if user_id is set)
    pub username: Option<String>,
    /// play count (for recent listens — how many times played)
    pub play_count: Option<i64>,
    /// rating value (1-5, for recent ratings)
    pub rating: Option<i64>,
    /// target type for ratings (song, album, artist)
    pub target_type: Option<String>,
    /// listen session id (for listen session feed items)
    pub session_id: Option<String>,
    /// session type (song, album, artist, genre, playlist, shuffle)
    pub session_type: Option<String>,
    /// session status (active, paused, completed, abandoned)
    pub session_status: Option<String>,
    /// progress percentage (0-100, for listen sessions)
    pub progress_percent: Option<f64>,
    /// songs completed in session
    pub songs_completed: Option<i64>,
    /// total songs in session
    pub total_songs: Option<i64>,
    // -- enrichment fields --
    /// artist name (resolved from artist_id)
    pub artist_name: Option<String>,
    /// album title (resolved from album_id)
    pub album_title: Option<String>,
    /// primary genre name
    pub genre: Option<String>,
    /// release year
    pub year: Option<i64>,
    /// number of tracks (for albums/playlists)
    pub song_count: Option<i64>,
    /// total duration in milliseconds (for albums/playlists/sessions)
    pub total_duration_ms: Option<i64>,
    /// description text (for playlists)
    pub description: Option<String>,
    /// tags (for albums)
    pub tags: Option<Vec<String>>,
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
            (SELECT json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
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
            let images = row.images.and_then(|json_str| {
                serde_json::from_str::<Vec<crate::music::crud::ImageMetadata>>(&json_str).ok()
            });
            FeedItem {
                id: row.id.clone(),
                feed_type: FeedItemType::RecentListen,
                song_id: Some(row.id),
                album_id: row.album_id,
                artist_id: row.artist_id.clone(),
                playlist_id: None,
                title: row.title,
                subtitle: row.artist_name.clone(),
                images,
                created_at: row.created_at,
                user_id: row.user_id,
                username: row.username,
                play_count: Some(row.play_count),
                rating: None,
                target_type: None,
                session_id: None,
                session_type: None,
                session_status: None,
                progress_percent: None,
                songs_completed: None,
                total_songs: None,
                artist_name: row.artist_name,
                album_title: None,
                genre: None,
                year: None,
                song_count: None,
                total_duration_ms: None,
                description: None,
                tags: None,
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
            (SELECT json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
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
            let images = row.images.and_then(|json_str| {
                serde_json::from_str::<Vec<crate::music::crud::ImageMetadata>>(&json_str).ok()
            });
            FeedItem {
                id: row.id,
                feed_type: FeedItemType::RecentFavorite,
                song_id: Some(row.song_id),
                album_id: row.album_id,
                artist_id: row.artist_id.clone(),
                playlist_id: None,
                title: row.title,
                subtitle: row.artist_name.clone(),
                images,
                created_at: row.created_at,
                user_id: Some(row.user_id),
                username: row.username,
                play_count: None,
                rating: None,
                target_type: None,
                session_id: None,
                session_type: None,
                session_status: None,
                progress_percent: None,
                songs_completed: None,
                total_songs: None,
                artist_name: row.artist_name,
                album_title: None,
                genre: None,
                year: None,
                song_count: None,
                total_duration_ms: None,
                description: None,
                tags: None,
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

    // Get recent albums with enrichment data
    let rows = sqlx::query!(
        r#"
        SELECT
            alb.id as "id!",
            alb.title as "title!",
            alb.created_at as "created_at!: i64",
            alb.release_date as "release_date?",
            alb.song_count as "song_count?: i64",
            alb.total_duration as "total_duration?: i64",
            (SELECT a.id FROM artist_albumz aa
             JOIN artistz a ON a.id = aa.artist_id
             WHERE aa.album_id = alb.id
             LIMIT 1) as "artist_id?",
            (SELECT a.name FROM artist_albumz aa
             JOIN artistz a ON a.id = aa.artist_id
             WHERE aa.album_id = alb.id
             LIMIT 1) as "artist_name?",
            (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
             FROM album_imagez ai
             JOIN media_blobz mb ON ai.media_blob_id = mb.id
             WHERE ai.album_id = alb.id) as "images?: String",
            (SELECT g.name FROM album_genrez ag
             JOIN genrez g ON g.id = ag.genre_id
             WHERE ag.album_id = alb.id
             LIMIT 1) as "genre?",
            (SELECT json_group_array(t.name)
             FROM album_tagz at2
             JOIN tagz t ON t.id = at2.tag_id
             WHERE at2.album_id = alb.id) as "tags?: String"
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
            let images = row.images.and_then(|json_str| {
                serde_json::from_str::<Vec<crate::music::crud::ImageMetadata>>(&json_str).ok()
            });
            let tags = row
                .tags
                .and_then(|json_str| serde_json::from_str::<Vec<String>>(&json_str).ok())
                .and_then(|v| if v.is_empty() { None } else { Some(v) });
            // extract year from release_date (could be "2024", "2024-01-15", etc.)
            let year = row
                .release_date
                .as_deref()
                .and_then(|d| d.get(..4))
                .and_then(|y| y.parse::<i64>().ok());
            FeedItem {
                id: row.id.clone(),
                feed_type: FeedItemType::RecentAlbum,
                song_id: None,
                album_id: Some(row.id),
                artist_id: row.artist_id,
                playlist_id: None,
                title: row.title.clone(),
                subtitle: row.artist_name.clone(),
                images,
                created_at: row.created_at,
                user_id: None,
                username: None,
                play_count: None,
                rating: None,
                target_type: None,
                session_id: None,
                session_type: None,
                session_status: None,
                progress_percent: None,
                songs_completed: None,
                total_songs: None,
                artist_name: row.artist_name,
                album_title: Some(row.title),
                genre: row.genre,
                year,
                song_count: row.song_count,
                total_duration_ms: row.total_duration,
                description: None,
                tags,
            }
        })
        .collect();

    GrimoireResponse::success("Recent albums retrieved successfully", (items, total_count))
}

/// get recent ratings
///
/// returns entities that were recently rated, ordered by most recent first.
///
/// returns (items, total_count) for pagination.
pub async fn get_recent_ratings(limit: i64, offset: i64) -> GrimoireResponse<(Vec<FeedItem>, i64)> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let count_result = match sqlx::query!(r#"SELECT COUNT(*) as "count!: i64" FROM user_ratingz"#)
        .fetch_one(&pool)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure("failed to get recent ratings count", vec![e.into()])
        }
    };

    let total_count = count_result.count;

    let rows = sqlx::query!(
        r#"
        SELECT
            ur.id as "id!",
            ur.target_type as "target_type!",
            ur.target_id as "target_id!",
            ur.rating as "rating!: i64",
            ur.updated_at as "created_at!: i64",
            ur.user_id,
            (SELECT u.username FROM user_accountz u WHERE u.id = ur.user_id) as "username?"
        FROM user_ratingz ur
        ORDER BY ur.updated_at DESC
        LIMIT ? OFFSET ?
        "#,
        limit,
        offset
    )
    .fetch_all(&pool)
    .await;

    let rows = match rows {
        Ok(r) => r,
        Err(e) => return GrimoireResponse::failure("failed to get recent ratings", vec![e.into()]),
    };

    // resolve titles/images for each rated entity — keep queries simple
    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        let (title, subtitle, images, song_id, album_id, artist_id) = match row.target_type.as_str()
        {
            "song" => {
                let info = sqlx::query!(
                    r#"
                    SELECT
                        s.title,
                        (SELECT a.name FROM artist_songz asz JOIN artistz a ON a.id = asz.artist_id WHERE asz.song_id = s.id LIMIT 1) as "artist_name?",
                        (SELECT json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
                         FROM song_imagez si JOIN media_blobz mb ON si.media_blob_id = mb.id WHERE si.song_id = s.id) as "images?: String",
                        (SELECT alb.id FROM album_songz als JOIN albumz alb ON alb.id = als.album_id WHERE als.song_id = s.id LIMIT 1) as "album_id?"
                    FROM songz s WHERE s.id = ?
                    "#,
                    row.target_id
                )
                .fetch_optional(&pool)
                .await
                .ok()
                .flatten();

                match info {
                    Some(i) => {
                        let imgs = i.images.and_then(|j| {
                            serde_json::from_str::<Vec<crate::music::crud::ImageMetadata>>(&j).ok()
                        });
                        (
                            i.title,
                            i.artist_name,
                            imgs,
                            Some(row.target_id.clone()),
                            i.album_id,
                            None,
                        )
                    }
                    None => (
                        row.target_id.clone(),
                        None,
                        None,
                        Some(row.target_id.clone()),
                        None,
                        None,
                    ),
                }
            }
            "album" => {
                let info = sqlx::query!(
                    r#"
                    SELECT
                        alb.title,
                        (SELECT a.name FROM artist_albumz aa JOIN artistz a ON a.id = aa.artist_id WHERE aa.album_id = alb.id LIMIT 1) as "artist_name?",
                        (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
                         FROM album_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id WHERE ai.album_id = alb.id) as "images?: String"
                    FROM albumz alb WHERE alb.id = ?
                    "#,
                    row.target_id
                )
                .fetch_optional(&pool)
                .await
                .ok()
                .flatten();

                match info {
                    Some(i) => {
                        let imgs = i.images.and_then(|j| {
                            serde_json::from_str::<Vec<crate::music::crud::ImageMetadata>>(&j).ok()
                        });
                        (
                            i.title,
                            i.artist_name,
                            imgs,
                            None,
                            Some(row.target_id.clone()),
                            None,
                        )
                    }
                    None => (
                        row.target_id.clone(),
                        None,
                        None,
                        None,
                        Some(row.target_id.clone()),
                        None,
                    ),
                }
            }
            "artist" => {
                let info = sqlx::query!(
                    r#"SELECT a.name FROM artistz a WHERE a.id = ?"#,
                    row.target_id
                )
                .fetch_optional(&pool)
                .await
                .ok()
                .flatten();

                let name = info
                    .map(|i| i.name)
                    .unwrap_or_else(|| row.target_id.clone());
                (name, None, None, None, None, Some(row.target_id.clone()))
            }
            _ => (row.target_id.clone(), None, None, None, None, None),
        };

        items.push(FeedItem {
            id: row.id,
            feed_type: FeedItemType::RecentRating,
            song_id,
            album_id,
            artist_id,
            playlist_id: None,
            title,
            subtitle: subtitle.clone(),
            images,
            created_at: row.created_at,
            user_id: Some(row.user_id),
            username: row.username,
            play_count: None,
            rating: Some(row.rating),
            target_type: Some(row.target_type),
            session_id: None,
            session_type: None,
            session_status: None,
            progress_percent: None,
            songs_completed: None,
            total_songs: None,
            artist_name: subtitle,
            album_title: None,
            genre: None,
            year: None,
            song_count: None,
            total_duration_ms: None,
            description: None,
            tags: None,
        });
    }

    GrimoireResponse::success("recent ratings retrieved", (items, total_count))
}

/// get recent playlists (new or updated)
///
/// returns playlists ordered by most recently updated.
///
/// returns (items, total_count) for pagination.
pub async fn get_recent_playlists(
    limit: i64,
    offset: i64,
) -> GrimoireResponse<(Vec<FeedItem>, i64)> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let count_result = match sqlx::query!(
        r#"SELECT COUNT(*) as "count!: i64" FROM playlistz WHERE deleted_at IS NULL"#
    )
    .fetch_one(&pool)
    .await
    {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to get recent playlists count",
                vec![e.into()],
            )
        }
    };

    let total_count = count_result.count;

    let rows = sqlx::query!(
        r#"
        SELECT
            p.id as "id!",
            p.title as "title!",
            p.description,
            p.updated_at as "created_at!: i64",
            p.created_by_id as "user_id?",
            (SELECT u.username FROM user_accountz u WHERE u.id = p.created_by_id) as "username?",
            (SELECT json_group_array(json_object('blob_id', pi.media_blob_id, 'is_primary', pi.is_primary, 'blob_type', mb.blob_type))
             FROM playlist_imagez pi
             JOIN media_blobz mb ON pi.media_blob_id = mb.id
             WHERE pi.playlist_id = p.id) as "images?: String",
            (SELECT COUNT(*) FROM playlist_songz ps WHERE ps.playlist_id = p.id) as "song_count!: i64",
            (SELECT COALESCE(SUM(s.duration), 0) FROM playlist_songz ps2 JOIN songz s ON s.id = ps2.song_id WHERE ps2.playlist_id = p.id) as "total_duration!: i64"
        FROM playlistz p
        WHERE p.deleted_at IS NULL
        ORDER BY p.updated_at DESC
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
            return GrimoireResponse::failure("failed to get recent playlists", vec![e.into()])
        }
    };

    let items = rows
        .into_iter()
        .map(|row| {
            let images = row.images.and_then(|j| {
                serde_json::from_str::<Vec<crate::music::crud::ImageMetadata>>(&j).ok()
            });
            FeedItem {
                id: row.id.clone(),
                feed_type: FeedItemType::RecentPlaylist,
                song_id: None,
                album_id: None,
                artist_id: None,
                playlist_id: Some(row.id),
                title: row.title,
                subtitle: row.description.clone(),
                images,
                created_at: row.created_at,
                user_id: row.user_id,
                username: row.username,
                play_count: None,
                rating: None,
                target_type: None,
                session_id: None,
                session_type: None,
                session_status: None,
                progress_percent: None,
                songs_completed: None,
                total_songs: None,
                artist_name: None,
                album_title: None,
                genre: None,
                year: None,
                song_count: Some(row.song_count),
                total_duration_ms: Some(row.total_duration),
                description: row.description,
                tags: None,
            }
        })
        .collect();

    GrimoireResponse::success("recent playlists retrieved", (items, total_count))
}

/// get recent listen sessions
///
/// returns listen sessions ordered by most recently updated.
///
/// returns (items, total_count) for pagination.
pub async fn get_recent_sessions(
    limit: i64,
    offset: i64,
) -> GrimoireResponse<(Vec<FeedItem>, i64)> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let count_result =
        match sqlx::query!(r#"SELECT COUNT(*) as "count!: i64" FROM listen_sessionz"#)
            .fetch_one(&pool)
            .await
        {
            Ok(r) => r,
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to get recent sessions count",
                    vec![e.into()],
                )
            }
        };

    let total_count = count_result.count;

    let rows = sqlx::query!(
        r#"
        SELECT
            ls.id as "id!",
            ls.label as "title!",
            ls.session_type as "session_type!",
            ls.status as "session_status!",
            ls.total_songs as "total_songs!: i64",
            ls.songs_completed as "songs_completed!: i64",
            ls.total_duration_ms as "total_duration_ms!: i64",
            ls.listened_duration_ms as "listened_duration_ms!: i64",
            ls.updated_at as "created_at!: i64",
            ls.user_id,
            ls.entity_id as "entity_id?",
            (SELECT u.username FROM user_accountz u WHERE u.id = ls.user_id) as "username?",
            CASE
                WHEN ls.session_type = 'album' AND ls.entity_id IS NOT NULL THEN
                    (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
                     FROM album_imagez ai
                     JOIN media_blobz mb ON ai.media_blob_id = mb.id
                     WHERE ai.album_id = ls.entity_id AND mb.blob_type NOT IN ('waveform'))
                WHEN ls.session_type = 'playlist' AND ls.entity_id IS NOT NULL THEN
                    (SELECT json_group_array(json_object('blob_id', pi.media_blob_id, 'is_primary', pi.is_primary, 'blob_type', mb.blob_type))
                     FROM playlist_imagez pi
                     JOIN media_blobz mb ON pi.media_blob_id = mb.id
                     WHERE pi.playlist_id = ls.entity_id AND mb.blob_type NOT IN ('waveform'))
                WHEN ls.session_type = 'artist' AND ls.entity_id IS NOT NULL THEN
                    (SELECT json_group_array(json_object('blob_id', ari.media_blob_id, 'is_primary', ari.is_primary, 'blob_type', mb.blob_type))
                     FROM artist_imagez ari
                     JOIN media_blobz mb ON ari.media_blob_id = mb.id
                     WHERE ari.artist_id = ls.entity_id AND mb.blob_type NOT IN ('waveform'))
                ELSE NULL
            END as "images?: String"
        FROM listen_sessionz ls
        ORDER BY ls.updated_at DESC
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
            return GrimoireResponse::failure("failed to get recent sessions", vec![e.into()])
        }
    };

    let items = rows
        .into_iter()
        .map(|row| {
            let progress = if row.total_duration_ms > 0 {
                Some(
                    (row.listened_duration_ms as f64 / row.total_duration_ms as f64 * 100.0)
                        .min(100.0),
                )
            } else if row.total_songs > 0 {
                Some((row.songs_completed as f64 / row.total_songs as f64 * 100.0).min(100.0))
            } else {
                Some(0.0)
            };

            let images = row.images.and_then(|json_str| {
                serde_json::from_str::<Vec<crate::music::crud::ImageMetadata>>(&json_str).ok()
            });

            // set album_id / artist_id / playlist_id based on session_type + entity_id
            let album_id = if row.session_type == "album" {
                row.entity_id.clone()
            } else {
                None
            };
            let artist_id = if row.session_type == "artist" {
                row.entity_id.clone()
            } else {
                None
            };
            let playlist_id = if row.session_type == "playlist" {
                row.entity_id.clone()
            } else {
                None
            };

            FeedItem {
                id: row.id.clone(),
                feed_type: FeedItemType::ListenSession,
                song_id: None,
                album_id,
                artist_id,
                playlist_id,
                title: row.title,
                subtitle: Some(row.session_type.clone()),
                images,
                created_at: row.created_at,
                user_id: Some(row.user_id),
                username: row.username,
                play_count: None,
                rating: None,
                target_type: None,
                session_id: Some(row.id),
                session_type: Some(row.session_type),
                session_status: Some(row.session_status),
                progress_percent: progress,
                songs_completed: Some(row.songs_completed),
                total_songs: Some(row.total_songs),
                artist_name: None,
                album_title: None,
                genre: None,
                year: None,
                song_count: None,
                total_duration_ms: Some(row.total_duration_ms),
                description: None,
                tags: None,
            }
        })
        .collect();

    GrimoireResponse::success("recent sessions retrieved", (items, total_count))
}

/// get recently added images across all entity types
///
/// joins image junction tables with media_blobz to get timestamps,
/// then joins entity tables for titles. excludes waveform images.
/// groups by entity to avoid duplicate entries for the same entity.
///
/// returns (items, total_count) for pagination.
pub async fn get_recent_images(limit: i64, offset: i64) -> GrimoireResponse<(Vec<FeedItem>, i64)> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    // union across all image tables, using media_blobz.created_at for ordering
    // group by entity to show one feed entry per entity (most recent image)
    let count_result = sqlx::query!(
        r#"
        SELECT COUNT(*) as "count!: i64" FROM (
            SELECT si.song_id as eid FROM song_imagez si
            JOIN media_blobz mb ON si.media_blob_id = mb.id
            JOIN songz s ON si.song_id = s.id
            WHERE mb.blob_type NOT IN ('waveform') AND mb.deleted_at IS NULL AND s.deleted_at IS NULL
              AND (mb.created_by IS NULL OR mb.created_by != 'job_processor')
              AND NOT EXISTS (
                SELECT 1 FROM album_songz als
                JOIN album_imagez ai ON ai.album_id = als.album_id AND ai.media_blob_id = si.media_blob_id
                WHERE als.song_id = si.song_id
              )
            UNION
            SELECT ai.album_id FROM album_imagez ai
            JOIN media_blobz mb ON ai.media_blob_id = mb.id
            JOIN albumz a ON ai.album_id = a.id
            WHERE mb.blob_type NOT IN ('waveform') AND mb.deleted_at IS NULL AND a.deleted_at IS NULL
              AND (mb.created_by IS NULL OR mb.created_by != 'job_processor')
            UNION
            SELECT ari.artist_id FROM artist_imagez ari
            JOIN media_blobz mb ON ari.media_blob_id = mb.id
            JOIN artistz art ON ari.artist_id = art.id
            WHERE mb.blob_type NOT IN ('waveform') AND mb.deleted_at IS NULL
              AND (mb.created_by IS NULL OR mb.created_by != 'job_processor')
            UNION
            SELECT pi.playlist_id FROM playlist_imagez pi
            JOIN media_blobz mb ON pi.media_blob_id = mb.id
            JOIN playlistz p ON pi.playlist_id = p.id
            WHERE mb.blob_type NOT IN ('waveform') AND mb.deleted_at IS NULL AND p.deleted_at IS NULL
              AND (mb.created_by IS NULL OR mb.created_by != 'job_processor')
        )
        "#
    )
    .fetch_one(&pool)
    .await;

    let total_count = match count_result {
        Ok(r) => r.count,
        Err(e) => {
            return GrimoireResponse::failure("failed to count recent images", vec![e.into()])
        }
    };

    // fetch recent images with entity info, grouped by entity (most recent image per entity)
    let rows = sqlx::query!(
        r#"
        SELECT
            entity_type as "entity_type!",
            entity_id as "entity_id!",
            entity_title as "entity_title!",
            artist_id as "artist_id?: String",
            artist_name as "artist_name?: String",
            album_id as "album_id?: String",
            MAX(created_at) as "created_at!: i64",
            images as "images?: String",
            created_by as "created_by?: String",
            (SELECT u.username FROM user_accountz u WHERE u.id = created_by LIMIT 1) as "username?: String"
        FROM (
            -- song images (exclude blobs that already exist as album images for songs on that album)
            SELECT
                'song' as entity_type,
                si.song_id as entity_id,
                s.title as entity_title,
                (SELECT a.id FROM artist_songz sa JOIN artistz a ON a.id = sa.artist_id WHERE sa.song_id = si.song_id LIMIT 1) as artist_id,
                (SELECT a.name FROM artist_songz sa JOIN artistz a ON a.id = sa.artist_id WHERE sa.song_id = si.song_id LIMIT 1) as artist_name,
                (SELECT aa.album_id FROM album_songz aa WHERE aa.song_id = si.song_id LIMIT 1) as album_id,
                mb.created_at as created_at,
                mb.created_by as created_by,
                (SELECT json_group_array(json_object('blob_id', si2.media_blob_id, 'is_primary', si2.is_primary, 'blob_type', mb2.blob_type))
                 FROM song_imagez si2
                 JOIN media_blobz mb2 ON si2.media_blob_id = mb2.id
                 WHERE si2.song_id = si.song_id AND mb2.blob_type NOT IN ('waveform')) as images
            FROM song_imagez si
            JOIN media_blobz mb ON si.media_blob_id = mb.id
            JOIN songz s ON si.song_id = s.id
            WHERE mb.blob_type NOT IN ('waveform') AND mb.deleted_at IS NULL AND s.deleted_at IS NULL
              AND (mb.created_by IS NULL OR mb.created_by != 'job_processor')
              AND NOT EXISTS (
                SELECT 1 FROM album_songz als
                JOIN album_imagez ai ON ai.album_id = als.album_id AND ai.media_blob_id = si.media_blob_id
                WHERE als.song_id = si.song_id
              )

            UNION ALL

            -- album images
            SELECT
                'album' as entity_type,
                ai.album_id as entity_id,
                alb.title as entity_title,
                (SELECT art.id FROM artist_albumz aa2 JOIN artistz art ON art.id = aa2.artist_id WHERE aa2.album_id = ai.album_id LIMIT 1) as artist_id,
                (SELECT art.name FROM artist_albumz aa2 JOIN artistz art ON art.id = aa2.artist_id WHERE aa2.album_id = ai.album_id LIMIT 1) as artist_name,
                ai.album_id as album_id,
                mb.created_at as created_at,
                mb.created_by as created_by,
                (SELECT json_group_array(json_object('blob_id', ai2.media_blob_id, 'is_primary', ai2.is_primary, 'blob_type', mb2.blob_type))
                 FROM album_imagez ai2
                 JOIN media_blobz mb2 ON ai2.media_blob_id = mb2.id
                 WHERE ai2.album_id = ai.album_id AND mb2.blob_type NOT IN ('waveform')) as images
            FROM album_imagez ai
            JOIN media_blobz mb ON ai.media_blob_id = mb.id
            JOIN albumz alb ON ai.album_id = alb.id
            WHERE mb.blob_type NOT IN ('waveform') AND mb.deleted_at IS NULL AND alb.deleted_at IS NULL
              AND (mb.created_by IS NULL OR mb.created_by != 'job_processor')

            UNION ALL

            -- artist images
            SELECT
                'artist' as entity_type,
                ari.artist_id as entity_id,
                art.name as entity_title,
                ari.artist_id as artist_id,
                art.name as artist_name,
                NULL as album_id,
                mb.created_at as created_at,
                mb.created_by as created_by,
                (SELECT json_group_array(json_object('blob_id', ari2.media_blob_id, 'is_primary', ari2.is_primary, 'blob_type', mb2.blob_type))
                 FROM artist_imagez ari2
                 JOIN media_blobz mb2 ON ari2.media_blob_id = mb2.id
                 WHERE ari2.artist_id = ari.artist_id AND mb2.blob_type NOT IN ('waveform')) as images
            FROM artist_imagez ari
            JOIN media_blobz mb ON ari.media_blob_id = mb.id
            JOIN artistz art ON ari.artist_id = art.id
            WHERE mb.blob_type NOT IN ('waveform') AND mb.deleted_at IS NULL
              AND (mb.created_by IS NULL OR mb.created_by != 'job_processor')

            UNION ALL

            -- playlist images
            SELECT
                'playlist' as entity_type,
                pi.playlist_id as entity_id,
                p.title as entity_title,
                NULL as artist_id,
                NULL as artist_name,
                NULL as album_id,
                mb.created_at as created_at,
                mb.created_by as created_by,
                (SELECT json_group_array(json_object('blob_id', pi2.media_blob_id, 'is_primary', pi2.is_primary, 'blob_type', mb2.blob_type))
                 FROM playlist_imagez pi2
                 JOIN media_blobz mb2 ON pi2.media_blob_id = mb2.id
                 WHERE pi2.playlist_id = pi.playlist_id AND mb2.blob_type NOT IN ('waveform')) as images
            FROM playlist_imagez pi
            JOIN media_blobz mb ON pi.media_blob_id = mb.id
            JOIN playlistz p ON pi.playlist_id = p.id
            WHERE mb.blob_type NOT IN ('waveform') AND mb.deleted_at IS NULL AND p.deleted_at IS NULL
              AND (mb.created_by IS NULL OR mb.created_by != 'job_processor')
        )
        GROUP BY entity_type, entity_id
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
        Err(e) => return GrimoireResponse::failure("failed to get recent images", vec![e.into()]),
    };

    let items = rows
        .into_iter()
        .map(|row| {
            let images = row.images.and_then(|json_str| {
                serde_json::from_str::<Vec<crate::music::crud::ImageMetadata>>(&json_str).ok()
            });

            let subtitle = match row.entity_type.as_str() {
                "song" => row.artist_name.clone().unwrap_or_default(),
                "album" => format!(
                    "album{}",
                    row.artist_name
                        .as_deref()
                        .map(|n| format!(" \u{00b7} {n}"))
                        .unwrap_or_default()
                ),
                "artist" => "artist".to_string(),
                "playlist" => "playlist".to_string(),
                _ => row.entity_type.clone(),
            };

            FeedItem {
                id: format!("img-{}-{}", row.entity_type, row.entity_id),
                feed_type: FeedItemType::NewImage,
                song_id: if row.entity_type == "song" {
                    Some(row.entity_id.clone())
                } else {
                    None
                },
                album_id: row.album_id,
                artist_id: row.artist_id,
                playlist_id: if row.entity_type == "playlist" {
                    Some(row.entity_id.clone())
                } else {
                    None
                },
                title: row.entity_title,
                subtitle: Some(subtitle),
                images,
                created_at: row.created_at,
                user_id: row.created_by,
                username: row.username,
                play_count: None,
                rating: None,
                target_type: Some(row.entity_type),
                session_id: None,
                session_type: None,
                session_status: None,
                progress_percent: None,
                songs_completed: None,
                total_songs: None,
                artist_name: row.artist_name,
                album_title: None,
                genre: None,
                year: None,
                song_count: None,
                total_duration_ms: None,
                description: None,
                tags: None,
            }
        })
        .collect();

    GrimoireResponse::success("recent images retrieved", (items, total_count))
}

/// get combined activity feed
///
/// fetches from each feed source independently, then merges and sorts
/// by timestamp in Rust. this avoids complex UNION ALL queries and
/// keeps each source query simple and independently testable.
///
/// returns (items, total_count) for pagination.
pub async fn get_combined_feed(limit: i64, offset: i64) -> GrimoireResponse<(Vec<FeedItem>, i64)> {
    // fetch from all sources concurrently, each with its own limit
    // we over-fetch from each source to ensure proper global ordering
    // note: individual song listens are excluded — only grouped sessions are shown
    let fetch_limit = limit + offset;

    let (favorites, albums, ratings, playlists, sessions, images) = tokio::join!(
        get_recent_favorites(fetch_limit, 0),
        get_recent_albums(fetch_limit, 0),
        get_recent_ratings(fetch_limit, 0),
        get_recent_playlists(fetch_limit, 0),
        get_recent_sessions(fetch_limit, 0),
        get_recent_images(fetch_limit, 0),
    );

    // collect all items and sum totals
    let mut all_items: Vec<FeedItem> = Vec::new();
    let mut total_count: i64 = 0;

    for response in [favorites, albums, ratings, playlists, sessions, images] {
        if let Some((items, count)) = response.data {
            all_items.extend(items);
            total_count += count;
        }
    }

    // sort by created_at descending (most recent first)
    all_items.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    // apply pagination
    let offset = offset as usize;
    let limit = limit as usize;
    let paginated: Vec<FeedItem> = all_items.into_iter().skip(offset).take(limit).collect();

    GrimoireResponse::success("combined feed retrieved", (paginated, total_count))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // requires database setup with test data
    async fn test_get_recent_listens() {
        let response = get_recent_listens(10, 0).await;
        assert!(response.success);
        let (items, total) = response.data.unwrap();
        assert!(total >= 0);
        assert!(items.len() <= 10);
    }

    #[tokio::test]
    #[ignore]
    async fn test_get_recent_favorites() {
        let response = get_recent_favorites(10, 0).await;
        assert!(response.success);
    }

    #[tokio::test]
    #[ignore]
    async fn test_get_recent_albums() {
        let response = get_recent_albums(10, 0).await;
        assert!(response.success);
    }

    #[tokio::test]
    #[ignore]
    async fn test_get_combined_feed() {
        let response = get_combined_feed(20, 0).await;
        assert!(response.success);
        let (items, total) = response.data.unwrap();
        assert!(total >= 0);
        assert!(items.len() <= 20);
    }
}
