//! Filter metadata API endpoints for search filters
//! #todo: get the sql outta here! too complex!

use crate::auth::AuthenticatedUser;
use axum::{
    extract::{Extension, Query},
    http::StatusCode,
    response::Json,
    routing::get,
    Router,
};
use grimoire::DatabaseConnection;
use serde::{Deserialize, Serialize};
use sqlx::Row;

/// Query parameters for filter metadata requests
#[derive(Debug, Deserialize)]
pub struct FilterParams {
    /// Maximum number of items to return
    #[serde(default = "default_limit")]
    pub limit: u32,
    /// Minimum count threshold to include item
    #[serde(default)]
    pub min_count: u32,
}

/// Filter option with count information
#[derive(Debug, Serialize)]
pub struct FilterOption {
    /// Filter value (used in API calls)
    pub value: String,
    /// Display label for UI
    pub label: String,
    /// Number of songs with this filter value
    pub count: u32,
}

/// Response for genre filters
#[derive(Debug, Serialize)]
pub struct GenreFiltersResponse {
    /// Available genre options
    pub genres: Vec<FilterOption>,
    /// Total number of unique genres
    pub total_count: u32,
}

/// Response for artist filters
#[derive(Debug, Serialize)]
pub struct ArtistFiltersResponse {
    /// Available artist options
    pub artists: Vec<FilterOption>,
    /// Total number of unique artists
    pub total_count: u32,
}

/// Response for year filters
#[derive(Debug, Serialize)]
pub struct YearFiltersResponse {
    /// Available year options
    pub years: Vec<FilterOption>,
    /// Total number of unique years
    pub total_count: u32,
}

/// Combined metadata for all filter types
#[derive(Debug, Serialize)]
pub struct AllFiltersResponse {
    /// Genre filter options
    pub genres: Vec<FilterOption>,
    /// Artist filter options
    pub artists: Vec<FilterOption>,
    /// Year filter options
    pub years: Vec<FilterOption>,
    /// Rating range information
    pub rating_range: RatingRange,
    /// Summary statistics
    pub summary: FilterSummary,
}

/// Rating range information
#[derive(Debug, Serialize)]
pub struct RatingRange {
    /// Minimum rating value
    pub min: i32,
    /// Maximum rating value
    pub max: i32,
    /// Most common rating
    pub most_common: Option<i32>,
}

/// Summary statistics for filters
#[derive(Debug, Serialize)]
pub struct FilterSummary {
    /// Total number of songs
    pub total_songs: u64,
    /// Number of songs with ratings
    pub rated_songs: u64,
    /// Number of favorite songs
    pub favorite_songs: u64,
    /// Number of unique genres
    pub unique_genres: u32,
    /// Number of unique artists
    pub unique_artists: u32,
    /// Number of unique years
    pub unique_years: u32,
}

// Default values
fn default_limit() -> u32 {
    50
}

/// Get genre filter options with counts
pub async fn get_genre_filters(
    Extension(_user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<FilterParams>,
) -> Result<Json<GenreFiltersResponse>, StatusCode> {
    let query = r#"
        SELECT
            genre,
            COUNT(*) as count
        FROM songs
        WHERE deleted_at IS NULL
        AND genre IS NOT NULL
        AND genre != ''
        GROUP BY genre
        HAVING COUNT(*) >= $1
        ORDER BY count DESC, genre ASC
        LIMIT $2
    "#;

    let rows = sqlx::query(query)
        .bind(params.min_count as i64)
        .bind(params.limit as i64)
        .fetch_all(db.pool())
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch genre filters: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let genres: Vec<FilterOption> = rows
        .into_iter()
        .map(|row| {
            let genre: String = row.get("genre");
            let count: i64 = row.get("count");
            FilterOption {
                value: genre.clone(),
                label: genre,
                count: count as u32,
            }
        })
        .collect();

    let total_count = genres.len() as u32;

    Ok(Json(GenreFiltersResponse {
        genres,
        total_count,
    }))
}

/// Get artist filter options with counts
pub async fn get_artist_filters(
    Extension(_user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<FilterParams>,
) -> Result<Json<ArtistFiltersResponse>, StatusCode> {
    let query = r#"
        SELECT
            artist,
            COUNT(*) as count
        FROM songs
        WHERE deleted_at IS NULL
        AND artist IS NOT NULL
        AND artist != ''
        GROUP BY artist
        HAVING COUNT(*) >= $1
        ORDER BY count DESC, artist ASC
        LIMIT $2
    "#;

    let rows = sqlx::query(query)
        .bind(params.min_count as i64)
        .bind(params.limit as i64)
        .fetch_all(db.pool())
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch artist filters: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let artists: Vec<FilterOption> = rows
        .into_iter()
        .map(|row| {
            let artist: String = row.get("artist");
            let count: i64 = row.get("count");
            FilterOption {
                value: artist.clone(),
                label: artist,
                count: count as u32,
            }
        })
        .collect();

    let total_count = artists.len() as u32;

    Ok(Json(ArtistFiltersResponse {
        artists,
        total_count,
    }))
}

/// Get year filter options with counts
pub async fn get_year_filters(
    Extension(_user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<FilterParams>,
) -> Result<Json<YearFiltersResponse>, StatusCode> {
    let query = r#"
        SELECT
            year,
            COUNT(*) as count
        FROM songs
        WHERE deleted_at IS NULL
        AND year IS NOT NULL
        GROUP BY year
        HAVING COUNT(*) >= $1
        ORDER BY year DESC
        LIMIT $2
    "#;

    let rows = sqlx::query(query)
        .bind(params.min_count as i64)
        .bind(params.limit as i64)
        .fetch_all(db.pool())
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch year filters: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let years: Vec<FilterOption> = rows
        .into_iter()
        .map(|row| {
            let year: i32 = row.get("year");
            let count: i64 = row.get("count");
            FilterOption {
                value: year.to_string(),
                label: year.to_string(),
                count: count as u32,
            }
        })
        .collect();

    let total_count = years.len() as u32;

    Ok(Json(YearFiltersResponse { years, total_count }))
}

/// Get all filter metadata in a single request
pub async fn get_all_filters(
    Extension(_user): Extension<AuthenticatedUser>,
    Extension(db): Extension<DatabaseConnection>,
    Query(params): Query<FilterParams>,
) -> Result<Json<AllFiltersResponse>, StatusCode> {
    // Get genres
    let genre_query = r#"
        SELECT
            genre,
            COUNT(*) as count
        FROM songs
        WHERE deleted_at IS NULL
        AND genre IS NOT NULL
        AND genre != ''
        GROUP BY genre
        HAVING COUNT(*) >= $1
        ORDER BY count DESC, genre ASC
        LIMIT $2
    "#;

    let genre_rows = sqlx::query(genre_query)
        .bind(params.min_count as i64)
        .bind(params.limit as i64)
        .fetch_all(db.pool())
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch genre filters: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let genres: Vec<FilterOption> = genre_rows
        .into_iter()
        .map(|row| {
            let genre: String = row.get("genre");
            let count: i64 = row.get("count");
            FilterOption {
                value: genre.clone(),
                label: genre,
                count: count as u32,
            }
        })
        .collect();

    // Get artists
    let artist_query = r#"
        SELECT
            artist,
            COUNT(*) as count
        FROM songs
        WHERE deleted_at IS NULL
        AND artist IS NOT NULL
        AND artist != ''
        GROUP BY artist
        HAVING COUNT(*) >= $1
        ORDER BY count DESC, artist ASC
        LIMIT $2
    "#;

    let artist_rows = sqlx::query(artist_query)
        .bind(params.min_count as i64)
        .bind(params.limit as i64)
        .fetch_all(db.pool())
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch artist filters: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let artists: Vec<FilterOption> = artist_rows
        .into_iter()
        .map(|row| {
            let artist: String = row.get("artist");
            let count: i64 = row.get("count");
            FilterOption {
                value: artist.clone(),
                label: artist,
                count: count as u32,
            }
        })
        .collect();

    // Get years
    let year_query = r#"
        SELECT
            year,
            COUNT(*) as count
        FROM songs
        WHERE deleted_at IS NULL
        AND year IS NOT NULL
        GROUP BY year
        HAVING COUNT(*) >= $1
        ORDER BY year DESC
        LIMIT $2
    "#;

    let year_rows = sqlx::query(year_query)
        .bind(params.min_count as i64)
        .bind(params.limit as i64)
        .fetch_all(db.pool())
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch year filters: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let years: Vec<FilterOption> = year_rows
        .into_iter()
        .map(|row| {
            let year: i32 = row.get("year");
            let count: i64 = row.get("count");
            FilterOption {
                value: year.to_string(),
                label: year.to_string(),
                count: count as u32,
            }
        })
        .collect();

    // Get rating range and summary statistics
    let stats_query = r#"
        SELECT
            COUNT(*) as total_songs,
            COUNT(rating) as rated_songs,
            COUNT(*) FILTER (WHERE is_favorite = true) as favorite_songs,
            MIN(rating) as min_rating,
            MAX(rating) as max_rating,
            MODE() WITHIN GROUP (ORDER BY rating) as most_common_rating,
            COUNT(DISTINCT genre) FILTER (WHERE genre IS NOT NULL AND genre != '') as unique_genres,
            COUNT(DISTINCT artist) FILTER (WHERE artist IS NOT NULL AND artist != '') as unique_artists,
            COUNT(DISTINCT year) FILTER (WHERE year IS NOT NULL) as unique_years
        FROM songs
        WHERE deleted_at IS NULL
    "#;

    let stats_row = sqlx::query(stats_query)
        .fetch_one(db.pool())
        .await
        .map_err(|e| {
            tracing::error!("Failed to fetch filter statistics: {}", e);
            StatusCode::INTERNAL_SERVER_ERROR
        })?;

    let total_songs: i64 = stats_row.get("total_songs");
    let rated_songs: i64 = stats_row.get("rated_songs");
    let favorite_songs: i64 = stats_row.get("favorite_songs");
    let min_rating: Option<i32> = stats_row.get("min_rating");
    let max_rating: Option<i32> = stats_row.get("max_rating");
    let most_common_rating: Option<i32> = stats_row.get("most_common_rating");
    let unique_genres: i64 = stats_row.get("unique_genres");
    let unique_artists: i64 = stats_row.get("unique_artists");
    let unique_years: i64 = stats_row.get("unique_years");

    let rating_range = RatingRange {
        min: min_rating.unwrap_or(1),
        max: max_rating.unwrap_or(5),
        most_common: most_common_rating,
    };

    let summary = FilterSummary {
        total_songs: total_songs as u64,
        rated_songs: rated_songs as u64,
        favorite_songs: favorite_songs as u64,
        unique_genres: unique_genres as u32,
        unique_artists: unique_artists as u32,
        unique_years: unique_years as u32,
    };

    Ok(Json(AllFiltersResponse {
        genres,
        artists,
        years,
        rating_range,
        summary,
    }))
}

/// Create filter routes
pub fn create_filter_routes() -> Router {
    Router::new()
        .route("/filters/genres", get(get_genre_filters))
        .route("/filters/artists", get(get_artist_filters))
        .route("/filters/years", get(get_year_filters))
        .route("/filters/metadata", get(get_all_filters))
}
