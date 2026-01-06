//! Simplified query API using SQL views with proper track ordering
//! Uses sqlx::query_as! macros for compile-time safety and clean mapping

use std::time::Instant;

use crate::database;
use crate::error::GrimoireResult;
use crate::music::crud::models::{
    AlbumQueryResult, ArtistQueryResult, GenreQueryResult, QueryParams, QueryResult,
    SongQueryResult,
};
use crate::music::entities::{Album, Artist, Genre, Song};

/// Song query row from song_query_view - simple and clean!
#[derive(sqlx::FromRow)]
struct SongViewRow {
    // Song fields
    song_rowid: i64,
    song_id: String,
    song_media_blob_id: String,
    song_thumbnail_blob_id: Option<String>,
    song_waveform_blob_id: Option<String>,
    song_title: String,
    song_track_number: Option<i64>,
    song_disc_number: Option<i64>,
    song_duration: Option<i64>,
    song_year: Option<i64>,
    song_bpm: Option<i64>,
    song_key_signature: Option<String>,
    song_metadata: Option<String>,
    song_processing_status: Option<String>,
    song_processing_notes: Option<String>,
    song_created_at: i64,
    song_updated_at: i64,
    song_deleted_at: Option<i64>,
    song_deleted_by: Option<String>,
    song_created_by: Option<String>,
    song_updated_by: Option<String>,

    // Artist fields (optional)
    artist_rowid: Option<i64>,
    artist_id: Option<String>,
    artist_name: Option<String>,
    artist_created_at: Option<i64>,
    artist_updated_at: Option<i64>,
    artist_deleted_at: Option<i64>,
    artist_deleted_by: Option<String>,
    artist_created_by: Option<String>,
    artist_updated_by: Option<String>,

    // Album fields (optional)
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

impl SongViewRow {
    fn to_song_query_result(self) -> SongQueryResult {
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

#[derive(sqlx::FromRow)]
struct ArtistViewRow {
    artist_rowid: i64,
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
}

#[derive(sqlx::FromRow)]
struct AlbumViewRow {
    album_rowid: i64,
    album_id: String,
    album_title: String,
    album_album_type: Option<String>,
    album_release_date: Option<String>,
    album_release_date_precision: Option<String>,
    album_label: Option<String>,
    album_genre_rowid: Option<i64>,
    album_song_count: Option<i64>,
    album_total_duration: Option<i64>,
    album_created_at: i64,
    album_updated_at: i64,
    album_deleted_at: Option<i64>,
    album_deleted_by: Option<String>,
    album_created_by: Option<String>,
    album_updated_by: Option<String>,
    artist_rowid: Option<i64>,
    artist_id: Option<String>,
    artist_name: Option<String>,
    artist_created_at: Option<i64>,
    artist_updated_at: Option<i64>,
}

#[derive(sqlx::FromRow)]
struct GenreViewRow {
    genre_rowid: i64,
    genre_id: String,
    genre_name: String,
    genre_created_at: i64,
}

pub async fn query_songs(params: QueryParams) -> GrimoireResult<QueryResult<SongQueryResult>> {
    let start_time = Instant::now();
    let pool = database::connect().await?;
    let limit = params.limit.unwrap_or(50).min(1000) as i64;
    let offset = params.offset.unwrap_or(0) as i64;

    let search_pattern = params
        .q
        .as_ref()
        .filter(|q| !q.trim().is_empty())
        .map(|q| format!("%{}%", q));

    // Get count with search
    let total_count: i64 = if let Some(ref pattern) = search_pattern {
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM song_query_view
             WHERE (song_title LIKE ? OR artist_name LIKE ? OR album_title LIKE ?)",
            pattern,
            pattern,
            pattern
        )
        .fetch_one(&pool)
        .await?
    } else {
        sqlx::query_scalar!("SELECT COUNT(*) FROM song_query_view")
            .fetch_one(&pool)
            .await?
    };

    // Execute query based on sort preference - CRITICAL: always preserve album track ordering!
    let rows = if let Some(ref pattern) = search_pattern {
        // With search
        match (params.sort_by.as_deref(), params.sort_direction.as_deref()) {
            (Some("title"), Some("desc")) => {
                sqlx::query_as!(
                    SongViewRow,
                    r#"SELECT
                        song_rowid as "song_rowid!",
                        song_id as "song_id!",
                        song_media_blob_id as "song_media_blob_id!",
                        song_thumbnail_blob_id,
                        song_waveform_blob_id,
                        song_title as "song_title!",
                        song_track_number,
                        song_disc_number,
                        song_duration,
                        song_year,
                        song_bpm,
                        song_key_signature,
                        song_metadata,
                        song_processing_status,
                        song_processing_notes,
                        song_created_at as "song_created_at!",
                        song_updated_at as "song_updated_at!",
                        song_deleted_at,
                        song_deleted_by,
                        song_created_by,
                        song_updated_by,
                        artist_rowid,
                        artist_id,
                        artist_name,
                        artist_created_at,
                        artist_updated_at,
                        artist_deleted_at,
                        artist_deleted_by,
                        artist_created_by,
                        artist_updated_by,
                        album_rowid,
                        album_id,
                        album_title,
                        album_album_type,
                        album_release_date,
                        album_release_date_precision,
                        album_label,
                        album_genre_rowid,
                        album_song_count,
                        album_total_duration,
                        album_created_at,
                        album_updated_at,
                        album_deleted_at,
                        album_deleted_by,
                        album_created_by,
                        album_updated_by
                     FROM song_query_view
                     WHERE (song_title LIKE ? OR artist_name LIKE ? OR album_title LIKE ?)
                     ORDER BY song_title DESC, album_title ASC, song_disc_number ASC, song_track_number ASC
                     LIMIT ? OFFSET ?"#,
                    pattern, pattern, pattern, limit, offset
                ).fetch_all(&pool).await?
            },
            _ => {
                // Default search: by created_at DESC but preserve album ordering
                sqlx::query_as!(
                    SongViewRow,
                    r#"SELECT
                        song_rowid as "song_rowid!",
                        song_id as "song_id!",
                        song_media_blob_id as "song_media_blob_id!",
                        song_thumbnail_blob_id,
                        song_waveform_blob_id,
                        song_title as "song_title!",
                        song_track_number,
                        song_disc_number,
                        song_duration,
                        song_year,
                        song_bpm,
                        song_key_signature,
                        song_metadata,
                        song_processing_status,
                        song_processing_notes,
                        song_created_at as "song_created_at!",
                        song_updated_at as "song_updated_at!",
                        song_deleted_at,
                        song_deleted_by,
                        song_created_by,
                        song_updated_by,
                        artist_rowid,
                        artist_id,
                        artist_name,
                        artist_created_at,
                        artist_updated_at,
                        artist_deleted_at,
                        artist_deleted_by,
                        artist_created_by,
                        artist_updated_by,
                        album_rowid,
                        album_id,
                        album_title,
                        album_album_type,
                        album_release_date,
                        album_release_date_precision,
                        album_label,
                        album_genre_rowid,
                        album_song_count,
                        album_total_duration,
                        album_created_at,
                        album_updated_at,
                        album_deleted_at,
                        album_deleted_by,
                        album_created_by,
                        album_updated_by
                     FROM song_query_view
                     WHERE (song_title LIKE ? OR artist_name LIKE ? OR album_title LIKE ?)
                     ORDER BY song_created_at DESC, album_title ASC, song_disc_number ASC, song_track_number ASC
                     LIMIT ? OFFSET ?"#,
                    pattern, pattern, pattern, limit, offset
                ).fetch_all(&pool).await?
            }
        }
    } else {
        // Without search
        match (params.sort_by.as_deref(), params.sort_direction.as_deref()) {
            (Some("title"), Some("desc")) => {
                sqlx::query_as!(
                    SongViewRow,
                    r#"SELECT
                        song_rowid as "song_rowid!",
                        song_id as "song_id!",
                        song_media_blob_id as "song_media_blob_id!",
                        song_thumbnail_blob_id,
                        song_waveform_blob_id,
                        song_title as "song_title!",
                        song_track_number,
                        song_disc_number,
                        song_duration,
                        song_year,
                        song_bpm,
                        song_key_signature,
                        song_metadata,
                        song_processing_status,
                        song_processing_notes,
                        song_created_at as "song_created_at!",
                        song_updated_at as "song_updated_at!",
                        song_deleted_at,
                        song_deleted_by,
                        song_created_by,
                        song_updated_by,
                        artist_rowid,
                        artist_id,
                        artist_name,
                        artist_created_at,
                        artist_updated_at,
                        artist_deleted_at,
                        artist_deleted_by,
                        artist_created_by,
                        artist_updated_by,
                        album_rowid,
                        album_id,
                        album_title,
                        album_album_type,
                        album_release_date,
                        album_release_date_precision,
                        album_label,
                        album_genre_rowid,
                        album_song_count,
                        album_total_duration,
                        album_created_at,
                        album_updated_at,
                        album_deleted_at,
                        album_deleted_by,
                        album_created_by,
                        album_updated_by
                     FROM song_query_view
                     ORDER BY song_title DESC, album_title ASC, song_disc_number ASC, song_track_number ASC
                     LIMIT ? OFFSET ?"#,
                    limit, offset
                ).fetch_all(&pool).await?
            },
            _ => {
                // Default: by created_at DESC but preserve album ordering
                sqlx::query_as!(
                    SongViewRow,
                    r#"SELECT
                        song_rowid as "song_rowid!",
                        song_id as "song_id!",
                        song_media_blob_id as "song_media_blob_id!",
                        song_thumbnail_blob_id,
                        song_waveform_blob_id,
                        song_title as "song_title!",
                        song_track_number,
                        song_disc_number,
                        song_duration,
                        song_year,
                        song_bpm,
                        song_key_signature,
                        song_metadata,
                        song_processing_status,
                        song_processing_notes,
                        song_created_at as "song_created_at!",
                        song_updated_at as "song_updated_at!",
                        song_deleted_at,
                        song_deleted_by,
                        song_created_by,
                        song_updated_by,
                        artist_rowid,
                        artist_id,
                        artist_name,
                        artist_created_at,
                        artist_updated_at,
                        artist_deleted_at,
                        artist_deleted_by,
                        artist_created_by,
                        artist_updated_by,
                        album_rowid,
                        album_id,
                        album_title,
                        album_album_type,
                        album_release_date,
                        album_release_date_precision,
                        album_label,
                        album_genre_rowid,
                        album_song_count,
                        album_total_duration,
                        album_created_at,
                        album_updated_at,
                        album_deleted_at,
                        album_deleted_by,
                        album_created_by,
                        album_updated_by
                     FROM song_query_view
                     ORDER BY song_created_at DESC, album_title ASC, song_disc_number ASC, song_track_number ASC
                     LIMIT ? OFFSET ?"#,
                    limit, offset
                ).fetch_all(&pool).await?
            }
        }
    };

    let songs: Vec<SongQueryResult> = rows
        .into_iter()
        .map(|row| row.to_song_query_result())
        .collect();

    let song_count = songs.len() as i64;
    println!(
        "Song query completed in {:?}, returned {} songs",
        start_time.elapsed(),
        song_count
    );

    Ok(QueryResult {
        items: songs,
        total_count,
        has_more: offset + song_count < total_count,
        query_time_ms: Some(start_time.elapsed().as_millis() as u64),
        limit,
        offset,
    })
}

pub async fn query_artists(params: QueryParams) -> GrimoireResult<QueryResult<ArtistQueryResult>> {
    let start_time = Instant::now();
    let pool = database::connect().await?;
    let limit = params.limit.unwrap_or(50).min(1000) as i64;
    let offset = params.offset.unwrap_or(0) as i64;

    let search_pattern = params
        .q
        .as_ref()
        .filter(|q| !q.trim().is_empty())
        .map(|q| format!("%{}%", q));

    // Count query
    let total_count: i64 = if let Some(ref pattern) = search_pattern {
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM artist_query_view WHERE artist_name LIKE ?",
            pattern
        )
        .fetch_one(&pool)
        .await?
    } else {
        sqlx::query_scalar!("SELECT COUNT(*) FROM artist_query_view")
            .fetch_one(&pool)
            .await?
    };

    // Execute query
    let rows = if let Some(ref pattern) = search_pattern {
        sqlx::query_as!(
            ArtistViewRow,
            r#"SELECT
                artist_rowid as "artist_rowid!",
                artist_id as "artist_id!",
                artist_name as "artist_name!",
                artist_created_at as "artist_created_at!",
                artist_updated_at as "artist_updated_at!",
                artist_deleted_at,
                artist_deleted_by,
                artist_created_by,
                artist_updated_by,
                song_count as "song_count!",
                album_count as "album_count!",
                total_duration as "total_duration!"
             FROM artist_query_view
             WHERE artist_name LIKE ?
             ORDER BY artist_name ASC LIMIT ? OFFSET ?"#,
            pattern,
            limit,
            offset
        )
        .fetch_all(&pool)
        .await?
    } else {
        sqlx::query_as!(
            ArtistViewRow,
            r#"SELECT
                artist_rowid as "artist_rowid!",
                artist_id as "artist_id!",
                artist_name as "artist_name!",
                artist_created_at as "artist_created_at!",
                artist_updated_at as "artist_updated_at!",
                artist_deleted_at,
                artist_deleted_by,
                artist_created_by,
                artist_updated_by,
                song_count as "song_count!",
                album_count as "album_count!",
                total_duration as "total_duration!"
             FROM artist_query_view
             ORDER BY artist_name ASC LIMIT ? OFFSET ?"#,
            limit,
            offset
        )
        .fetch_all(&pool)
        .await?
    };

    let artists: Vec<ArtistQueryResult> = rows
        .into_iter()
        .map(|row| {
            let artist = Artist {
                rowid: row.artist_rowid,
                id: row.artist_id,
                name: row.artist_name,
                created_at: row.artist_created_at,
                updated_at: row.artist_updated_at,
                deleted_at: row.artist_deleted_at,
                deleted_by: row.artist_deleted_by,
                created_by: row.artist_created_by,
                updated_by: row.artist_updated_by,
            };

            ArtistQueryResult {
                artist,
                song_count: row.song_count,
                album_count: row.album_count,
                total_duration: Some(row.total_duration),
                rating: None,
            }
        })
        .collect();

    let artist_count = artists.len() as i64;
    println!(
        "Artist query completed in {:?}, returned {} artists",
        start_time.elapsed(),
        artist_count
    );

    Ok(QueryResult {
        items: artists,
        total_count,
        has_more: offset + artist_count < total_count,
        query_time_ms: Some(start_time.elapsed().as_millis() as u64),
        limit,
        offset,
    })
}

pub async fn query_albums(params: QueryParams) -> GrimoireResult<QueryResult<AlbumQueryResult>> {
    let start_time = Instant::now();
    let pool = database::connect().await?;
    let limit = params.limit.unwrap_or(50).min(1000) as i64;
    let offset = params.offset.unwrap_or(0) as i64;

    let search_pattern = params
        .q
        .as_ref()
        .filter(|q| !q.trim().is_empty())
        .map(|q| format!("%{}%", q));

    // Count query
    let total_count: i64 = if let Some(ref pattern) = search_pattern {
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM album_query_view
             WHERE (album_title LIKE ? OR artist_name LIKE ?)",
            pattern,
            pattern
        )
        .fetch_one(&pool)
        .await?
    } else {
        sqlx::query_scalar!("SELECT COUNT(*) FROM album_query_view")
            .fetch_one(&pool)
            .await?
    };

    // Execute query
    let rows = if let Some(ref pattern) = search_pattern {
        sqlx::query_as!(
            AlbumViewRow,
            r#"SELECT
                album_rowid as "album_rowid!",
                album_id as "album_id!",
                album_title as "album_title!",
                album_album_type,
                album_release_date,
                album_release_date_precision,
                album_label,
                album_genre_rowid,
                album_song_count,
                album_total_duration,
                album_created_at as "album_created_at!",
                album_updated_at as "album_updated_at!",
                album_deleted_at,
                album_deleted_by,
                album_created_by,
                album_updated_by,
                artist_rowid,
                artist_id,
                artist_name,
                artist_created_at,
                artist_updated_at
             FROM album_query_view
             WHERE (album_title LIKE ? OR artist_name LIKE ?)
             ORDER BY album_title ASC LIMIT ? OFFSET ?"#,
            pattern,
            pattern,
            limit,
            offset
        )
        .fetch_all(&pool)
        .await?
    } else {
        sqlx::query_as!(
            AlbumViewRow,
            r#"SELECT
                album_rowid as "album_rowid!",
                album_id as "album_id!",
                album_title as "album_title!",
                album_album_type,
                album_release_date,
                album_release_date_precision,
                album_label,
                album_genre_rowid,
                album_song_count,
                album_total_duration,
                album_created_at as "album_created_at!",
                album_updated_at as "album_updated_at!",
                album_deleted_at,
                album_deleted_by,
                album_created_by,
                album_updated_by,
                artist_rowid,
                artist_id,
                artist_name,
                artist_created_at,
                artist_updated_at
             FROM album_query_view
             ORDER BY album_title ASC LIMIT ? OFFSET ?"#,
            limit,
            offset
        )
        .fetch_all(&pool)
        .await?
    };

    let albums: Vec<AlbumQueryResult> = rows
        .into_iter()
        .map(|row| {
            let album = Album {
                rowid: row.album_rowid,
                id: row.album_id,
                title: row.album_title,
                album_type: row.album_album_type.unwrap_or_else(|| "album".to_string()),
                release_date: row.album_release_date,
                release_date_precision: row.album_release_date_precision,
                label: row.album_label,
                genre_rowid: row.album_genre_rowid,
                song_count: row.album_song_count.unwrap_or(0),
                total_duration: row.album_total_duration.unwrap_or(0),
                created_at: row.album_created_at,
                updated_at: row.album_updated_at,
                deleted_at: row.album_deleted_at,
                deleted_by: row.album_deleted_by,
                created_by: row.album_created_by,
                updated_by: row.album_updated_by,
            };

            let artist = if let Some(artist_rowid) = row.artist_rowid {
                Some(Artist {
                    rowid: artist_rowid,
                    id: row.artist_id.unwrap_or_default(),
                    name: row.artist_name.unwrap_or_default(),
                    created_at: row.artist_created_at.unwrap_or(0),
                    updated_at: row.artist_updated_at.unwrap_or(0),
                    deleted_at: None,
                    deleted_by: None,
                    created_by: None,
                    updated_by: None,
                })
            } else {
                None
            };

            AlbumQueryResult {
                album,
                artist,
                genre: None,
                rating: None,
                is_favorite: None,
            }
        })
        .collect();

    let album_count = albums.len() as i64;
    println!(
        "Album query completed in {:?}, returned {} albums",
        start_time.elapsed(),
        album_count
    );

    Ok(QueryResult {
        items: albums,
        total_count,
        has_more: offset + album_count < total_count,
        query_time_ms: Some(start_time.elapsed().as_millis() as u64),
        limit,
        offset,
    })
}

pub async fn query_genres(params: QueryParams) -> GrimoireResult<QueryResult<GenreQueryResult>> {
    let start_time = Instant::now();
    let pool = database::connect().await?;
    let limit = params.limit.unwrap_or(50).min(1000) as i64;
    let offset = params.offset.unwrap_or(0) as i64;

    let search_pattern = params
        .q
        .as_ref()
        .filter(|q| !q.trim().is_empty())
        .map(|q| format!("%{}%", q));

    // Count query
    let total_count: i64 = if let Some(ref pattern) = search_pattern {
        sqlx::query_scalar!(
            "SELECT COUNT(*) FROM genre_query_view WHERE genre_name LIKE ?",
            pattern
        )
        .fetch_one(&pool)
        .await?
    } else {
        sqlx::query_scalar!("SELECT COUNT(*) FROM genre_query_view")
            .fetch_one(&pool)
            .await?
    };

    // Execute query
    let rows = if let Some(ref pattern) = search_pattern {
        sqlx::query_as!(
            GenreViewRow,
            r#"SELECT
                genre_rowid as "genre_rowid!",
                genre_id as "genre_id!",
                genre_name as "genre_name!",
                genre_created_at as "genre_created_at!"
             FROM genre_query_view
             WHERE genre_name LIKE ?
             ORDER BY genre_name ASC LIMIT ? OFFSET ?"#,
            pattern,
            limit,
            offset
        )
        .fetch_all(&pool)
        .await?
    } else {
        sqlx::query_as!(
            GenreViewRow,
            r#"SELECT
                genre_rowid as "genre_rowid!",
                genre_id as "genre_id!",
                genre_name as "genre_name!",
                genre_created_at as "genre_created_at!"
             FROM genre_query_view
             ORDER BY genre_name ASC LIMIT ? OFFSET ?"#,
            limit,
            offset
        )
        .fetch_all(&pool)
        .await?
    };

    let genres: Vec<GenreQueryResult> = rows
        .into_iter()
        .map(|row| {
            let genre = Genre {
                rowid: row.genre_rowid,
                id: row.genre_id,
                name: row.genre_name,
                created_at: row.genre_created_at,
            };

            GenreQueryResult {
                genre,
                song_count: None,
                album_count: None,
            }
        })
        .collect();

    let genre_count = genres.len() as i64;
    println!(
        "Genre query completed in {:?}, returned {} genres",
        start_time.elapsed(),
        genre_count
    );

    Ok(QueryResult {
        items: genres,
        total_count,
        has_more: offset + genre_count < total_count,
        query_time_ms: Some(start_time.elapsed().as_millis() as u64),
        limit,
        offset,
    })
}

pub async fn query_recent_songs(limit: Option<usize>) -> GrimoireResult<Vec<SongQueryResult>> {
    let pool = database::connect().await?;
    let limit = limit.unwrap_or(20).min(100) as i64;

    // Recent songs with proper album track ordering
    let rows = sqlx::query_as!(
        SongViewRow,
        r#"SELECT
            song_rowid as "song_rowid!",
            song_id as "song_id!",
            song_media_blob_id as "song_media_blob_id!",
            song_thumbnail_blob_id,
            song_waveform_blob_id,
            song_title as "song_title!",
            song_track_number,
            song_disc_number,
            song_duration,
            song_year,
            song_bpm,
            song_key_signature,
            song_metadata,
            song_processing_status,
            song_processing_notes,
            song_created_at as "song_created_at!",
            song_updated_at as "song_updated_at!",
            song_deleted_at,
            song_deleted_by,
            song_created_by,
            song_updated_by,
            artist_rowid,
            artist_id,
            artist_name,
            artist_created_at,
            artist_updated_at,
            artist_deleted_at,
            artist_deleted_by,
            artist_created_by,
            artist_updated_by,
            album_rowid,
            album_id,
            album_title,
            album_album_type,
            album_release_date,
            album_release_date_precision,
            album_label,
            album_genre_rowid,
            album_song_count,
            album_total_duration,
            album_created_at,
            album_updated_at,
            album_deleted_at,
            album_deleted_by,
            album_created_by,
            album_updated_by
         FROM song_query_view
         ORDER BY song_created_at DESC, album_title ASC, song_disc_number ASC, song_track_number ASC
         LIMIT ?"#,
        limit
    )
    .fetch_all(&pool)
    .await?;

    Ok(rows
        .into_iter()
        .map(|row| row.to_song_query_result())
        .collect())
}

// CLI-compatible wrapper that returns QueryResult
pub async fn list_recent_songs_query_result(
    limit: Option<u32>,
) -> GrimoireResult<QueryResult<SongQueryResult>> {
    let songs = query_recent_songs(limit.map(|l| l as usize)).await?;
    let total_count = songs.len() as i64;

    Ok(QueryResult {
        items: songs,
        total_count,
        has_more: false,        // Recent songs don't use pagination
        query_time_ms: Some(0), // Not tracking for this simple query
        limit: limit.unwrap_or(20) as i64,
        offset: 0,
    })
}

// Legacy compatibility functions
pub async fn list_recent_songs(limit: Option<u32>) -> GrimoireResult<QueryResult<SongQueryResult>> {
    list_recent_songs_query_result(limit).await
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
    };
    query_songs(params).await
}

pub async fn list_songs_by_artist(
    _artist_rowid: i64,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<QueryResult<SongQueryResult>> {
    // TODO: Implement artist filtering
    let params = QueryParams {
        q: None,
        search_fields: None,
        filters: std::collections::HashMap::new(),
        sort_by: Some("album".to_string()),
        sort_direction: Some("asc".to_string()),
        limit,
        offset,
    };
    query_songs(params).await
}

pub async fn list_songs_by_album(
    _album_rowid: i64,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<QueryResult<SongQueryResult>> {
    // TODO: Implement album filtering
    let params = QueryParams {
        q: None,
        search_fields: None,
        filters: std::collections::HashMap::new(),
        sort_by: Some("track_number".to_string()),
        sort_direction: Some("asc".to_string()),
        limit,
        offset,
    };
    query_songs(params).await
}

pub async fn list_albums_by_artist(
    _artist_rowid: i64,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<QueryResult<AlbumQueryResult>> {
    // TODO: Implement artist filtering
    let params = QueryParams {
        q: None,
        search_fields: None,
        filters: std::collections::HashMap::new(),
        sort_by: Some("release_date".to_string()),
        sort_direction: Some("desc".to_string()),
        limit,
        offset,
    };
    query_albums(params).await
}

pub async fn list_songs_by_genre(
    _genre_rowid: i64,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<QueryResult<SongQueryResult>> {
    // TODO: Implement genre filtering
    let params = QueryParams {
        q: None,
        search_fields: None,
        filters: std::collections::HashMap::new(),
        sort_by: Some("album".to_string()),
        sort_direction: Some("asc".to_string()),
        limit,
        offset,
    };
    query_songs(params).await
}
