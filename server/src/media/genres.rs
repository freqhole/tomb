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
    routing::{get, post},
    Json as JsonExtractor, Router,
};
use grimoire::music::genre_models::{GenreSearchBody, GenreSearchRequest, GenreStatsResponse};
use grimoire::{database::DatabaseConnection, music::genre_service::GenreService, AppConfig};
use serde::Deserialize;

/// Query parameters for GET /api/music/genres
#[derive(Debug, Deserialize)]
pub struct GenreStatsQuery {
    /// Include only genres with songs (default: false, shows all predefined genres)
    #[serde(default)]
    pub with_songs_only: bool,
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

    let service = GenreService::new(db.pool().clone());

    match service
        .get_genre_stats(&predefined_genres, query.with_songs_only)
        .await
    {
        Ok(response) => Ok(Json(response)),
        Err(e) => {
            tracing::error!("failed to fetch genre stats: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
}

/// POST /api/music/genres - search/filter within genres with pagination
pub async fn search_genres(
    Extension(_user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    JsonExtractor(body): JsonExtractor<GenreSearchBody>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let request: GenreSearchRequest = body.into();
    let service = GenreService::new(db.pool().clone());

    match service.search_genres(request).await {
        Ok(response) => Ok(Json(response)),
        Err(e) => {
            tracing::error!("failed to search genres: {}", e);
            Err(StatusCode::INTERNAL_SERVER_ERROR)
        }
    }
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
    Router::new()
        .route("/genres", get(get_genres))
        .route("/genres", post(search_genres))
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
}
