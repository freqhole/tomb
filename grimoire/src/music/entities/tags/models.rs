//! tag domain models

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// tag model for music domain
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub created_at: i64, // unix timestamp UTC
}

/// request for creating a new tag
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateTagRequest {
    pub name: String,
}

/// request for querying tags
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct QueryTagsRequest {
    pub search: Option<String>,
}

/// request for getting a tag by id
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetTagRequest {
    pub tag_id: String,
}

/// request for deleting a tag
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct DeleteTagRequest {
    pub tag_id: String,
    pub deleted_by: Option<String>,
}

/// request for getting album tags
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetAlbumTagsRequest {
    pub album_id: String,
}

/// request for adding tags to an album
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AddAlbumTagsRequest {
    pub album_id: String,
    pub tag_ids: Vec<String>,
}

/// request for removing tags from an album
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RemoveAlbumTagsRequest {
    pub album_id: String,
    pub tag_ids: Vec<String>,
}

/// request for replacing all album tags
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ReplaceAlbumTagsRequest {
    pub album_id: String,
    pub tag_ids: Vec<String>,
}
