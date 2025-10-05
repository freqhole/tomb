//! Genre API endpoints for music library organization
//!
//! This module provides endpoints for browsing and searching genres:
//! - GET /api/music/genres - returns all predefined genres with statistics
//! - POST /api/music/genres - search/filter within genres with pagination

use crate::auth::AuthenticatedUser;
use axum::{
    extract::{Extension, Query},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use grimoire::{database::DatabaseConnection, AppConfig};
use serde::{Deserialize, Serialize};
use sqlx::Row;

/// Query parameters for GET /api/music/genres
#[derive(Debug, Deserialize)]
pub struct GenreStatsQuery {
    /// Include only genres with songs (default: false, shows all predefined genres)
    #[serde(default)]
    pub with_songs_only: bool,
}

/// Individual genre statistics
#[derive(Debug, Serialize)]
pub struct GenreStat {
    pub name: String,
    pub song_count: i64,
    pub album_count: i64,
    pub artist_count: i64,
    pub total_duration: i64,
}

/// Response for GET /api/music/genres
#[derive(Debug, Serialize)]
pub struct GenreStatsResponse {
    pub genres: Vec<GenreStat>,
    pub total: i64,
}

/// GET /api/music/genres - get all predefined genres with statistics
pub async fn get_genres(
    Extension(_user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Extension(config): Extension<AppConfig>,
    Query(query): Query<GenreStatsQuery>,
) -> Result<Json<GenreStatsResponse>, StatusCode> {
    // Get predefined genres from config
    let predefined_genres = config
        .media
        .genres
        .clone()
        .unwrap_or_else(|| vec!["rock".to_string(), "pop".to_string(), "jazz".to_string()]);

    if predefined_genres.is_empty() {
        return Err(StatusCode::INTERNAL_SERVER_ERROR);
    }

    // Build genre stats query using direct SQL
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
    for genre in &predefined_genres {
        query_builder = query_builder.bind(genre);
    }

    let rows = query_builder.fetch_all(db.pool()).await.map_err(|e| {
        tracing::error!("failed to fetch genre stats: {}", e);
        StatusCode::INTERNAL_SERVER_ERROR
    })?;

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
    if query.with_songs_only {
        genres.retain(|genre| genre.song_count > 0);
    }

    let total = genres.len() as i64;

    Ok(Json(GenreStatsResponse { genres, total }))
}

/// Helper function to parse comma-separated sub-genres input
pub fn parse_sub_genres_input(input: &str) -> Vec<String> {
    input
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_lowercase())
        .collect()
}

/// Helper function to format sub-genres array for display
pub fn format_sub_genres_display(sub_genres: &[String]) -> String {
    sub_genres.join(", ")
}

/// Create genre routes
pub fn create_genre_routes() -> Router {
    Router::new().route("/genres", get(get_genres))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_sub_genres_input() {
        let input = "rock, pop, jazz, ";
        let result = parse_sub_genres_input(input);
        assert_eq!(result, vec!["rock", "pop", "jazz"]);

        let input = "  electronic  ,  ambient  ,  ";
        let result = parse_sub_genres_input(input);
        assert_eq!(result, vec!["electronic", "ambient"]);

        let input = "";
        let result = parse_sub_genres_input(input);
        assert_eq!(result, Vec::<String>::new());
    }

    #[test]
    fn test_format_sub_genres_display() {
        let sub_genres = vec!["rock".to_string(), "pop".to_string(), "jazz".to_string()];
        let result = format_sub_genres_display(&sub_genres);
        assert_eq!(result, "rock, pop, jazz");

        let empty: Vec<String> = vec![];
        let result = format_sub_genres_display(&empty);
        assert_eq!(result, "");
    }

    #[test]
    fn test_genre_search_body_conversion() {
        let body = GenreSearchBody {
            genre: Some("rock".to_string()),
            artist: Some("artist name".to_string()),
            q: Some("search term".to_string()),
            tags: Some(vec!["tag1".to_string(), "tag2".to_string()]),
            sort_by: Some("songs".to_string()),
            sort_direction: Some("desc".to_string()),
            page: Some(2),
            page_size: Some(25),
        };

        let request: GenreSearchRequest = body.into();
        assert_eq!(request.genre, Some("rock".to_string()));
        assert_eq!(request.artist, Some("artist name".to_string()));
        assert_eq!(request.q, Some("search term".to_string()));
        assert_eq!(
            request.tags,
            Some(vec!["tag1".to_string(), "tag2".to_string()])
        );
        assert_eq!(request.sort_by, Some("songs".to_string()));
        assert_eq!(request.sort_direction, Some("desc".to_string()));
        assert_eq!(request.page, Some(2));
        assert_eq!(request.page_size, Some(25));
    }
}
