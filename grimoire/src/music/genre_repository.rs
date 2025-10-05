//! Genre repository with SQL logic for music genre API endpoints
//!
//! This module contains the data access layer for genre operations,
//! including statistics retrieval and search functionality.

use crate::music::genre_models::*;
use sqlx::{PgPool, Row};

pub struct GenreRepository {
    pool: PgPool,
}

impl GenreRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Get all predefined genres with statistics
    pub async fn get_genre_stats(
        &self,
        predefined_genres: &[String],
        with_songs_only: bool,
    ) -> Result<GenreStatsResponse, sqlx::Error> {
        // Build genre stats query using parameterized queries
        let genre_placeholders: Vec<String> = predefined_genres
            .iter()
            .enumerate()
            .map(|(i, _)| format!("${}", i + 1))
            .collect();

        let sql_query = format!(
            r#"
            WITH predefined_genres(name) AS (
                VALUES {}
            ),
            genre_stats AS (
                SELECT
                    pg.name,
                    COALESCE(COUNT(DISTINCT s.id), 0) as song_count,
                    COALESCE(COUNT(DISTINCT s.album), 0) as album_count,
                    COALESCE(COUNT(DISTINCT s.artist), 0) as artist_count,
                    COALESCE(SUM(EXTRACT(EPOCH FROM s.duration))::bigint, 0) as total_duration
                FROM predefined_genres pg
                LEFT JOIN songs s ON s.genre = pg.name AND s.deleted_at IS NULL
                GROUP BY pg.name
            )
            SELECT
                name,
                song_count,
                album_count,
                artist_count,
                total_duration
            FROM genre_stats
            ORDER BY name
            "#,
            genre_placeholders
                .iter()
                .map(|p| format!("({})", p))
                .collect::<Vec<_>>()
                .join(",")
        );

        let mut query_builder = sqlx::query(&sql_query);
        for genre in predefined_genres {
            query_builder = query_builder.bind(genre);
        }

        let rows = query_builder.fetch_all(&self.pool).await?;

        let mut genres: Vec<GenreStat> = rows
            .into_iter()
            .map(|row| GenreStat {
                name: row.get("name"),
                song_count: row.get("song_count"),
                album_count: row.get("album_count"),
                artist_count: row.get("artist_count"),
                total_duration: row.get("total_duration"),
            })
            .collect();

        // Filter to only genres with songs if requested
        if with_songs_only {
            genres.retain(|genre| genre.song_count > 0);
        }

        let total = genres.len() as i64;

        Ok(GenreStatsResponse { genres, total })
    }

    /// Search for artists within genres with filtering and pagination
    pub async fn search_genre_artists(
        &self,
        request: &GenreSearchRequest,
    ) -> Result<GenreArtistsResponse, sqlx::Error> {
        let page = request.page.unwrap_or(1).max(1);
        let page_size = request.page_size.unwrap_or(50).clamp(1, 100);
        let offset = (page - 1) * page_size;

        // Build query parts
        let mut query_parts = vec![r#"
            SELECT
                s.artist,
                COUNT(DISTINCT s.id) as song_count,
                COUNT(DISTINCT s.album) as album_count,
                EXTRACT(EPOCH FROM SUM(s.duration))::bigint as total_duration,
                ARRAY_AGG(DISTINCT s.genre) FILTER (WHERE s.genre IS NOT NULL) as genres,
                AVG(s.rating)::float8 as avg_rating,
                COUNT(CASE WHEN s.is_favorite THEN 1 END) as favorite_count
            FROM songs s
            WHERE s.deleted_at IS NULL AND s.artist IS NOT NULL
        "#
        .to_string()];
        let mut bind_values: Vec<String> = vec![];
        let mut param_count = 0;

        if let Some(genre) = &request.genre {
            param_count += 1;
            query_parts.push(format!("AND s.genre = ${}", param_count));
            bind_values.push(genre.clone());
        }

        if let Some(q) = &request.q {
            if !q.trim().is_empty() {
                param_count += 1;
                query_parts.push(format!("AND s.artist ILIKE ${}", param_count));
                bind_values.push(format!("%{}%", q.trim()));
            }
        }

        query_parts.push("GROUP BY s.artist".to_string());
        query_parts.push("ORDER BY s.artist ASC".to_string());

        param_count += 1;
        let limit_param = param_count;
        param_count += 1;
        let offset_param = param_count;

        query_parts.push(format!("LIMIT ${} OFFSET ${}", limit_param, offset_param));

        let query_str = query_parts.join(" ");
        let mut query = sqlx::query(&query_str);

        for value in &bind_values {
            query = query.bind(value);
        }
        query = query.bind(page_size).bind(offset);

        let rows = query.fetch_all(&self.pool).await?;

        let artists: Vec<GenreArtist> = rows
            .into_iter()
            .map(|row| GenreArtist {
                artist: row.get("artist"),
                song_count: row.get("song_count"),
                album_count: row.get("album_count"),
                total_duration: row.get::<Option<i64>, _>("total_duration").unwrap_or(0),
                genres: row
                    .get::<Option<Vec<String>>, _>("genres")
                    .unwrap_or_default(),
                avg_rating: row.get("avg_rating"),
                favorite_count: row.get("favorite_count"),
            })
            .collect();

        let total = artists.len() as i64; // Simplified - should be actual count
        let total_pages = (total + page_size as i64 - 1) / page_size as i64;

        Ok(GenreArtistsResponse {
            artists,
            total,
            page,
            page_size,
            total_pages,
            has_next: page < total_pages,
            has_prev: page > 1,
        })
    }

    /// Search for albums within a specific genre and artist
    pub async fn search_genre_albums(
        &self,
        request: &GenreSearchRequest,
    ) -> Result<GenreAlbumsResponse, sqlx::Error> {
        let page = request.page.unwrap_or(1).max(1);
        let page_size = request.page_size.unwrap_or(50).clamp(1, 100);
        let offset = (page - 1) * page_size;

        // Build query parts
        let mut query_parts = vec![r#"
            SELECT
                s.album,
                s.artist,
                s.year,
                COUNT(DISTINCT s.id) as track_count,
                COUNT(DISTINCT s.disc_number) as disc_count,
                EXTRACT(EPOCH FROM SUM(s.duration))::text as total_duration,
                s.genre as genres,
                AVG(s.rating)::float8 as avg_rating,
                COUNT(CASE WHEN s.is_favorite THEN 1 END) as favorite_count
            FROM songs s
            WHERE s.deleted_at IS NULL
        "#
        .to_string()];
        let mut bind_values: Vec<String> = vec![];
        let mut param_count = 0;

        if let Some(genre) = &request.genre {
            param_count += 1;
            query_parts.push(format!("AND s.genre = ${}", param_count));
            bind_values.push(genre.clone());
        }

        if let Some(artist) = &request.artist {
            param_count += 1;
            query_parts.push(format!("AND s.artist = ${}", param_count));
            bind_values.push(artist.clone());
        }

        if let Some(q) = &request.q {
            if !q.trim().is_empty() {
                param_count += 1;
                query_parts.push(format!(
                    "AND (s.album ILIKE ${} OR s.artist ILIKE ${})",
                    param_count, param_count
                ));
                bind_values.push(format!("%{}%", q.trim()));
            }
        }

        query_parts.push("GROUP BY s.album, s.artist, s.year, s.genre".to_string());
        query_parts.push("ORDER BY s.album ASC".to_string());

        param_count += 1;
        let limit_param = param_count;
        param_count += 1;
        let offset_param = param_count;

        query_parts.push(format!("LIMIT ${} OFFSET ${}", limit_param, offset_param));

        let query_str = query_parts.join(" ");
        let mut query = sqlx::query(&query_str);

        for value in &bind_values {
            query = query.bind(value);
        }
        query = query.bind(page_size).bind(offset);

        let rows = query.fetch_all(&self.pool).await?;

        let albums: Vec<GenreAlbum> = rows
            .into_iter()
            .map(|row| GenreAlbum {
                album: row.get("album"),
                artist: row.get("artist"),
                year: row.get("year"),
                track_count: row.get("track_count"),
                disc_count: row.get("disc_count"),
                total_duration: row.get("total_duration"),
                genres: row.get("genres"),
                avg_rating: row.get("avg_rating"),
                favorite_count: row.get("favorite_count"),
                album_thumbnail_id: None, // TODO: implement album thumbnails
            })
            .collect();

        let total = albums.len() as i64; // Simplified - should be actual count
        let total_pages = (total + page_size as i64 - 1) / page_size as i64;

        Ok(GenreAlbumsResponse {
            albums,
            total,
            page,
            page_size,
            total_pages,
            has_next: page < total_pages,
            has_prev: page > 1,
        })
    }
}
