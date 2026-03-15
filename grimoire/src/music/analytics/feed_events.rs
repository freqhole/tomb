//! feed events - denormalized activity feed for fast querying
//!
//! this module provides functions to create, update, and query feed events.
//! feed events are denormalized at write time for fast reads.
//! service accounts (freqroot) are skipped at write time - their actions
//! never create feed events in the first place.

use crate::database;
use crate::music::crud::{EntityUrl, ImageMetadata};
use crate::GrimoireResponse;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen::ZodSchema as ZodSchemaTrait;
use zod_gen_derive::ZodSchema;

// ============================================================================
// types
// ============================================================================

/// feed event type - determines what kind of activity this represents
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FeedEventType {
    Album,
    Artist,
    Playlist,
    Session,
    Listen,
    FavoriteSong,
    FavoriteAlbum,
    FavoriteArtist,
    FavoritePlaylist,
    RatingSong,
    RatingAlbum,
    RatingArtist,
    NewImageSong,
    NewImageAlbum,
    NewImageArtist,
    NewImagePlaylist,
}

impl ZodSchemaTrait for FeedEventType {
    fn zod_schema() -> String {
        r#"z.union([z.literal("album"), z.literal("artist"), z.literal("playlist"), z.literal("session"), z.literal("listen"), z.literal("favorite_song"), z.literal("favorite_album"), z.literal("favorite_artist"), z.literal("favorite_playlist"), z.literal("rating_song"), z.literal("rating_album"), z.literal("rating_artist"), z.literal("new_image_song"), z.literal("new_image_album"), z.literal("new_image_artist"), z.literal("new_image_playlist")])"#.to_string()
    }
}

impl std::fmt::Display for FeedEventType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FeedEventType::Album => write!(f, "album"),
            FeedEventType::Artist => write!(f, "artist"),
            FeedEventType::Playlist => write!(f, "playlist"),
            FeedEventType::Session => write!(f, "session"),
            FeedEventType::Listen => write!(f, "listen"),
            FeedEventType::FavoriteSong => write!(f, "favorite_song"),
            FeedEventType::FavoriteAlbum => write!(f, "favorite_album"),
            FeedEventType::FavoriteArtist => write!(f, "favorite_artist"),
            FeedEventType::FavoritePlaylist => write!(f, "favorite_playlist"),
            FeedEventType::RatingSong => write!(f, "rating_song"),
            FeedEventType::RatingAlbum => write!(f, "rating_album"),
            FeedEventType::RatingArtist => write!(f, "rating_artist"),
            FeedEventType::NewImageSong => write!(f, "new_image_song"),
            FeedEventType::NewImageAlbum => write!(f, "new_image_album"),
            FeedEventType::NewImageArtist => write!(f, "new_image_artist"),
            FeedEventType::NewImagePlaylist => write!(f, "new_image_playlist"),
        }
    }
}

impl TryFrom<&str> for FeedEventType {
    type Error = String;

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        match s {
            "album" => Ok(FeedEventType::Album),
            "artist" => Ok(FeedEventType::Artist),
            "playlist" => Ok(FeedEventType::Playlist),
            "session" => Ok(FeedEventType::Session),
            "listen" => Ok(FeedEventType::Listen),
            "favorite_song" => Ok(FeedEventType::FavoriteSong),
            "favorite_album" => Ok(FeedEventType::FavoriteAlbum),
            "favorite_artist" => Ok(FeedEventType::FavoriteArtist),
            "favorite_playlist" => Ok(FeedEventType::FavoritePlaylist),
            "rating_song" => Ok(FeedEventType::RatingSong),
            "rating_album" => Ok(FeedEventType::RatingAlbum),
            "rating_artist" => Ok(FeedEventType::RatingArtist),
            "new_image_song" => Ok(FeedEventType::NewImageSong),
            "new_image_album" => Ok(FeedEventType::NewImageAlbum),
            "new_image_artist" => Ok(FeedEventType::NewImageArtist),
            "new_image_playlist" => Ok(FeedEventType::NewImagePlaylist),
            _ => Err(format!("unknown feed event type: {}", s)),
        }
    }
}

/// genre with id and name for JSON serialization
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GenreRef {
    pub id: String,
    pub name: String,
}

/// tag with id and name for JSON serialization
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct TagRef {
    pub id: String,
    pub name: String,
}

/// a feed event from the database
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct FeedEvent {
    pub id: String,
    pub feed_type: FeedEventType,
    pub song_id: Option<String>,
    pub album_id: Option<String>,
    pub artist_id: Option<String>,
    pub playlist_id: Option<String>,
    pub session_id: Option<String>,
    pub created_by_user_id: String,
    pub created_by_username: String,
    pub updated_by_user_id: Option<String>,
    pub updated_by_username: Option<String>,
    pub title: String,
    pub subtitle: Option<String>,
    pub description: Option<String>,
    pub song_ids: Vec<String>,
    pub images: Vec<ImageMetadata>,
    pub extra_images: Vec<ImageMetadata>,
    pub collage_images: Option<Vec<ImageMetadata>>,
    pub genres: Vec<GenreRef>,
    pub tags: Vec<TagRef>,
    pub artist_name: Option<String>,
    pub album_title: Option<String>,
    pub year: Option<i64>,
    pub song_count: Option<i64>,
    pub songs_added: Option<i64>,
    pub total_duration_ms: Option<i64>,
    pub image_count: Option<i64>,
    pub urls: Vec<EntityUrl>,
    pub rating: Option<i64>,
    pub session_type: Option<String>,
    pub session_status: Option<String>,
    pub progress_percent: Option<f64>,
    pub songs_completed: Option<i64>,
    pub total_songs: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub is_favorite: bool,
}

/// raw row from database (before JSON parsing)
#[derive(Debug, FromRow)]
struct RawFeedEventRow {
    id: String,
    feed_type: String,
    song_id: Option<String>,
    album_id: Option<String>,
    artist_id: Option<String>,
    playlist_id: Option<String>,
    session_id: Option<String>,
    created_by_user_id: String,
    created_by_username: String,
    updated_by_user_id: Option<String>,
    updated_by_username: Option<String>,
    title: String,
    subtitle: Option<String>,
    description: Option<String>,
    song_ids: String,
    images: String,
    extra_images: String,
    collage_images: Option<String>,
    genres: String,
    tags: String,
    artist_name: Option<String>,
    album_title: Option<String>,
    year: Option<i64>,
    song_count: Option<i64>,
    songs_added: Option<i64>,
    total_duration_ms: Option<i64>,
    image_count: Option<i64>,
    urls: String,
    rating: Option<i64>,
    session_type: Option<String>,
    session_status: Option<String>,
    progress_percent: Option<f64>,
    songs_completed: Option<i64>,
    total_songs: Option<i64>,
    created_at: i64,
    updated_at: i64,
    is_favorite: i64,
}

impl RawFeedEventRow {
    fn into_feed_event(self) -> FeedEvent {
        FeedEvent {
            id: self.id,
            feed_type: FeedEventType::try_from(self.feed_type.as_str())
                .unwrap_or(FeedEventType::Album),
            song_id: self.song_id,
            album_id: self.album_id,
            artist_id: self.artist_id,
            playlist_id: self.playlist_id,
            session_id: self.session_id,
            created_by_user_id: self.created_by_user_id,
            created_by_username: self.created_by_username,
            updated_by_user_id: self.updated_by_user_id,
            updated_by_username: self.updated_by_username,
            title: self.title,
            subtitle: self.subtitle,
            description: self.description,
            song_ids: serde_json::from_str(&self.song_ids).unwrap_or_default(),
            images: serde_json::from_str(&self.images).unwrap_or_default(),
            extra_images: serde_json::from_str(&self.extra_images).unwrap_or_default(),
            collage_images: self
                .collage_images
                .and_then(|s| serde_json::from_str(&s).ok()),
            genres: serde_json::from_str(&self.genres).unwrap_or_default(),
            tags: serde_json::from_str(&self.tags).unwrap_or_default(),
            artist_name: self.artist_name,
            album_title: self.album_title,
            year: self.year,
            song_count: self.song_count,
            songs_added: self.songs_added,
            total_duration_ms: self.total_duration_ms,
            image_count: self.image_count,
            urls: serde_json::from_str(&self.urls).unwrap_or_default(),
            rating: self.rating,
            session_type: self.session_type,
            session_status: self.session_status,
            progress_percent: self.progress_percent,
            songs_completed: self.songs_completed,
            total_songs: self.total_songs,
            created_at: self.created_at,
            updated_at: self.updated_at,
            is_favorite: self.is_favorite != 0,
        }
    }
}

// ============================================================================
// constants
// ============================================================================

const FREQROOT_USERNAME: &str = "freqroot";

// ============================================================================
// query functions
// ============================================================================

/// get feed events with optional filtering
pub async fn get_feed_events(
    limit: i64,
    offset: i64,
    feed_types: Option<&[FeedEventType]>,
    user_id: Option<&str>,
    viewer_user_id: Option<&str>,
) -> GrimoireResponse<Vec<FeedEvent>> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let viewer_id = viewer_user_id.unwrap_or("");

    let mut sql = String::from(
        r#"
        SELECT 
            fe.*,
            COALESCE((
                SELECT 1 FROM user_favoritez uf 
                WHERE uf.user_id = ?
                AND uf.target_id = COALESCE(fe.song_id, fe.album_id, fe.playlist_id, fe.artist_id)
                LIMIT 1
            ), 0) as is_favorite
        FROM feed_eventz fe
        WHERE 1=1
        "#,
    );

    if let Some(types) = feed_types {
        if !types.is_empty() {
            let type_list: Vec<String> = types.iter().map(|t| format!("'{}'", t)).collect();
            sql.push_str(&format!(" AND fe.feed_type IN ({})", type_list.join(",")));
        }
    }

    if let Some(uid) = user_id {
        sql.push_str(&format!(" AND fe.created_by_user_id = '{}'", uid));
    }

    sql.push_str(" ORDER BY fe.updated_at DESC");
    sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));

    let rows = match sqlx::query_as::<_, RawFeedEventRow>(&sql)
        .bind(viewer_id)
        .fetch_all(&pool)
        .await
    {
        Ok(r) => r,
        Err(e) => return GrimoireResponse::failure("failed to fetch feed events", vec![e.into()]),
    };

    let events: Vec<FeedEvent> = rows.into_iter().map(|r| r.into_feed_event()).collect();
    GrimoireResponse::success("feed events retrieved", events)
}

// ============================================================================
// write functions - skip service accounts at write time
// ============================================================================

/// check if user should be skipped for feed events (freqroot / service accounts / non-existent).
/// called at write time - service account actions and invalid user IDs never create feed events.
pub async fn should_skip_feed_event(user_id: &str) -> bool {
    // skip empty user IDs
    if user_id.is_empty() {
        return true;
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(_) => return true, // skip on connection error to avoid FK failures
    };

    let result = sqlx::query_scalar!(
        r#"SELECT username FROM user_accountz WHERE id = ?"#,
        user_id
    )
    .fetch_optional(&pool)
    .await;

    match result {
        Ok(Some(username)) => username == FREQROOT_USERNAME, // skip freqroot
        Ok(None) => true,                                    // skip non-existent users
        Err(_) => true,                                      // skip on query error
    }
}

/// result of a feed event write operation
#[derive(Debug, Clone, Serialize)]
pub enum FeedEventResult {
    /// feed event was created/updated, contains the id
    Created(String),
    /// skipped because user is a service account
    Skipped,
}

/// create or update an album feed event
/// songs_added: how many songs were added in this action (usually 1)
pub async fn upsert_album_feed_event(
    album_id: &str,
    user_id: &str,
    username: &str,
    songs_added: i64,
) -> GrimoireResponse<FeedEventResult> {
    if should_skip_feed_event(user_id).await {
        tracing::debug!(
            "skipping album feed event: album_id={}, user_id={} (invalid or service account)",
            album_id,
            user_id
        );
        return GrimoireResponse::success(
            "skipped feed event for service account",
            FeedEventResult::Skipped,
        );
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let album_data = sqlx::query!(
        r#"
        SELECT 
            a.title,
            a.song_count,
            a.total_duration,
            CAST(SUBSTR(a.release_date, 1, 4) AS INTEGER) as "year: i64",
            (SELECT art.name FROM artist_albumz aa JOIN artistz art ON art.id = aa.artist_id WHERE aa.album_id = a.id LIMIT 1) as artist_name,
            (SELECT art.id FROM artist_albumz aa JOIN artistz art ON art.id = aa.artist_id WHERE aa.album_id = a.id LIMIT 1) as artist_id,
            COALESCE((SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
             FROM album_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id
             WHERE ai.album_id = a.id AND mb.blob_type NOT IN ('waveform') AND ai.is_primary = 1), '[]') as "images!: String",
            COALESCE((SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
             FROM album_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id
             WHERE ai.album_id = a.id AND mb.blob_type NOT IN ('waveform') AND ai.is_primary = 0), '[]') as "extra_images!: String",
            COALESCE((SELECT json_group_array(json_object('id', g.id, 'name', g.name))
             FROM album_genrez ag JOIN genrez g ON g.id = ag.genre_id WHERE ag.album_id = a.id), '[]') as "genres!: String",
            COALESCE((SELECT json_group_array(json_object('id', t.id, 'name', t.name))
             FROM album_tagz at JOIN tagz t ON t.id = at.tag_id WHERE at.album_id = a.id), '[]') as "tags!: String",
            COALESCE((SELECT json_group_array(s.id) FROM album_songz als JOIN songz s ON s.id = als.song_id WHERE als.album_id = a.id ORDER BY s.disc_number, s.track_number), '[]') as "song_ids!: String",
            COALESCE((SELECT json_group_array(json_object('id', eu.id, 'name', eu.name, 'url', eu.url))
             FROM entity_urlz eu WHERE eu.entity_type = 'album' AND eu.entity_id = a.id), '[]') as "urls!: String"
        FROM albumz a
        WHERE a.id = ?
        "#,
        album_id
    )
    .fetch_optional(&pool)
    .await;

    let album = match album_data {
        Ok(Some(a)) => a,
        Ok(None) => return GrimoireResponse::failure("album not found", vec![]),
        Err(e) => return GrimoireResponse::failure("failed to fetch album data", vec![e.into()]),
    };

    let feed_type = FeedEventType::Album.to_string();
    let title = album.title;
    let subtitle = album.artist_name.clone();
    let artist_name = album.artist_name;
    let artist_id = album.artist_id;
    let song_count = album.song_count;
    let total_duration_ms = album.total_duration;
    let year = album.year;
    let images = album.images;
    let extra_images = album.extra_images;
    let genres = album.genres;
    let tags = album.tags;
    let song_ids = album.song_ids;
    let urls = album.urls;

    let result = sqlx::query_scalar!(
        r#"
        INSERT INTO feed_eventz (
            feed_type, album_id, artist_id, created_by_user_id, created_by_username,
            title, subtitle, artist_name, song_count, songs_added, total_duration_ms, year,
            images, extra_images, genres, tags, song_ids, urls
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (album_id, created_by_user_id) WHERE feed_type = 'album' AND album_id IS NOT NULL
        DO UPDATE SET
            updated_by_user_id = excluded.created_by_user_id,
            updated_by_username = excluded.created_by_username,
            title = excluded.title,
            subtitle = excluded.subtitle,
            artist_name = excluded.artist_name,
            song_count = excluded.song_count,
            songs_added = feed_eventz.songs_added + excluded.songs_added,
            total_duration_ms = excluded.total_duration_ms,
            year = excluded.year,
            images = excluded.images,
            extra_images = excluded.extra_images,
            genres = excluded.genres,
            tags = excluded.tags,
            song_ids = excluded.song_ids,
            urls = excluded.urls,
            updated_at = unixepoch()
        RETURNING id
        "#,
        feed_type,
        album_id,
        artist_id,
        user_id,
        username,
        title,
        subtitle,
        artist_name,
        song_count,
        songs_added,
        total_duration_ms,
        year,
        images,
        extra_images,
        genres,
        tags,
        song_ids,
        urls
    )
    .fetch_one(&pool)
    .await;

    match result {
        Ok(id) => {
            tracing::debug!(
                "created album feed event: album_id={}, user_id={}, username={}, feed_id={:?}",
                album_id,
                user_id,
                username,
                id
            );
            GrimoireResponse::success(
                "album feed event upserted",
                FeedEventResult::Created(id.expect("insert should return id")),
            )
        }
        Err(e) => {
            tracing::warn!(
                "failed to create album feed event: album_id={}, user_id={}, error={}",
                album_id,
                user_id,
                e
            );
            GrimoireResponse::failure("failed to upsert album feed event", vec![e.into()])
        }
    }
}

/// create or update an artist feed event
pub async fn upsert_artist_feed_event(
    artist_id: &str,
    user_id: &str,
    username: &str,
) -> GrimoireResponse<FeedEventResult> {
    if should_skip_feed_event(user_id).await {
        return GrimoireResponse::success(
            "skipped feed event for service account",
            FeedEventResult::Skipped,
        );
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let artist_data = sqlx::query!(
        r#"
        SELECT 
            a.name,
            COALESCE((SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
             FROM artist_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id
             WHERE ai.artist_id = a.id AND mb.blob_type NOT IN ('waveform') AND ai.is_primary = 1), '[]') as "images!: String",
            COALESCE((SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
             FROM artist_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id
             WHERE ai.artist_id = a.id AND mb.blob_type NOT IN ('waveform') AND ai.is_primary = 0), '[]') as "extra_images!: String",
            COALESCE((SELECT json_group_array(json_object('id', eu.id, 'name', eu.name, 'url', eu.url))
             FROM entity_urlz eu WHERE eu.entity_type = 'artist' AND eu.entity_id = a.id), '[]') as "urls!: String"
        FROM artistz a
        WHERE a.id = ?
        "#,
        artist_id
    )
    .fetch_optional(&pool)
    .await;

    let artist = match artist_data {
        Ok(Some(a)) => a,
        Ok(None) => return GrimoireResponse::failure("artist not found", vec![]),
        Err(e) => return GrimoireResponse::failure("failed to fetch artist data", vec![e.into()]),
    };

    let feed_type = FeedEventType::Artist.to_string();
    let title = artist.name.clone();
    let artist_name = Some(artist.name);
    let images = artist.images;
    let extra_images = artist.extra_images;
    let urls = artist.urls;

    let result = sqlx::query_scalar!(
        r#"
        INSERT INTO feed_eventz (
            feed_type, artist_id, created_by_user_id, created_by_username,
            title, artist_name, images, extra_images, urls
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (artist_id, created_by_user_id) WHERE feed_type = 'artist' AND artist_id IS NOT NULL
        DO UPDATE SET
            updated_by_user_id = excluded.created_by_user_id,
            updated_by_username = excluded.created_by_username,
            title = excluded.title,
            artist_name = excluded.artist_name,
            images = excluded.images,
            extra_images = excluded.extra_images,
            urls = excluded.urls,
            updated_at = unixepoch()
        RETURNING id
        "#,
        feed_type,
        artist_id,
        user_id,
        username,
        title,
        artist_name,
        images,
        extra_images,
        urls
    )
    .fetch_one(&pool)
    .await;

    match result {
        Ok(id) => GrimoireResponse::success(
            "artist feed event upserted",
            FeedEventResult::Created(id.expect("insert should return id")),
        ),
        Err(e) => GrimoireResponse::failure("failed to upsert artist feed event", vec![e.into()]),
    }
}

/// create or update a playlist feed event
pub async fn upsert_playlist_feed_event(
    playlist_id: &str,
    user_id: &str,
    username: &str,
) -> GrimoireResponse<FeedEventResult> {
    if should_skip_feed_event(user_id).await {
        return GrimoireResponse::success(
            "skipped feed event for service account",
            FeedEventResult::Skipped,
        );
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let playlist_data = sqlx::query!(
        r#"
        SELECT 
            p.title,
            p.description,
            p.created_by_id as original_creator_id,
            (SELECT u.username FROM user_accountz u WHERE u.id = p.created_by_id) as "original_creator_username?: String",
            (SELECT COUNT(*) FROM playlist_songz ps WHERE ps.playlist_id = p.id) as "song_count!: i64",
            (SELECT COALESCE(SUM(s.duration), 0) FROM playlist_songz ps JOIN songz s ON s.id = ps.song_id WHERE ps.playlist_id = p.id) as "total_duration_ms!: i64",
            COALESCE((SELECT json_group_array(json_object('blob_id', pi.media_blob_id, 'is_primary', pi.is_primary, 'blob_type', mb.blob_type))
             FROM playlist_imagez pi JOIN media_blobz mb ON pi.media_blob_id = mb.id
             WHERE pi.playlist_id = p.id AND mb.blob_type NOT IN ('waveform') AND pi.is_primary = 1), '[]') as "images!: String",
            COALESCE((SELECT json_group_array(json_object('blob_id', pi.media_blob_id, 'is_primary', pi.is_primary, 'blob_type', mb.blob_type))
             FROM playlist_imagez pi JOIN media_blobz mb ON pi.media_blob_id = mb.id
             WHERE pi.playlist_id = p.id AND mb.blob_type NOT IN ('waveform') AND pi.is_primary = 0), '[]') as "extra_images!: String",
            COALESCE((SELECT json_group_array(s.id) FROM playlist_songz ps JOIN songz s ON s.id = ps.song_id WHERE ps.playlist_id = p.id ORDER BY ps.position), '[]') as "song_ids!: String",
            COALESCE((SELECT json_group_array(json_object('id', eu.id, 'name', eu.name, 'url', eu.url))
             FROM entity_urlz eu WHERE eu.entity_type = 'playlist' AND eu.entity_id = p.id), '[]') as "urls!: String"
        FROM playlistz p
        WHERE p.id = ?
        "#,
        playlist_id
    )
    .fetch_optional(&pool)
    .await;

    let playlist = match playlist_data {
        Ok(Some(p)) => p,
        Ok(None) => return GrimoireResponse::failure("playlist not found", vec![]),
        Err(e) => {
            return GrimoireResponse::failure("failed to fetch playlist data", vec![e.into()])
        }
    };

    let feed_type = FeedEventType::Playlist.to_string();
    let title = playlist.title;
    let description = playlist.description;
    let song_count = playlist.song_count;
    let total_duration_ms = playlist.total_duration_ms;
    let images = playlist.images;
    let extra_images = playlist.extra_images;
    let song_ids = playlist.song_ids;
    let urls = playlist.urls;
    let original_creator_id = playlist
        .original_creator_id
        .unwrap_or_else(|| user_id.to_string());
    let original_creator_username = playlist
        .original_creator_username
        .unwrap_or_else(|| username.to_string());

    let result = sqlx::query_scalar!(
        r#"
        INSERT INTO feed_eventz (
            feed_type, playlist_id, created_by_user_id, created_by_username,
            title, description, song_count, total_duration_ms,
            images, extra_images, song_ids, urls
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (playlist_id) WHERE feed_type = 'playlist' AND playlist_id IS NOT NULL
        DO UPDATE SET
            updated_by_user_id = ?,
            updated_by_username = ?,
            title = excluded.title,
            description = excluded.description,
            song_count = excluded.song_count,
            total_duration_ms = excluded.total_duration_ms,
            images = excluded.images,
            extra_images = excluded.extra_images,
            song_ids = excluded.song_ids,
            urls = excluded.urls,
            updated_at = unixepoch()
        RETURNING id
        "#,
        feed_type,
        playlist_id,
        original_creator_id,
        original_creator_username,
        title,
        description,
        song_count,
        total_duration_ms,
        images,
        extra_images,
        song_ids,
        urls,
        user_id,
        username
    )
    .fetch_one(&pool)
    .await;

    match result {
        Ok(id) => GrimoireResponse::success(
            "playlist feed event upserted",
            FeedEventResult::Created(id.expect("insert should return id")),
        ),
        Err(e) => GrimoireResponse::failure("failed to upsert playlist feed event", vec![e.into()]),
    }
}

/// create or update a session feed event
pub async fn upsert_session_feed_event(session_id: &str) -> GrimoireResponse<FeedEventResult> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let session_data = sqlx::query!(
        r#"
        SELECT 
            ls.user_id,
            (SELECT u.username FROM user_accountz u WHERE u.id = ls.user_id) as "username?: String",
            ls.session_type,
            ls.entity_id,
            ls.label,
            ls.status,
            ls.song_ids,
            ls.total_songs,
            ls.songs_completed,
            ls.total_duration_ms,
            CASE
                WHEN ls.total_songs > 0 THEN MIN(ls.songs_completed * 100.0 / ls.total_songs, 100.0)
                ELSE 0.0
            END as "progress_percent!: f64",
            CASE
                WHEN ls.session_type = 'album' AND ls.entity_id IS NOT NULL THEN
                    (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
                     FROM album_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id
                     WHERE ai.album_id = ls.entity_id AND mb.blob_type NOT IN ('waveform'))
                WHEN ls.session_type = 'artist' AND ls.entity_id IS NOT NULL THEN
                    (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
                     FROM artist_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id
                     WHERE ai.artist_id = ls.entity_id AND mb.blob_type NOT IN ('waveform'))
                WHEN ls.session_type = 'playlist' AND ls.entity_id IS NOT NULL THEN
                    (SELECT json_group_array(json_object('blob_id', pi.media_blob_id, 'is_primary', pi.is_primary, 'blob_type', mb.blob_type))
                     FROM playlist_imagez pi JOIN media_blobz mb ON pi.media_blob_id = mb.id
                     WHERE pi.playlist_id = ls.entity_id AND mb.blob_type NOT IN ('waveform'))
                ELSE '[]'
            END as "images!: String",
            CASE
                WHEN ls.session_type IN ('genre', 'shuffle') THEN
                    (SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', 1, 'blob_type', mb.blob_type))
                     FROM (
                         SELECT DISTINCT als.album_id
                         FROM json_each(ls.song_ids) je
                         JOIN album_songz als ON als.song_id = je.value
                         LIMIT 4
                     ) distinct_albums
                     JOIN album_imagez ai ON ai.album_id = distinct_albums.album_id AND ai.is_primary = 1
                     JOIN media_blobz mb ON mb.id = ai.media_blob_id
                     WHERE mb.blob_type NOT IN ('waveform'))
                ELSE NULL
            END as "collage_images?: String",
            CASE
                WHEN ls.session_type = 'album' THEN (SELECT a.title FROM albumz a WHERE a.id = ls.entity_id)
                WHEN ls.session_type = 'artist' THEN (SELECT a.name FROM artistz a WHERE a.id = ls.entity_id)
                WHEN ls.session_type = 'playlist' THEN (SELECT p.title FROM playlistz p WHERE p.id = ls.entity_id)
                ELSE NULL
            END as "entity_title?: String",
            CASE
                WHEN ls.session_type = 'album' THEN (SELECT art.name FROM artist_albumz aa JOIN artistz art ON art.id = aa.artist_id WHERE aa.album_id = ls.entity_id LIMIT 1)
                ELSE NULL
            END as "artist_name?: String",
            CASE
                WHEN ls.session_type = 'album' THEN ls.entity_id
                ELSE NULL
            END as "album_id?: String",
            CASE
                WHEN ls.session_type = 'artist' THEN ls.entity_id
                ELSE NULL
            END as "artist_id?: String",
            CASE
                WHEN ls.session_type = 'playlist' THEN ls.entity_id
                ELSE NULL
            END as "playlist_id?: String"
        FROM listen_sessionz ls
        WHERE ls.id = ?
        "#,
        session_id
    )
    .fetch_optional(&pool)
    .await;

    let session = match session_data {
        Ok(Some(s)) => s,
        Ok(None) => return GrimoireResponse::failure("session not found", vec![]),
        Err(e) => return GrimoireResponse::failure("failed to fetch session data", vec![e.into()]),
    };

    let user_id = session.user_id.clone();
    if should_skip_feed_event(&user_id).await {
        return GrimoireResponse::success(
            "skipped feed event for service account",
            FeedEventResult::Skipped,
        );
    }

    let feed_type = FeedEventType::Session.to_string();
    let username = session.username.unwrap_or_else(|| "unknown".to_string());
    let title = session.label;
    let subtitle = session.entity_title;
    let artist_name = session.artist_name;
    let album_id = session.album_id;
    let artist_id = session.artist_id;
    let playlist_id = session.playlist_id;
    let session_type = Some(session.session_type);
    let session_status = Some(session.status);
    let progress_percent = Some(session.progress_percent);
    let songs_completed = Some(session.songs_completed);
    let total_songs = Some(session.total_songs);
    let total_duration_ms = Some(session.total_duration_ms);
    let song_ids = session.song_ids;
    let images = session.images;
    let collage_images = session.collage_images;

    let result = sqlx::query_scalar!(
        r#"
        INSERT INTO feed_eventz (
            feed_type, session_id, album_id, artist_id, playlist_id,
            created_by_user_id, created_by_username,
            title, subtitle, artist_name,
            session_type, session_status, progress_percent, songs_completed, total_songs,
            total_duration_ms, song_ids, images, collage_images
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (session_id) WHERE feed_type = 'session' AND session_id IS NOT NULL
        DO UPDATE SET
            title = excluded.title,
            subtitle = excluded.subtitle,
            artist_name = excluded.artist_name,
            session_status = excluded.session_status,
            progress_percent = excluded.progress_percent,
            songs_completed = excluded.songs_completed,
            total_songs = excluded.total_songs,
            total_duration_ms = excluded.total_duration_ms,
            song_ids = excluded.song_ids,
            images = excluded.images,
            collage_images = excluded.collage_images,
            updated_at = unixepoch()
        RETURNING id
        "#,
        feed_type,
        session_id,
        album_id,
        artist_id,
        playlist_id,
        user_id,
        username,
        title,
        subtitle,
        artist_name,
        session_type,
        session_status,
        progress_percent,
        songs_completed,
        total_songs,
        total_duration_ms,
        song_ids,
        images,
        collage_images
    )
    .fetch_one(&pool)
    .await;

    match result {
        Ok(id) => GrimoireResponse::success(
            "session feed event upserted",
            FeedEventResult::Created(id.expect("insert should return id")),
        ),
        Err(e) => GrimoireResponse::failure("failed to upsert session feed event", vec![e.into()]),
    }
}

/// create a favorite feed event
pub async fn create_favorite_feed_event(
    target_type: &str,
    target_id: &str,
    user_id: &str,
    username: &str,
) -> GrimoireResponse<FeedEventResult> {
    if should_skip_feed_event(user_id).await {
        return GrimoireResponse::success(
            "skipped feed event for service account",
            FeedEventResult::Skipped,
        );
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    // gather data based on target type - use struct to avoid large tuple
    struct FavoriteData {
        feed_type: String,
        song_id: Option<String>,
        album_id: Option<String>,
        artist_id: Option<String>,
        playlist_id: Option<String>,
        title: String,
        subtitle: Option<String>,
        artist_name: Option<String>,
        album_title: Option<String>,
        images: String,
    }

    let data = match target_type {
        "song" => {
            let row = sqlx::query!(
                r#"
                SELECT 
                    s.title,
                    (SELECT art.name FROM artist_songz asa JOIN artistz art ON art.id = asa.artist_id WHERE asa.song_id = s.id LIMIT 1) as "artist_name?: String",
                    (SELECT als.album_id FROM album_songz als WHERE als.song_id = s.id LIMIT 1) as "album_id?: String",
                    (SELECT alb.title FROM album_songz als JOIN albumz alb ON alb.id = als.album_id WHERE als.song_id = s.id LIMIT 1) as "album_title?: String",
                    COALESCE((SELECT json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
                     FROM song_imagez si JOIN media_blobz mb ON si.media_blob_id = mb.id
                     WHERE si.song_id = s.id AND mb.blob_type NOT IN ('waveform')), '[]') as "images!: String"
                FROM songz s WHERE s.id = ?
                "#,
                target_id
            )
            .fetch_optional(&pool)
            .await;

            match row {
                Ok(Some(d)) => FavoriteData {
                    feed_type: FeedEventType::FavoriteSong.to_string(),
                    song_id: Some(target_id.to_string()),
                    album_id: d.album_id,
                    artist_id: None,
                    playlist_id: None,
                    title: d.title,
                    subtitle: d.artist_name.clone(),
                    artist_name: d.artist_name,
                    album_title: d.album_title,
                    images: d.images,
                },
                _ => return GrimoireResponse::failure("song not found", vec![]),
            }
        }
        "album" => {
            let row = sqlx::query!(
                r#"
                SELECT 
                    a.title,
                    (SELECT art.name FROM artist_albumz aa JOIN artistz art ON art.id = aa.artist_id WHERE aa.album_id = a.id LIMIT 1) as "artist_name?: String",
                    COALESCE((SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
                     FROM album_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id
                     WHERE ai.album_id = a.id AND mb.blob_type NOT IN ('waveform')), '[]') as "images!: String"
                FROM albumz a WHERE a.id = ?
                "#,
                target_id
            )
            .fetch_optional(&pool)
            .await;

            match row {
                Ok(Some(d)) => FavoriteData {
                    feed_type: FeedEventType::FavoriteAlbum.to_string(),
                    song_id: None,
                    album_id: Some(target_id.to_string()),
                    artist_id: None,
                    playlist_id: None,
                    title: d.title,
                    subtitle: d.artist_name.clone(),
                    artist_name: d.artist_name,
                    album_title: None,
                    images: d.images,
                },
                _ => return GrimoireResponse::failure("album not found", vec![]),
            }
        }
        "artist" => {
            let row = sqlx::query!(
                r#"
                SELECT 
                    a.name,
                    COALESCE((SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
                     FROM artist_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id
                     WHERE ai.artist_id = a.id AND mb.blob_type NOT IN ('waveform')), '[]') as "images!: String"
                FROM artistz a WHERE a.id = ?
                "#,
                target_id
            )
            .fetch_optional(&pool)
            .await;

            match row {
                Ok(Some(d)) => FavoriteData {
                    feed_type: FeedEventType::FavoriteArtist.to_string(),
                    song_id: None,
                    album_id: None,
                    artist_id: Some(target_id.to_string()),
                    playlist_id: None,
                    title: d.name.clone(),
                    subtitle: None,
                    artist_name: Some(d.name),
                    album_title: None,
                    images: d.images,
                },
                _ => return GrimoireResponse::failure("artist not found", vec![]),
            }
        }
        "playlist" => {
            let row = sqlx::query!(
                r#"
                SELECT 
                    p.title,
                    p.description,
                    COALESCE((SELECT json_group_array(json_object('blob_id', pi.media_blob_id, 'is_primary', pi.is_primary, 'blob_type', mb.blob_type))
                     FROM playlist_imagez pi JOIN media_blobz mb ON pi.media_blob_id = mb.id
                     WHERE pi.playlist_id = p.id AND mb.blob_type NOT IN ('waveform')), '[]') as "images!: String"
                FROM playlistz p WHERE p.id = ?
                "#,
                target_id
            )
            .fetch_optional(&pool)
            .await;

            match row {
                Ok(Some(d)) => FavoriteData {
                    feed_type: FeedEventType::FavoritePlaylist.to_string(),
                    song_id: None,
                    album_id: None,
                    artist_id: None,
                    playlist_id: Some(target_id.to_string()),
                    title: d.title,
                    subtitle: d.description,
                    artist_name: None,
                    album_title: None,
                    images: d.images,
                },
                _ => return GrimoireResponse::failure("playlist not found", vec![]),
            }
        }
        _ => return GrimoireResponse::failure("invalid target type", vec![]),
    };

    let result = sqlx::query_scalar!(
        r#"
        INSERT INTO feed_eventz (
            feed_type, song_id, album_id, artist_id, playlist_id,
            created_by_user_id, created_by_username,
            title, subtitle, artist_name, album_title, images
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        "#,
        data.feed_type,
        data.song_id,
        data.album_id,
        data.artist_id,
        data.playlist_id,
        user_id,
        username,
        data.title,
        data.subtitle,
        data.artist_name,
        data.album_title,
        data.images
    )
    .fetch_one(&pool)
    .await;

    match result {
        Ok(id) => GrimoireResponse::success(
            "favorite feed event created",
            FeedEventResult::Created(id.expect("insert should return id")),
        ),
        Err(e) => GrimoireResponse::failure("failed to create favorite feed event", vec![e.into()]),
    }
}

/// delete a favorite feed event (when unfavoriting)
pub async fn delete_favorite_feed_event(
    target_type: &str,
    target_id: &str,
    user_id: &str,
) -> GrimoireResponse<()> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    let feed_type = match target_type {
        "song" => FeedEventType::FavoriteSong.to_string(),
        "album" => FeedEventType::FavoriteAlbum.to_string(),
        "artist" => FeedEventType::FavoriteArtist.to_string(),
        "playlist" => FeedEventType::FavoritePlaylist.to_string(),
        _ => return GrimoireResponse::failure("invalid target type", vec![]),
    };

    let result = sqlx::query!(
        r#"
        DELETE FROM feed_eventz 
        WHERE feed_type = ? 
        AND created_by_user_id = ?
        AND (
            (? = 'song' AND song_id = ?) OR
            (? = 'album' AND album_id = ?) OR
            (? = 'artist' AND artist_id = ?) OR
            (? = 'playlist' AND playlist_id = ?)
        )
        "#,
        feed_type,
        user_id,
        target_type,
        target_id,
        target_type,
        target_id,
        target_type,
        target_id,
        target_type,
        target_id
    )
    .execute(&pool)
    .await;

    match result {
        Ok(_) => GrimoireResponse::success("favorite feed event deleted", ()),
        Err(e) => GrimoireResponse::failure("failed to delete favorite feed event", vec![e.into()]),
    }
}

/// create or update a rating feed event
pub async fn upsert_rating_feed_event(
    target_type: &str,
    target_id: &str,
    user_id: &str,
    username: &str,
    rating: i64,
) -> GrimoireResponse<FeedEventResult> {
    if should_skip_feed_event(user_id).await {
        return GrimoireResponse::success(
            "skipped feed event for service account",
            FeedEventResult::Skipped,
        );
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    // gather data based on target type - use struct to avoid large tuple
    struct RatingData {
        feed_type: String,
        song_id: Option<String>,
        album_id: Option<String>,
        artist_id: Option<String>,
        title: String,
        subtitle: Option<String>,
        artist_name: Option<String>,
        album_title: Option<String>,
        images: String,
    }

    let data = match target_type {
        "song" => {
            let row = sqlx::query!(
                r#"
                SELECT 
                    s.title,
                    (SELECT art.name FROM artist_songz asa JOIN artistz art ON art.id = asa.artist_id WHERE asa.song_id = s.id LIMIT 1) as "artist_name?: String",
                    (SELECT als.album_id FROM album_songz als WHERE als.song_id = s.id LIMIT 1) as "album_id?: String",
                    (SELECT alb.title FROM album_songz als JOIN albumz alb ON alb.id = als.album_id WHERE als.song_id = s.id LIMIT 1) as "album_title?: String",
                    COALESCE((SELECT json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
                     FROM song_imagez si JOIN media_blobz mb ON si.media_blob_id = mb.id
                     WHERE si.song_id = s.id AND mb.blob_type NOT IN ('waveform')), '[]') as "images!: String"
                FROM songz s WHERE s.id = ?
                "#,
                target_id
            )
            .fetch_optional(&pool)
            .await;

            match row {
                Ok(Some(d)) => RatingData {
                    feed_type: FeedEventType::RatingSong.to_string(),
                    song_id: Some(target_id.to_string()),
                    album_id: d.album_id,
                    artist_id: None,
                    title: d.title,
                    subtitle: d.artist_name.clone(),
                    artist_name: d.artist_name,
                    album_title: d.album_title,
                    images: d.images,
                },
                _ => return GrimoireResponse::failure("song not found", vec![]),
            }
        }
        "album" => {
            let row = sqlx::query!(
                r#"
                SELECT 
                    a.title,
                    (SELECT art.name FROM artist_albumz aa JOIN artistz art ON art.id = aa.artist_id WHERE aa.album_id = a.id LIMIT 1) as "artist_name?: String",
                    COALESCE((SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
                     FROM album_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id
                     WHERE ai.album_id = a.id AND mb.blob_type NOT IN ('waveform')), '[]') as "images!: String"
                FROM albumz a WHERE a.id = ?
                "#,
                target_id
            )
            .fetch_optional(&pool)
            .await;

            match row {
                Ok(Some(d)) => RatingData {
                    feed_type: FeedEventType::RatingAlbum.to_string(),
                    song_id: None,
                    album_id: Some(target_id.to_string()),
                    artist_id: None,
                    title: d.title,
                    subtitle: d.artist_name.clone(),
                    artist_name: d.artist_name,
                    album_title: None,
                    images: d.images,
                },
                _ => return GrimoireResponse::failure("album not found", vec![]),
            }
        }
        "artist" => {
            let row = sqlx::query!(
                r#"
                SELECT 
                    a.name,
                    COALESCE((SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
                     FROM artist_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id
                     WHERE ai.artist_id = a.id AND mb.blob_type NOT IN ('waveform')), '[]') as "images!: String"
                FROM artistz a WHERE a.id = ?
                "#,
                target_id
            )
            .fetch_optional(&pool)
            .await;

            match row {
                Ok(Some(d)) => RatingData {
                    feed_type: FeedEventType::RatingArtist.to_string(),
                    song_id: None,
                    album_id: None,
                    artist_id: Some(target_id.to_string()),
                    title: d.name.clone(),
                    subtitle: None,
                    artist_name: Some(d.name),
                    album_title: None,
                    images: d.images,
                },
                _ => return GrimoireResponse::failure("artist not found", vec![]),
            }
        }
        _ => return GrimoireResponse::failure("invalid target type for rating", vec![]),
    };

    let result = sqlx::query_scalar!(
        r#"
        INSERT INTO feed_eventz (
            feed_type, song_id, album_id, artist_id,
            created_by_user_id, created_by_username,
            title, subtitle, artist_name, album_title, images, rating
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (song_id, created_by_user_id) WHERE feed_type = 'rating_song' AND song_id IS NOT NULL
        DO UPDATE SET rating = excluded.rating, updated_at = unixepoch()
        ON CONFLICT (album_id, created_by_user_id) WHERE feed_type = 'rating_album' AND album_id IS NOT NULL
        DO UPDATE SET rating = excluded.rating, updated_at = unixepoch()
        ON CONFLICT (artist_id, created_by_user_id) WHERE feed_type = 'rating_artist' AND artist_id IS NOT NULL
        DO UPDATE SET rating = excluded.rating, updated_at = unixepoch()
        RETURNING id
        "#,
        data.feed_type,
        data.song_id,
        data.album_id,
        data.artist_id,
        user_id,
        username,
        data.title,
        data.subtitle,
        data.artist_name,
        data.album_title,
        data.images,
        rating
    )
    .fetch_one(&pool)
    .await;

    match result {
        Ok(id) => GrimoireResponse::success(
            "rating feed event upserted",
            FeedEventResult::Created(id.expect("insert should return id")),
        ),
        Err(e) => GrimoireResponse::failure("failed to upsert rating feed event", vec![e.into()]),
    }
}

/// create a listen feed event when a song is played
pub async fn create_listen_feed_event(
    song_id: &str,
    user_id: &str,
    username: &str,
) -> GrimoireResponse<FeedEventResult> {
    if should_skip_feed_event(user_id).await {
        return GrimoireResponse::success(
            "skipped feed event for service account",
            FeedEventResult::Skipped,
        );
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    // gather song data
    let song_data = sqlx::query!(
        r#"
        SELECT 
            s.title,
            (SELECT art.name FROM artist_songz asa JOIN artistz art ON art.id = asa.artist_id WHERE asa.song_id = s.id LIMIT 1) as "artist_name?: String",
            (SELECT art.id FROM artist_songz asa JOIN artistz art ON art.id = asa.artist_id WHERE asa.song_id = s.id LIMIT 1) as "artist_id?: String",
            (SELECT als.album_id FROM album_songz als WHERE als.song_id = s.id LIMIT 1) as "album_id?: String",
            (SELECT alb.title FROM album_songz als JOIN albumz alb ON alb.id = als.album_id WHERE als.song_id = s.id LIMIT 1) as "album_title?: String",
            COALESCE((SELECT json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type))
             FROM song_imagez si JOIN media_blobz mb ON si.media_blob_id = mb.id
             WHERE si.song_id = s.id AND mb.blob_type NOT IN ('waveform')), '[]') as "images!: String"
        FROM songz s WHERE s.id = ?
        "#,
        song_id
    )
    .fetch_optional(&pool)
    .await;

    let data = match song_data {
        Ok(Some(d)) => d,
        _ => return GrimoireResponse::failure("song not found", vec![]),
    };

    let feed_type = FeedEventType::Listen.to_string();

    // insert new listen event each time (no upsert - each play is unique)
    let result = sqlx::query_scalar!(
        r#"
        INSERT INTO feed_eventz (
            feed_type, song_id, album_id, artist_id,
            created_by_user_id, created_by_username,
            title, subtitle, artist_name, album_title, images
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        RETURNING id
        "#,
        feed_type,
        song_id,
        data.album_id,
        data.artist_id,
        user_id,
        username,
        data.title,
        data.artist_name,
        data.artist_name,
        data.album_title,
        data.images
    )
    .fetch_one(&pool)
    .await;

    match result {
        Ok(id) => GrimoireResponse::success(
            "listen feed event created",
            FeedEventResult::Created(id.expect("insert should return id")),
        ),
        Err(e) => GrimoireResponse::failure("failed to create listen feed event", vec![e.into()]),
    }
}

/// create or update a feed event when images are added to an entity
///
/// this aggregates all images for the entity into a single carousel-style feed event.
/// multiple image additions by the same user update the same event rather than creating duplicates.
///
/// note: `_media_blob_id` is kept for API compatibility but not used (we fetch all entity images)
pub async fn create_image_feed_event(
    entity_type: &str,
    entity_id: &str,
    _media_blob_id: &str, // kept for API compatibility; we fetch all images for the entity
    user_id: &str,
    username: &str,
) -> GrimoireResponse<FeedEventResult> {
    if should_skip_feed_event(user_id).await {
        return GrimoireResponse::success(
            "skipped feed event for service account",
            FeedEventResult::Skipped,
        );
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    // gather entity data based on type
    struct ImageEventData {
        feed_type: String,
        song_id: Option<String>,
        album_id: Option<String>,
        artist_id: Option<String>,
        playlist_id: Option<String>,
        title: String,
        subtitle: Option<String>,
        artist_name: Option<String>,
        album_title: Option<String>,
        year: Option<i64>,
        song_count: Option<i64>,
        total_duration_ms: Option<i64>,
        genres_json: String,
    }

    let data = match entity_type {
        "song" => {
            let row = sqlx::query!(
                r#"
                SELECT 
                    s.title,
                    s.duration,
                    (SELECT art.name FROM artist_songz asa JOIN artistz art ON art.id = asa.artist_id WHERE asa.song_id = s.id LIMIT 1) as "artist_name?: String",
                    (SELECT alb.title FROM album_songz als JOIN albumz alb ON alb.id = als.album_id WHERE als.song_id = s.id LIMIT 1) as "album_title?: String",
                    (SELECT COALESCE(json_group_array(json_object('id', g.id, 'name', g.name)), '[]') 
                     FROM album_songz als2 
                     JOIN album_genrez ag ON ag.album_id = als2.album_id 
                     JOIN genrez g ON g.id = ag.genre_id 
                     WHERE als2.song_id = s.id) as "genres_json!: String"
                FROM songz s WHERE s.id = ?
                "#,
                entity_id
            )
            .fetch_optional(&pool)
            .await;

            match row {
                Ok(Some(d)) => ImageEventData {
                    feed_type: FeedEventType::NewImageSong.to_string(),
                    song_id: Some(entity_id.to_string()),
                    album_id: None,
                    artist_id: None,
                    playlist_id: None,
                    title: d.title,
                    subtitle: d.artist_name.clone(),
                    artist_name: d.artist_name,
                    album_title: d.album_title,
                    year: None,
                    song_count: Some(1),
                    total_duration_ms: d.duration.map(|d| d * 1000), // duration is in seconds, convert to ms
                    genres_json: d.genres_json,
                },
                _ => return GrimoireResponse::failure("song not found", vec![]),
            }
        }
        "album" => {
            let row = sqlx::query!(
                r#"
                SELECT 
                    a.title,
                    CAST(SUBSTR(a.release_date, 1, 4) AS INTEGER) as "year?: i64",
                    (SELECT art.name FROM artist_albumz aa JOIN artistz art ON art.id = aa.artist_id WHERE aa.album_id = a.id LIMIT 1) as "artist_name?: String",
                    (SELECT COUNT(*) FROM album_songz WHERE album_id = a.id) as "song_count!: i64",
                    (SELECT COALESCE(SUM(s.duration), 0) * 1000 FROM album_songz als JOIN songz s ON s.id = als.song_id WHERE als.album_id = a.id) as "total_duration_ms!: i64",
                    (SELECT COALESCE(json_group_array(json_object('id', g.id, 'name', g.name)), '[]') FROM album_genrez ag JOIN genrez g ON g.id = ag.genre_id WHERE ag.album_id = a.id) as "genres_json!: String"
                FROM albumz a WHERE a.id = ?
                "#,
                entity_id
            )
            .fetch_optional(&pool)
            .await;

            match row {
                Ok(Some(d)) => ImageEventData {
                    feed_type: FeedEventType::NewImageAlbum.to_string(),
                    song_id: None,
                    album_id: Some(entity_id.to_string()),
                    artist_id: None,
                    playlist_id: None,
                    title: d.title,
                    subtitle: d.artist_name.clone(),
                    artist_name: d.artist_name,
                    album_title: None,
                    year: d.year,
                    song_count: Some(d.song_count),
                    total_duration_ms: Some(d.total_duration_ms),
                    genres_json: d.genres_json,
                },
                _ => return GrimoireResponse::failure("album not found", vec![]),
            }
        }
        "artist" => {
            let row = sqlx::query!(
                r#"
                SELECT 
                    name,
                    (SELECT COUNT(*) FROM artist_albumz WHERE artist_id = artistz.id) as "album_count!: i64"
                FROM artistz WHERE id = ?
                "#,
                entity_id
            )
            .fetch_optional(&pool)
            .await;

            match row {
                Ok(Some(d)) => ImageEventData {
                    feed_type: FeedEventType::NewImageArtist.to_string(),
                    song_id: None,
                    album_id: None,
                    artist_id: Some(entity_id.to_string()),
                    playlist_id: None,
                    title: d.name.clone(),
                    subtitle: Some(format!("{} albums", d.album_count)),
                    artist_name: Some(d.name),
                    album_title: None,
                    year: None,
                    song_count: None,
                    total_duration_ms: None,
                    genres_json: "[]".to_string(),
                },
                _ => return GrimoireResponse::failure("artist not found", vec![]),
            }
        }
        "playlist" => {
            let row = sqlx::query!(
                r#"
                SELECT 
                    title, 
                    description,
                    (SELECT COUNT(*) FROM playlist_songz WHERE playlist_id = playlistz.id) as "song_count!: i64",
                    (SELECT COALESCE(SUM(s.duration), 0) * 1000 FROM playlist_songz ps JOIN songz s ON s.id = ps.song_id WHERE ps.playlist_id = playlistz.id) as "total_duration_ms!: i64"
                FROM playlistz WHERE id = ?
                "#,
                entity_id
            )
            .fetch_optional(&pool)
            .await;

            match row {
                Ok(Some(d)) => ImageEventData {
                    feed_type: FeedEventType::NewImagePlaylist.to_string(),
                    song_id: None,
                    album_id: None,
                    artist_id: None,
                    playlist_id: Some(entity_id.to_string()),
                    title: d.title,
                    subtitle: d.description,
                    artist_name: None,
                    album_title: None,
                    year: None,
                    song_count: Some(d.song_count),
                    total_duration_ms: Some(d.total_duration_ms),
                    genres_json: "[]".to_string(),
                },
                _ => return GrimoireResponse::failure("playlist not found", vec![]),
            }
        }
        _ => return GrimoireResponse::failure("invalid entity type for image", vec![]),
    };

    // gather ALL current images for this entity (including the one just added)
    // this creates a carousel-friendly feed event showing all images
    let images_json = match entity_type {
        "song" => {
            sqlx::query_scalar!(
                r#"SELECT COALESCE(json_group_array(json_object('blob_id', si.media_blob_id, 'is_primary', si.is_primary, 'blob_type', mb.blob_type)), '[]')
                   FROM song_imagez si JOIN media_blobz mb ON si.media_blob_id = mb.id
                   WHERE si.song_id = ? AND mb.blob_type NOT IN ('waveform')"#,
                entity_id
            )
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|_| "[]".to_string())
        }
        "album" => {
            sqlx::query_scalar!(
                r#"SELECT COALESCE(json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type)), '[]')
                   FROM album_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id
                   WHERE ai.album_id = ? AND mb.blob_type NOT IN ('waveform')"#,
                entity_id
            )
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|_| "[]".to_string())
        }
        "artist" => {
            sqlx::query_scalar!(
                r#"SELECT COALESCE(json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type)), '[]')
                   FROM artist_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id
                   WHERE ai.artist_id = ? AND mb.blob_type NOT IN ('waveform')"#,
                entity_id
            )
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|_| "[]".to_string())
        }
        "playlist" => {
            sqlx::query_scalar!(
                r#"SELECT COALESCE(json_group_array(json_object('blob_id', pi.media_blob_id, 'is_primary', pi.is_primary, 'blob_type', mb.blob_type)), '[]')
                   FROM playlist_imagez pi JOIN media_blobz mb ON pi.media_blob_id = mb.id
                   WHERE pi.playlist_id = ? AND mb.blob_type NOT IN ('waveform')"#,
                entity_id
            )
            .fetch_one(&pool)
            .await
            .unwrap_or_else(|_| "[]".to_string())
        }
        _ => "[]".to_string(),
    };

    // count images from the JSON array
    let image_count: i64 = serde_json::from_str::<Vec<serde_json::Value>>(&images_json)
        .map(|arr| arr.len() as i64)
        .unwrap_or(0);

    // check for existing image feed event for this entity+user combination
    // this allows multiple image additions to aggregate into one carousel feed event
    let existing_id = match entity_type {
        "album" => {
            sqlx::query_scalar!(
                r#"SELECT id FROM feed_eventz WHERE feed_type = 'new_image_album' AND album_id = ? AND created_by_user_id = ?"#,
                entity_id,
                user_id
            )
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten()
        }
        "artist" => {
            sqlx::query_scalar!(
                r#"SELECT id FROM feed_eventz WHERE feed_type = 'new_image_artist' AND artist_id = ? AND created_by_user_id = ?"#,
                entity_id,
                user_id
            )
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten()
        }
        "playlist" => {
            sqlx::query_scalar!(
                r#"SELECT id FROM feed_eventz WHERE feed_type = 'new_image_playlist' AND playlist_id = ? AND created_by_user_id = ?"#,
                entity_id,
                user_id
            )
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten()
        }
        "song" => {
            sqlx::query_scalar!(
                r#"SELECT id FROM feed_eventz WHERE feed_type = 'new_image_song' AND song_id = ? AND created_by_user_id = ?"#,
                entity_id,
                user_id
            )
            .fetch_optional(&pool)
            .await
            .ok()
            .flatten()
        }
        _ => None,
    };

    // if exists, update; otherwise insert
    // note: double Some because query_scalar! with fetch_optional returns Option<Option<String>>
    if let Some(Some(id)) = existing_id {
        // update existing event with refreshed images and metadata
        match sqlx::query!(
            r#"UPDATE feed_eventz SET 
                images = ?, 
                image_count = ?,
                year = ?,
                song_count = ?,
                total_duration_ms = ?,
                genres = ?,
                updated_at = unixepoch(), 
                updated_by_user_id = ?, 
                updated_by_username = ? 
               WHERE id = ?"#,
            images_json,
            image_count,
            data.year,
            data.song_count,
            data.total_duration_ms,
            data.genres_json,
            user_id,
            username,
            id
        )
        .execute(&pool)
        .await
        {
            Ok(_) => GrimoireResponse::success(
                "image feed event updated",
                FeedEventResult::Created(id), // reuse Created variant for updated
            ),
            Err(e) => {
                GrimoireResponse::failure("failed to update image feed event", vec![e.into()])
            }
        }
    } else {
        // insert new event
        match sqlx::query_scalar!(
            r#"
            INSERT INTO feed_eventz (
                feed_type, song_id, album_id, artist_id, playlist_id,
                created_by_user_id, created_by_username,
                title, subtitle, artist_name, album_title, images,
                image_count, year, song_count, total_duration_ms, genres
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id
            "#,
            data.feed_type,
            data.song_id,
            data.album_id,
            data.artist_id,
            data.playlist_id,
            user_id,
            username,
            data.title,
            data.subtitle,
            data.artist_name,
            data.album_title,
            images_json,
            image_count,
            data.year,
            data.song_count,
            data.total_duration_ms,
            data.genres_json
        )
        .fetch_one(&pool)
        .await
        {
            Ok(id) => GrimoireResponse::success(
                "image feed event created",
                FeedEventResult::Created(id.expect("insert should return id")),
            ),
            Err(e) => {
                GrimoireResponse::failure("failed to create image feed event", vec![e.into()])
            }
        }
    }
}

// ============================================================================
// feed event maintenance (for entity reassignment)
// ============================================================================

/// result of feed event reassignment operation
#[derive(Debug, Clone)]
pub enum FeedEventReassignResult {
    /// feed event was moved from old entity to new entity
    Moved,
    /// feed event was deleted (user already has event for new entity)
    Deleted,
    /// no feed event existed for this user+entity
    NoneExisted,
    /// operation skipped (service account or missing user)
    Skipped,
}

/// handle feed events when an album is reassigned and the old album becomes orphaned.
///
/// this function:
/// 1. if acting_user has a feed event for old_album but NOT for new_album: moves it
/// 2. if acting_user has feed events for BOTH: deletes the old one
/// 3. deletes any other users' feed events for the orphaned old_album
///
/// call this AFTER delete_album_if_unused returns true (album was soft-deleted).
pub async fn handle_album_feed_reassignment(
    old_album_id: &str,
    new_album_id: &str,
    acting_user_id: Option<&str>,
) -> GrimoireResponse<FeedEventReassignResult> {
    let Some(user_id) = acting_user_id else {
        // no user context - just delete all feed events for the orphaned album
        let _ = delete_feed_events_for_album(old_album_id).await;
        return GrimoireResponse::success(
            "no acting user, deleted orphan feed events",
            FeedEventReassignResult::Skipped,
        );
    };

    if should_skip_feed_event(user_id).await {
        let _ = delete_feed_events_for_album(old_album_id).await;
        return GrimoireResponse::success(
            "service account, deleted orphan feed events",
            FeedEventReassignResult::Skipped,
        );
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    // check if acting user has a feed event for the old album
    let old_event_id = sqlx::query_scalar!(
        r#"SELECT id FROM feed_eventz 
           WHERE feed_type = 'album' AND album_id = ? AND created_by_user_id = ?"#,
        old_album_id,
        user_id
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    let result = if let Some(old_id) = old_event_id {
        // user has an event for the old album - check if they also have one for the new album
        let new_event_exists = sqlx::query_scalar!(
            r#"SELECT id FROM feed_eventz 
               WHERE feed_type = 'album' AND album_id = ? AND created_by_user_id = ?"#,
            new_album_id,
            user_id
        )
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten()
        .is_some();

        if new_event_exists {
            // user already has event for new album - delete the orphaned one
            let _ = sqlx::query!("DELETE FROM feed_eventz WHERE id = ?", old_id)
                .execute(&pool)
                .await;

            tracing::debug!(
                "deleted orphaned album feed event: old_album={}, user={} (user has event for new album)",
                old_album_id,
                user_id
            );
            FeedEventReassignResult::Deleted
        } else {
            // user has no event for new album - move the old one
            // also need to refresh the denormalized data for the new album
            let album_data = sqlx::query!(
                r#"
                SELECT 
                    a.title,
                    a.song_count,
                    a.total_duration,
                    CAST(SUBSTR(a.release_date, 1, 4) AS INTEGER) as "year: i64",
                    (SELECT art.name FROM artist_albumz aa JOIN artistz art ON art.id = aa.artist_id WHERE aa.album_id = a.id LIMIT 1) as artist_name,
                    (SELECT art.id FROM artist_albumz aa JOIN artistz art ON art.id = aa.artist_id WHERE aa.album_id = a.id LIMIT 1) as artist_id,
                    COALESCE((SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
                     FROM album_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id
                     WHERE ai.album_id = a.id AND mb.blob_type NOT IN ('waveform') AND ai.is_primary = 1), '[]') as "images!: String",
                    COALESCE((SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
                     FROM album_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id
                     WHERE ai.album_id = a.id AND mb.blob_type NOT IN ('waveform') AND ai.is_primary = 0), '[]') as "extra_images!: String",
                    COALESCE((SELECT json_group_array(json_object('id', g.id, 'name', g.name))
                     FROM album_genrez ag JOIN genrez g ON g.id = ag.genre_id WHERE ag.album_id = a.id), '[]') as "genres!: String",
                    COALESCE((SELECT json_group_array(json_object('id', t.id, 'name', t.name))
                     FROM album_tagz at JOIN tagz t ON t.id = at.tag_id WHERE at.album_id = a.id), '[]') as "tags!: String",
                    COALESCE((SELECT json_group_array(s.id) FROM album_songz als JOIN songz s ON s.id = als.song_id WHERE als.album_id = a.id ORDER BY s.disc_number, s.track_number), '[]') as "song_ids!: String",
                    COALESCE((SELECT json_group_array(json_object('id', eu.id, 'name', eu.name, 'url', eu.url))
                     FROM entity_urlz eu WHERE eu.entity_type = 'album' AND eu.entity_id = a.id), '[]') as "urls!: String"
                FROM albumz a
                WHERE a.id = ?
                "#,
                new_album_id
            )
            .fetch_optional(&pool)
            .await;

            match album_data {
                Ok(Some(album)) => {
                    let _ = sqlx::query!(
                        r#"UPDATE feed_eventz SET
                            album_id = ?,
                            artist_id = ?,
                            title = ?,
                            subtitle = ?,
                            artist_name = ?,
                            song_count = ?,
                            total_duration_ms = ?,
                            year = ?,
                            images = ?,
                            extra_images = ?,
                            genres = ?,
                            tags = ?,
                            song_ids = ?,
                            urls = ?,
                            updated_at = unixepoch()
                        WHERE id = ?"#,
                        new_album_id,
                        album.artist_id,
                        album.title,
                        album.artist_name,
                        album.artist_name,
                        album.song_count,
                        album.total_duration,
                        album.year,
                        album.images,
                        album.extra_images,
                        album.genres,
                        album.tags,
                        album.song_ids,
                        album.urls,
                        old_id
                    )
                    .execute(&pool)
                    .await;

                    tracing::debug!(
                        "moved album feed event: {} -> {}, user={}",
                        old_album_id,
                        new_album_id,
                        user_id
                    );
                    FeedEventReassignResult::Moved
                }
                _ => {
                    // new album not found? just delete the old event
                    let _ = sqlx::query!("DELETE FROM feed_eventz WHERE id = ?", old_id)
                        .execute(&pool)
                        .await;
                    FeedEventReassignResult::Deleted
                }
            }
        }
    } else {
        FeedEventReassignResult::NoneExisted
    };

    // delete any remaining feed events for the orphaned album (from other users)
    let _ = sqlx::query!(
        "DELETE FROM feed_eventz WHERE feed_type = 'album' AND album_id = ?",
        old_album_id
    )
    .execute(&pool)
    .await;

    GrimoireResponse::success("album feed event reassignment handled", result)
}

/// handle feed events when an artist is reassigned and the old artist becomes orphaned.
/// similar logic to handle_album_feed_reassignment.
pub async fn handle_artist_feed_reassignment(
    old_artist_id: &str,
    new_artist_id: &str,
    acting_user_id: Option<&str>,
) -> GrimoireResponse<FeedEventReassignResult> {
    let Some(user_id) = acting_user_id else {
        let _ = delete_feed_events_for_artist(old_artist_id).await;
        return GrimoireResponse::success(
            "no acting user, deleted orphan feed events",
            FeedEventReassignResult::Skipped,
        );
    };

    if should_skip_feed_event(user_id).await {
        let _ = delete_feed_events_for_artist(old_artist_id).await;
        return GrimoireResponse::success(
            "service account, deleted orphan feed events",
            FeedEventReassignResult::Skipped,
        );
    }

    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    // check if acting user has a feed event for the old artist
    let old_event_id = sqlx::query_scalar!(
        r#"SELECT id FROM feed_eventz 
           WHERE feed_type = 'artist' AND artist_id = ? AND created_by_user_id = ?"#,
        old_artist_id,
        user_id
    )
    .fetch_optional(&pool)
    .await
    .ok()
    .flatten();

    let result = if let Some(old_id) = old_event_id {
        let new_event_exists = sqlx::query_scalar!(
            r#"SELECT id FROM feed_eventz 
               WHERE feed_type = 'artist' AND artist_id = ? AND created_by_user_id = ?"#,
            new_artist_id,
            user_id
        )
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten()
        .is_some();

        if new_event_exists {
            let _ = sqlx::query!("DELETE FROM feed_eventz WHERE id = ?", old_id)
                .execute(&pool)
                .await;

            tracing::debug!(
                "deleted orphaned artist feed event: old_artist={}, user={}",
                old_artist_id,
                user_id
            );
            FeedEventReassignResult::Deleted
        } else {
            // move the feed event to new artist - refresh denormalized data
            let artist_data = sqlx::query!(
                r#"
                SELECT 
                    a.name as title,
                    (SELECT COUNT(*) FROM artist_albumz WHERE artist_id = a.id) as "album_count!: i64",
                    COALESCE((SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
                     FROM artist_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id
                     WHERE ai.artist_id = a.id AND mb.blob_type NOT IN ('waveform') AND ai.is_primary = 1), '[]') as "images!: String",
                    COALESCE((SELECT json_group_array(json_object('blob_id', ai.media_blob_id, 'is_primary', ai.is_primary, 'blob_type', mb.blob_type))
                     FROM artist_imagez ai JOIN media_blobz mb ON ai.media_blob_id = mb.id
                     WHERE ai.artist_id = a.id AND mb.blob_type NOT IN ('waveform') AND ai.is_primary = 0), '[]') as "extra_images!: String",
                    COALESCE((SELECT json_group_array(json_object('id', eu.id, 'name', eu.name, 'url', eu.url))
                     FROM entity_urlz eu WHERE eu.entity_type = 'artist' AND eu.entity_id = a.id), '[]') as "urls!: String"
                FROM artistz a
                WHERE a.id = ?
                "#,
                new_artist_id
            )
            .fetch_optional(&pool)
            .await;

            match artist_data {
                Ok(Some(artist)) => {
                    let subtitle = format!("{} albums", artist.album_count);
                    let _ = sqlx::query!(
                        r#"UPDATE feed_eventz SET
                            artist_id = ?,
                            title = ?,
                            subtitle = ?,
                            artist_name = ?,
                            images = ?,
                            extra_images = ?,
                            urls = ?,
                            updated_at = unixepoch()
                        WHERE id = ?"#,
                        new_artist_id,
                        artist.title,
                        subtitle,
                        artist.title,
                        artist.images,
                        artist.extra_images,
                        artist.urls,
                        old_id
                    )
                    .execute(&pool)
                    .await;

                    tracing::debug!(
                        "moved artist feed event: {} -> {}, user={}",
                        old_artist_id,
                        new_artist_id,
                        user_id
                    );
                    FeedEventReassignResult::Moved
                }
                _ => {
                    let _ = sqlx::query!("DELETE FROM feed_eventz WHERE id = ?", old_id)
                        .execute(&pool)
                        .await;
                    FeedEventReassignResult::Deleted
                }
            }
        }
    } else {
        FeedEventReassignResult::NoneExisted
    };

    // delete any remaining feed events for the orphaned artist
    let _ = sqlx::query!(
        "DELETE FROM feed_eventz WHERE feed_type = 'artist' AND artist_id = ?",
        old_artist_id
    )
    .execute(&pool)
    .await;

    GrimoireResponse::success("artist feed event reassignment handled", result)
}

/// delete all feed events for an album (used when album is orphaned)
pub async fn delete_feed_events_for_album(album_id: &str) -> GrimoireResponse<u64> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    match sqlx::query!("DELETE FROM feed_eventz WHERE album_id = ?", album_id)
        .execute(&pool)
        .await
    {
        Ok(r) => GrimoireResponse::success(
            &format!("deleted {} feed events for album", r.rows_affected()),
            r.rows_affected(),
        ),
        Err(e) => GrimoireResponse::failure("failed to delete feed events", vec![e.into()]),
    }
}

/// delete all feed events for an artist (used when artist is orphaned)
pub async fn delete_feed_events_for_artist(artist_id: &str) -> GrimoireResponse<u64> {
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("failed to connect to database", vec![e.into()])
        }
    };

    match sqlx::query!("DELETE FROM feed_eventz WHERE artist_id = ?", artist_id)
        .execute(&pool)
        .await
    {
        Ok(r) => GrimoireResponse::success(
            &format!("deleted {} feed events for artist", r.rows_affected()),
            r.rows_affected(),
        ),
        Err(e) => GrimoireResponse::failure("failed to delete feed events", vec![e.into()]),
    }
}
