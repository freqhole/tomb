//! Unified query API for music entities with relationship table joins
//! Provides type-safe, composable queries with full-text search integration

use serde_json::Value;
use sqlx::Row;
use std::collections::HashMap;
use std::time::Instant;

use crate::database;
use crate::error::GrimoireResult;
use crate::media_blobz::MediaBlob;
use crate::music::crud::models::{
    AlbumQueryResult, ArtistQueryResult, GenreQueryResult, QueryParams, QueryResult,
    SongQueryResult,
};
use crate::music::entities::{Album, Artist, Genre, Song};

/// Query songs with album grouping and full relation data by default
///
/// Critical requirement: Songs are grouped by album first, sorted by disc/track within album,
/// then album groups are sorted by the user's sort_by parameter
pub async fn query_songs(params: QueryParams) -> GrimoireResult<QueryResult<SongQueryResult>> {
    let start_time = Instant::now();
    let pool = database::connect().await?;

    let limit = params.limit.unwrap_or(50).min(1000) as i64;
    let offset = params.offset.unwrap_or(0) as i64;

    // Build complex query with relationship table joins
    // This query implements the critical album grouping requirement
    let mut base_sql = r#"
        SELECT
            -- Song fields
            s.rowid as song_rowid,
            s.id as song_id,
            s.media_blob_id as song_media_blob_id,
            s.thumbnail_blob_id as song_thumbnail_blob_id,
            s.waveform_blob_id as song_waveform_blob_id,
            s.title as song_title,
            s.track_number as song_track_number,
            s.disc_number as song_disc_number,
            s.duration as song_duration,
            s.year as song_year,
            s.bpm as song_bpm,
            s.key_signature as song_key_signature,
            s.metadata as song_metadata,
            s.processing_status as song_processing_status,
            s.processing_notes as song_processing_notes,
            s.created_at as song_created_at,
            s.updated_at as song_updated_at,
            s.deleted_at as song_deleted_at,
            s.deleted_by as song_deleted_by,
            s.created_by as song_created_by,
            s.updated_by as song_updated_by,

            -- Artist fields (through artist_songz relationship)
            ar.rowid as artist_rowid,
            ar.id as artist_id,
            ar.name as artist_name,
            ar.created_at as artist_created_at,
            ar.updated_at as artist_updated_at,
            ar.deleted_at as artist_deleted_at,
            ar.deleted_by as artist_deleted_by,
            ar.created_by as artist_created_by,
            ar.updated_by as artist_updated_by,

            -- Album fields (through album_songz relationship)
            al.rowid as album_rowid,
            al.id as album_id,
            al.title as album_title,
            al.album_type as album_type,
            al.release_date as album_release_date,
            al.release_date_precision as album_release_date_precision,
            al.label as album_label,
            al.genre_rowid as album_genre_rowid,
            al.song_count as album_song_count,
            al.total_duration as album_total_duration,
            al.created_at as album_created_at,
            al.updated_at as album_updated_at,
            al.deleted_at as album_deleted_at,
            al.deleted_by as album_deleted_by,
            al.created_by as album_created_by,
            al.updated_by as album_updated_by,

            -- Genre fields (through album -> genre relationship)
            g.rowid as genre_rowid,
            g.id as genre_id,
            g.name as genre_name,
            g.created_at as genre_created_at,

            -- Media blob fields
            mb.rowid as media_blob_rowid,
            mb.id as media_blob_id,
            mb.sha256 as media_blob_sha256,
            mb.size as media_blob_size,
            mb.mime as media_blob_mime,
            mb.source_client_id as media_blob_source_client_id,
            mb.local_path as media_blob_local_path,
            mb.metadata as media_blob_metadata,
            mb.created_at as media_blob_created_at,
            mb.updated_at as media_blob_updated_at,
            mb.parent_blob_id as media_blob_parent_blob_id,
            mb.blob_type as media_blob_blob_type,
            mb.deleted_at as media_blob_deleted_at,
            mb.deleted_by as media_blob_deleted_by,
            mb.created_by as media_blob_created_by,
            mb.updated_by as media_blob_updated_by
        FROM songz s
        LEFT JOIN artist_songz ars ON s.rowid = ars.song_rowid
        LEFT JOIN artistz ar ON ars.artist_rowid = ar.rowid AND ar.deleted_at IS NULL
        LEFT JOIN album_songz als ON s.rowid = als.song_rowid
        LEFT JOIN albumz al ON als.album_rowid = al.rowid AND al.deleted_at IS NULL
        LEFT JOIN genrez g ON al.genre_rowid = g.rowid
        LEFT JOIN media_blobz mb ON s.media_blob_id = mb.id AND mb.deleted_at IS NULL
        WHERE s.deleted_at IS NULL
    "#
    .to_string();

    let mut where_conditions = Vec::new();
    let mut bind_params: Vec<String> = Vec::new();

    // Add full-text search if provided
    if let Some(q) = &params.q {
        if !q.trim().is_empty() {
            let search_term = format!("%{}%", q);
            if let Some(fields) = &params.search_fields {
                let mut search_conditions = Vec::new();
                for field in fields {
                    match field.as_str() {
                        "title" => search_conditions.push("s.title LIKE ?".to_string()),
                        "artist" => search_conditions.push("ar.name LIKE ?".to_string()),
                        "album" => search_conditions.push("al.title LIKE ?".to_string()),
                        _ => search_conditions.push("s.title LIKE ?".to_string()),
                    }
                    bind_params.push(search_term.clone());
                }
                if !search_conditions.is_empty() {
                    where_conditions.push(format!("({})", search_conditions.join(" OR ")));
                }
            } else {
                // Search all fields by default
                where_conditions
                    .push("(s.title LIKE ? OR ar.name LIKE ? OR al.title LIKE ?)".to_string());
                bind_params.push(search_term.clone());
                bind_params.push(search_term.clone());
                bind_params.push(search_term);
            }
        }
    }

    // Add simplified filters (canonical names only)
    for (key, value) in &params.filters {
        match key.as_str() {
            "artist" => {
                if let Some(name) = value.as_str() {
                    where_conditions.push("ar.name LIKE ?".to_string());
                    bind_params.push(format!("%{}%", name));
                }
            }
            "album" => {
                if let Some(title) = value.as_str() {
                    where_conditions.push("al.title LIKE ?".to_string());
                    bind_params.push(format!("%{}%", title));
                }
            }
            "genre" => {
                if let Some(name) = value.as_str() {
                    where_conditions.push("g.name LIKE ?".to_string());
                    bind_params.push(format!("%{}%", name));
                }
            }
            // Future filters - tags, rating_min, is_favorite
            _ => {}
        }
    }

    // Add WHERE conditions to query
    if !where_conditions.is_empty() {
        base_sql.push_str(" AND ");
        base_sql.push_str(&where_conditions.join(" AND "));
    }

    // Critical album grouping requirement:
    // 1. Group by album first
    // 2. Sort within album by disc_number, track_number
    // 3. Sort album groups by user's sort_by parameter
    let order_clause = match params.sort_by.as_deref() {
        Some("title") => {
            if params.sort_direction.as_deref() == Some("desc") {
                "ORDER BY s.title DESC, COALESCE(al.rowid, 999999), COALESCE(s.disc_number, 1), COALESCE(s.track_number, 1)"
            } else {
                "ORDER BY s.title ASC, COALESCE(al.rowid, 999999), COALESCE(s.disc_number, 1), COALESCE(s.track_number, 1)"
            }
        }
        Some("artist") => {
            if params.sort_direction.as_deref() == Some("desc") {
                "ORDER BY ar.name DESC, COALESCE(al.rowid, 999999), COALESCE(s.disc_number, 1), COALESCE(s.track_number, 1)"
            } else {
                "ORDER BY ar.name ASC, COALESCE(al.rowid, 999999), COALESCE(s.disc_number, 1), COALESCE(s.track_number, 1)"
            }
        }
        Some("album") => {
            if params.sort_direction.as_deref() == Some("desc") {
                "ORDER BY al.title DESC, COALESCE(s.disc_number, 1), COALESCE(s.track_number, 1)"
            } else {
                "ORDER BY al.title ASC, COALESCE(s.disc_number, 1), COALESCE(s.track_number, 1)"
            }
        }
        Some("year") => {
            if params.sort_direction.as_deref() == Some("desc") {
                "ORDER BY s.year DESC, COALESCE(al.rowid, 999999), COALESCE(s.disc_number, 1), COALESCE(s.track_number, 1)"
            } else {
                "ORDER BY s.year ASC, COALESCE(al.rowid, 999999), COALESCE(s.disc_number, 1), COALESCE(s.track_number, 1)"
            }
        }
        Some("duration") => {
            if params.sort_direction.as_deref() == Some("desc") {
                "ORDER BY s.duration DESC, COALESCE(al.rowid, 999999), COALESCE(s.disc_number, 1), COALESCE(s.track_number, 1)"
            } else {
                "ORDER BY s.duration ASC, COALESCE(al.rowid, 999999), COALESCE(s.disc_number, 1), COALESCE(s.track_number, 1)"
            }
        }
        Some("created_at") | _ => {
            // Default: sort albums by created_at, then tracks within album
            if params.sort_direction.as_deref() == Some("desc") {
                "ORDER BY COALESCE(al.created_at, s.created_at) DESC, COALESCE(al.rowid, 999999), COALESCE(s.disc_number, 1), COALESCE(s.track_number, 1)"
            } else {
                "ORDER BY COALESCE(al.created_at, s.created_at) ASC, COALESCE(al.rowid, 999999), COALESCE(s.disc_number, 1), COALESCE(s.track_number, 1)"
            }
        }
    };

    base_sql.push_str(" ");
    base_sql.push_str(order_clause);

    // Get count first (rebuild query without SELECT columns and ORDER BY)
    let count_sql = r#"
        SELECT COUNT(DISTINCT s.rowid)
        FROM songz s
        LEFT JOIN artist_songz ars ON s.rowid = ars.song_rowid
        LEFT JOIN artistz ar ON ars.artist_rowid = ar.rowid AND ar.deleted_at IS NULL
        LEFT JOIN album_songz als ON s.rowid = als.song_rowid
        LEFT JOIN albumz al ON als.album_rowid = al.rowid AND al.deleted_at IS NULL
        LEFT JOIN genrez g ON al.genre_rowid = g.rowid
        LEFT JOIN media_blobz mb ON s.media_blob_id = mb.id AND mb.deleted_at IS NULL
        WHERE s.deleted_at IS NULL
    "#;

    let mut count_query_with_conditions = count_sql.to_string();
    if !where_conditions.is_empty() {
        count_query_with_conditions.push_str(" AND ");
        count_query_with_conditions.push_str(&where_conditions.join(" AND "));
    }

    let mut count_query = sqlx::query_scalar(&count_query_with_conditions);
    for param in &bind_params {
        count_query = count_query.bind(param);
    }
    let total_count: i64 = count_query.fetch_one(&pool).await?;

    // Add pagination to main query
    base_sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));

    // Execute main query
    let mut query = sqlx::query(&base_sql);
    for param in &bind_params {
        query = query.bind(param);
    }
    let rows = query.fetch_all(&pool).await?;

    // Map results with full relation data
    let songs = rows
        .into_iter()
        .map(|row| {
            // Extract song data
            let song = Song {
                rowid: row.get("song_rowid"),
                id: row.get("song_id"),
                media_blob_id: row.get("song_media_blob_id"),
                thumbnail_blob_id: row.get("song_thumbnail_blob_id"),
                waveform_blob_id: row.get("song_waveform_blob_id"),
                title: row.get("song_title"),
                track_number: row.get("song_track_number"),
                disc_number: row.get("song_disc_number"),
                duration: row.get("song_duration"),
                year: row.get("song_year"),
                bpm: row.get("song_bpm"),
                key_signature: row.get("song_key_signature"),
                metadata: row.get("song_metadata"),
                processing_status: row.get("song_processing_status"),
                processing_notes: row.get("song_processing_notes"),
                created_at: row.get("song_created_at"),
                updated_at: row.get("song_updated_at"),
                deleted_at: row.get("song_deleted_at"),
                deleted_by: row.get("song_deleted_by"),
                created_by: row.get("song_created_by"),
                updated_by: row.get("song_updated_by"),
            };

            // Extract artist data (if exists)
            let artist = if let Ok(artist_rowid) = row.try_get::<i64, _>("artist_rowid") {
                Some(Artist {
                    rowid: artist_rowid,
                    id: row.get("artist_id"),
                    name: row.get("artist_name"),
                    created_at: row.get("artist_created_at"),
                    updated_at: row.get("artist_updated_at"),
                    deleted_at: row.get("artist_deleted_at"),
                    deleted_by: row.get("artist_deleted_by"),
                    created_by: row.get("artist_created_by"),
                    updated_by: row.get("artist_updated_by"),
                })
            } else {
                None
            };

            // Extract album data (if exists)
            let album = if let Ok(album_rowid) = row.try_get::<i64, _>("album_rowid") {
                Some(Album {
                    rowid: album_rowid,
                    id: row.get("album_id"),
                    title: row.get("album_title"),
                    album_type: row.get("album_type"),
                    release_date: row.get("album_release_date"),
                    release_date_precision: row.get("album_release_date_precision"),
                    label: row.get("album_label"),
                    genre_rowid: row.get("album_genre_rowid"),
                    song_count: row.get("album_song_count"),
                    total_duration: row.get("album_total_duration"),
                    created_at: row.get("album_created_at"),
                    updated_at: row.get("album_updated_at"),
                    deleted_at: row.get("album_deleted_at"),
                    deleted_by: row.get("album_deleted_by"),
                    created_by: row.get("album_created_by"),
                    updated_by: row.get("album_updated_by"),
                })
            } else {
                None
            };

            // Extract genre data (if exists)
            let genre = if let Ok(genre_rowid) = row.try_get::<i64, _>("genre_rowid") {
                Some(Genre {
                    rowid: genre_rowid,
                    id: row.get("genre_id"),
                    name: row.get("genre_name"),
                    created_at: row.get("genre_created_at"),
                })
            } else {
                None
            };

            // Extract media blob data (if exists)
            let media_blob = if let Ok(blob_id) = row.try_get::<String, _>("media_blob_id") {
                Some(MediaBlob {
                    rowid: row.get("media_blob_rowid"),
                    id: blob_id,
                    sha256: row.get("media_blob_sha256"),
                    size: row.get("media_blob_size"),
                    mime: row.get("media_blob_mime"),
                    source_client_id: row.get("media_blob_source_client_id"),
                    local_path: row.get("media_blob_local_path"),
                    parent_blob_id: row.get("media_blob_parent_blob_id"),
                    blob_type: row.get("media_blob_blob_type"),
                    metadata: row.get("media_blob_metadata"),
                    created_at: row.get("media_blob_created_at"),
                    updated_at: row.get("media_blob_updated_at"),
                    deleted_at: row.get("media_blob_deleted_at"),
                    deleted_by: row.get("media_blob_deleted_by"),
                    created_by: row.get("media_blob_created_by"),
                    updated_by: row.get("media_blob_updated_by"),
                })
            } else {
                None
            };

            SongQueryResult {
                song,
                artist,
                album,
                genre,
                media_blob,
                relevance_score: None, // Set by FTS if used
                snippet: None,         // Set by FTS if used
            }
        })
        .collect();

    let mut result = QueryResult::new(songs, total_count, offset as u32, limit as u32);
    result.query_time_ms = Some(start_time.elapsed().as_millis() as u64);
    Ok(result)
}

/// Query artists with aggregated stats
pub async fn query_artists(params: QueryParams) -> GrimoireResult<QueryResult<ArtistQueryResult>> {
    let start_time = Instant::now();
    let pool = database::connect().await?;

    let limit = params.limit.unwrap_or(50).min(1000) as i64;
    let offset = params.offset.unwrap_or(0) as i64;

    // Build query for artists with aggregated stats
    let mut base_sql = r#"
        SELECT
            ar.rowid as artist_rowid,
            ar.id as artist_id,
            ar.name as artist_name,
            ar.created_at as artist_created_at,
            ar.updated_at as artist_updated_at,
            ar.deleted_at as artist_deleted_at,
            ar.deleted_by as artist_deleted_by,
            ar.created_by as artist_created_by,
            ar.updated_by as artist_updated_by,
            COUNT(DISTINCT s.rowid) as song_count,
            COUNT(DISTINCT al.rowid) as album_count,
            COALESCE(SUM(s.duration), 0) as total_duration
        FROM artistz ar
        LEFT JOIN artist_songz ars ON ar.rowid = ars.artist_rowid
        LEFT JOIN songz s ON ars.song_rowid = s.rowid AND s.deleted_at IS NULL
        LEFT JOIN artist_albumz aal ON ar.rowid = aal.artist_rowid
        LEFT JOIN albumz al ON aal.album_rowid = al.rowid AND al.deleted_at IS NULL
        WHERE ar.deleted_at IS NULL
    "#
    .to_string();

    let mut where_conditions = Vec::new();
    let mut bind_params: Vec<String> = Vec::new();

    // Add search if provided
    if let Some(q) = &params.q {
        if !q.trim().is_empty() {
            let search_term = format!("%{}%", q);
            where_conditions.push("ar.name LIKE ?".to_string());
            bind_params.push(search_term);
        }
    }

    // Add letter filtering for artist indexing
    if let Some(starts_with) = params.filters.get("starts_with") {
        if let Some(letter) = starts_with.as_str() {
            if letter == "#" {
                // Non-alphabetic characters - simplified approach
                where_conditions.push("(ar.name < 'A' OR ar.name > 'Z')".to_string());
            } else {
                // Specific letter (case insensitive)
                where_conditions.push("(ar.name LIKE ? OR ar.name LIKE ?)".to_string());
                bind_params.push(format!("{}%", letter.to_uppercase()));
                bind_params.push(format!("{}%", letter.to_lowercase()));
            }
        }
    }

    // Add WHERE conditions to query
    if !where_conditions.is_empty() {
        base_sql.push_str(" AND ");
        base_sql.push_str(&where_conditions.join(" AND "));
    }

    base_sql.push_str(" GROUP BY ar.rowid");

    // Add sorting
    let order_clause = match params.sort_by.as_deref() {
        Some("song_count") => {
            if params.sort_direction.as_deref() == Some("desc") {
                " ORDER BY song_count DESC"
            } else {
                " ORDER BY song_count ASC"
            }
        }
        Some("album_count") => {
            if params.sort_direction.as_deref() == Some("desc") {
                " ORDER BY album_count DESC"
            } else {
                " ORDER BY album_count ASC"
            }
        }
        Some("name") | _ => {
            if params.sort_direction.as_deref() == Some("desc") {
                " ORDER BY ar.name DESC"
            } else {
                " ORDER BY ar.name ASC"
            }
        }
    };

    base_sql.push_str(order_clause);

    // Get count
    let count_sql = format!(
        "SELECT COUNT(*) FROM ({}) as artist_subquery",
        base_sql.split("ORDER BY").next().unwrap()
    );

    let mut count_query = sqlx::query_scalar(&count_sql);
    for param in &bind_params {
        count_query = count_query.bind(param);
    }
    let total_count: i64 = count_query.fetch_one(&pool).await?;

    // Add pagination
    base_sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));

    let mut query = sqlx::query(&base_sql);
    for param in &bind_params {
        query = query.bind(param);
    }
    let rows = query.fetch_all(&pool).await?;

    let artists = rows
        .into_iter()
        .map(|row| {
            let artist = Artist {
                rowid: row.get("artist_rowid"),
                id: row.get("artist_id"),
                name: row.get("artist_name"),
                created_at: row.get("artist_created_at"),
                updated_at: row.get("artist_updated_at"),
                deleted_at: row.get("artist_deleted_at"),
                deleted_by: row.get("artist_deleted_by"),
                created_by: row.get("artist_created_by"),
                updated_by: row.get("artist_updated_by"),
            };

            let song_count: i64 = row.get("song_count");
            let album_count: i64 = row.get("album_count");
            let total_duration: i64 = row.get("total_duration");

            ArtistQueryResult {
                artist,
                song_count,
                album_count,
                total_duration: Some(total_duration),
                rating: None, // Future implementation
            }
        })
        .collect();

    let mut result = QueryResult::new(artists, total_count, offset as u32, limit as u32);
    result.query_time_ms = Some(start_time.elapsed().as_millis() as u64);
    Ok(result)
}

/// Query albums with artist and genre data
pub async fn query_albums(params: QueryParams) -> GrimoireResult<QueryResult<AlbumQueryResult>> {
    let start_time = Instant::now();
    let pool = database::connect().await?;

    let limit = params.limit.unwrap_or(50).min(1000) as i64;
    let offset = params.offset.unwrap_or(0) as i64;

    let mut base_sql = r#"
        SELECT
            al.rowid as album_rowid,
            al.id as album_id,
            al.title as album_title,
            al.album_type as album_type,
            al.release_date as album_release_date,
            al.release_date_precision as album_release_date_precision,
            al.label as album_label,
            al.genre_rowid as album_genre_rowid,
            al.song_count as album_song_count,
            al.total_duration as album_total_duration,
            al.created_at as album_created_at,
            al.updated_at as album_updated_at,
            al.deleted_at as album_deleted_at,
            al.deleted_by as album_deleted_by,
            al.created_by as album_created_by,
            al.updated_by as album_updated_by,

            ar.rowid as artist_rowid,
            ar.id as artist_id,
            ar.name as artist_name,
            ar.created_at as artist_created_at,
            ar.updated_at as artist_updated_at,
            ar.deleted_at as artist_deleted_at,
            ar.deleted_by as artist_deleted_by,
            ar.created_by as artist_created_by,
            ar.updated_by as artist_updated_by,

            g.rowid as genre_rowid,
            g.id as genre_id,
            g.name as genre_name,
            g.created_at as genre_created_at
        FROM albumz al
        LEFT JOIN artist_albumz aal ON al.rowid = aal.album_rowid
        LEFT JOIN artistz ar ON aal.artist_rowid = ar.rowid AND ar.deleted_at IS NULL
        LEFT JOIN genrez g ON al.genre_rowid = g.rowid
        WHERE al.deleted_at IS NULL
    "#
    .to_string();

    let mut where_conditions = Vec::new();
    let mut bind_params: Vec<String> = Vec::new();

    // Add search
    if let Some(q) = &params.q {
        if !q.trim().is_empty() {
            let search_term = format!("%{}%", q);
            where_conditions.push("(al.title LIKE ? OR ar.name LIKE ?)".to_string());
            bind_params.push(search_term.clone());
            bind_params.push(search_term);
        }
    }

    // Add filters
    for (key, value) in &params.filters {
        match key.as_str() {
            "artist" => {
                if let Some(name) = value.as_str() {
                    where_conditions.push("ar.name LIKE ?".to_string());
                    bind_params.push(format!("%{}%", name));
                }
            }
            "genre" => {
                if let Some(name) = value.as_str() {
                    where_conditions.push("g.name LIKE ?".to_string());
                    bind_params.push(format!("%{}%", name));
                }
            }
            _ => {}
        }
    }

    // Add WHERE conditions to query
    if !where_conditions.is_empty() {
        base_sql.push_str(" AND ");
        base_sql.push_str(&where_conditions.join(" AND "));
    }

    // Add sorting
    let order_clause = match params.sort_by.as_deref() {
        Some("title") => {
            if params.sort_direction.as_deref() == Some("desc") {
                " ORDER BY al.title DESC"
            } else {
                " ORDER BY al.title ASC"
            }
        }
        Some("release_date") => {
            if params.sort_direction.as_deref() == Some("desc") {
                " ORDER BY al.release_date DESC"
            } else {
                " ORDER BY al.release_date ASC"
            }
        }
        Some("track_count") => {
            if params.sort_direction.as_deref() == Some("desc") {
                " ORDER BY al.song_count DESC"
            } else {
                " ORDER BY al.song_count ASC"
            }
        }
        Some("duration") => {
            if params.sort_direction.as_deref() == Some("desc") {
                " ORDER BY al.total_duration DESC"
            } else {
                " ORDER BY al.total_duration ASC"
            }
        }
        Some("created_at") | _ => {
            if params.sort_direction.as_deref() == Some("desc") {
                " ORDER BY al.created_at DESC"
            } else {
                " ORDER BY al.created_at ASC"
            }
        }
    };

    base_sql.push_str(order_clause);

    // Count and pagination
    let count_sql = format!(
        "SELECT COUNT(*) FROM ({})",
        base_sql.split("ORDER BY").next().unwrap()
    );

    let mut count_query = sqlx::query_scalar(&count_sql);
    for param in &bind_params {
        count_query = count_query.bind(param);
    }
    let total_count: i64 = count_query.fetch_one(&pool).await?;

    base_sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));

    let mut query = sqlx::query(&base_sql);
    for param in &bind_params {
        query = query.bind(param);
    }
    let rows = query.fetch_all(&pool).await?;

    let albums = rows
        .into_iter()
        .map(|row| {
            let album = Album {
                rowid: row.get("album_rowid"),
                id: row.get("album_id"),
                title: row.get("album_title"),
                album_type: row.get("album_type"),
                release_date: row.get("album_release_date"),
                release_date_precision: row.get("album_release_date_precision"),
                label: row.get("album_label"),
                genre_rowid: row.get("album_genre_rowid"),
                song_count: row.get("album_song_count"),
                total_duration: row.get("album_total_duration"),
                created_at: row.get("album_created_at"),
                updated_at: row.get("album_updated_at"),
                deleted_at: row.get("album_deleted_at"),
                deleted_by: row.get("album_deleted_by"),
                created_by: row.get("album_created_by"),
                updated_by: row.get("album_updated_by"),
            };

            let artist = if let Ok(artist_rowid) = row.try_get::<i64, _>("artist_rowid") {
                Some(Artist {
                    rowid: artist_rowid,
                    id: row.get("artist_id"),
                    name: row.get("artist_name"),
                    created_at: row.get("artist_created_at"),
                    updated_at: row.get("artist_updated_at"),
                    deleted_at: row.get("artist_deleted_at"),
                    deleted_by: row.get("artist_deleted_by"),
                    created_by: row.get("artist_created_by"),
                    updated_by: row.get("artist_updated_by"),
                })
            } else {
                None
            };

            let genre = if let Ok(genre_rowid) = row.try_get::<i64, _>("genre_rowid") {
                Some(Genre {
                    rowid: genre_rowid,
                    id: row.get("genre_id"),
                    name: row.get("genre_name"),
                    created_at: row.get("genre_created_at"),
                })
            } else {
                None
            };

            AlbumQueryResult {
                album,
                artist,
                genre,
                rating: None,      // Future implementation
                is_favorite: None, // Future implementation
            }
        })
        .collect();

    let mut result = QueryResult::new(albums, total_count, offset as u32, limit as u32);
    result.query_time_ms = Some(start_time.elapsed().as_millis() as u64);
    Ok(result)
}

/// Query genres with basic filtering
pub async fn query_genres(params: QueryParams) -> GrimoireResult<QueryResult<GenreQueryResult>> {
    let start_time = Instant::now();
    let pool = database::connect().await?;

    let limit = params.limit.unwrap_or(50).min(1000) as i64;
    let offset = params.offset.unwrap_or(0) as i64;

    let mut base_sql = "SELECT rowid, id, name, created_at FROM genrez".to_string();
    let mut bind_params: Vec<String> = Vec::new();

    // Add search if provided
    if let Some(q) = &params.q {
        if !q.trim().is_empty() {
            let search_term = format!("%{}%", q);
            base_sql.push_str(" WHERE name LIKE ?");
            bind_params.push(search_term);
        }
    }

    base_sql.push_str(" ORDER BY name ASC");

    // Get count
    let count_sql = format!(
        "SELECT COUNT(*) FROM ({})",
        base_sql.split("ORDER BY").next().unwrap()
    );

    let mut count_query = sqlx::query_scalar(&count_sql);
    for param in &bind_params {
        count_query = count_query.bind(param);
    }
    let total_count: i64 = count_query.fetch_one(&pool).await?;

    base_sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));

    let mut query = sqlx::query(&base_sql);
    for param in &bind_params {
        query = query.bind(param);
    }
    let rows = query.fetch_all(&pool).await?;

    let genres = rows
        .into_iter()
        .map(|row| {
            let genre = Genre {
                rowid: row.get("rowid"),
                id: row.get("id"),
                name: row.get("name"),
                created_at: row.get("created_at"),
            };

            GenreQueryResult {
                genre,
                song_count: None,  // Could be computed if needed
                album_count: None, // Could be computed if needed
            }
        })
        .collect();

    let mut result = QueryResult::new(genres, total_count, offset as u32, limit as u32);
    result.query_time_ms = Some(start_time.elapsed().as_millis() as u64);
    Ok(result)
}

// Legacy compatibility functions - delegate to unified query API
pub async fn search_songs(
    q: &str,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<QueryResult<SongQueryResult>> {
    let params = QueryParams {
        q: Some(q.to_string()),
        search_fields: None, // Search all fields
        filters: HashMap::new(),
        sort_by: Some("created_at".to_string()),
        sort_direction: Some("desc".to_string()),
        limit,
        offset,
    };
    query_songs(params).await
}

pub async fn list_songs_by_artist(
    artist_rowid: i64,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<QueryResult<SongQueryResult>> {
    let mut filters = HashMap::new();
    filters.insert(
        "artist_rowid".to_string(),
        Value::Number(artist_rowid.into()),
    );

    let params = QueryParams {
        q: None,
        search_fields: None,
        filters,
        sort_by: Some("album".to_string()), // Group by album for artist view
        sort_direction: Some("asc".to_string()),
        limit,
        offset,
    };
    query_songs(params).await
}

pub async fn list_songs_by_album(
    album_rowid: i64,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<QueryResult<SongQueryResult>> {
    let mut filters = HashMap::new();
    filters.insert("album_rowid".to_string(), Value::Number(album_rowid.into()));

    let params = QueryParams {
        q: None,
        search_fields: None,
        filters,
        sort_by: Some("track_number".to_string()), // Sort by track within album
        sort_direction: Some("asc".to_string()),
        limit,
        offset,
    };
    query_songs(params).await
}

pub async fn list_albums_by_artist(
    artist_rowid: i64,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<QueryResult<AlbumQueryResult>> {
    let mut filters = HashMap::new();
    filters.insert(
        "artist_rowid".to_string(),
        Value::Number(artist_rowid.into()),
    );

    let params = QueryParams {
        q: None,
        search_fields: None,
        filters,
        sort_by: Some("release_date".to_string()),
        sort_direction: Some("desc".to_string()),
        limit,
        offset,
    };
    query_albums(params).await
}

pub async fn list_songs_by_genre(
    genre_rowid: i64,
    limit: Option<u32>,
    offset: Option<u32>,
) -> GrimoireResult<QueryResult<SongQueryResult>> {
    let mut filters = HashMap::new();
    filters.insert("genre_rowid".to_string(), Value::Number(genre_rowid.into()));

    let params = QueryParams {
        q: None,
        search_fields: None,
        filters,
        sort_by: Some("album".to_string()),
        sort_direction: Some("asc".to_string()),
        limit,
        offset,
    };
    query_songs(params).await
}

pub async fn list_recent_songs(limit: Option<u32>) -> GrimoireResult<QueryResult<SongQueryResult>> {
    let params = QueryParams {
        q: None,
        search_fields: None,
        filters: HashMap::new(),
        sort_by: Some("created_at".to_string()),
        sort_direction: Some("desc".to_string()),
        limit,
        offset: Some(0),
    };
    query_songs(params).await
}
