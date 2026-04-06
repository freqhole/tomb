//! photo domain models

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// photo entity — a photograph or image file
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct Photo {
    pub id: String,
    pub media_blob_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub original_filename: Option<String>,
    pub taken_at: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
    pub orientation: Option<i64>,
    pub metadata: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub deleted_by: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
}

/// request for creating a new photo entity
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreatePhotoRequest {
    pub media_blob_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub original_filename: Option<String>,
    pub taken_at: Option<i64>,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
    pub orientation: Option<i64>,
    pub metadata: Option<String>,
    pub created_by: Option<String>,
}
