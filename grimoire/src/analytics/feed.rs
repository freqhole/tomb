use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Serialize, Deserialize)]
pub struct FeedItem {
    pub item_type: FeedItemType,
    pub domain_type: Option<String>,
    pub domain_ids: Option<Vec<String>>,
    pub title: String,
    pub subtitle: Option<String>,
    pub image_url: Option<String>,
    pub metadata: FeedItemMetadata,
    pub play_count: Option<i64>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_played_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    pub user_id: Option<Uuid>,
    pub username: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FeedItemType {
    RecentAlbum,
    RecentPlaylist,
    UserActivityGroup,
    TrendingCollection,
    UserPlayedAlbum,
    UserPlayedPlaylist,
    UserPlayedArtist,
    UserPlayedGenre,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FeedItemMetadata {
    pub total_songs: Option<i32>,
    pub artist_name: Option<String>,
    pub album_name: Option<String>,
    pub playlist_name: Option<String>,
    pub genre_name: Option<String>,
    pub user_activity: Option<UserActivitySummary>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserActivitySummary {
    pub recent_albums: Vec<ActivityTile>,
    pub recent_playlists: Vec<ActivityTile>,
    pub recent_songs: Vec<ActivityTile>,
    pub period_description: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActivityTile {
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub image_url: Option<String>,
    pub domain_type: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FeedResponse {
    pub items: Vec<FeedItem>,
    pub has_more: bool,
    pub total_count: i64,
    pub limit: i64,
    pub offset: i64,
}

pub async fn get_social_feed(
    pool: &PgPool,
    limit: i64,
    offset: i64,
    days_back: i32,
) -> Result<FeedResponse, sqlx::Error> {
    // Get feed items
    let rows = sqlx::query!(
        r#"
        SELECT
            item_type,
            domain_type,
            domain_ids,
            title,
            subtitle,
            image_url,
            metadata,
            play_count,
            last_played_at,
            score,
            created_at,
            user_id,
            username
        FROM get_social_feed_items($1, $2, INTERVAL '1 day' * $3)
        "#,
        limit,
        offset,
        days_back as f64
    )
    .fetch_all(pool)
    .await?;

    // Get total count for pagination
    let total_count = sqlx::query_scalar!(
        "SELECT get_social_feed_count(INTERVAL '1 day' * $1)",
        days_back as f64
    )
    .fetch_one(pool)
    .await?
    .unwrap_or(0);

    let items: Vec<FeedItem> = rows
        .into_iter()
        .map(|row| {
            let item_type = match row.item_type.as_deref().unwrap_or("recent_album") {
                "recent_album" => FeedItemType::RecentAlbum,
                "recent_playlist" => FeedItemType::RecentPlaylist,
                "user_activity_group" => FeedItemType::UserActivityGroup,
                "trending_collection" => FeedItemType::TrendingCollection,
                "user_played_album" => FeedItemType::UserPlayedAlbum,
                "user_played_playlist" => FeedItemType::UserPlayedPlaylist,
                "user_played_artist" => FeedItemType::UserPlayedArtist,
                "user_played_genre" => FeedItemType::UserPlayedGenre,
                _ => FeedItemType::RecentAlbum, // fallback
            };

            // Parse metadata JSON
            let metadata: FeedItemMetadata = if let Some(meta_json) = row.metadata {
                // Handle user_activity parsing
                if item_type == FeedItemType::UserActivityGroup {
                    if let Some(user_activity_json) = meta_json.get("user_activity") {
                        let user_activity: Result<UserActivitySummary, _> =
                            serde_json::from_value(user_activity_json.clone());

                        match user_activity {
                            Ok(activity) => FeedItemMetadata {
                                total_songs: None,
                                artist_name: None,
                                album_name: None,
                                playlist_name: None,
                                genre_name: None,
                                user_activity: Some(activity),
                            },
                            Err(_) => FeedItemMetadata {
                                total_songs: None,
                                artist_name: None,
                                album_name: None,
                                playlist_name: None,
                                genre_name: None,
                                user_activity: None,
                            },
                        }
                    } else {
                        Default::default()
                    }
                } else {
                    // Handle regular collection metadata
                    FeedItemMetadata {
                        total_songs: meta_json
                            .get("total_songs")
                            .and_then(|v| v.as_i64())
                            .map(|v| v as i32),
                        artist_name: meta_json
                            .get("artist_name")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        album_name: meta_json
                            .get("album_name")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        playlist_name: meta_json
                            .get("playlist_name")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        genre_name: meta_json
                            .get("genre_name")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        user_activity: None,
                    }
                }
            } else {
                Default::default()
            };

            FeedItem {
                item_type,
                domain_type: row.domain_type,
                domain_ids: row.domain_ids,
                title: row.title.unwrap_or_else(|| "untitled".to_string()),
                subtitle: row.subtitle,
                image_url: row.image_url,
                metadata,
                play_count: row.play_count,
                last_played_at: row.last_played_at,
                created_at: row.created_at.unwrap_or_else(|| OffsetDateTime::now_utc()),
                user_id: row.user_id,
                username: row.username,
            }
        })
        .collect();

    let has_more = offset + limit < total_count;

    Ok(FeedResponse {
        items,
        has_more,
        total_count,
        limit,
        offset,
    })
}

impl Default for FeedItemMetadata {
    fn default() -> Self {
        Self {
            total_songs: None,
            artist_name: None,
            album_name: None,
            playlist_name: None,
            genre_name: None,
            user_activity: None,
        }
    }
}

impl PartialEq for FeedItemType {
    fn eq(&self, other: &Self) -> bool {
        std::mem::discriminant(self) == std::mem::discriminant(other)
    }
}
