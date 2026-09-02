//! video season domain models

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// video season model (~ albumz for the video domain, always belongs to a
/// series)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct VideoSeason {
    pub id: String,
    pub series_id: String,
    pub season_number: i64,
    pub title: Option<String>,
    pub description: Option<String>,
    pub poster_blob_id: Option<String>,
    pub created_at: i64,         // unix timestamp UTC
    pub updated_at: i64,         // unix timestamp UTC
    pub deleted_at: Option<i64>, // unix timestamp UTC
}

/// request for creating a new video season
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateVideoSeasonRequest {
    pub series_id: String,
    pub season_number: i64,
    pub title: Option<String>,
    pub description: Option<String>,
    pub poster_blob_id: Option<String>,
}

/// request for updating a video season
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdateVideoSeasonRequest {
    pub season_id: String,
    pub season_number: Option<i64>,
    pub title: Option<String>,
    pub description: Option<String>,
    pub poster_blob_id: Option<String>,
}
