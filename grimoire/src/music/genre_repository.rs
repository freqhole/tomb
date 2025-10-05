//! Genre repository with SQL logic for music genre API endpoints
//!
//! This module contains the data access layer for genre operations,
//! including statistics retrieval and search functionality.

use crate::config::app_config::GenreConfig;
use crate::music::genre_models::*;
use sqlx::{PgPool, Row};

pub struct GenreRepository {
    pool: PgPool,
}

impl GenreRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Get all predefined genres with statistics using grouping logic
    pub async fn get_genre_stats_with_grouping(
        &self,
        predefined_genres: &[GenreConfig],
        with_songs_only: bool,
    ) -> Result<GenreStatsResponse, sqlx::Error> {
        // Parse genre groups from config
        let mut genre_groups = Vec::new();
        for group in predefined_genres {
            genre_groups.push((
                group.display.clone(),
                group.slug.clone(),
                group.genres.clone(),
            ));
        }

        // Build genre stats query using grouping logic
        let mut genre_cases = Vec::new();
        let mut bind_params = Vec::new();
        let mut param_index = 1;

        for (group_name, _group_slug, individual_genres) in &genre_groups {
            let genre_conditions: Vec<String> = individual_genres
                .iter()
                .map(|_| {
                    let condition = format!("LOWER(s.genre) = LOWER(${})", param_index);
                    param_index += 1;
                    condition
                })
                .collect();

            let case_when = format!(
                "WHEN {} THEN ${}",
                genre_conditions.join(" OR "),
                param_index
            );
            param_index += 1;

            genre_cases.push(case_when);
            bind_params.extend(individual_genres.clone());
            bind_params.push(group_name.clone());
        }

        let sql_query = format!(
            r#"
            WITH genre_mapping AS (
                SELECT
                    s.id,
                    s.album,
                    s.artist,
                    s.duration,
                    CASE
                        {}
                        ELSE NULL
                    END as genre_group
                FROM songs s
                WHERE s.deleted_at IS NULL
            ),
            genre_stats AS (
                SELECT
                    genre_group as name,
                    COUNT(DISTINCT id) as song_count,
                    COUNT(DISTINCT album) as album_count,
                    COUNT(DISTINCT artist) as artist_count,
                    COALESCE(SUM(EXTRACT(EPOCH FROM duration))::bigint, 0) as total_duration
                FROM genre_mapping
                WHERE genre_group IS NOT NULL
                GROUP BY genre_group
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
            genre_cases.join("\n                        ")
        );

        let mut query_builder = sqlx::query(&sql_query);
        for param in bind_params {
            query_builder = query_builder.bind(param);
        }

        let rows = query_builder.fetch_all(&self.pool).await?;

        let mut genres: Vec<GenreStat> = rows
            .into_iter()
            .map(|row| {
                let display_name: String = row.get("name");
                // Find the slug for this display name
                let slug = genre_groups
                    .iter()
                    .find(|(name, _slug, _genres)| name == &display_name)
                    .map(|(_name, slug, _genres)| slug.clone())
                    .unwrap_or_else(|| display_name.to_lowercase().replace(" ", "-"));

                GenreStat {
                    name: display_name,
                    slug,
                    song_count: row.get("song_count"),
                    album_count: row.get("album_count"),
                    artist_count: row.get("artist_count"),
                    total_duration: row.get("total_duration"),
                }
            })
            .collect();

        // Filter to only genres with songs if requested
        if with_songs_only {
            genres.retain(|genre| genre.song_count > 0);
        }

        let total = genres.len() as i64;

        Ok(GenreStatsResponse { genres, total })
    }

    /// Get all predefined genres with statistics (legacy method for backward compatibility)
    pub async fn get_genre_stats(
        &self,
        predefined_genres: &[GenreConfig],
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
            query_builder = query_builder.bind(&genre.display);
        }

        let rows = query_builder.fetch_all(&self.pool).await?;

        let mut genres: Vec<GenreStat> = rows
            .into_iter()
            .map(|row| {
                let display_name: String = row.get("name");
                // Find the slug for this display name from predefined genres
                let slug = predefined_genres
                    .iter()
                    .find(|g| g.display == display_name)
                    .map(|g| g.slug.clone())
                    .unwrap_or_else(|| display_name.to_lowercase().replace(" ", "-"));

                GenreStat {
                    name: display_name,
                    slug,
                    song_count: row.get("song_count"),
                    album_count: row.get("album_count"),
                    artist_count: row.get("artist_count"),
                    total_duration: row.get("total_duration"),
                }
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

        // Handle single genre or expanded genres (from slug lookup)
        if let Some(expanded_genres) = &request.expanded_genres {
            if !expanded_genres.is_empty() {
                let genre_placeholders: Vec<String> = expanded_genres
                    .iter()
                    .map(|_| {
                        param_count += 1;
                        format!("${}", param_count)
                    })
                    .collect();
                query_parts.push(format!(
                    "AND s.genre IN ({})",
                    genre_placeholders.join(", ")
                ));
                for genre in expanded_genres {
                    bind_values.push(genre.clone());
                }
            }
        } else if let Some(genre) = &request.genre {
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

        if let Some(tags) = &request.tags {
            if !tags.is_empty() {
                let tag_conditions: Vec<String> = tags
                    .iter()
                    .map(|_| {
                        param_count += 1;
                        format!("${} = ANY(s.tags)", param_count)
                    })
                    .collect();
                query_parts.push(format!("AND ({})", tag_conditions.join(" OR ")));
                for tag in tags {
                    bind_values.push(tag.clone());
                }
            }
        }

        query_parts.push("GROUP BY s.artist".to_string());

        // Handle sorting
        let sort_column = match request.sort_by.as_deref() {
            Some("song_count") => "COUNT(DISTINCT s.id)",
            Some("album_count") => "COUNT(DISTINCT s.album)",
            Some("total_duration") => "SUM(s.duration)",
            Some("avg_rating") => "AVG(s.rating)",
            Some("favorite_count") => "COUNT(CASE WHEN s.is_favorite THEN 1 END)",
            _ => "s.artist",
        };

        let sort_direction = match request.sort_direction.as_deref() {
            Some("desc") => "DESC",
            _ => "ASC",
        };

        // Add secondary sort by artist name for consistent ordering when primary values are equal
        let order_clause = if sort_column == "s.artist" {
            format!("ORDER BY {} {}", sort_column, sort_direction)
        } else {
            format!("ORDER BY {} {}, s.artist ASC", sort_column, sort_direction)
        };
        query_parts.push(order_clause);

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
                COUNT(CASE WHEN s.is_favorite THEN 1 END) as favorite_count,
                (SELECT thumbnail_blob_id FROM songs s2
                 WHERE s2.album = s.album
                 AND s2.thumbnail_blob_id IS NOT NULL
                 AND s2.deleted_at IS NULL
                 ORDER BY disc_number NULLS LAST, track_number NULLS LAST
                 LIMIT 1) as album_thumbnail_id
            FROM songs s
            WHERE s.deleted_at IS NULL
        "#
        .to_string()];
        let mut bind_values: Vec<String> = vec![];
        let mut param_count = 0;

        // Handle single genre or expanded genres (from slug lookup)
        if let Some(expanded_genres) = &request.expanded_genres {
            if !expanded_genres.is_empty() {
                let genre_placeholders: Vec<String> = expanded_genres
                    .iter()
                    .map(|_| {
                        param_count += 1;
                        format!("${}", param_count)
                    })
                    .collect();
                query_parts.push(format!(
                    "AND s.genre IN ({})",
                    genre_placeholders.join(", ")
                ));
                for genre in expanded_genres {
                    bind_values.push(genre.clone());
                }
            }
        } else if let Some(genre) = &request.genre {
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

        if let Some(tags) = &request.tags {
            if !tags.is_empty() {
                let tag_conditions: Vec<String> = tags
                    .iter()
                    .map(|_| {
                        param_count += 1;
                        format!("${} = ANY(s.tags)", param_count)
                    })
                    .collect();
                query_parts.push(format!("AND ({})", tag_conditions.join(" OR ")));
                for tag in tags {
                    bind_values.push(tag.clone());
                }
            }
        }

        query_parts.push("GROUP BY s.album, s.artist, s.year, s.genre".to_string());

        // Handle sorting
        let sort_column = match request.sort_by.as_deref() {
            Some("track_count") => "COUNT(DISTINCT s.id)",
            Some("year") => "MIN(s.year)",
            Some("album") => "s.album",
            Some("artist") => "s.artist",
            Some("total_duration") => "SUM(s.duration)",
            Some("avg_rating") => "AVG(s.rating)",
            Some("favorite_count") => "COUNT(CASE WHEN s.is_favorite THEN 1 END)",
            _ => "s.album",
        };

        let sort_direction = match request.sort_direction.as_deref() {
            Some("desc") => "DESC",
            _ => "ASC",
        };

        // Add secondary sort by album name for consistent ordering when primary values are equal
        let order_clause = if sort_column == "s.album" {
            format!("ORDER BY {} {}", sort_column, sort_direction)
        } else {
            format!("ORDER BY {} {}, s.album ASC", sort_column, sort_direction)
        };
        query_parts.push(order_clause);

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
                album_thumbnail_id: row.get("album_thumbnail_id"),
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
