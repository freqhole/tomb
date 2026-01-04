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
    UserPlayedSong,
    UserFavoritedAlbum,
    UserFavoritedPlaylist,
    UserFavoritedSong,
    UserUnfavoritedSong,
    UserRatedSong,
    UserListeningSession,
    UserDailyActivity,
    UserWeeklyActivity,
    UserMonthlyActivity,
    UserMusicArchive,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FeedItemMetadata {
    pub total_songs: Option<i32>,
    pub artist_name: Option<String>,
    pub album_name: Option<String>,
    pub playlist_name: Option<String>,
    pub genre_name: Option<String>,
    pub user_activity: Option<UserActivitySummary>,
    pub social_context: Option<SocialContext>,
    pub collection_grid: Option<CollectionGrid>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SocialContext {
    pub action_type: String,
    pub frequency: i64,
    pub is_trending: bool,
    pub rating: Option<i32>,
    pub age_category: Option<String>,
    pub grouping_level: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CollectionGrid {
    pub total_songs: Option<i32>,
    pub grouping_level: Option<String>,
    pub songs: Option<Vec<CollectionGridSong>>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CollectionGridSong {
    pub id: String,
    pub song_id: Option<String>,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub album: Option<String>,
    pub year: Option<i32>,
    pub genre: Option<String>,
    pub sub_genres: Option<Vec<String>>,
    pub tags: Option<Vec<String>>,
    pub disc_number: Option<i32>,
    pub track_number: Option<i32>,
    pub duration: Option<String>,
    pub thumbnail_blob_id: Option<String>,
    pub domain_type: Option<String>,
    pub user_rating: Option<i32>,
    pub is_favorite: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserActivitySummary {
    pub recent_albums: Option<Vec<ActivityTile>>,
    pub recent_playlists: Option<Vec<ActivityTile>>,
    pub recent_songs: Option<Vec<ActivityTile>>,
    pub period_description: Option<String>,
    pub total_events: Option<i64>,
    pub last_activity: Option<String>,
    pub grouping_level: Option<String>,
    pub user_play_count: Option<i64>,
    pub session_duration: Option<f64>,
    pub total_play_count: Option<i64>,
    pub unique_collections: Option<i64>,
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
                "user_played_song" => FeedItemType::UserPlayedSong,
                "user_favorited_album" => FeedItemType::UserFavoritedAlbum,
                "user_favorited_playlist" => FeedItemType::UserFavoritedPlaylist,
                "user_favorited_song" => FeedItemType::UserFavoritedSong,
                "user_unfavorited_song" => FeedItemType::UserUnfavoritedSong,
                "user_rated_song" => FeedItemType::UserRatedSong,
                "user_listening_session" => FeedItemType::UserListeningSession,
                "user_daily_activity" => FeedItemType::UserDailyActivity,
                "user_weekly_activity" => FeedItemType::UserWeeklyActivity,
                "user_monthly_activity" => FeedItemType::UserMonthlyActivity,
                "user_music_archive" => FeedItemType::UserMusicArchive,
                _ => FeedItemType::RecentAlbum, // fallback
            };

            // Parse metadata JSON
            let metadata: FeedItemMetadata = if let Some(meta_json) = row.metadata {
                // Parse social context
                let social_context = meta_json.get("social_context").and_then(|sc| {
                    Some(SocialContext {
                        action_type: sc.get("action_type")?.as_str()?.to_string(),
                        frequency: sc.get("frequency")?.as_i64()?,
                        is_trending: sc.get("is_trending")?.as_bool()?,
                        rating: sc.get("rating").and_then(|v| v.as_i64()).map(|v| v as i32),
                        age_category: sc
                            .get("age_category")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        grouping_level: sc
                            .get("grouping_level")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                    })
                });

                // Parse user activity (for sessions and activity items)
                let user_activity = meta_json.get("user_activity").and_then(|ua| {
                    Some(UserActivitySummary {
                        recent_albums: None,
                        recent_playlists: None,
                        recent_songs: None,
                        period_description: None,
                        total_events: ua.get("total_events").and_then(|v| v.as_i64()),
                        last_activity: ua
                            .get("last_activity")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        grouping_level: ua
                            .get("grouping_level")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        user_play_count: ua.get("user_play_count").and_then(|v| v.as_i64()),
                        session_duration: ua.get("session_duration").and_then(|v| v.as_f64()),
                        total_play_count: ua.get("total_play_count").and_then(|v| v.as_i64()),
                        unique_collections: ua.get("unique_collections").and_then(|v| v.as_i64()),
                    })
                });

                // Parse collection grid (for session items)
                let collection_grid = meta_json.get("collection_grid").and_then(|cg| {
                    let songs = cg.get("songs").and_then(|songs_array| {
                        let songs_vec: Vec<CollectionGridSong> = songs_array
                            .as_array()?
                            .iter()
                            .filter_map(|song| {
                                Some(CollectionGridSong {
                                    id: song.get("id")?.as_str()?.to_string(),
                                    song_id: song
                                        .get("song_id")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                    title: song
                                        .get("title")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                    artist: song
                                        .get("artist")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                    album: song
                                        .get("album")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                    year: song
                                        .get("year")
                                        .and_then(|v| v.as_i64())
                                        .map(|v| v as i32),
                                    genre: song
                                        .get("genre")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                    sub_genres: song.get("sub_genres").and_then(|v| {
                                        v.as_array().map(|arr| {
                                            arr.iter()
                                                .filter_map(|item| {
                                                    item.as_str().map(|s| s.to_string())
                                                })
                                                .collect()
                                        })
                                    }),
                                    tags: song.get("tags").and_then(|v| {
                                        v.as_array().map(|arr| {
                                            arr.iter()
                                                .filter_map(|item| {
                                                    item.as_str().map(|s| s.to_string())
                                                })
                                                .collect()
                                        })
                                    }),
                                    disc_number: song
                                        .get("disc_number")
                                        .and_then(|v| v.as_i64())
                                        .map(|v| v as i32),
                                    track_number: song
                                        .get("track_number")
                                        .and_then(|v| v.as_i64())
                                        .map(|v| v as i32),
                                    duration: song
                                        .get("duration")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                    thumbnail_blob_id: song
                                        .get("thumbnail_blob_id")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                    domain_type: song
                                        .get("domain_type")
                                        .and_then(|v| v.as_str())
                                        .map(|s| s.to_string()),
                                    user_rating: song
                                        .get("user_rating")
                                        .and_then(|v| v.as_i64())
                                        .map(|v| v as i32),
                                    is_favorite: song.get("is_favorite").and_then(|v| v.as_bool()),
                                })
                            })
                            .collect();
                        Some(songs_vec)
                    });

                    Some(CollectionGrid {
                        total_songs: cg
                            .get("total_songs")
                            .and_then(|v| v.as_i64())
                            .map(|v| v as i32),
                        grouping_level: cg
                            .get("grouping_level")
                            .and_then(|v| v.as_str())
                            .map(|s| s.to_string()),
                        songs,
                    })
                });

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
                    user_activity,
                    social_context,
                    collection_grid,
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
            social_context: None,
            collection_grid: None,
        }
    }
}

impl PartialEq for FeedItemType {
    fn eq(&self, other: &Self) -> bool {
        std::mem::discriminant(self) == std::mem::discriminant(other)
    }
}
