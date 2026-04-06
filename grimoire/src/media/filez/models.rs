//! file domain models — catch-all for files that don't fit other domains

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// file entity — generic file (catch-all domain).
/// named FileEntity to avoid conflict with std::fs::File.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct FileEntity {
    pub id: String,
    pub media_blob_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub original_filename: Option<String>,
    pub metadata: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub deleted_by: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
}

/// request for creating a new file entity
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateFileRequest {
    pub media_blob_id: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub original_filename: Option<String>,
    pub metadata: Option<String>,
    pub created_by: Option<String>,
}
