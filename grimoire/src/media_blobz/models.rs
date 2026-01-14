//! media blob domain models

use crate::Bytes;
use serde::{Deserialize, Serialize};
use zod_gen::{zod_nullable, zod_number, zod_object, zod_string, ZodSchema};
use zod_gen_derive::ZodSchema;

/// media blob model for domain logic
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MediaBlob {
    pub id: String,
    pub sha256: String,
    pub size: Option<i64>,
    pub mime: Option<String>,
    pub source_client_id: Option<String>,
    pub local_path: Option<String>,
    pub parent_blob_id: Option<String>,
    pub blob_type: String,
    #[serde(default)]
    pub metadata: serde_json::Value,
    pub created_at: i64,         // unix timestamp UTC
    pub updated_at: i64,         // unix timestamp UTC
    pub deleted_at: Option<i64>, // unix timestamp UTC
    pub deleted_by: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
}

/// request for creating a new media blob
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateMediaBlobRequest {
    pub sha256: String,
    pub size: Option<i64>,
    pub mime: Option<String>,
    pub source_client_id: Option<String>,
    pub local_path: Option<String>,
    pub parent_blob_id: Option<String>,
    pub blob_type: Option<String>,
    #[serde(default)]
    pub metadata: serde_json::Value,
    pub created_by: Option<String>,
    /// binary data for thumbnails, waveforms, etc. (exclusive with local_path)
    #[serde(skip)]
    pub data: Option<Bytes>,
}

impl ZodSchema for MediaBlob {
    fn zod_schema() -> String {
        // local_path intentionally excluded - internal filesystem detail not exposed in api
        zod_object(&[
            ("id", &zod_string()),
            ("sha256", &zod_string()),
            ("size", &zod_nullable(zod_number())),
            ("mime", &zod_nullable(zod_string())),
            ("source_client_id", &zod_nullable(zod_string())),
            ("parent_blob_id", &zod_nullable(zod_string())),
            ("blob_type", &zod_string()),
            ("metadata", &"z.any()".to_string()),
            ("created_at", &zod_number()),
            ("updated_at", &zod_number()),
            ("deleted_at", &zod_nullable(zod_number())),
            ("deleted_by", &zod_nullable(zod_string())),
            ("created_by", &zod_nullable(zod_string())),
            ("updated_by", &zod_nullable(zod_string())),
        ])
    }
}
