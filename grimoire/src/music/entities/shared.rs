//! shared domain models used across multiple entities

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// image metadata for entity image collections
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, FromRow)]
pub struct ImageMetadata {
    pub media_blob_id: String,
    pub is_primary: i64,  // SQLite boolean (0/1)
    pub blob_type: String,  // from media_blobz.blob_type ('thumbnail', 'waveform', etc)
}
