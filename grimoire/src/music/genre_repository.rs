// genre repository with sql logic for music genre api endpoints
use crate::music::genre_models::*;
use sqlx::{PgPool, Row};

pub struct GenreRepository {
    pool: PgPool,
}

impl GenreRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// get all predefined genres with statistics (including zero counts for unused genres)
    pub async fn get_genre_stats(
        &self,
        predefined_genres: &[String],
    ) -> Result<GenreStatsResponse, sqlx::Error> {
        // create a temporary table with predefined genres for left join
        let genre_list = predefined_genres
            .iter()
            .map(|g| format!("('{}')", g.replace("'", "''")))
            .collect::<Vec<_>>()
            .join(",");

        let query = format!(
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
                    COALESCE(SUM(EXTRACT(EPOCH FROM s.duration)::bigint), 0) as total_duration
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
            genre_list
        );

        let rows = sqlx::query(&query).fetch_all(&self.pool).await?;

        let genres: Vec<GenreStat> = rows
            .into_iter()
            .map(|row| GenreStat {
                name: row.get("name"),
                song_count: row.get("song_count"),
                album_count: row.get("album_count"),
                artist_count: row.get("artist_count"),
                total_duration: row.get("total_duration"),
            })
            .collect();

        let total = genres.len() as i64;

        Ok(GenreStatsResponse { genres, total })
    }

    /// search for artists within genres with filtering and pagination
    pub async fn search_genre_artists(
        &self,
        request: &GenreSearchRequest,
    ) -> Result<GenreArtistsResponse, sqlx::Error> {
        let offset = request.offset();
        let limit = request.limit();
        let sort_by = request.effective_sort_by();
        let sort_direction = request.effective_sort_direction();

        // build where conditions
        let mut where_conditions = vec!["s.deleted_at IS NULL".to_string()];

        if let Some(genre) = &request.genre {
            where_conditions.push(format!("s.genre = '{}'", genre.replace("'", "''")));
        }

        if let Some(q) = &request.q {
            if !q.trim().is_empty() {
                where_conditions.push(format!(
                    "(s.artist ILIKE '%{}%' OR s.album ILIKE '%{}%' OR s.title ILIKE '%{}%')",
                    q.replace("'", "''"),
                    q.replace("'", "''"),
                    q.replace("'", "''")
                ));
            }
        }

        if let Some(tags) = &request.tags {
            if !tags.is_empty() {
                let tag_list = tags
                    .iter()
                    .map(|t| format!("'{}'", t.replace("'", "''")))
                    .collect::<Vec<_>>()
                    .join(",");
                where_conditions.push(format!("s.tags && ARRAY[{}]", tag_list));
            }
        }

        let where_clause = where_conditions.join(" AND ");

        // build order clause
        let order_clause = match sort_by {
            "songs" => format!("song_count {}", sort_direction),
            "albums" => format!("album_count {}", sort_direction),
            "rating" => format!("avg_rating {} NULLS LAST", sort_direction),
            "genre" | _ => format!("artist {}", sort_direction),
        };

        // get total count
        let count_query = format!(
            r#"
            SELECT COUNT(DISTINCT s.artist) as total
            FROM songs s
            WHERE {} AND s.artist IS NOT NULL
            "#,
            where_clause
        );

        let total_row = sqlx::query(&count_query).fetch_one(&self.pool).await?;
        let total: i64 = total_row.get("total");

        // get paginated results
        let main_query = format!(
            r#"
            SELECT
                s.artist,
                COUNT(DISTINCT s.id) as song_count,
                COUNT(DISTINCT s.album) as album_count,
                SUM(EXTRACT(EPOCH FROM s.duration)::bigint) as total_duration,
                ARRAY_AGG(DISTINCT s.genre ORDER BY s.genre) FILTER (WHERE s.genre IS NOT NULL) as genres,
                AVG(s.rating) as avg_rating,
                COUNT(CASE WHEN s.is_favorite = true THEN 1 END) as favorite_count
            FROM songs s
            WHERE {} AND s.artist IS NOT NULL
            GROUP BY s.artist
            ORDER BY {}
            LIMIT {} OFFSET {}
            "#,
            where_clause, order_clause, limit, offset
        );

        let rows = sqlx::query(&main_query).fetch_all(&self.pool).await?;

        let artists = rows
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

        let page = request.effective_page();
        let page_size = request.effective_page_size();
        let total_pages = (total + page_size as i64 - 1) / page_size as i64;

        Ok(GenreArtistsResponse {
            artists,
            total,
            page,
            page_size,
            total_pages,
            has_next: page < total_pages as i32,
            has_prev: page > 1,
        })
    }

    /// search for albums within a specific genre and artist
    pub async fn search_genre_albums(
        &self,
        request: &GenreSearchRequest,
    ) -> Result<GenreAlbumsResponse, sqlx::Error> {
        let offset = request.offset();
        let limit = request.limit();
        let sort_by = request.effective_sort_by();
        let sort_direction = request.effective_sort_direction();

        // build where conditions - artist is required for album search
        let mut where_conditions = vec!["s.deleted_at IS NULL".to_string()];

        if let Some(genre) = &request.genre {
            where_conditions.push(format!("s.genre = '{}'", genre.replace("'", "''")));
        }

        if let Some(artist) = &request.artist {
            where_conditions.push(format!("s.artist = '{}'", artist.replace("'", "''")));
        }

        if let Some(q) = &request.q {
            if !q.trim().is_empty() {
                where_conditions.push(format!(
                    "(s.album ILIKE '%{}%' OR s.title ILIKE '%{}%')",
                    q.replace("'", "''"),
                    q.replace("'", "''")
                ));
            }
        }

        if let Some(tags) = &request.tags {
            if !tags.is_empty() {
                let tag_list = tags
                    .iter()
                    .map(|t| format!("'{}'", t.replace("'", "''")))
                    .collect::<Vec<_>>()
                    .join(",");
                where_conditions.push(format!("s.tags && ARRAY[{}]", tag_list));
            }
        }

        let where_clause = where_conditions.join(" AND ");

        // build order clause
        let order_clause = match sort_by {
            "songs" => format!("track_count {}", sort_direction),
            "albums" => format!("s.album {}", sort_direction),
            "rating" => format!("avg_rating {} NULLS LAST", sort_direction),
            _ => format!("s.album {}", sort_direction),
        };

        // get total count
        let count_query = format!(
            r#"
            SELECT COUNT(DISTINCT COALESCE(s.album, 'unknown album')) as total
            FROM songs s
            WHERE {}
            "#,
            where_clause
        );

        let total_row = sqlx::query(&count_query).fetch_one(&self.pool).await?;
        let total: i64 = total_row.get("total");

        // get paginated results
        let main_query = format!(
            r#"
            SELECT
                s.album,
                s.artist,
                s.year,
                COUNT(DISTINCT s.id) as track_count,
                COUNT(DISTINCT s.disc_number) as disc_count,
                CASE
                    WHEN SUM(EXTRACT(EPOCH FROM s.duration)) IS NOT NULL THEN
                        CONCAT(
                            FLOOR(SUM(EXTRACT(EPOCH FROM s.duration)) / 60)::text,
                            ':',
                            LPAD(FLOOR(SUM(EXTRACT(EPOCH FROM s.duration)) % 60)::text, 2, '0')
                        )
                    ELSE NULL
                END as total_duration,
                STRING_AGG(DISTINCT s.genre, ', ' ORDER BY s.genre) as genres,
                AVG(s.rating) as avg_rating,
                COUNT(CASE WHEN s.is_favorite = true THEN 1 END) as favorite_count,
                s.thumbnail_blob_id as album_thumbnail_id
            FROM songs s
            WHERE {}
            GROUP BY s.album, s.artist, s.year, s.thumbnail_blob_id
            ORDER BY {}
            LIMIT {} OFFSET {}
            "#,
            where_clause, order_clause, limit, offset
        );

        let rows = sqlx::query(&main_query).fetch_all(&self.pool).await?;

        let albums = rows
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

        let page = request.effective_page();
        let page_size = request.effective_page_size();
        let total_pages = (total + page_size as i64 - 1) / page_size as i64;

        Ok(GenreAlbumsResponse {
            albums,
            total,
            page,
            page_size,
            total_pages,
            has_next: page < total_pages as i32,
            has_prev: page > 1,
        })
    }
}
