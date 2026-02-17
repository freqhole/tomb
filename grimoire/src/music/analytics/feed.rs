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
use sea_query::{Expr, Iden, Order, Query, SqliteQueryBuilder};
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
    /// genre id (for linking to genre detail)
    pub genre_id: Option<String>,
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
    /// whether the primary entity is favorited by the viewer
    pub is_favorite: bool,
}

/// column identifiers for feed_query_view (type-safe sea_query references)
#[derive(Iden)]
enum FeedView {
    #[iden = "feed_query_view"]
    Table,
    #[iden = "id"]
    Id,
    #[iden = "feed_type"]
    FeedType,
    #[iden = "song_id"]
    SongId,
    #[iden = "album_id"]
    AlbumId,
    #[iden = "artist_id"]
    ArtistId,
    #[iden = "playlist_id"]
    PlaylistId,
    #[iden = "title"]
    Title,
    #[iden = "subtitle"]
    Subtitle,
    #[iden = "images"]
    Images,
    #[iden = "created_at"]
    CreatedAt,
    #[iden = "user_id"]
    UserId,
    #[iden = "username"]
    Username,
    #[iden = "play_count"]
    PlayCount,
    #[iden = "rating"]
    Rating,
    #[iden = "target_type"]
    TargetType,
    #[iden = "session_id"]
    SessionId,
    #[iden = "session_type"]
    SessionType,
    #[iden = "session_status"]
    SessionStatus,
    #[iden = "progress_percent"]
    ProgressPercent,
    #[iden = "songs_completed"]
    SongsCompleted,
    #[iden = "total_songs"]
    TotalSongs,
    #[iden = "artist_name"]
    ArtistName,
    #[iden = "album_title"]
    AlbumTitle,
    #[iden = "genre"]
    Genre,
    #[iden = "genre_id"]
    GenreId,
    #[iden = "year"]
    Year,
    #[iden = "song_count"]
    SongCount,
    #[iden = "total_duration_ms"]
    TotalDurationMs,
    #[iden = "description"]
    Description,
    #[iden = "tags"]
    Tags,
}

/// helper to bind sea_query values to a sqlx query
fn bind_sea_query_values<'a>(
    mut sqlx_query: sqlx::query::QueryAs<
        'a,
        sqlx::Sqlite,
        RawFeedRow,
        sqlx::sqlite::SqliteArguments<'a>,
    >,
    values: &'a sea_query::Values,
) -> sqlx::query::QueryAs<'a, sqlx::Sqlite, RawFeedRow, sqlx::sqlite::SqliteArguments<'a>> {
    for value in &values.0 {
        match value {
            sea_query::Value::String(Some(s)) => {
                sqlx_query = sqlx_query.bind(s.as_ref());
            }
            sea_query::Value::Int(Some(i)) => {
                sqlx_query = sqlx_query.bind(*i);
            }
            sea_query::Value::BigInt(Some(i)) => {
                sqlx_query = sqlx_query.bind(*i);
            }
            sea_query::Value::BigUnsigned(Some(u)) => {
                sqlx_query = sqlx_query.bind(*u as i64);
            }
            _ => {}
        }
    }
    sqlx_query
}

/// get combined activity feed
///
/// queries the feed_query_view which unions all feed sources into a single
/// view. uses sea_query for type-safe dynamic WHERE clauses when filtering
/// by feed_type and/or user_id.
///
/// returns (items, total_count) for pagination.
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

    // build dynamic WHERE filters with sea_query
    let apply_filters = |query: &mut sea_query::SelectStatement| {
        if let Some(types) = feed_types {
            if !types.is_empty() {
                // serialize enum variants to their snake_case string form for SQL
                let type_values: Vec<sea_query::Value> = types
                    .iter()
                    .filter_map(|t| serde_json::to_value(t).ok())
                    .filter_map(|v| v.as_str().map(|s| s.to_string().into()))
                    .collect();
                query.and_where(Expr::col(FeedView::FeedType).is_in(type_values));
            }
        }
        if let Some(uid) = user_id {
            query.and_where(Expr::col(FeedView::UserId).eq(uid));
        }
    };

    // count query
    let mut count_query = Query::select();
    count_query
        .expr(Expr::col(sea_query::Asterisk).count())
        .from(FeedView::Table);
    apply_filters(&mut count_query);

    let (count_sql, count_values) = count_query.build(SqliteQueryBuilder);

    let mut count_sqlx = sqlx::query_scalar::<_, i32>(&count_sql);
    for value in &count_values.0 {
        match value {
            sea_query::Value::String(Some(s)) => {
                count_sqlx = count_sqlx.bind(s.as_ref());
            }
            _ => {}
        }
    }

    let total_count = match count_sqlx.fetch_one(&pool).await {
        Ok(c) => c as i64,
        Err(e) => return GrimoireResponse::failure("failed to count feed items", vec![e.into()]),
    };

    // data query
    let mut data_query = Query::select();
    data_query
        .column(FeedView::Id)
        .column(FeedView::FeedType)
        .column(FeedView::SongId)
        .column(FeedView::AlbumId)
        .column(FeedView::ArtistId)
        .column(FeedView::PlaylistId)
        .column(FeedView::Title)
        .column(FeedView::Subtitle)
        .column(FeedView::Images)
        .column(FeedView::CreatedAt)
        .column(FeedView::UserId)
        .column(FeedView::Username)
        .column(FeedView::PlayCount)
        .column(FeedView::Rating)
        .column(FeedView::TargetType)
        .column(FeedView::SessionId)
        .column(FeedView::SessionType)
        .column(FeedView::SessionStatus)
        .column(FeedView::ProgressPercent)
        .column(FeedView::SongsCompleted)
        .column(FeedView::TotalSongs)
        .column(FeedView::ArtistName)
        .column(FeedView::AlbumTitle)
        .column(FeedView::Genre)
        .column(FeedView::GenreId)
        .column(FeedView::Year)
        .column(FeedView::SongCount)
        .column(FeedView::TotalDurationMs)
        .column(FeedView::Description)
        .column(FeedView::Tags)
        .from(FeedView::Table);

    // add is_favorite correlated subquery if viewer is authenticated
    if let Some(vid) = viewer_user_id {
        let vid_val: sea_query::Value = vid.to_string().into();
        data_query.expr_as(
            Expr::cust_with_values(
                "COALESCE((SELECT 1 FROM user_favoritez uf WHERE uf.user_id = ? AND uf.target_id = COALESCE(song_id, album_id, playlist_id, artist_id) AND uf.target_type = CASE WHEN song_id IS NOT NULL THEN 'song' WHEN album_id IS NOT NULL THEN 'album' WHEN playlist_id IS NOT NULL THEN 'playlist' WHEN artist_id IS NOT NULL THEN 'artist' END LIMIT 1), 0)",
                [vid_val],
            ),
            sea_query::Alias::new("is_favorite"),
        );
    } else {
        data_query.expr_as(Expr::cust("0"), sea_query::Alias::new("is_favorite"));
    }

    apply_filters(&mut data_query);

    data_query
        .order_by(FeedView::CreatedAt, Order::Desc)
        .limit(limit as u64)
        .offset(offset as u64);

    let (data_sql, data_values) = data_query.build(SqliteQueryBuilder);
    tracing::debug!("feed query SQL: {}", data_sql);

    let sqlx_query = sqlx::query_as::<_, RawFeedRow>(&data_sql);
    let sqlx_query = bind_sea_query_values(sqlx_query, &data_values);

    let rows = match sqlx_query.fetch_all(&pool).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("feed query error: {:?}", e);
            tracing::error!("feed query SQL was: {}", data_sql);
            return GrimoireResponse::failure("failed to get feed items", vec![e.into()]);
        }
    };

    let items: Vec<FeedItem> = rows.into_iter().map(|row| row.into_feed_item()).collect();

    GrimoireResponse::success("combined feed retrieved", (items, total_count))
}

/// raw row struct for deserializing from feed_query_view
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
    total_duration_ms: Option<i64>,
    description: Option<String>,
    tags: Option<String>,
    is_favorite: i32,
}

impl RawFeedRow {
    fn into_feed_item(self) -> FeedItem {
        let feed_type = match self.feed_type.as_str() {
            "recent_listen" => FeedItemType::RecentListen,
            "recent_favorite" => FeedItemType::RecentFavorite,
            "recent_album" => FeedItemType::RecentAlbum,
            "recent_rating" => FeedItemType::RecentRating,
            "recent_playlist" => FeedItemType::RecentPlaylist,
            "listen_session" => FeedItemType::ListenSession,
            "new_image" => FeedItemType::NewImage,
            _ => FeedItemType::RecentListen,
        };

        let images = self.images.and_then(|json_str| {
            serde_json::from_str::<Vec<crate::music::crud::ImageMetadata>>(&json_str).ok()
        });

        let tags = self
            .tags
            .and_then(|json_str| serde_json::from_str::<Vec<String>>(&json_str).ok())
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
            total_duration_ms: self.total_duration_ms,
            description: self.description,
            tags,
            is_favorite: self.is_favorite != 0,
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
