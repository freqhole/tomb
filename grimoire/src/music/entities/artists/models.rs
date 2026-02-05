//! artist domain models

use crate::music::crud::ImageMetadata;
use crate::JsonVec;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// artist model (normalized table)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct Artist {
    pub id: String,
    pub name: String,
    pub bio: Option<String>,
    pub images: Option<JsonVec<ImageMetadata>>,
    pub created_at: i64,         // unix timestamp UTC
    pub updated_at: i64,         // unix timestamp UTC
    pub deleted_at: Option<i64>, // unix timestamp UTC
    pub deleted_by: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
}

/// request for creating a new artist
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateArtistRequest {
    pub name: String,
    pub created_by: Option<String>,
}

/// request for updating an artist
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UpdateArtistRequest {
    pub artist_id: String,
    pub name: Option<String>,
    pub bio: Option<String>,
    pub updated_by: Option<String>,
}
