//! Playlist query system with sea-query integration and position-based ordering

use sea_query::{Cond, Expr, Iden, Order, Query, SelectStatement, SqliteQueryBuilder};
use std::time::Instant;

use crate::database;
use crate::music::crud::models::{
    PlaylistQueryResult, PlaylistSongResult, QueryParams, QueryResult, SongQueryResult,
};
use crate::music::entities::{Album, Artist, Song};
use crate::music::Playlist;
use crate::GrimoireResponse;

// Playlist table identifiers for type-safe queries
#[derive(Iden)]
enum PlaylistView {
    #[iden = "playlist_query_view"]
    Table,
    #[iden = "playlist_id"]
    PlaylistId,
    #[iden = "playlist_title"]
    PlaylistTitle,
    #[iden = "playlist_description"]
    PlaylistDescription,
    #[iden = "playlist_is_public"]
    PlaylistIsPublic,
    #[iden = "playlist_created_by_id"]
    PlaylistCreatedById,
    #[iden = "playlist_created_at"]
    PlaylistCreatedAt,
    #[iden = "playlist_updated_at"]
    PlaylistUpdatedAt,
    #[iden = "playlist_deleted_at"]
    PlaylistDeletedAt,
    #[iden = "playlist_images"]
    PlaylistImages,
    #[iden = "playlist_song_count"]
    PlaylistSongCount,
    #[iden = "playlist_total_duration"]
    PlaylistTotalDuration,
    #[iden = "favorite_id"]
    FavoriteId,
    #[iden = "favorite_user_id"]
    FavoriteUserId,
    #[iden = "favorited_at"]
    FavoritedAt,
}

// Playlist songs view for position-ordered songs
#[derive(Iden)]
enum PlaylistSongView {
    #[iden = "playlist_song_query_view"]
    Table,
    #[iden = "position"]
    Position,
    #[iden = "added_at"]
    AddedAt,
    #[iden = "song_title"]
    SongTitle,
    #[iden = "artist_name"]
    ArtistName,
    #[iden = "album_title"]
    AlbumTitle,
}

// Common column identifiers for filter conditions
#[derive(Iden)]
enum PlaylistColumns {
    #[iden = "playlist_id"]
    PlaylistId,
    #[iden = "created_by_id"]
    CreatedById,
}

// Row structures for playlist queries
#[derive(sqlx::FromRow)]
pub struct PlaylistViewRow {
    playlist_id: String,
    playlist_title: String,
    playlist_description: Option<String>,
    playlist_is_public: i64,
    playlist_images: Option<String>, // JSON array from view
    playlist_created_by_id: Option<String>,
    playlist_created_at: i64,
    playlist_updated_at: i64,
    playlist_deleted_at: Option<i64>,
    playlist_song_count: i64,
    playlist_total_duration: i64,
    // user favorites
    #[allow(dead_code)]
    favorite_id: Option<String>,
    favorite_user_id: Option<String>,
    #[allow(dead_code)]
    favorited_at: Option<i64>,
}

impl PlaylistViewRow {
    pub fn to_playlist_query_result(self, user_id: Option<&str>) -> PlaylistQueryResult {
        // parse images JSON array
        let images = self.playlist_images.and_then(|json_str| {
            serde_json::from_str::<Vec<crate::music::crud::ImageMetadata>>(&json_str).ok()
        })
        .map(crate::JsonVec); // wrap in JsonVec if present

        let playlist = Playlist {
            id: self.playlist_id,
            title: self.playlist_title,
            description: self.playlist_description,
            is_public: self.playlist_is_public,
            images,
            created_by_id: self.playlist_created_by_id,
            created_at: self.playlist_created_at,
            updated_at: self.playlist_updated_at,
            deleted_at: self.playlist_deleted_at,
            deleted_by: None,
            created_by: None,
            updated_by: None,
            song_count: self.playlist_song_count,
        };

        // determine favorite status based on user_id match
        let is_favorite = if let Some(uid) = user_id {
            Some(self.favorite_user_id.as_ref() == Some(&uid.to_string()))
        } else {
            None
        };

        PlaylistQueryResult {
            playlist,
            song_count: self.playlist_song_count,
            total_duration: Some(self.playlist_total_duration),
            is_favorite,
        }
    }
}

// Row structure for playlist songs with position ordering
#[derive(sqlx::FromRow)]
pub struct PlaylistSongViewRow {
    // Playlist song relationship fields
    position: i64,
    added_at: i64,

    // Full song data (same as SongViewRow but from playlist context)
    song_id: String,
    song_media_blob_id: String,
    song_images: Option<String>, // JSON array from view
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

    // Artist fields
    artist_id: Option<String>,
    artist_name: Option<String>,
    artist_bio: Option<String>,
    artist_created_at: Option<i64>,
    artist_updated_at: Option<i64>,
    artist_deleted_at: Option<i64>,
    artist_deleted_by: Option<String>,
    artist_created_by: Option<String>,
    artist_updated_by: Option<String>,
    artist_images: Option<String>, // JSON array from view
    artist_total_song_count: Option<i64>,
    artist_total_album_count: Option<i64>,
    artist_total_duration: Option<i64>,

    // Album fields
    album_id: Option<String>,
    album_title: Option<String>,
    album_album_type: Option<String>,
    album_release_date: Option<String>,
    album_release_date_precision: Option<String>,
    album_label: Option<String>,
    album_song_count: Option<i64>,
    album_total_duration: Option<i64>,
    album_created_at: Option<i64>,
    album_updated_at: Option<i64>,
    album_deleted_at: Option<i64>,
    album_deleted_by: Option<String>,
    album_created_by: Option<String>,
    album_updated_by: Option<String>,
    album_genres: Option<String>,    // JSON array from view
    album_genre_ids: Option<String>, // JSON array from view
    album_images: Option<String>,    // JSON array from view
    album_tags: Option<String>,      // JSON array of tag names from view

    // User favorites and ratings
    #[allow(dead_code)] // used by sqlx for deserialization
    favorite_id: Option<String>,
    favorite_user_id: Option<String>,
    favorited_at: Option<i64>,
    rating_user_id: Option<String>,
    user_rating: Option<i64>,
    rating_created_at: Option<i64>,
}

impl PlaylistSongViewRow {
    pub fn to_playlist_song_result(self, user_id: Option<&str>) -> PlaylistSongResult {
        let position = self.position;
        let added_at = self.added_at;

        // parse images JSON array
        let images = self.song_images.and_then(|json_str| {
            serde_json::from_str::<Vec<crate::music::crud::ImageMetadata>>(&json_str).ok()
        })
        .or(Some(vec![])); // default to empty vec

        // parse album tags JSON array
        let album_tags = self
            .album_tags
            .and_then(|json_str| serde_json::from_str::<Vec<String>>(&json_str).ok())
            .or(Some(vec![])); // default to empty vec

        // parse album genres JSON array
        let album_genres = self
            .album_genres
            .and_then(|json_str| serde_json::from_str::<Vec<String>>(&json_str).ok())
            .map(crate::JsonVec);

        // parse album genre_ids JSON array
        let album_genre_ids = self
            .album_genre_ids
            .and_then(|json_str| serde_json::from_str::<Vec<String>>(&json_str).ok())
            .map(crate::JsonVec);

        // parse artist images JSON array
        let artist_images = self
            .artist_images
            .and_then(|json_str| serde_json::from_str::<Vec<crate::music::crud::ImageMetadata>>(&json_str).ok())
            .map(crate::JsonVec);

        // parse album images JSON array
        let album_images = self
            .album_images
            .and_then(|json_str| serde_json::from_str::<Vec<crate::music::crud::ImageMetadata>>(&json_str).ok())
            .map(crate::JsonVec);

        let song = Song {
            id: self.song_id,
            media_blob_id: self.song_media_blob_id,
            images: images.clone().map(crate::JsonVec),
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
                bio: self.artist_bio,
                created_at: self.artist_created_at.unwrap_or(0),
                updated_at: self.artist_updated_at.unwrap_or(0),
                deleted_at: self.artist_deleted_at,
                deleted_by: self.artist_deleted_by,
                created_by: self.artist_created_by,
                updated_by: self.artist_updated_by,
                images: artist_images,
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
                genres: album_genres,
                genre_ids: album_genre_ids,
                images: album_images,
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

        // determine user context fields based on user_id match
        let (is_favorite, rating, favorited_at, rating_created_at): (
            Option<bool>,
            Option<i32>,
            Option<i64>,
            Option<i64>,
        ) = if let Some(uid) = user_id {
            let is_fav = self.favorite_user_id.as_ref() == Some(&uid.to_string());
            let fav_at = if is_fav { self.favorited_at } else { None };
            let user_rating = if self.rating_user_id.as_ref() == Some(&uid.to_string()) {
                self.user_rating.map(|r| r as i32)
            } else {
                None
            };
            let rating_at = if user_rating.is_some() {
                self.rating_created_at
            } else {
                None
            };
            (Some(is_fav), user_rating, fav_at, rating_at)
        } else {
            (None, None, None, None)
        };

        let song_result = SongQueryResult {
            song,
            artist,
            album,
            genre: None,
            media_blob: None,
            images,
            relevance_score: None,
            snippet: None,
            is_favorite,
            rating,
            favorited_at,
            rating_created_at,
            artist_total_song_count: self.artist_total_song_count,
            artist_total_album_count: self.artist_total_album_count,
            artist_total_duration: self.artist_total_duration,
            album_is_favorite: None,
            album_rating: None,
            album_tags,
        };

        PlaylistSongResult {
            details: song_result,
            position,
            added_at,
        }
    }
}

// Shared filter logic for playlists
fn add_playlist_filters(query: &mut SelectStatement, params: &QueryParams) {
    // Search in playlist title and description
    if let Some(search_term) = params.q.as_ref().filter(|s| !s.trim().is_empty()) {
        let pattern = format!("%{}%", search_term);
        query.cond_where(
            Cond::any()
                .add(Expr::col(PlaylistView::PlaylistTitle).like(pattern.clone()))
                .add(Expr::col(PlaylistView::PlaylistDescription).like(pattern)),
        );
    }

    // Filter by creator
    if let Some(created_by) = params.filters.get("created_by_id").and_then(|v| v.as_i64()) {
        query.and_where(Expr::col(PlaylistColumns::CreatedById).eq(created_by));
    }

    // Filter by public/private
    if let Some(is_public_value) = params.filters.get("is_public") {
        let is_public = match is_public_value {
            serde_json::Value::Bool(b) => Some(*b),
            serde_json::Value::String(s) => match s.as_str() {
                "true" => Some(true),
                "false" => Some(false),
                _ => None,
            },
            _ => None,
        };

        if let Some(public_flag) = is_public {
            query.and_where(
                Expr::col(PlaylistView::PlaylistIsPublic).eq(if public_flag { 1 } else { 0 }),
            );
        }
    }
}

// Main playlist query function
pub async fn query_playlists(
    params: QueryParams,
) -> GrimoireResponse<QueryResult<PlaylistQueryResult>> {
    let start_time = Instant::now();
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };
    let limit = params.limit.unwrap_or(50).min(1000);
    let offset = params.offset.unwrap_or(0);

    let mut query = Query::select();
    query
        .column(PlaylistView::PlaylistId)
        .column(PlaylistView::PlaylistTitle)
        .column(PlaylistView::PlaylistDescription)
        .column(PlaylistView::PlaylistIsPublic)
        .column(PlaylistView::PlaylistImages)
        .column(PlaylistView::PlaylistCreatedById)
        .column(PlaylistView::PlaylistCreatedAt)
        .column(PlaylistView::PlaylistUpdatedAt)
        .column(PlaylistView::PlaylistDeletedAt)
        .column(PlaylistView::PlaylistSongCount)
        .column(PlaylistView::PlaylistTotalDuration)
        .column(PlaylistView::FavoriteId)
        .column(PlaylistView::FavoriteUserId)
        .column(PlaylistView::FavoritedAt)
        .from(PlaylistView::Table);

    add_playlist_filters(&mut query, &params);

    let sort_direction = match params.sort_direction.as_deref() {
        Some("desc") => Order::Desc,
        _ => Order::Asc,
    };

    match params.sort_by.as_deref() {
        Some("title") => {
            query.order_by(PlaylistView::PlaylistTitle, sort_direction);
        }
        Some("created_at") => {
            query.order_by(PlaylistView::PlaylistCreatedAt, sort_direction);
        }
        Some("updated_at") => {
            query.order_by(PlaylistView::PlaylistUpdatedAt, sort_direction);
        }
        Some("song_count") => {
            query.order_by(PlaylistView::PlaylistSongCount, sort_direction);
        }
        Some("duration") => {
            query.order_by(PlaylistView::PlaylistTotalDuration, sort_direction);
        }
        _ => {
            query.order_by(PlaylistView::PlaylistUpdatedAt, Order::Desc);
        }
    }

    query.limit(limit as u64).offset(offset as u64);

    let (sql, values) = query.build(SqliteQueryBuilder);

    let mut sqlx_query = sqlx::query_as::<_, PlaylistViewRow>(&sql);
    for value in values.0 {
        match value {
            sea_query::Value::String(Some(s)) => {
                sqlx_query = sqlx_query.bind(s.as_ref().to_string());
            }
            sea_query::Value::Int(Some(i)) => {
                sqlx_query = sqlx_query.bind(i);
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

    let rows: Vec<PlaylistViewRow> = match sqlx_query.fetch_all(&pool).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("Failed to fetch playlists from database: {:?}", e);
            return GrimoireResponse::failure(
                &format!("Failed to query playlists: {}", e),
                vec![e.into()],
            );
        }
    };

    let user_id_ref = params.user_id.as_deref();
    let playlists: Vec<PlaylistQueryResult> = rows
        .into_iter()
        .map(|row| row.to_playlist_query_result(user_id_ref))
        .collect();
    let playlist_count = playlists.len();

    GrimoireResponse::success(
        "Playlists queried successfully",
        QueryResult {
            items: playlists,
            total_count: playlist_count as i64,
            has_more: playlist_count == limit as usize,
            limit: limit as i64,
            offset: offset as i64,
            query_time_ms: Some(start_time.elapsed().as_millis() as u64),
        },
    )
}

// Query songs within a playlist (position-ordered, NOT disc/track ordered)
/// query playlist songs with full metadata
pub async fn query_playlist_songs(
    playlist_id: &str,
    params: QueryParams,
) -> GrimoireResponse<QueryResult<PlaylistSongResult>> {
    let start_time = Instant::now();
    let pool = match database::connect().await {
        Ok(p) => p,
        Err(e) => {
            return GrimoireResponse::failure("Failed to connect to database", vec![e.into()])
        }
    };
    let limit = params.limit.unwrap_or(50).min(1000);
    let offset = params.offset.unwrap_or(0);

    let mut query = Query::select();
    query
        .column(sea_query::Asterisk)
        .from(PlaylistSongView::Table);

    // Filter by playlist ID
    query.and_where(Expr::col(PlaylistColumns::PlaylistId).eq(playlist_id));

    // Optional search within playlist songs
    if let Some(search_term) = params.q.as_ref().filter(|s| !s.trim().is_empty()) {
        let pattern = format!("%{}%", search_term);
        query.cond_where(
            Cond::any()
                .add(Expr::col(PlaylistSongView::SongTitle).like(pattern.clone()))
                .add(Expr::col(PlaylistSongView::ArtistName).like(pattern.clone()))
                .add(Expr::col(PlaylistSongView::AlbumTitle).like(pattern)),
        );
    }

    // Playlist ordering: ALWAYS by position (not disc/track like albums)
    let sort_direction = match params.sort_direction.as_deref() {
        Some("desc") => Order::Desc,
        _ => Order::Asc,
    };

    match params.sort_by.as_deref() {
        Some("added_at") => {
            query.order_by(PlaylistSongView::AddedAt, sort_direction);
        }
        Some("title") => {
            query.order_by(PlaylistSongView::SongTitle, sort_direction);
        }
        Some("artist") => {
            query.order_by(PlaylistSongView::ArtistName, sort_direction);
        }
        _ => {
            // Default: respect playlist position (user's intended order)
            query.order_by(PlaylistSongView::Position, Order::Asc);
        }
    }

    query.limit(limit as u64).offset(offset as u64);

    let (sql, values) = query.build(SqliteQueryBuilder);

    let mut sqlx_query = sqlx::query_as::<_, PlaylistSongViewRow>(&sql);
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

    let rows = match sqlx_query.fetch_all(&pool).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("query_playlist_songs fetch error: {}", e);
            return GrimoireResponse::failure("Failed to query playlist songs", vec![e.into()])
        }
    };

    let user_id_ref = params.user_id.as_ref().map(|uid| uid.as_str());
    let songs: Vec<PlaylistSongResult> = rows
        .into_iter()
        .map(|r| r.to_playlist_song_result(user_id_ref))
        .collect();
    let song_count = songs.len();

    GrimoireResponse::success(
        "Playlist songs queried successfully",
        QueryResult {
            items: songs,
            total_count: song_count as i64,
            has_more: song_count == limit as usize,
            limit: limit as i64,
            offset: offset as i64,
            query_time_ms: Some(start_time.elapsed().as_millis() as u64),
        },
    )
}

// Legacy compatibility functions (temporary)
pub async fn list_user_playlists(
    created_by_id: String,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResponse<QueryResult<PlaylistQueryResult>> {
    let mut filters = std::collections::HashMap::new();
    filters.insert(
        "created_by_id".to_string(),
        serde_json::Value::String(created_by_id),
    );

    let params = QueryParams {
        q: None,
        search_fields: None,
        filters,
        sort_by: Some("updated_at".to_string()),
        sort_direction: Some("desc".to_string()),
        limit,
        offset,
        user_id: None,
        favorites_only: None,
        min_rating: None,
    };
    query_playlists(params).await
}

pub async fn search_playlists(
    q: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResponse<QueryResult<PlaylistQueryResult>> {
    let params = QueryParams {
        q: Some(q.to_string()),
        search_fields: None,
        filters: std::collections::HashMap::new(),
        sort_by: Some("updated_at".to_string()),
        sort_direction: Some("desc".to_string()),
        limit,
        offset,
        user_id: None,
        favorites_only: None,
        min_rating: None,
    };
    query_playlists(params).await
}
