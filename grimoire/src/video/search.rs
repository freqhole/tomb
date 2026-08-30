//! video full-text search (~ the music domain's `crate::search`, but
//! scoped to the `videoz_fts`/`video_seriez_fts` tables until the
//! generic cross-domain search redesign happens - see phase 11 notes in
//! docs/video-domain-plan.md)

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use zod_gen_derive::ZodSchema;

use crate::error::GrimoireResult;
use crate::search::helpers::{
    calculate_confidence, extract_snippet, generate_highlight, sanitize_fts_query,
    text_contains_query,
};
use crate::search::models::{Suggestion, SuggestionType};

/// video search result with ranking
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct VideoSearchResult {
    pub id: String,
    pub title: String,
    pub series_id: Option<String>,
    pub series_name: Option<String>,
    pub episode_number: Option<i64>,
    pub duration_seconds: Option<f64>,
    pub thumbnail_url: Option<String>,
    pub user_rating: Option<i32>,
    pub is_favorite: bool,
    pub search_rank: f32,
    pub match_type: String,
    pub highlight: Option<String>,
}

/// search videos with full details via `videoz_fts`
pub async fn search_videos(
    pool: &SqlitePool,
    query: &str,
    user_id: Option<&str>,
    limit: u32,
    offset: u32,
) -> GrimoireResult<Vec<VideoSearchResult>> {
    #[derive(sqlx::FromRow)]
    struct VideoRow {
        video_id: String,
        video_title: String,
        series_id: Option<String>,
        series_name: Option<String>,
        episode_number: Option<i64>,
        duration_seconds: Option<f64>,
        fts_rank: f64,
        user_rating: Option<i64>,
        is_favorite: i64,
    }

    let user_id_param = user_id.unwrap_or("");
    let sanitized_query = sanitize_fts_query(query);

    let rows = sqlx::query_as!(
        VideoRow,
        r#"
        SELECT
            video.id as "video_id!: String",
            video.title as "video_title!: String",
            video.series_id as "series_id: String",
            (SELECT series.title
             FROM video_seriez series
             WHERE series.id = video.series_id AND series.deleted_at IS NULL
            ) as "series_name: String",
            video.episode_number as "episode_number: i64",
            video.duration_seconds as "duration_seconds: f64",
            fts.rank as "fts_rank!: f64",
            rating.rating as "user_rating: i64",
            CASE WHEN favorite.id IS NOT NULL THEN 1 ELSE 0 END as "is_favorite!: i64"
        FROM videoz_fts fts
        JOIN videoz video ON fts.video_id = video.id
        LEFT JOIN user_ratingz rating
            ON rating.target_id = video.id
            AND rating.target_type = 'video'
            AND rating.user_id = ?
        LEFT JOIN user_favoritez favorite
            ON favorite.target_id = video.id
            AND favorite.target_type = 'video'
            AND favorite.user_id = ?
        WHERE videoz_fts MATCH ?
            AND video.deleted_at IS NULL
            AND (rating.rating IS NULL OR rating.rating != 0)
        ORDER BY fts.rank
        LIMIT ? OFFSET ?
        "#,
        user_id_param,
        user_id_param,
        sanitized_query,
        limit,
        offset
    )
    .fetch_all(pool)
    .await?;

    let results = rows
        .into_iter()
        .map(|row| VideoSearchResult {
            id: row.video_id,
            title: row.video_title,
            series_id: row.series_id,
            series_name: row.series_name,
            episode_number: row.episode_number,
            duration_seconds: row.duration_seconds,
            thumbnail_url: None,
            user_rating: row.user_rating.map(|r| r as i32),
            is_favorite: row.is_favorite != 0,
            search_rank: row.fts_rank as f32,
            match_type: "title".to_string(),
            highlight: None,
        })
        .collect();

    Ok(results)
}

/// video series search result with ranking
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct VideoSeriesSearchResult {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub video_count: i64,
    pub thumbnail_url: Option<String>,
    pub search_rank: f32,
    pub match_type: String,
    pub highlight: Option<String>,
}

/// search video series with full details via `video_seriez_fts`
pub async fn search_video_seriez(
    pool: &SqlitePool,
    query: &str,
    limit: u32,
    offset: u32,
) -> GrimoireResult<Vec<VideoSeriesSearchResult>> {
    #[derive(sqlx::FromRow)]
    struct SeriesRow {
        series_id: String,
        series_title: String,
        description: Option<String>,
        fts_rank: f64,
        video_count: i64,
    }

    let sanitized_query = sanitize_fts_query(query);

    let rows = sqlx::query_as!(
        SeriesRow,
        r#"
        SELECT
            series.id as "series_id!: String",
            series.title as "series_title!: String",
            series.description as "description: String",
            fts.rank as "fts_rank!: f64",
            (SELECT COUNT(*) FROM videoz v WHERE v.series_id = series.id AND v.deleted_at IS NULL)
                as "video_count!: i64"
        FROM video_seriez_fts fts
        JOIN video_seriez series ON fts.series_id = series.id
        WHERE video_seriez_fts MATCH ?
            AND series.deleted_at IS NULL
        ORDER BY fts.rank
        LIMIT ? OFFSET ?
        "#,
        sanitized_query,
        limit,
        offset
    )
    .fetch_all(pool)
    .await?;

    let results = rows
        .into_iter()
        .map(|row| {
            let primary_match = text_contains_query(&row.series_title, query);
            let (match_type, highlight) = if primary_match {
                (
                    "title".to_string(),
                    generate_highlight(&row.series_title, query),
                )
            } else {
                (
                    "description".to_string(),
                    generate_highlight(&row.series_title, query),
                )
            };

            VideoSeriesSearchResult {
                id: row.series_id,
                title: row.series_title,
                description: row.description,
                video_count: row.video_count,
                thumbnail_url: None,
                search_rank: row.fts_rank as f32,
                match_type,
                highlight: Some(highlight),
            }
        })
        .collect();

    Ok(results)
}

/// video autocomplete suggestions via `videoz_fts` (prefix match)
pub async fn get_video_suggestions(
    pool: &SqlitePool,
    partial: &str,
    user_id: Option<&str>,
) -> GrimoireResult<Vec<Suggestion>> {
    #[derive(sqlx::FromRow)]
    struct VideoSuggestionRow {
        video_id: String,
        video_title: String,
        series_id: Option<String>,
        series_name: Option<String>,
        episode_number: Option<i64>,
        description: Option<String>,
        fts_rank: f64,
        is_favorite: i64,
    }

    let user_id_param = user_id.unwrap_or("");
    let match_query = sanitize_fts_query(partial);

    let rows = sqlx::query_as!(
        VideoSuggestionRow,
        r#"
        SELECT
            video.id as "video_id!: String",
            video.title as "video_title!: String",
            video.series_id as "series_id: String",
            (SELECT series.title
             FROM video_seriez series
             WHERE series.id = video.series_id AND series.deleted_at IS NULL
            ) as "series_name: String",
            video.episode_number as "episode_number: i64",
            video.description as "description: String",
            fts.rank as "fts_rank!: f64",
            CASE WHEN favorite.id IS NOT NULL THEN 1 ELSE 0 END as "is_favorite!: i64"
        FROM videoz_fts fts
        JOIN videoz video ON fts.video_id = video.id
        LEFT JOIN user_favoritez favorite
            ON favorite.target_id = video.id
            AND favorite.target_type = 'video'
            AND favorite.user_id = ?
        WHERE videoz_fts MATCH ?
            AND video.deleted_at IS NULL
        ORDER BY fts.rank
        LIMIT 100
        "#,
        user_id_param,
        match_query
    )
    .fetch_all(pool)
    .await?;

    let suggestions = rows
        .into_iter()
        .map(|row| {
            let confidence = calculate_confidence(partial, &row.video_title, row.fts_rank as f32);
            let highlight = generate_highlight(&row.video_title, partial);

            let primary_match = text_contains_query(&row.video_title, partial);
            let (matched_field, match_snippet) = if !primary_match {
                row.description
                    .as_deref()
                    .and_then(|d| extract_snippet(d, partial, 80))
                    .map(|snippet| (Some("description".to_string()), Some(snippet)))
                    .unwrap_or((None, None))
            } else {
                (None, None)
            };
            let match_type = matched_field.as_deref().unwrap_or("title");

            Suggestion {
                value: row.video_title.clone(),
                display: row.video_title.clone(),
                highlight,
                count: 1,
                suggestion_type: SuggestionType::Video,
                confidence,
                metadata: Some(serde_json::json!({
                    "match_type": match_type,
                    "series_id": row.series_id,
                    "series_name": row.series_name,
                    "episode_number": row.episode_number,
                })),
                entity_id: row.video_id,
                is_favorite: row.is_favorite != 0,
                matched_field,
                match_snippet,
            }
        })
        .collect();

    Ok(suggestions)
}

/// video series autocomplete suggestions via `video_seriez_fts` (prefix match)
pub async fn get_video_series_suggestions(
    pool: &SqlitePool,
    partial: &str,
) -> GrimoireResult<Vec<Suggestion>> {
    #[derive(sqlx::FromRow)]
    struct SeriesSuggestionRow {
        series_id: String,
        series_title: String,
        description: Option<String>,
        fts_rank: f64,
        video_count: i64,
    }

    let match_query = sanitize_fts_query(partial);

    let rows = sqlx::query_as!(
        SeriesSuggestionRow,
        r#"
        SELECT
            series.id as "series_id!: String",
            series.title as "series_title!: String",
            series.description as "description: String",
            fts.rank as "fts_rank!: f64",
            (SELECT COUNT(*) FROM videoz v WHERE v.series_id = series.id AND v.deleted_at IS NULL)
                as "video_count!: i64"
        FROM video_seriez_fts fts
        JOIN video_seriez series ON fts.series_id = series.id
        WHERE video_seriez_fts MATCH ?
            AND series.deleted_at IS NULL
        ORDER BY fts.rank
        LIMIT 100
        "#,
        match_query
    )
    .fetch_all(pool)
    .await?;

    let suggestions = rows
        .into_iter()
        .map(|row| {
            let confidence = calculate_confidence(partial, &row.series_title, row.fts_rank as f32);
            let highlight = generate_highlight(&row.series_title, partial);

            let primary_match = text_contains_query(&row.series_title, partial);
            let (matched_field, match_snippet) = if !primary_match {
                row.description
                    .as_deref()
                    .and_then(|d| extract_snippet(d, partial, 80))
                    .map(|snippet| (Some("description".to_string()), Some(snippet)))
                    .unwrap_or((None, None))
            } else {
                (None, None)
            };
            let match_type = matched_field.as_deref().unwrap_or("title");

            Suggestion {
                value: row.series_title.clone(),
                display: row.series_title.clone(),
                highlight,
                count: row.video_count,
                suggestion_type: SuggestionType::VideoSeries,
                confidence,
                metadata: Some(serde_json::json!({
                    "match_type": match_type,
                    "video_count": row.video_count,
                })),
                entity_id: row.series_id,
                is_favorite: false,
                matched_field,
                match_snippet,
            }
        })
        .collect();

    Ok(suggestions)
}
