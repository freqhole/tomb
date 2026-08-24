//! video full-text search (~ the music domain's `crate::search`, but
//! scoped to the single `videoz_fts` table until the generic
//! cross-domain search redesign happens)

use serde::{Deserialize, Serialize};
use sqlx::SqlitePool;
use zod_gen_derive::ZodSchema;

use crate::error::GrimoireResult;
use crate::search::helpers::sanitize_fts_query;

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
