//! Music filtering queries for artists and albums with tag support
//!
//! This module provides filtering functionality for artists and albums
//! with support for tag-based filtering, search queries, and pagination.

use crate::music::models::AlbumSummary;
use sqlx::{PgPool, Row};

pub type Result<T> = std::result::Result<T, crate::music::repository::MusicRepositoryError>;

/// Artist summary data for filtering results
#[derive(Debug)]
pub struct ArtistFilterResult {
    pub artist: String,
    pub song_count: i64,
    pub album_count: i64,
    pub total_duration: f64,
    pub avg_rating: Option<f64>,
    pub favorite_count: i64,
    pub genres: Vec<String>,
}

/// Filter artists with tag support and pagination
pub async fn filter_artists(
    pool: &PgPool,
    tags: Option<&[String]>,
    query: Option<&str>,
    sort_by: Option<&str>,
    sort_direction: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<ArtistFilterResult>> {
    let mut sql_conditions = Vec::new();
    let mut has_tag_filter = false;

    // Build WHERE conditions
    if let Some(tag_list) = tags {
        if !tag_list.is_empty() {
            sql_conditions.push("s.tags && $1::text[]".to_string());
            has_tag_filter = true;
        }
    }

    if let Some(search_query) = query {
        if !search_query.trim().is_empty() {
            let param_num = if has_tag_filter { 2 } else { 1 };
            sql_conditions.push(format!("s.artist ILIKE ${}", param_num));
        }
    }

    let where_clause = if sql_conditions.is_empty() {
        String::new()
    } else {
        format!(" AND {}", sql_conditions.join(" AND "))
    };

    // Build ORDER BY clause
    let sort_by_val = sort_by.unwrap_or("artist");
    let sort_direction_val = sort_direction.unwrap_or("asc");

    let order_clause = match sort_by_val {
        "name" | "artist" => format!("s.artist {}", sort_direction_val),
        "song_count" => format!("song_count {}", sort_direction_val),
        "album_count" => format!("album_count {}", sort_direction_val),
        "rating" => format!("avg_rating {} NULLS LAST", sort_direction_val),
        _ => "s.artist ASC".to_string(),
    };

    let sql_query = format!(
        r#"
        SELECT
            s.artist,
            COUNT(DISTINCT s.id) as song_count,
            COUNT(DISTINCT s.album) as album_count,
            COALESCE(SUM(EXTRACT(EPOCH FROM s.duration)), 0) as total_duration,
            AVG(s.rating) as avg_rating,
            COUNT(CASE WHEN s.is_favorite THEN 1 END) as favorite_count,
            ARRAY_AGG(DISTINCT s.genre) FILTER (WHERE s.genre IS NOT NULL) as genres
        FROM songs s
        WHERE s.artist IS NOT NULL AND s.deleted_at IS NULL
        {}
        GROUP BY s.artist
        ORDER BY {}
        LIMIT {} OFFSET {}
        "#,
        where_clause, order_clause, limit, offset
    );

    // Execute query with proper parameter binding
    let results = match (tags, query) {
        (Some(tag_list), Some(search_query))
            if !tag_list.is_empty() && !search_query.trim().is_empty() =>
        {
            sqlx::query(&sql_query)
                .bind(tag_list)
                .bind(format!("%{}%", search_query.trim()))
                .fetch_all(pool)
                .await?
        }
        (Some(tag_list), _) if !tag_list.is_empty() => {
            sqlx::query(&sql_query)
                .bind(tag_list)
                .fetch_all(pool)
                .await?
        }
        (_, Some(search_query)) if !search_query.trim().is_empty() => {
            sqlx::query(&sql_query)
                .bind(format!("%{}%", search_query.trim()))
                .fetch_all(pool)
                .await?
        }
        _ => sqlx::query(&sql_query).fetch_all(pool).await?,
    };

    // Convert results to ArtistFilterResult
    let artists: Vec<ArtistFilterResult> = results
        .into_iter()
        .map(|row| ArtistFilterResult {
            artist: row
                .try_get::<Option<String>, _>("artist")
                .unwrap_or(None)
                .unwrap_or_default(),
            song_count: row
                .try_get::<Option<i64>, _>("song_count")
                .unwrap_or(None)
                .unwrap_or(0),
            album_count: row
                .try_get::<Option<i64>, _>("album_count")
                .unwrap_or(None)
                .unwrap_or(0),
            total_duration: row
                .try_get::<Option<f64>, _>("total_duration")
                .unwrap_or(None)
                .unwrap_or(0.0),
            avg_rating: row.try_get::<Option<f64>, _>("avg_rating").unwrap_or(None),
            favorite_count: row
                .try_get::<Option<i64>, _>("favorite_count")
                .unwrap_or(None)
                .unwrap_or(0),
            genres: row
                .try_get::<Option<Vec<String>>, _>("genres")
                .unwrap_or(None)
                .unwrap_or_default(),
        })
        .collect();

    Ok(artists)
}

/// Get filtered artists count for pagination
pub async fn get_filtered_artists_count(
    pool: &PgPool,
    tags: Option<&[String]>,
    query: Option<&str>,
) -> Result<i64> {
    let mut sql_conditions = Vec::new();
    let mut has_tag_filter = false;

    if let Some(tag_list) = tags {
        if !tag_list.is_empty() {
            sql_conditions.push("s.tags && $1::text[]".to_string());
            has_tag_filter = true;
        }
    }

    if let Some(search_query) = query {
        if !search_query.trim().is_empty() {
            let param_num = if has_tag_filter { 2 } else { 1 };
            sql_conditions.push(format!("s.artist ILIKE ${}", param_num));
        }
    }

    let where_clause = if sql_conditions.is_empty() {
        String::new()
    } else {
        format!(" AND {}", sql_conditions.join(" AND "))
    };

    let sql_query = format!(
        "SELECT COUNT(DISTINCT s.artist) FROM songs s WHERE s.artist IS NOT NULL AND s.deleted_at IS NULL{}",
        where_clause
    );

    let count: Option<i64> = match (tags, query) {
        (Some(tag_list), Some(search_query))
            if !tag_list.is_empty() && !search_query.trim().is_empty() =>
        {
            sqlx::query_scalar(&sql_query)
                .bind(tag_list)
                .bind(format!("%{}%", search_query.trim()))
                .fetch_one(pool)
                .await?
        }
        (Some(tag_list), _) if !tag_list.is_empty() => {
            sqlx::query_scalar(&sql_query)
                .bind(tag_list)
                .fetch_one(pool)
                .await?
        }
        (_, Some(search_query)) if !search_query.trim().is_empty() => {
            sqlx::query_scalar(&sql_query)
                .bind(format!("%{}%", search_query.trim()))
                .fetch_one(pool)
                .await?
        }
        _ => sqlx::query_scalar(&sql_query).fetch_one(pool).await?,
    };

    Ok(count.unwrap_or(0))
}

/// Filter albums with tag support and pagination
pub async fn filter_albums(
    pool: &PgPool,
    tags: Option<&[String]>,
    query: Option<&str>,
    artist: Option<&str>,
    year_min: Option<i32>,
    year_max: Option<i32>,
    sort_by: Option<&str>,
    sort_direction: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<AlbumSummary>> {
    // For tag filtering, we need to join with songs table
    if let Some(tag_list) = tags {
        if !tag_list.is_empty() {
            return filter_albums_with_tags(
                pool,
                tag_list,
                query,
                artist,
                year_min,
                year_max,
                sort_by,
                sort_direction,
                limit,
                offset,
            )
            .await;
        }
    }

    // Build conditions for album_summary direct query
    let mut conditions = Vec::new();

    if let Some(search_query) = query {
        if !search_query.trim().is_empty() {
            conditions.push(format!(
                "(album ILIKE '%{}%' OR artist ILIKE '%{}%')",
                search_query.replace('\'', "''"),
                search_query.replace('\'', "''")
            ));
        }
    }

    if let Some(artist_name) = artist {
        if !artist_name.trim().is_empty() {
            conditions.push(format!("artist = '{}'", artist_name.replace('\'', "''")));
        }
    }

    if let Some(min_year) = year_min {
        conditions.push(format!("year >= {}", min_year));
    }
    if let Some(max_year) = year_max {
        conditions.push(format!("year <= {}", max_year));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!(" AND {}", conditions.join(" AND "))
    };

    // Build ORDER BY clause
    let sort_by_val = sort_by.unwrap_or("year");
    let sort_direction_val = sort_direction.unwrap_or("desc");

    let order_clause = match sort_by_val {
        "name" | "album" => format!("album {}", sort_direction_val),
        "artist" => format!("artist {}", sort_direction_val),
        "year" => format!("year {} NULLS LAST", sort_direction_val),
        "rating" => format!("avg_rating {} NULLS LAST", sort_direction_val),
        _ => "year DESC NULLS LAST".to_string(),
    };

    let sql_query = format!(
        "SELECT * FROM album_summary WHERE 1=1{} ORDER BY {} LIMIT {} OFFSET {}",
        where_clause, order_clause, limit, offset
    );

    let albums = sqlx::query_as::<_, AlbumSummary>(&sql_query)
        .fetch_all(pool)
        .await?;

    Ok(albums)
}

/// Helper for filtering albums with tag requirements (joins with songs)
async fn filter_albums_with_tags(
    pool: &PgPool,
    tags: &[String],
    query: Option<&str>,
    artist: Option<&str>,
    year_min: Option<i32>,
    year_max: Option<i32>,
    sort_by: Option<&str>,
    sort_direction: Option<&str>,
    limit: i64,
    offset: i64,
) -> Result<Vec<AlbumSummary>> {
    let mut conditions = Vec::new();

    if let Some(search_query) = query {
        if !search_query.trim().is_empty() {
            conditions.push(format!(
                "(als.album ILIKE '%{}%' OR als.artist ILIKE '%{}%')",
                search_query.replace('\'', "''"),
                search_query.replace('\'', "''")
            ));
        }
    }

    if let Some(artist_name) = artist {
        if !artist_name.trim().is_empty() {
            conditions.push(format!(
                "als.artist = '{}'",
                artist_name.replace('\'', "''")
            ));
        }
    }

    if let Some(min_year) = year_min {
        conditions.push(format!("als.year >= {}", min_year));
    }
    if let Some(max_year) = year_max {
        conditions.push(format!("als.year <= {}", max_year));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!(" AND {}", conditions.join(" AND "))
    };

    let sort_by_val = sort_by.unwrap_or("year");
    let sort_direction_val = sort_direction.unwrap_or("desc");

    let order_clause = match sort_by_val {
        "name" | "album" => format!("als.album {}", sort_direction_val),
        "artist" => format!("als.artist {}", sort_direction_val),
        "year" => format!("als.year {} NULLS LAST", sort_direction_val),
        "rating" => format!("als.avg_rating {} NULLS LAST", sort_direction_val),
        _ => "als.year DESC NULLS LAST".to_string(),
    };

    let sql_query = format!(
        r#"
        SELECT DISTINCT als.*
        FROM album_summary als
        JOIN songs s ON s.album = als.album AND s.artist = als.artist
        WHERE s.tags && $1::text[] AND s.deleted_at IS NULL
        {}
        ORDER BY {}
        LIMIT {} OFFSET {}
        "#,
        where_clause, order_clause, limit, offset
    );

    let albums = sqlx::query_as::<_, AlbumSummary>(&sql_query)
        .bind(tags)
        .fetch_all(pool)
        .await?;

    Ok(albums)
}

/// Get filtered albums count for pagination
pub async fn get_filtered_albums_count(
    pool: &PgPool,
    tags: Option<&[String]>,
    query: Option<&str>,
    artist: Option<&str>,
    year_min: Option<i32>,
    year_max: Option<i32>,
) -> Result<i64> {
    if let Some(tag_list) = tags {
        if !tag_list.is_empty() {
            // Count albums that have songs with specified tags using simple approach
            let count_result = sqlx::query("SELECT COUNT(DISTINCT s.album) FROM songs s WHERE s.tags && $1::text[] AND s.deleted_at IS NULL AND s.album IS NOT NULL AND s.artist IS NOT NULL")
                .bind(tag_list)
                .fetch_one(pool)
                .await?;

            let count: i64 = count_result.try_get(0).unwrap_or(0);
            return Ok(count);
        }
    }

    // Build conditions for direct album_summary count
    let mut conditions = Vec::new();

    if let Some(search_query) = query {
        if !search_query.trim().is_empty() {
            conditions.push(format!(
                "(album ILIKE '%{}%' OR artist ILIKE '%{}%')",
                search_query.replace('\'', "''"),
                search_query.replace('\'', "''")
            ));
        }
    }

    if let Some(artist_name) = artist {
        if !artist_name.trim().is_empty() {
            conditions.push(format!("artist = '{}'", artist_name.replace('\'', "''")));
        }
    }

    if let Some(min_year) = year_min {
        conditions.push(format!("year >= {}", min_year));
    }
    if let Some(max_year) = year_max {
        conditions.push(format!("year <= {}", max_year));
    }

    let where_clause = if conditions.is_empty() {
        String::new()
    } else {
        format!(" AND {}", conditions.join(" AND "))
    };

    let sql_query = format!(
        "SELECT COUNT(*) FROM album_summary WHERE 1=1{}",
        where_clause
    );

    let count_result = sqlx::query(&sql_query).fetch_one(pool).await?;
    let count: i64 = count_result.try_get(0).unwrap_or(0);

    Ok(count)
}
