//! unified query operations for music entities
//! handles complex queries, full-text search, filtering, pagination, and sorting

use std::collections::HashMap;
use std::time::Instant;

use sqlx::SqlitePool;

use crate::database;
use crate::error::GrimoireResult;
use crate::music::entities::{Album, Artist, Genre, Song};

use super::models::{
    AlbumQueryResult, ArtistQueryResult, QueryParams, QueryResult, SongQueryResult,
};

/// query songs with unified parameters supporting FTS, filters, and pagination
pub async fn query_songs(params: QueryParams) -> GrimoireResult<QueryResult<SongQueryResult>> {
    let start_time = Instant::now();
    let pool = database::connect_music().await?;

    let limit = params.limit.unwrap_or(50).min(1000); // Cap at 1000
    let offset = params.offset.unwrap_or(0);
    let include_relations = params.include_relations;

    // Build the base query with optional FTS
    let (query_sql, count_sql, query_args) = build_songs_query(&params)?;

    // Execute count query for pagination
    let mut count_query = sqlx::query_scalar(&count_sql);
    for arg in &query_args {
        count_query = count_query.bind(arg);
    }
    let total_count: i64 = count_query.fetch_one(&pool).await?;

    // Execute main query
    let mut query = sqlx::query_as::<_, Song>(&query_sql);
    for arg in &query_args {
        query = query.bind(arg);
    }
    query = query.bind(limit).bind(offset);

    let songs: Vec<Song> = query.fetch_all(&pool).await?;

    // Convert to query results
    let items = if include_relations {
        convert_songs_with_relations(songs, &pool).await?
    } else {
        convert_songs_basic(songs)
    };

    let mut result = QueryResult::new(items, total_count, offset, limit);
    result.query_time_ms = Some(start_time.elapsed().as_millis() as u64);

    Ok(result)
}

/// query artists with unified parameters supporting FTS, filters, and pagination
pub async fn query_artists(params: QueryParams) -> GrimoireResult<QueryResult<ArtistQueryResult>> {
    let start_time = Instant::now();
    let pool = database::connect_music().await?;

    let limit = params.limit.unwrap_or(50).min(1000);
    let offset = params.offset.unwrap_or(0);

    let (query_sql, count_sql, query_args) = build_artists_query(&params)?;

    // Execute count query
    let mut count_query = sqlx::query_scalar(&count_sql);
    for arg in &query_args {
        count_query = count_query.bind(arg);
    }
    let total_count: i64 = count_query.fetch_one(&pool).await?;

    // Execute main query
    let mut query = sqlx::query_as::<_, ArtistWithStats>(&query_sql);
    for arg in &query_args {
        query = query.bind(arg);
    }
    query = query.bind(limit).bind(offset);

    let artist_rows: Vec<ArtistWithStats> = query.fetch_all(&pool).await?;
    let items = convert_artist_rows(artist_rows);

    let mut result = QueryResult::new(items, total_count, offset, limit);
    result.query_time_ms = Some(start_time.elapsed().as_millis() as u64);

    Ok(result)
}

/// query albums with unified parameters supporting FTS, filters, and pagination
pub async fn query_albums(params: QueryParams) -> GrimoireResult<QueryResult<AlbumQueryResult>> {
    let start_time = Instant::now();
    let pool = database::connect_music().await?;

    let limit = params.limit.unwrap_or(50).min(1000);
    let offset = params.offset.unwrap_or(0);
    let include_relations = params.include_relations;

    let (query_sql, count_sql, query_args) = build_albums_query(&params)?;

    // Execute count query
    let mut count_query = sqlx::query_scalar(&count_sql);
    for arg in &query_args {
        count_query = count_query.bind(arg);
    }
    let total_count: i64 = count_query.fetch_one(&pool).await?;

    // Execute main query
    let mut query = sqlx::query_as::<_, AlbumWithStats>(&query_sql);
    for arg in &query_args {
        query = query.bind(arg);
    }
    query = query.bind(limit).bind(offset);

    let album_rows: Vec<AlbumWithStats> = query.fetch_all(&pool).await?;

    let items = if include_relations {
        convert_albums_with_relations(album_rows, &pool).await?
    } else {
        convert_albums_basic(album_rows)
    };

    let mut result = QueryResult::new(items, total_count, offset, limit);
    result.query_time_ms = Some(start_time.elapsed().as_millis() as u64);

    Ok(result)
}

/// query genres with song counts and basic metadata
pub async fn query_genres(params: QueryParams) -> GrimoireResult<QueryResult<Genre>> {
    let start_time = Instant::now();
    let pool = database::connect_music().await?;

    let limit = params.limit.unwrap_or(50).min(1000);
    let offset = params.offset.unwrap_or(0);

    let (query_sql, count_sql, query_args) = build_genres_query(&params)?;

    // Execute count query
    let mut count_query = sqlx::query_scalar(&count_sql);
    for arg in &query_args {
        count_query = count_query.bind(arg);
    }
    let total_count: i64 = count_query.fetch_one(&pool).await?;

    // Execute main query
    let mut query = sqlx::query_as::<_, Genre>(&query_sql);
    for arg in &query_args {
        query = query.bind(arg);
    }
    query = query.bind(limit).bind(offset);

    let items: Vec<Genre> = query.fetch_all(&pool).await?;

    let mut result = QueryResult::new(items, total_count, offset, limit);
    result.query_time_ms = Some(start_time.elapsed().as_millis() as u64);

    Ok(result)
}

// Internal query builders

fn build_songs_query(params: &QueryParams) -> GrimoireResult<(String, String, Vec<String>)> {
    let mut where_clauses = vec!["s.deleted_at IS NULL".to_string()];
    let mut args = Vec::new();
    let mut joins = Vec::new();
    let select_fields = "s.*".to_string();
    let mut order_by = "s.created_at ASC".to_string();

    // Handle full-text search
    if let Some(q) = &params.q {
        if !q.trim().is_empty() {
            // For now, use LIKE-based search until FTS5 is set up
            let search_condition = if let Some(fields) = &params.search_fields {
                let field_conditions: Vec<String> = fields
                    .iter()
                    .map(|field| match field.as_str() {
                        "title" => "s.title LIKE ?".to_string(),
                        "artist" => {
                            joins.push(
                                "LEFT JOIN artists a ON s.artist_rowid = a.rowid".to_string(),
                            );
                            "a.name LIKE ?".to_string()
                        }
                        "album" => {
                            joins.push(
                                "LEFT JOIN albums al ON s.album_rowid = al.rowid".to_string(),
                            );
                            "al.title LIKE ?".to_string()
                        }
                        _ => "s.title LIKE ?".to_string(),
                    })
                    .collect();
                format!("({})", field_conditions.join(" OR "))
            } else {
                joins.push("LEFT JOIN artists a ON s.artist_rowid = a.rowid".to_string());
                joins.push("LEFT JOIN albums al ON s.album_rowid = al.rowid".to_string());
                "(s.title LIKE ? OR a.name LIKE ? OR al.title LIKE ?)".to_string()
            };

            where_clauses.push(search_condition);
            let search_term = format!("%{}%", q);

            if params.search_fields.is_some() {
                args.push(search_term);
            } else {
                args.extend([search_term.clone(), search_term.clone(), search_term]);
            }
        }
    }

    // Handle filters
    apply_song_filters(&mut where_clauses, &mut args, &mut joins, &params.filters)?;

    // Handle sorting
    if let Some(sort_field) = &params.sort_by {
        let direction = params.sort_direction.as_deref().unwrap_or("asc");
        order_by = format!(
            "{} {}",
            map_song_sort_field(sort_field),
            direction.to_uppercase()
        );
    }

    // Build final query
    let joins_sql = if !joins.is_empty() {
        joins.into_iter().collect::<Vec<_>>().join(" ")
    } else {
        String::new()
    };

    let where_sql = if !where_clauses.is_empty() {
        format!("WHERE {}", where_clauses.join(" AND "))
    } else {
        String::new()
    };

    let query_sql = format!(
        "SELECT {} FROM songs s {} {} ORDER BY {} LIMIT ? OFFSET ?",
        select_fields, joins_sql, where_sql, order_by
    );

    let count_sql = format!("SELECT COUNT(*) FROM songs s {} {}", joins_sql, where_sql);

    Ok((query_sql, count_sql, args))
}

fn build_artists_query(params: &QueryParams) -> GrimoireResult<(String, String, Vec<String>)> {
    let mut where_clauses = vec!["a.deleted_at IS NULL".to_string()];
    let mut args = Vec::new();
    let mut order_by = "a.name ASC".to_string();

    // Handle full-text search
    if let Some(q) = &params.q {
        if !q.trim().is_empty() {
            where_clauses.push("a.name LIKE ?".to_string());
            args.push(format!("%{}%", q));
        }
    }

    // Handle sorting
    if let Some(sort_field) = &params.sort_by {
        let direction = params.sort_direction.as_deref().unwrap_or("asc");
        order_by = format!(
            "{} {}",
            map_artist_sort_field(sort_field),
            direction.to_uppercase()
        );
    }

    let where_sql = if !where_clauses.is_empty() {
        format!("WHERE {}", where_clauses.join(" AND "))
    } else {
        String::new()
    };

    let query_sql = format!(
        r#"
        SELECT
            a.*,
            COALESCE(s.song_count, 0) as song_count,
            COALESCE(al.album_count, 0) as album_count,
            COALESCE(s.total_duration, 0) as total_duration
        FROM artists a
        LEFT JOIN (
            SELECT artist_rowid, COUNT(*) as song_count, SUM(duration) as total_duration
            FROM songs
            WHERE deleted_at IS NULL
            GROUP BY artist_rowid
        ) s ON a.rowid = s.artist_rowid
        LEFT JOIN (
            SELECT artist_rowid, COUNT(*) as album_count
            FROM albums
            WHERE deleted_at IS NULL
            GROUP BY artist_rowid
        ) al ON a.rowid = al.artist_rowid
        {}
        ORDER BY {}
        LIMIT ? OFFSET ?
        "#,
        where_sql, order_by
    );

    let count_sql = format!("SELECT COUNT(*) FROM artists a {}", where_sql);

    Ok((query_sql, count_sql, args))
}

fn build_albums_query(params: &QueryParams) -> GrimoireResult<(String, String, Vec<String>)> {
    let mut where_clauses = vec!["al.deleted_at IS NULL".to_string()];
    let mut args = Vec::new();
    let mut joins = Vec::new();
    let mut order_by = "al.title ASC".to_string();

    // Handle full-text search
    if let Some(q) = &params.q {
        if !q.trim().is_empty() {
            joins.push("LEFT JOIN artists a ON al.artist_rowid = a.rowid".to_string());
            where_clauses.push("(al.title LIKE ? OR a.name LIKE ?)".to_string());
            let search_term = format!("%{}%", q);
            args.extend([search_term.clone(), search_term]);
        }
    }

    // Handle sorting
    if let Some(sort_field) = &params.sort_by {
        let direction = params.sort_direction.as_deref().unwrap_or("asc");
        order_by = format!(
            "{} {}",
            map_album_sort_field(sort_field),
            direction.to_uppercase()
        );
    }

    let joins_sql = if !joins.is_empty() {
        joins.join(" ")
    } else {
        String::new()
    };

    let where_sql = if !where_clauses.is_empty() {
        format!("WHERE {}", where_clauses.join(" AND "))
    } else {
        String::new()
    };

    let query_sql = format!(
        r#"
        SELECT
            al.*,
            COALESCE(s.song_count, 0) as song_count,
            COALESCE(s.total_duration, 0) as total_duration
        FROM albums al
        {}
        LEFT JOIN (
            SELECT album_rowid, COUNT(*) as song_count, SUM(duration) as total_duration
            FROM songs
            WHERE deleted_at IS NULL
            GROUP BY album_rowid
        ) s ON al.rowid = s.album_rowid
        {}
        ORDER BY {}
        LIMIT ? OFFSET ?
        "#,
        joins_sql, where_sql, order_by
    );

    let count_sql = format!("SELECT COUNT(*) FROM albums al {} {}", joins_sql, where_sql);

    Ok((query_sql, count_sql, args))
}

fn build_genres_query(params: &QueryParams) -> GrimoireResult<(String, String, Vec<String>)> {
    let mut where_clauses = vec!["g.deleted_at IS NULL".to_string()];
    let mut args = Vec::new();
    let mut order_by = "g.name ASC".to_string();

    // Handle full-text search
    if let Some(q) = &params.q {
        if !q.trim().is_empty() {
            where_clauses.push("g.name LIKE ?".to_string());
            args.push(format!("%{}%", q));
        }
    }

    // Handle sorting
    if let Some(sort_field) = &params.sort_by {
        let direction = params.sort_direction.as_deref().unwrap_or("asc");
        order_by = format!(
            "{} {}",
            map_genre_sort_field(sort_field),
            direction.to_uppercase()
        );
    }

    let where_sql = if !where_clauses.is_empty() {
        format!("WHERE {}", where_clauses.join(" AND "))
    } else {
        String::new()
    };

    let query_sql = format!(
        "SELECT * FROM genres g {} ORDER BY {} LIMIT ? OFFSET ?",
        where_sql, order_by
    );

    let count_sql = format!("SELECT COUNT(*) FROM genres g {}", where_sql);

    Ok((query_sql, count_sql, args))
}

// Filter application helpers

fn apply_song_filters(
    where_clauses: &mut Vec<String>,
    args: &mut Vec<String>,
    joins: &mut Vec<String>,
    filters: &HashMap<String, serde_json::Value>,
) -> GrimoireResult<()> {
    for (key, value) in filters {
        match key.as_str() {
            "artist" | "artist_name" => {
                joins.push("LEFT JOIN artists a ON s.artist_rowid = a.rowid".to_string());
                where_clauses.push("a.name LIKE ?".to_string());
                args.push(format!("%{}%", value.as_str().unwrap_or("")));
            }
            "album" | "album_title" => {
                joins.push("LEFT JOIN albums al ON s.album_rowid = al.rowid".to_string());
                where_clauses.push("al.title LIKE ?".to_string());
                args.push(format!("%{}%", value.as_str().unwrap_or("")));
            }
            "genre" | "genre_name" => {
                joins.push("LEFT JOIN albums al ON s.album_rowid = al.rowid".to_string());
                joins.push("LEFT JOIN genres g ON al.genre_rowid = g.rowid".to_string());
                where_clauses.push("g.name LIKE ?".to_string());
                args.push(format!("%{}%", value.as_str().unwrap_or("")));
            }
            "year_from" | "year_min" => {
                if let Some(year) = value.as_i64() {
                    where_clauses.push("s.year >= ?".to_string());
                    args.push(year.to_string());
                }
            }
            "year_to" | "year_max" => {
                if let Some(year) = value.as_i64() {
                    where_clauses.push("s.year <= ?".to_string());
                    args.push(year.to_string());
                }
            }
            "duration_min" => {
                if let Some(duration) = value.as_i64() {
                    where_clauses.push("s.duration >= ?".to_string());
                    args.push(duration.to_string());
                }
            }
            "duration_max" => {
                if let Some(duration) = value.as_i64() {
                    where_clauses.push("s.duration <= ?".to_string());
                    args.push(duration.to_string());
                }
            }
            "has_thumbnail" => {
                if let Some(has_thumb) = value.as_bool() {
                    if has_thumb {
                        where_clauses.push("s.thumbnail_id IS NOT NULL".to_string());
                    } else {
                        where_clauses.push("s.thumbnail_id IS NULL".to_string());
                    }
                }
            }
            _ => {
                // Unknown filter - skip silently
            }
        }
    }
    Ok(())
}

// Field mapping helpers

fn map_song_sort_field(field: &str) -> String {
    match field {
        "title" => "s.title".to_string(),
        "artist" => "a.name".to_string(),
        "album" => "al.title".to_string(),
        "year" => "s.year".to_string(),
        "duration" => "s.duration".to_string(),
        "track_number" => "s.track_number".to_string(),
        "created_at" => "s.created_at".to_string(),
        "updated_at" => "s.updated_at".to_string(),
        _ => "s.created_at".to_string(),
    }
}

fn map_artist_sort_field(field: &str) -> String {
    match field {
        "name" => "a.name".to_string(),
        "song_count" => "song_count".to_string(),
        "album_count" => "album_count".to_string(),
        "created_at" => "a.created_at".to_string(),
        _ => "a.name".to_string(),
    }
}

fn map_album_sort_field(field: &str) -> String {
    match field {
        "title" => "al.title".to_string(),
        "artist" => "a.name".to_string(),
        "year" => "al.year".to_string(),
        "song_count" => "song_count".to_string(),
        "total_duration" => "total_duration".to_string(),
        "created_at" => "al.created_at".to_string(),
        _ => "al.title".to_string(),
    }
}

fn map_genre_sort_field(field: &str) -> String {
    match field {
        "name" => "g.name".to_string(),
        "created_at" => "g.created_at".to_string(),
        _ => "g.name".to_string(),
    }
}

// Result conversion helpers

#[derive(sqlx::FromRow)]
struct ArtistWithStats {
    // Artist fields
    pub rowid: i64,
    pub id: String,
    pub name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub deleted_by: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
    // Aggregated fields
    pub song_count: i64,
    pub album_count: i64,
    pub total_duration: Option<i64>,
}

#[derive(sqlx::FromRow)]
struct AlbumWithStats {
    // Album fields
    pub rowid: i64,
    pub id: String,
    pub title: String,
    pub album_type: String,
    pub release_date: Option<String>,
    pub release_date_precision: Option<String>,
    pub label: Option<String>,
    pub genre_rowid: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub deleted_by: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
    // Aggregated fields
    pub song_count: i64,
    pub total_duration: Option<i64>,
}

fn convert_songs_basic(songs: Vec<Song>) -> Vec<SongQueryResult> {
    songs
        .into_iter()
        .map(|song| SongQueryResult {
            song,
            artist: None,
            album: None,
            genre: None,
            relevance_score: None,
            snippet: None,
        })
        .collect()
}

async fn convert_songs_with_relations(
    songs: Vec<Song>,
    _pool: &SqlitePool,
) -> GrimoireResult<Vec<SongQueryResult>> {
    // TODO: Implement relation fetching for songs
    // For now, return basic conversion
    Ok(convert_songs_basic(songs))
}

fn convert_artist_rows(rows: Vec<ArtistWithStats>) -> Vec<ArtistQueryResult> {
    rows.into_iter()
        .map(|row| ArtistQueryResult {
            artist: Artist {
                rowid: row.rowid,
                id: row.id,
                name: row.name,
                created_at: row.created_at,
                updated_at: row.updated_at,
                deleted_at: row.deleted_at,
                deleted_by: row.deleted_by,
                created_by: row.created_by,
                updated_by: row.updated_by,
            },
            song_count: row.song_count,
            album_count: row.album_count,
            total_duration: row.total_duration,
            relevance_score: None,
            snippet: None,
        })
        .collect()
}

fn convert_albums_basic(rows: Vec<AlbumWithStats>) -> Vec<AlbumQueryResult> {
    rows.into_iter()
        .map(|row| AlbumQueryResult {
            album: Album {
                rowid: row.rowid,
                id: row.id,
                title: row.title,
                album_type: row.album_type,
                release_date: row.release_date,
                release_date_precision: row.release_date_precision,
                label: row.label,
                genre_rowid: row.genre_rowid,
                song_count: row.song_count,
                total_duration: row.total_duration.unwrap_or(0),
                created_at: row.created_at,
                updated_at: row.updated_at,
                deleted_at: row.deleted_at,
                deleted_by: row.deleted_by,
                created_by: row.created_by,
                updated_by: row.updated_by,
            },
            artist: None,
            genre: None,
            song_count: row.song_count,
            total_duration: row.total_duration,
            relevance_score: None,
            snippet: None,
        })
        .collect()
}

async fn convert_albums_with_relations(
    rows: Vec<AlbumWithStats>,
    _pool: &SqlitePool,
) -> GrimoireResult<Vec<AlbumQueryResult>> {
    // TODO: Implement relation fetching for albums
    // For now, return basic conversion
    Ok(convert_albums_basic(rows))
}

// Legacy compatibility functions (can be removed once consumers are updated)

/// search songs - legacy compatibility wrapper
#[deprecated(note = "Use query_songs with QueryParams instead")]
pub async fn search_songs(query: &str) -> GrimoireResult<Vec<Song>> {
    let params = QueryParams {
        q: Some(query.to_string()),
        ..Default::default()
    };

    let _result = query_songs(params).await?;

    // Convert SongQueryResult back to Song for compatibility
    // TODO: Remove this function once all consumers use the new API
    Ok(vec![])
}

/// list songs by artist - legacy compatibility wrapper
#[deprecated(note = "Use query_songs with artist filter instead")]
pub async fn list_songs_by_artist(artist_id: &str) -> GrimoireResult<Vec<Song>> {
    let mut filters = HashMap::new();
    filters.insert(
        "artist_id".to_string(),
        serde_json::Value::String(artist_id.to_string()),
    );

    let params = QueryParams {
        filters,
        ..Default::default()
    };

    let _result = query_songs(params).await?;
    Ok(vec![])
}

/// list songs by album - legacy compatibility wrapper
#[deprecated(note = "Use query_songs with album filter instead")]
pub async fn list_songs_by_album(album_id: &str) -> GrimoireResult<Vec<Song>> {
    let mut filters = HashMap::new();
    filters.insert(
        "album_id".to_string(),
        serde_json::Value::String(album_id.to_string()),
    );

    let params = QueryParams {
        filters,
        sort_by: Some("track_number".to_string()),
        ..Default::default()
    };

    let _result = query_songs(params).await?;
    Ok(vec![])
}

/// get albums by artist - legacy compatibility wrapper
#[deprecated(note = "Use query_albums with artist filter instead")]
pub async fn list_albums_by_artist(artist_id: &str) -> GrimoireResult<Vec<Album>> {
    let mut filters = HashMap::new();
    filters.insert(
        "artist_id".to_string(),
        serde_json::Value::String(artist_id.to_string()),
    );

    let params = QueryParams {
        filters,
        ..Default::default()
    };

    let _result = query_albums(params).await?;
    Ok(vec![])
}

/// get songs by genre - legacy compatibility wrapper
#[deprecated(note = "Use query_songs with genre filter instead")]
pub async fn list_songs_by_genre(genre_id: &str) -> GrimoireResult<Vec<Song>> {
    let mut filters = HashMap::new();
    filters.insert(
        "genre_id".to_string(),
        serde_json::Value::String(genre_id.to_string()),
    );

    let params = QueryParams {
        filters,
        ..Default::default()
    };

    let _result = query_songs(params).await?;
    Ok(vec![])
}

/// get recently added songs - legacy compatibility wrapper
#[deprecated(note = "Use query_songs with sort_by created_at desc instead")]
pub async fn list_recent_songs(limit: Option<i64>) -> GrimoireResult<Vec<Song>> {
    let params = QueryParams {
        sort_by: Some("created_at".to_string()),
        sort_direction: Some("desc".to_string()),
        limit,
        ..Default::default()
    };

    let _result = query_songs(params).await?;
    Ok(vec![])
}
