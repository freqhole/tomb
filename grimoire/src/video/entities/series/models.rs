//! video series domain models

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// video series model (~ artistz for the video domain)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct VideoSeries {
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub poster_blob_id: Option<String>,
    pub created_at: i64,         // unix timestamp UTC
    pub updated_at: i64,         // unix timestamp UTC
    pub deleted_at: Option<i64>, // unix timestamp UTC
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
    pub deleted_by: Option<String>,
}

/// request for creating a new video series
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateVideoSeriesRequest {
    pub title: String,
    pub description: Option<String>,
    pub poster_blob_id: Option<String>,
    pub created_by: Option<String>,
}

/// request for updating a video series
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdateVideoSeriesRequest {
    pub series_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub poster_blob_id: Option<String>,
    pub updated_by: Option<String>,
}
