//! video domain models

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// video entity
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct Video {
    pub id: String,
    pub media_blob_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub original_filename: Option<String>,
    pub duration: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub codec: Option<String>,
    pub framerate: Option<f64>,
    pub bitrate: Option<i64>,
    pub metadata: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub deleted_by: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
}

/// request for creating a new video entity
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateVideoRequest {
    pub media_blob_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub original_filename: Option<String>,
    pub duration: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub codec: Option<String>,
    pub framerate: Option<f64>,
    pub bitrate: Option<i64>,
    pub metadata: Option<String>,
    pub created_by: Option<String>,
}
