//! feed system for music analytics
//!
//! provides a unified feed of recent activity including:
//! - recent favorites (from user_favoritez)
//! - recent albums (newly added to library)
//! - recent ratings (from user_ratingz)
//! - recent playlists (new or updated)
//! - listen sessions (from listen_sessionz)
//!
//! this module now queries the denormalized feed_eventz table for fast reads.
//! feed events are created at write time in the respective modules.

use crate::database;
use crate::music::crud::{EntityUrl, ImageMetadata};
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
    pub images: Option<Vec<ImageMetadata>>,
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
    /// genre id (for linking to genre detail)
    pub genre_id: Option<String>,
    /// release year
    pub year: Option<i64>,
    /// number of tracks (for albums/playlists)
    pub song_count: Option<i64>,
    /// delta: how many songs added in this action (vs total)
    pub songs_added: Option<i64>,
    /// total duration in milliseconds (for albums/playlists/sessions)
    pub total_duration_ms: Option<i64>,
    /// number of images (for new_image feed events)
    pub image_count: Option<i64>,
    /// entity URLs (external links)
    pub urls: Option<Vec<EntityUrl>>,
    /// description text (for playlists)
    pub description: Option<String>,
    /// tags (for albums)
    pub tags: Option<Vec<String>>,
    /// whether the primary entity is favorited by the viewer
    pub is_favorite: bool,
    /// true if this is the user's first add to this entity (INSERT vs UPDATE)
    pub is_initial_add: bool,
    /// collage images for multi-album/artist listen sessions (up to 4 distinct album covers)
    pub collage_images: Option<Vec<ImageMetadata>>,
    /// when the entity was originally created (for playlists, to distinguish create vs update)
    pub entity_created_at: Option<i64>,
}

/// column identifiers - kept for reference but no longer used with sea_query
// the feed_eventz table is now queried directly with plain SQL for simplicity

/// convert feed_eventz feed_type to FeedItemType for API backwards compatibility
fn map_feed_event_type(feed_type: &str) -> FeedItemType {
    match feed_type {
        "album" => FeedItemType::RecentAlbum,
        "artist" => FeedItemType::RecentAlbum, // treat artist as album-like for now
        "playlist" => FeedItemType::RecentPlaylist,
        "session" => FeedItemType::ListenSession,
        "favorite_song" | "favorite_album" | "favorite_artist" | "favorite_playlist" => {
            FeedItemType::RecentFavorite
        }
        "rating_song" | "rating_album" | "rating_artist" => FeedItemType::RecentRating,
        "new_image_song" | "new_image_album" | "new_image_artist" | "new_image_playlist" => {
            FeedItemType::NewImage
        }
        _ => FeedItemType::RecentAlbum,
    }
}

/// convert FeedItemType to the list of feed_eventz feed_type strings
fn feed_item_type_to_event_types(item_type: &FeedItemType) -> Vec<&'static str> {
    match item_type {
        FeedItemType::RecentAlbum => vec!["album", "artist"],
        FeedItemType::RecentPlaylist => vec!["playlist"],
        FeedItemType::ListenSession => vec!["session"],
        FeedItemType::RecentListen => vec![], // individual listens not tracked; use listening sessions
        FeedItemType::RecentFavorite => {
            vec![
                "favorite_song",
                "favorite_album",
                "favorite_artist",
                "favorite_playlist",
            ]
        }
        FeedItemType::RecentRating => vec!["rating_song", "rating_album", "rating_artist"],
        FeedItemType::NewImage => vec![
            "new_image_song",
            "new_image_album",
            "new_image_artist",
            "new_image_playlist",
        ],
    }
}

/// get combined activity feed
///
/// queries the feed_eventz table for fast denormalized reads.
/// feed events are created at write time in their respective modules.
///
/// returns (items, total_count) for pagination. total_count is -1 (unknown)
/// since counting is expensive - client uses "has more" heuristic.
pub async fn get_combined_feed(
    limit: i64,
    offset: i64,
    feed_types: Option<&[FeedItemType]>,
    user_id: Option<&str>,
    viewer_user_id: Option<&str>,
) -> GrimoireResponse<(Vec<FeedItem>, i64)> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let viewer_id = viewer_user_id.unwrap_or("");

    // build SQL with dynamic filters
    let mut sql = String::from(
        r#"
        SELECT 
            fe.id,
            fe.feed_type,
            fe.song_id,
            fe.album_id,
            fe.artist_id,
            fe.playlist_id,
            fe.title,
            fe.subtitle,
            fe.images,
            fe.updated_at as created_at,
            fe.created_by_user_id as user_id,
            fe.created_by_username as username,
            NULL as play_count,
            fe.rating,
            CASE 
                WHEN fe.feed_type LIKE 'rating_%' OR fe.feed_type LIKE 'favorite_%' THEN
                    REPLACE(REPLACE(fe.feed_type, 'rating_', ''), 'favorite_', '')
                ELSE NULL 
            END as target_type,
            fe.session_id,
            fe.session_type,
            fe.session_status,
            fe.progress_percent,
            fe.songs_completed,
            fe.total_songs,
            fe.artist_name,
            fe.album_title,
            COALESCE((SELECT g.label FROM json_each(fe.genres) je, taxonz g WHERE g.id = json_extract(je.value, '$.id') LIMIT 1), NULL) as genre,
            COALESCE((SELECT json_extract(je.value, '$.id') FROM json_each(fe.genres) je LIMIT 1), NULL) as genre_id,
            fe.year,
            fe.song_count,
            fe.songs_added,
            fe.total_duration_ms,
            fe.image_count,
            fe.urls,
            fe.description,
            (SELECT json_group_array(json_extract(je.value, '$.name')) FROM json_each(fe.tags) je) as tags,
            COALESCE((
                SELECT 1 FROM user_favoritez uf 
                WHERE uf.user_id = ?
                AND uf.target_id = COALESCE(fe.song_id, fe.album_id, fe.playlist_id, fe.artist_id)
                LIMIT 1
            ), 0) as is_favorite,
            (fe.created_at = fe.updated_at) as is_initial_add,
            COALESCE(
                (SELECT p.created_at FROM playlistz p WHERE p.id = fe.playlist_id),
                (SELECT a.created_at FROM albumz a WHERE a.id = fe.album_id),
                (SELECT ar.created_at FROM artistz ar WHERE ar.id = fe.artist_id),
                fe.created_at
            ) as entity_created_at,
            fe.collage_images
        FROM feed_eventz fe
        WHERE 1=1
        "#,
    );

    // build feed type filter
    if let Some(types) = feed_types {
        if !types.is_empty() {
            let event_types: Vec<&str> = types
                .iter()
                .flat_map(feed_item_type_to_event_types)
                .collect();
            if !event_types.is_empty() {
                let type_list: String = event_types
                    .iter()
                    .map(|t| format!("'{}'", t))
                    .collect::<Vec<_>>()
                    .join(",");
                sql.push_str(&format!(" AND fe.feed_type IN ({})", type_list));
            }
        }
    }

    // user filter
    if let Some(uid) = user_id {
        sql.push_str(&format!(" AND fe.created_by_user_id = '{}'", uid));
    }

    sql.push_str(" ORDER BY fe.updated_at DESC");
    sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));

    tracing::debug!("feed query SQL: {}", sql);

    let rows = match sqlx::query_as::<_, RawFeedRow>(&sql)
        .bind(viewer_id)
        .fetch_all(&pool)
        .await
    {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("feed query error: {:?}", e);
            tracing::error!("feed query SQL was: {}", sql);
            return GrimoireResponse::failure("failed to get feed items", vec![e.into()]);
        }
    };

    let items: Vec<FeedItem> = rows.into_iter().map(|row| row.into_feed_item()).collect();

    // total_count = -1 indicates unknown (skip expensive COUNT)
    let total_count: i64 = -1;

    GrimoireResponse::success("combined feed retrieved", (items, total_count))
}

/// raw row struct for deserializing from feed_eventz
#[derive(Debug, sqlx::FromRow)]
struct RawFeedRow {
    id: String,
    feed_type: String,
    song_id: Option<String>,
    album_id: Option<String>,
    artist_id: Option<String>,
    playlist_id: Option<String>,
    title: String,
    subtitle: Option<String>,
    images: Option<String>,
    created_at: i64,
    user_id: Option<String>,
    username: Option<String>,
    play_count: Option<i64>,
    rating: Option<i64>,
    target_type: Option<String>,
    session_id: Option<String>,
    session_type: Option<String>,
    session_status: Option<String>,
    progress_percent: Option<f64>,
    songs_completed: Option<i64>,
    total_songs: Option<i64>,
    artist_name: Option<String>,
    album_title: Option<String>,
    genre: Option<String>,
    genre_id: Option<String>,
    year: Option<i64>,
    song_count: Option<i64>,
    songs_added: Option<i64>,
    total_duration_ms: Option<i64>,
    image_count: Option<i64>,
    urls: Option<String>,
    description: Option<String>,
    tags: Option<String>,
    is_favorite: i32,
    is_initial_add: i32,
    entity_created_at: Option<i64>,
    collage_images: Option<String>,
}

impl RawFeedRow {
    fn into_feed_item(self) -> FeedItem {
        // use helper function to map feed_eventz types to FeedItemType
        let feed_type = map_feed_event_type(&self.feed_type);

        let images = self
            .images
            .and_then(|json_str| serde_json::from_str::<Vec<ImageMetadata>>(&json_str).ok());

        let tags = self
            .tags
            .and_then(|json_str| serde_json::from_str::<Vec<String>>(&json_str).ok())
            .and_then(|v| if v.is_empty() { None } else { Some(v) });

        let collage_images = self
            .collage_images
            .and_then(|json_str| serde_json::from_str::<Vec<ImageMetadata>>(&json_str).ok());

        let urls = self
            .urls
            .and_then(|json_str| serde_json::from_str::<Vec<EntityUrl>>(&json_str).ok())
            .and_then(|v| if v.is_empty() { None } else { Some(v) });

        FeedItem {
            id: self.id,
            feed_type,
            song_id: self.song_id,
            album_id: self.album_id,
            artist_id: self.artist_id,
            playlist_id: self.playlist_id,
            title: self.title,
            subtitle: self.subtitle,
            images,
            created_at: self.created_at,
            user_id: self.user_id,
            username: self.username,
            play_count: self.play_count,
            rating: self.rating,
            target_type: self.target_type,
            session_id: self.session_id,
            session_type: self.session_type,
            session_status: self.session_status,
            progress_percent: self.progress_percent,
            songs_completed: self.songs_completed,
            total_songs: self.total_songs,
            artist_name: self.artist_name,
            album_title: self.album_title,
            genre: self.genre,
            genre_id: self.genre_id,
            year: self.year,
            song_count: self.song_count,
            songs_added: self.songs_added,
            total_duration_ms: self.total_duration_ms,
            image_count: self.image_count,
            urls,
            description: self.description,
            tags,
            is_favorite: self.is_favorite != 0,
            is_initial_add: self.is_initial_add != 0,
            collage_images,
            entity_created_at: self.entity_created_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore] // requires database setup with test data
    async fn test_get_combined_feed() {
        let response = get_combined_feed(20, 0, None, None, None).await;
        assert!(response.success);
        let (items, total) = response.data.unwrap();
        assert!(total >= 0);
        assert!(items.len() <= 20);
    }

    #[tokio::test]
    #[ignore]
    async fn test_get_combined_feed_filtered_by_type() {
        let types = vec![FeedItemType::RecentAlbum];
        let response = get_combined_feed(10, 0, Some(&types), None, None).await;
        assert!(response.success);
        let (items, _total) = response.data.unwrap();
        for item in &items {
            assert_eq!(item.feed_type, FeedItemType::RecentAlbum);
        }
    }

    #[tokio::test]
    #[ignore]
    async fn test_get_combined_feed_filtered_by_user() {
        let response = get_combined_feed(10, 0, None, Some("nonexistent-user"), None).await;
        assert!(response.success);
        let (items, total) = response.data.unwrap();
        assert_eq!(total, 0);
        assert!(items.is_empty());
    }
}
