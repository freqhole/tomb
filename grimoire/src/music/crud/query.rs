//! Unified query system with shared filters for songs, albums, artists, genres

use sea_query::{Alias, Cond, Expr, Iden, Order, Query, SelectStatement, SqliteQueryBuilder};
use std::time::Instant;

use crate::database;
use crate::error::GrimoireResult;
use crate::music::crud::models::{
    AlbumQueryResult, ArtistQueryResult, GenreQueryResult, QueryParams, QueryResult,
    SongQueryResult,
};
use crate::music::entities::{Album, Artist, Song};
use crate::music::Genre;

// Table identifiers for type-safe queries
#[derive(Iden)]
enum SongView {
    #[iden = "song_query_view"]
    Table,
    #[iden = "song_id"]
    SongId,
    #[iden = "song_title"]
    SongTitle,
    #[iden = "artist_name"]
    ArtistName,
    #[iden = "album_title"]
    AlbumTitle,
    #[iden = "album_release_date"]
    AlbumReleaseDate,
    #[iden = "album_created_at"]
    AlbumCreatedAt,
    #[iden = "album_total_duration"]
    AlbumTotalDuration,
    #[iden = "album_song_count"]
    AlbumSongCount,
    #[iden = "artist_total_song_count"]
    ArtistTotalSongCount,
    #[iden = "artist_total_duration"]
    ArtistTotalDuration,
    #[iden = "song_disc_number"]
    SongDiscNumber,
    #[iden = "song_track_number"]
    SongTrackNumber,
    #[iden = "favorite_user_id"]
    FavoriteUserId,
    #[iden = "rating_user_id"]
    RatingUserId,
    #[iden = "user_rating"]
    UserRating,
}

#[derive(Iden)]
enum AlbumView {
    #[iden = "album_query_view"]
    Table,
    #[iden = "album_title"]
    AlbumTitle,
    #[iden = "artist_name"]
    ArtistName,
    #[iden = "album_created_at"]
    AlbumCreatedAt,
    #[iden = "album_release_date"]
    AlbumReleaseDate,
    #[iden = "album_total_duration"]
    AlbumTotalDuration,
    #[iden = "album_song_count"]
    AlbumSongCount,
}

#[derive(Iden)]
enum ArtistView {
    #[iden = "artist_query_view"]
    Table,
    #[iden = "artist_name"]
    ArtistName,
    #[iden = "artist_created_at"]
    ArtistCreatedAt,
    #[iden = "song_count"]
    SongCount,
    #[iden = "album_count"]
    AlbumCount,
    #[iden = "total_duration"]
    TotalDuration,
}

#[derive(Iden)]
enum GenreView {
    #[iden = "genre_query_view"]
    Table,
    #[iden = "genre_name"]
    GenreName,
    #[iden = "genre_created_at"]
    GenreCreatedAt,
}

#[derive(Iden)]
enum UserFavoritez {
    Table,
    #[iden = "id"]
    Id,
    #[iden = "user_id"]
    UserId,
    #[iden = "target_type"]
    TargetType,
    #[iden = "target_id"]
    TargetId,
}

#[derive(Iden)]
enum UserRatingz {
    Table,
    #[iden = "user_id"]
    UserId,
    #[iden = "target_type"]
    TargetType,
    #[iden = "target_id"]
    TargetId,
    #[iden = "rating"]
    Rating,
}

#[derive(Iden)]
enum CommonColumns {
    #[iden = "artist_id"]
    ArtistId,
    #[iden = "album_id"]
    AlbumId,
    #[iden = "album_genre_id"]
    AlbumGenreId,
}

// Row structures
#[derive(sqlx::FromRow)]
pub struct SongViewRow {
    song_id: String,
    song_media_blob_id: String,
    song_thumbnail_blob_id: Option<String>,
    song_waveform_blob_id: Option<String>,
    song_title: String,
    song_track_number: i64,
    song_disc_number: i64,
    song_duration: Option<i64>,
    song_year: Option<i64>,
    song_bpm: Option<i64>,
    song_key_signature: Option<String>,
    song_metadata: Option<String>,
    song_lyrics: Option<String>,
    song_processing_status: Option<String>,
    song_processing_notes: Option<String>,
    song_created_at: i64,
    song_updated_at: i64,
    song_deleted_at: Option<i64>,
    song_deleted_by: Option<String>,
    song_created_by: Option<String>,
    song_updated_by: Option<String>,
    artist_id: Option<String>,
    artist_name: Option<String>,
    artist_created_at: Option<i64>,
    artist_updated_at: Option<i64>,
    artist_deleted_at: Option<i64>,
    artist_deleted_by: Option<String>,
    artist_created_by: Option<String>,
    artist_updated_by: Option<String>,
    artist_total_song_count: Option<i64>,
    artist_total_album_count: Option<i64>,
    artist_total_duration: Option<i64>,
    album_id: Option<String>,
    album_title: Option<String>,
    album_album_type: Option<String>,
    album_release_date: Option<String>,
    album_release_date_precision: Option<String>,
    album_label: Option<String>,
    album_genre_id: Option<String>,
    album_song_count: Option<i64>,
    album_total_duration: Option<i64>,
    album_created_at: Option<i64>,
    album_updated_at: Option<i64>,
    album_deleted_at: Option<i64>,
    album_deleted_by: Option<String>,
    album_created_by: Option<String>,
    album_updated_by: Option<String>,
    // User context fields from view joins
    favorite_id: Option<String>,
    favorite_user_id: Option<String>,
    favorited_at: Option<i64>,
    rating_user_id: Option<String>,
    user_rating: Option<i32>,
    rating_created_at: Option<i64>,
}

impl SongViewRow {
    pub fn to_song_query_result(self, user_id: Option<&str>) -> SongQueryResult {
        let song = Song {
            id: self.song_id,
            media_blob_id: self.song_media_blob_id,
            thumbnail_blob_id: self.song_thumbnail_blob_id,
            waveform_blob_id: self.song_waveform_blob_id,
            title: self.song_title,
            track_number: self.song_track_number,
            disc_number: self.song_disc_number,
            duration: self.song_duration,
            year: self.song_year,
            bpm: self.song_bpm,
            key_signature: self.song_key_signature,
            metadata: self.song_metadata,
            lyrics: self.song_lyrics,
            processing_status: self.song_processing_status,
            processing_notes: self.song_processing_notes,
            created_at: self.song_created_at,
            updated_at: self.song_updated_at,
            deleted_at: self.song_deleted_at,
            deleted_by: self.song_deleted_by,
            created_by: self.song_created_by,
            updated_by: self.song_updated_by,
        };

        let artist = if self.artist_id.is_some() {
            Some(Artist {
                id: self.artist_id.unwrap_or_default(),
                name: self.artist_name.unwrap_or_default(),
                created_at: self.artist_created_at.unwrap_or(0),
                updated_at: self.artist_updated_at.unwrap_or(0),
                deleted_at: self.artist_deleted_at,
                deleted_by: self.artist_deleted_by,
                created_by: self.artist_created_by,
                updated_by: self.artist_updated_by,
            })
        } else {
            None
        };

        let album = if self.album_id.is_some() {
            Some(Album {
                id: self.album_id.unwrap_or_default(),
                title: self.album_title.unwrap_or_default(),
                album_type: self.album_album_type.unwrap_or_else(|| "album".to_string()),
                release_date: self.album_release_date,
                release_date_precision: self.album_release_date_precision,
                label: self.album_label,
                genre_id: self.album_genre_id,
                song_count: self.album_song_count.unwrap_or(0),
                total_duration: self.album_total_duration.unwrap_or(0),
                created_at: self.album_created_at.unwrap_or(0),
                updated_at: self.album_updated_at.unwrap_or(0),
                deleted_at: self.album_deleted_at,
                deleted_by: self.album_deleted_by,
                created_by: self.album_created_by,
                updated_by: self.album_updated_by,
            })
        } else {
            None
        };

        // Determine user context fields based on user_id match
        let (is_favorite, rating) = if let Some(uid) = user_id {
            let is_fav = self.favorite_user_id.as_ref() == Some(&uid.to_string());
            let user_rating = if self.rating_user_id.as_ref() == Some(&uid.to_string()) {
                self.user_rating
            } else {
                None
            };
            (Some(is_fav), user_rating)
        } else {
            (None, None)
        };

        SongQueryResult {
            song,
            artist,
            album,
            genre: None,
            media_blob: None,
            relevance_score: None,
            snippet: None,
            is_favorite,
            rating,
        }
    }
}

// Row structures for other views
#[derive(sqlx::FromRow)]
pub struct ArtistViewRow {
    artist_id: String,
    artist_name: String,
    artist_created_at: i64,
    artist_updated_at: i64,
    artist_deleted_at: Option<i64>,
    artist_deleted_by: Option<String>,
    artist_created_by: Option<String>,
    artist_updated_by: Option<String>,
    song_count: i64,
    album_count: i64,
    total_duration: i64,
    // User context fields from view joins
    favorite_id: Option<String>,
    favorite_user_id: Option<String>,
    favorited_at: Option<i64>,
    rating_user_id: Option<String>,
    user_rating: Option<i32>,
    rating_created_at: Option<i64>,
}

impl ArtistViewRow {
    pub fn to_artist_query_result(self, user_id: Option<&str>) -> ArtistQueryResult {
        let artist = Artist {
            id: self.artist_id,
            name: self.artist_name,
            created_at: self.artist_created_at,
            updated_at: self.artist_updated_at,
            deleted_at: self.artist_deleted_at,
            deleted_by: self.artist_deleted_by,
            created_by: self.artist_created_by,
            updated_by: self.artist_updated_by,
        };

        // Determine user context fields based on user_id match
        let (is_favorite, rating) = if let Some(uid) = user_id {
            let is_fav = self.favorite_user_id.as_ref() == Some(&uid.to_string());
            let user_rating = if self.rating_user_id.as_ref() == Some(&uid.to_string()) {
                self.user_rating
            } else {
                None
            };
            (Some(is_fav), user_rating)
        } else {
            (None, None)
        };

        ArtistQueryResult {
            artist,
            song_count: self.song_count,
            album_count: self.album_count,
            total_duration: Some(self.total_duration),
            is_favorite,
            rating,
        }
    }
}

#[derive(sqlx::FromRow)]
pub struct AlbumViewRow {
    album_id: String,
    album_title: String,
    album_album_type: Option<String>,
    album_release_date: Option<String>,
    album_release_date_precision: Option<String>,
    album_label: Option<String>,
    album_genre_id: Option<String>,
    album_song_count: Option<i64>,
    album_total_duration: Option<i64>,
    album_created_at: i64,
    album_updated_at: i64,
    album_deleted_at: Option<i64>,
    album_deleted_by: Option<String>,
    album_created_by: Option<String>,
    album_updated_by: Option<String>,
    artist_id: Option<String>,
    artist_name: Option<String>,
    artist_created_at: Option<i64>,
    artist_updated_at: Option<i64>,
    // User context fields from view joins
    favorite_id: Option<String>,
    favorite_user_id: Option<String>,
    favorited_at: Option<i64>,
    rating_user_id: Option<String>,
    user_rating: Option<i32>,
    rating_created_at: Option<i64>,
}

impl AlbumViewRow {
    pub fn to_album_query_result(self, user_id: Option<&str>) -> AlbumQueryResult {
        let album = Album {
            id: self.album_id,
            title: self.album_title,
            album_type: self.album_album_type.unwrap_or_default(),
            release_date: self.album_release_date,
            release_date_precision: self.album_release_date_precision,
            label: self.album_label,
            genre_id: self.album_genre_id,
            song_count: self.album_song_count.unwrap_or(0),
            total_duration: self.album_total_duration.unwrap_or(0),
            created_at: self.album_created_at,
            updated_at: self.album_updated_at,
            deleted_at: self.album_deleted_at,
            deleted_by: self.album_deleted_by,
            created_by: self.album_created_by,
            updated_by: self.album_updated_by,
        };

        let artist = if self.artist_id.is_some() {
            Some(Artist {
                id: self.artist_id.unwrap_or_default(),
                name: self.artist_name.unwrap_or_default(),
                created_at: self.artist_created_at.unwrap_or(0),
                updated_at: self.artist_updated_at.unwrap_or(0),
                deleted_at: None,
                deleted_by: None,
                created_by: None,
                updated_by: None,
            })
        } else {
            None
        };

        // Determine user context fields based on user_id match
        let (is_favorite, rating) = if let Some(uid) = user_id {
            let is_fav = self.favorite_user_id.as_ref() == Some(&uid.to_string());
            let user_rating = if self.rating_user_id.as_ref() == Some(&uid.to_string()) {
                self.user_rating
            } else {
                None
            };
            (Some(is_fav), user_rating)
        } else {
            (None, None)
        };

        AlbumQueryResult {
            album,
            artist,
            genre: None,
            is_favorite,
            rating,
        }
    }
}

#[derive(sqlx::FromRow)]
pub struct GenreViewRow {
    genre_id: String,
    genre_name: String,
    genre_created_at: i64,
    // User context fields from view joins (no ratings for genres)
    favorite_id: Option<String>,
    favorite_user_id: Option<String>,
    favorited_at: Option<i64>,
}

impl GenreViewRow {
    pub fn to_genre_query_result(self, user_id: Option<&str>) -> GenreQueryResult {
        let genre = Genre {
            id: self.genre_id,
            name: self.genre_name,
            created_at: self.genre_created_at,
        };

        // Determine favorite status based on user_id match
        let is_favorite = if let Some(uid) = user_id {
            Some(self.favorite_user_id.as_ref() == Some(&uid.to_string()))
        } else {
            None
        };

        GenreQueryResult {
            genre,
            song_count: None,
            album_count: None,
            is_favorite,
        }
    }
}

// Shared filter logic
fn add_global_filters(
    query: &mut SelectStatement,
    params: &QueryParams,
    song_col: impl Iden + 'static,
    artist_col: impl Iden + 'static,
    album_col: impl Iden + 'static,
) {
    // Search across multiple fields
    if let Some(search_term) = params.q.as_ref().filter(|s| !s.trim().is_empty()) {
        let pattern = format!("%{}%", search_term);
        query.cond_where(
            Cond::any()
                .add(Expr::col(song_col).like(pattern.clone()))
                .add(Expr::col(artist_col).like(pattern.clone()))
                .add(Expr::col(album_col).like(pattern)),
        );
    }

    // Handle ID filters (using proper column names from the view)
    if let Some(artist_id) = params.filters.get("artist_id").and_then(|v| v.as_str()) {
        query.and_where(Expr::col(CommonColumns::ArtistId).eq(artist_id));
    }

    if let Some(album_id) = params.filters.get("album_id").and_then(|v| v.as_str()) {
        query.and_where(Expr::col(CommonColumns::AlbumId).eq(album_id));
    }

    if let Some(genre_id) = params.filters.get("genre_id").and_then(|v| v.as_str()) {
        query.and_where(Expr::col(CommonColumns::AlbumGenreId).eq(genre_id));
    }

    // TODO: Add other global filters
    // if let Some(tags) = params.filters.get("tags") { ... }
    // if let Some(favorites) = params.filters.get("favorites") { ... }
    // if let Some(min_rating) = params.filters.get("min_rating") { ... }
}

// Main query functions
pub async fn query_songs(params: QueryParams) -> GrimoireResult<QueryResult<SongQueryResult>> {
    let start_time = Instant::now();
    let pool = database::connect().await?;
    let limit = params.limit.unwrap_or(50).min(1000);
    let offset = params.offset.unwrap_or(0);

    let mut query = Query::select();
    query.from(SongView::Table);

    // All user fields are now included in the view, just select everything
    query.column(sea_query::Asterisk);

    // Apply user filters if user context provided
    if let Some(ref user_id) = params.user_id {
        if let Some(true) = params.favorites_only {
            query.and_where(Expr::col((SongView::Table, SongView::FavoriteUserId)).eq(user_id));
        }
        if let Some(min_rating) = params.min_rating {
            query
                .and_where(Expr::col((SongView::Table, SongView::RatingUserId)).eq(user_id))
                .and_where(Expr::col((SongView::Table, SongView::UserRating)).gte(min_rating));
        }
    }

    add_global_filters(
        &mut query,
        &params,
        SongView::SongTitle,
        SongView::ArtistName,
        SongView::AlbumTitle,
    );

    // Song-specific ordering (always preserve album grouping)
    let sort_direction = match params.sort_direction.as_deref() {
        Some("desc") => Order::Desc,
        _ => Order::Asc,
    };

    match params.sort_by.as_deref() {
        Some("title") => {
            query.order_by(SongView::AlbumTitle, sort_direction);
        }
        Some("year") => {
            query.order_by(SongView::AlbumReleaseDate, sort_direction);
            query.order_by(SongView::AlbumTitle, Order::Asc);
        }
        Some("artist") => {
            query.order_by(SongView::ArtistName, sort_direction);
            query.order_by(SongView::AlbumTitle, Order::Asc);
        }
        _ => {
            query.order_by(SongView::AlbumCreatedAt, Order::Desc);
            query.order_by(SongView::AlbumTitle, Order::Asc);
        }
    }

    // Always preserve track order within albums
    query
        .order_by(SongView::SongDiscNumber, Order::Asc)
        .order_by(SongView::SongTrackNumber, Order::Asc);

    query.limit(limit as u64).offset(offset as u64);

    let (sql, values) = query.build(SqliteQueryBuilder);

    let mut sqlx_query = sqlx::query_as::<_, SongViewRow>(&sql);
    for value in values.0 {
        match value {
            sea_query::Value::String(Some(s)) => {
                sqlx_query = sqlx_query.bind(s.to_string());
            }
            sea_query::Value::Int(Some(i)) => {
                sqlx_query = sqlx_query.bind(i);
            }
            sea_query::Value::BigUnsigned(Some(u)) => {
                sqlx_query = sqlx_query.bind(u as i64);
            }
            _ => {
                return Err(crate::error::GrimoireError::Database(
                    sqlx::Error::Protocol("Unsupported parameter type in query".to_string()),
                ));
            }
        }
    }

    let rows = sqlx_query.fetch_all(&pool).await?;

    let user_id_ref = params.user_id.as_ref().map(|uid| uid.as_str());
    let songs: Vec<SongQueryResult> = rows
        .into_iter()
        .map(|r| r.to_song_query_result(user_id_ref))
        .collect();
    let song_count = songs.len();

    Ok(QueryResult {
        items: songs,
        total_count: song_count as i64,
        has_more: song_count == limit as usize,
        limit: limit as i64,
        offset: offset as i64,
        query_time_ms: Some(start_time.elapsed().as_millis() as u64),
    })
}

pub async fn query_albums(params: QueryParams) -> GrimoireResult<QueryResult<AlbumQueryResult>> {
    let start_time = Instant::now();
    let pool = database::connect().await?;
    let limit = params.limit.unwrap_or(50).min(1000);
    let offset = params.offset.unwrap_or(0);

    let mut query = Query::select();
    query.column(sea_query::Asterisk).from(AlbumView::Table);

    add_global_filters(
        &mut query,
        &params,
        AlbumView::AlbumTitle,
        AlbumView::ArtistName,
        AlbumView::AlbumTitle,
    );

    let sort_direction = match params.sort_direction.as_deref() {
        Some("desc") => Order::Desc,
        _ => Order::Asc,
    };

    match params.sort_by.as_deref() {
        Some("title") => {
            query.order_by(AlbumView::AlbumTitle, sort_direction);
        }
        Some("artist") => {
            query.order_by(AlbumView::ArtistName, sort_direction);
        }
        Some("release_date") => {
            query.order_by(AlbumView::AlbumReleaseDate, sort_direction);
        }
        Some("duration") => {
            query.order_by(AlbumView::AlbumTotalDuration, sort_direction);
        }
        Some("song_count") => {
            query.order_by(AlbumView::AlbumSongCount, sort_direction);
        }
        _ => {
            query.order_by(AlbumView::AlbumCreatedAt, Order::Desc);
        }
    }

    query.limit(limit as u64).offset(offset as u64);

    let (sql, values) = query.build(SqliteQueryBuilder);

    let mut sqlx_query = sqlx::query_as::<_, AlbumViewRow>(&sql);
    for value in values.0 {
        match value {
            sea_query::Value::String(Some(s)) => {
                sqlx_query = sqlx_query.bind(s.as_ref().to_string());
            }
            sea_query::Value::BigInt(Some(i)) => {
                sqlx_query = sqlx_query.bind(i);
            }
            sea_query::Value::BigUnsigned(Some(i)) => {
                sqlx_query = sqlx_query.bind(i as i64);
            }
            _ => {}
        }
    }

    let rows = sqlx_query.fetch_all(&pool).await?;

    let user_id_ref = params.user_id.as_ref().map(|uid| uid.as_str());
    let albums: Vec<AlbumQueryResult> = rows
        .into_iter()
        .map(|r| r.to_album_query_result(user_id_ref))
        .collect();
    let album_count = albums.len();

    Ok(QueryResult {
        items: albums,
        total_count: album_count as i64,
        has_more: album_count == limit as usize,
        limit: limit as i64,
        offset: offset as i64,
        query_time_ms: Some(start_time.elapsed().as_millis() as u64),
    })
}

pub async fn query_artists(params: QueryParams) -> GrimoireResult<QueryResult<ArtistQueryResult>> {
    let start_time = Instant::now();
    let pool = database::connect().await?;
    let limit = params.limit.unwrap_or(50).min(1000);
    let offset = params.offset.unwrap_or(0);

    let mut query = Query::select();
    query.column(sea_query::Asterisk).from(ArtistView::Table);

    // Artist-specific search filter
    if let Some(search_term) = params.q.as_ref().filter(|s| !s.trim().is_empty()) {
        let pattern = format!("%{}%", search_term);
        query.cond_where(Expr::col(ArtistView::ArtistName).like(pattern));
    }

    // Handle starts_with filter for artists
    if let Some(starts_with) = params.filters.get("starts_with").and_then(|v| v.as_str()) {
        if starts_with == "#" {
            // Non-alphabetic characters
            query.and_where(Expr::cust(
                "SUBSTR(UPPER(artist_name), 1, 1) NOT BETWEEN 'A' AND 'Z'",
            ));
        } else {
            // Artists starting with specific letter
            let starts_pattern = format!("{}%", starts_with.to_uppercase());
            query.and_where(Expr::col(ArtistView::ArtistName).like(starts_pattern));
        }
    }

    let sort_direction = match params.sort_direction.as_deref() {
        Some("desc") => Order::Desc,
        _ => Order::Asc,
    };

    match params.sort_by.as_deref() {
        Some("name") => {
            query.order_by(ArtistView::ArtistName, sort_direction);
        }
        Some("song_count") => {
            query.order_by(ArtistView::SongCount, sort_direction);
        }
        Some("album_count") => {
            query.order_by(ArtistView::AlbumCount, sort_direction);
        }
        Some("duration") => {
            query.order_by(ArtistView::TotalDuration, sort_direction);
        }
        _ => {
            query.order_by(ArtistView::ArtistName, Order::Asc);
        }
    }

    query.limit(limit as u64).offset(offset as u64);

    let (sql, values) = query.build(SqliteQueryBuilder);

    let mut sqlx_query = sqlx::query_as::<_, ArtistViewRow>(&sql);
    for value in values.0 {
        match value {
            sea_query::Value::String(Some(s)) => {
                sqlx_query = sqlx_query.bind(s.as_ref().to_string());
            }
            sea_query::Value::BigInt(Some(i)) => {
                sqlx_query = sqlx_query.bind(i);
            }
            sea_query::Value::BigUnsigned(Some(i)) => {
                sqlx_query = sqlx_query.bind(i as i64);
            }
            _ => {}
        }
    }

    let rows = sqlx_query.fetch_all(&pool).await?;

    let user_id_ref = params.user_id.as_ref().map(|uid| uid.as_str());
    let artists: Vec<ArtistQueryResult> = rows
        .into_iter()
        .map(|r| r.to_artist_query_result(user_id_ref))
        .collect();
    let artist_count = artists.len();

    Ok(QueryResult {
        items: artists,
        total_count: artist_count as i64,
        has_more: artist_count == limit as usize,
        limit: limit as i64,
        offset: offset as i64,
        query_time_ms: Some(start_time.elapsed().as_millis() as u64),
    })
}

pub async fn query_genres(params: QueryParams) -> GrimoireResult<QueryResult<GenreQueryResult>> {
    let start_time = Instant::now();
    let pool = database::connect().await?;
    let limit = params.limit.unwrap_or(50).min(1000);
    let offset = params.offset.unwrap_or(0);

    let mut query = Query::select();
    query.column(sea_query::Asterisk).from(GenreView::Table);

    // Genre-specific search filter
    if let Some(search_term) = params.q.as_ref().filter(|s| !s.trim().is_empty()) {
        let pattern = format!("%{}%", search_term);
        query.cond_where(Expr::col(GenreView::GenreName).like(pattern));
    }

    let sort_direction = match params.sort_direction.as_deref() {
        Some("desc") => Order::Desc,
        _ => Order::Asc,
    };

    match params.sort_by.as_deref() {
        Some("name") => {
            query.order_by(GenreView::GenreName, sort_direction);
        }
        _ => {
            query.order_by(GenreView::GenreName, Order::Asc);
        }
    }

    query.limit(limit as u64).offset(offset as u64);

    let (sql, values) = query.build(SqliteQueryBuilder);

    let mut sqlx_query = sqlx::query_as::<_, GenreViewRow>(&sql);
    for value in values.0 {
        match value {
            sea_query::Value::String(Some(s)) => {
                sqlx_query = sqlx_query.bind(s.as_ref().to_string());
            }
            sea_query::Value::BigInt(Some(i)) => {
                sqlx_query = sqlx_query.bind(i);
            }
            sea_query::Value::BigUnsigned(Some(i)) => {
                sqlx_query = sqlx_query.bind(i as i64);
            }
            _ => {}
        }
    }

    let rows = sqlx_query.fetch_all(&pool).await?;

    let user_id_ref = params.user_id.as_ref().map(|uid| uid.as_str());
    let genres: Vec<GenreQueryResult> = rows
        .into_iter()
        .map(|r| r.to_genre_query_result(user_id_ref))
        .collect();
    let genre_count = genres.len();

    Ok(QueryResult {
        items: genres,
        total_count: genre_count as i64,
        has_more: genre_count == limit as usize,
        limit: limit as i64,
        offset: offset as i64,
        query_time_ms: Some(start_time.elapsed().as_millis() as u64),
    })
}

// Legacy compatibility functions (temporary)
pub async fn list_recent_songs(limit: Option<u32>) -> GrimoireResult<QueryResult<SongQueryResult>> {
    let params = QueryParams {
        q: None,
        search_fields: None,
        filters: std::collections::HashMap::new(),
        sort_by: Some("created_at".to_string()),
        sort_direction: Some("desc".to_string()),
        limit,
        offset: Some(0),
        user_id: None,
        favorites_only: None,
        min_rating: None,
    };
    query_songs(params).await
}

pub async fn search_songs(
    q: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<QueryResult<SongQueryResult>> {
    let params = QueryParams {
        q: Some(q.to_string()),
        search_fields: None,
        filters: std::collections::HashMap::new(),
        sort_by: Some("created_at".to_string()),
        sort_direction: Some("desc".to_string()),
        limit,
        offset,
        user_id: None,
        favorites_only: None,
        min_rating: None,
    };
    query_songs(params).await
}

pub async fn list_songs_by_artist(
    artist_id: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<QueryResult<SongQueryResult>> {
    let mut filters = std::collections::HashMap::new();
    filters.insert(
        "artist_id".to_string(),
        serde_json::Value::String(artist_id.to_string()),
    );

    let params = QueryParams {
        q: None,
        search_fields: None,
        filters,
        sort_by: Some("album".to_string()),
        sort_direction: Some("asc".to_string()),
        limit,
        offset,
        user_id: None,
        favorites_only: None,
        min_rating: None,
    };
    query_songs(params).await
}

pub async fn list_songs_by_album(
    album_id: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<QueryResult<SongQueryResult>> {
    let mut filters = std::collections::HashMap::new();
    filters.insert(
        "album_id".to_string(),
        serde_json::Value::String(album_id.to_string()),
    );

    let params = QueryParams {
        q: None,
        search_fields: None,
        filters,
        sort_by: Some("track_number".to_string()),
        sort_direction: Some("asc".to_string()),
        limit,
        offset,
        user_id: None,
        favorites_only: None,
        min_rating: None,
    };
    query_songs(params).await
}

pub async fn list_songs_by_genre(
    genre_id: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<QueryResult<SongQueryResult>> {
    let mut filters = std::collections::HashMap::new();
    filters.insert(
        "genre_id".to_string(),
        serde_json::Value::String(genre_id.to_string()),
    );

    let params = QueryParams {
        q: None,
        search_fields: None,
        filters,
        sort_by: Some("album".to_string()),
        sort_direction: Some("asc".to_string()),
        limit,
        offset,
        user_id: None,
        favorites_only: None,
        min_rating: None,
    };
    query_songs(params).await
}

pub async fn list_albums_by_artist(
    artist_id: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<QueryResult<AlbumQueryResult>> {
    let mut filters = std::collections::HashMap::new();
    filters.insert(
        "artist_id".to_string(),
        serde_json::Value::String(artist_id.to_string()),
    );

    let params = QueryParams {
        q: None,
        search_fields: None,
        filters,
        sort_by: Some("release_date".to_string()),
        sort_direction: Some("desc".to_string()),
        limit,
        offset,
        user_id: None,
        favorites_only: None,
        min_rating: None,
    };
    query_albums(params).await
}
