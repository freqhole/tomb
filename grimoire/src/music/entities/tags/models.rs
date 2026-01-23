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

/// request for getting tags for multiple albums
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetAlbumsTagsRequest {
    pub album_ids: Vec<String>,
}

/// request for adding tags to multiple albums
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AddAlbumsTagsRequest {
    pub album_ids: Vec<String>,
    #[serde(default)]
    pub tag_ids: Vec<String>,
    #[serde(default)]
    pub tag_names: Vec<String>,
}

/// request for removing tags from multiple albums
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RemoveAlbumsTagsRequest {
    pub album_ids: Vec<String>,
    pub tag_ids: Vec<String>,
}

/// request for replacing tags for multiple albums
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ReplaceAlbumsTagsRequest {
    pub album_ids: Vec<String>,
    pub tag_ids: Vec<String>,
}
