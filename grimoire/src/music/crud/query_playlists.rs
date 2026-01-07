//! Playlist query system with sea-query integration and position-based ordering

use sea_query::{Cond, Expr, Iden, Order, Query, SelectStatement, SqliteQueryBuilder};
use std::time::Instant;

use crate::database;
use crate::error::GrimoireResult;
use crate::music::crud::models::{PlaylistQueryResult, QueryParams, QueryResult, SongQueryResult};
use crate::music::entities::{Album, Artist, Song};
use crate::music::Playlist;

// Playlist table identifiers for type-safe queries
#[derive(Iden)]
enum PlaylistView {
    #[iden = "playlist_query_view"]
    Table,
    #[iden = "playlist_title"]
    PlaylistTitle,
    #[iden = "playlist_description"]
    PlaylistDescription,
    #[iden = "playlist_created_at"]
    PlaylistCreatedAt,
    #[iden = "playlist_updated_at"]
    PlaylistUpdatedAt,
    #[iden = "playlist_song_count"]
    PlaylistSongCount,
    #[iden = "playlist_total_duration"]
    PlaylistTotalDuration,
    #[iden = "playlist_is_public"]
    PlaylistIsPublic,
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
    #[iden = "created_by_rowid"]
    CreatedByRowid,
}

// Row structures for playlist queries
#[derive(sqlx::FromRow)]
pub struct PlaylistViewRow {
    playlist_rowid: i64,
    playlist_id: String,
    playlist_title: String,
    playlist_description: Option<String>,
    playlist_is_public: i64,
    playlist_thumbnail_blob_id: Option<String>,
    playlist_created_by_rowid: Option<i64>,
    playlist_created_at: i64,
    playlist_updated_at: i64,
    playlist_deleted_at: Option<i64>,
    playlist_song_count: i64,
    playlist_total_duration: i64,
}

impl PlaylistViewRow {
    pub fn to_playlist_query_result(self) -> PlaylistQueryResult {
        let playlist = Playlist {
            rowid: self.playlist_rowid,
            id: self.playlist_id,
            title: self.playlist_title,
            description: self.playlist_description,
            is_public: self.playlist_is_public,
            thumbnail_blob_id: self.playlist_thumbnail_blob_id,
            created_by_rowid: self.playlist_created_by_rowid,
            created_at: self.playlist_created_at,
            updated_at: self.playlist_updated_at,
            deleted_at: self.playlist_deleted_at,
            deleted_by: None,
            created_by: None,
            updated_by: None,
        };

        PlaylistQueryResult {
            playlist,
            song_count: self.playlist_song_count,
            total_duration: Some(self.playlist_total_duration),
            is_favorite: None,
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
    song_rowid: i64,
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

    // Artist fields
    artist_rowid: Option<i64>,
    artist_id: Option<String>,
    artist_name: Option<String>,
    artist_created_at: Option<i64>,
    artist_updated_at: Option<i64>,
    artist_deleted_at: Option<i64>,
    artist_deleted_by: Option<String>,
    artist_created_by: Option<String>,
    artist_updated_by: Option<String>,

    // Album fields
    album_rowid: Option<i64>,
    album_id: Option<String>,
    album_title: Option<String>,
    album_album_type: Option<String>,
    album_release_date: Option<String>,
    album_release_date_precision: Option<String>,
    album_label: Option<String>,
    album_genre_rowid: Option<i64>,
    album_song_count: Option<i64>,
    album_total_duration: Option<i64>,
    album_created_at: Option<i64>,
    album_updated_at: Option<i64>,
    album_deleted_at: Option<i64>,
    album_deleted_by: Option<String>,
    album_created_by: Option<String>,
    album_updated_by: Option<String>,
}

impl PlaylistSongViewRow {
    pub fn to_song_query_result(self) -> SongQueryResult {
        let song = Song {
            rowid: self.song_rowid,
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

        let artist = if let Some(artist_rowid) = self.artist_rowid {
            Some(Artist {
                rowid: artist_rowid,
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

        let album = if let Some(album_rowid) = self.album_rowid {
            Some(Album {
                rowid: album_rowid,
                id: self.album_id.unwrap_or_default(),
                title: self.album_title.unwrap_or_default(),
                album_type: self.album_album_type.unwrap_or_else(|| "album".to_string()),
                release_date: self.album_release_date,
                release_date_precision: self.album_release_date_precision,
                label: self.album_label,
                genre_rowid: self.album_genre_rowid,
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

        SongQueryResult {
            song,
            artist,
            album,
            genre: None,
            media_blob: None,
            relevance_score: None,
            snippet: None,
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
    if let Some(created_by) = params
        .filters
        .get("created_by_rowid")
        .and_then(|v| v.as_i64())
    {
        query.and_where(Expr::col(PlaylistColumns::CreatedByRowid).eq(created_by));
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
) -> GrimoireResult<QueryResult<PlaylistQueryResult>> {
    let start_time = Instant::now();
    let pool = database::connect().await?;
    let limit = params.limit.unwrap_or(50).min(1000);
    let offset = params.offset.unwrap_or(0);

    let mut query = Query::select();
    query.column(sea_query::Asterisk).from(PlaylistView::Table);

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

    let rows = sqlx_query.fetch_all(&pool).await?;

    let playlists: Vec<PlaylistQueryResult> = rows
        .into_iter()
        .map(|r| r.to_playlist_query_result())
        .collect();
    let playlist_count = playlists.len();

    Ok(QueryResult {
        items: playlists,
        total_count: playlist_count as i64,
        has_more: playlist_count == limit as usize,
        limit: limit as i64,
        offset: offset as i64,
        query_time_ms: Some(start_time.elapsed().as_millis() as u64),
    })
}

// Query songs within a playlist (position-ordered, NOT disc/track ordered)
pub async fn query_playlist_songs(
    playlist_id: &str,
    params: QueryParams,
) -> GrimoireResult<QueryResult<SongQueryResult>> {
    let start_time = Instant::now();
    let pool = database::connect().await?;
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

    let rows = sqlx_query.fetch_all(&pool).await?;

    let songs: Vec<SongQueryResult> = rows.into_iter().map(|r| r.to_song_query_result()).collect();
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

// Legacy compatibility functions (temporary)
pub async fn list_user_playlists(
    created_by_rowid: i64,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<QueryResult<PlaylistQueryResult>> {
    let mut filters = std::collections::HashMap::new();
    filters.insert(
        "created_by_rowid".to_string(),
        serde_json::Value::Number(serde_json::Number::from(created_by_rowid)),
    );

    let params = QueryParams {
        q: None,
        search_fields: None,
        filters,
        sort_by: Some("updated_at".to_string()),
        sort_direction: Some("desc".to_string()),
        limit,
        offset,
    };
    query_playlists(params).await
}

pub async fn search_playlists(
    q: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<QueryResult<PlaylistQueryResult>> {
    let params = QueryParams {
        q: Some(q.to_string()),
        search_fields: None,
        filters: std::collections::HashMap::new(),
        sort_by: Some("updated_at".to_string()),
        sort_direction: Some("desc".to_string()),
        limit,
        offset,
    };
    query_playlists(params).await
}
