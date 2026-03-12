//! media blob domain models

use crate::Bytes;
use serde::{Deserialize, Serialize};
use std::fmt;
use zod_gen::{zod_nullable, zod_number, zod_object, zod_string, ZodSchema};
use zod_gen_derive::ZodSchema;

/// blob type enum matching database constraints
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BlobType {
    /// original/standalone media file (audio, video, images) - parent_blob_id = NULL
    Original,
    /// sized thumbnail image (50x50, 200x200) - parent_blob_id points to the full-res image
    Thumbnail,
    /// waveform visualization data - parent_blob_id points to the audio blob
    Waveform,
    /// preview/sample clip - parent_blob_id points to original
    Preview,
}

impl ZodSchema for BlobType {
    fn zod_schema() -> String {
        r#"z.union([z.literal("original"), z.literal("thumbnail"), z.literal("waveform"), z.literal("preview")])"#.to_string()
    }
}

impl BlobType {
    pub fn as_str(&self) -> &'static str {
        match self {
            BlobType::Original => "original",
            BlobType::Thumbnail => "thumbnail",
            BlobType::Waveform => "waveform",
            BlobType::Preview => "preview",
        }
    }
}

impl fmt::Display for BlobType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

impl From<BlobType> for String {
    fn from(blob_type: BlobType) -> Self {
        blob_type.as_str().to_string()
    }
}

impl std::str::FromStr for BlobType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "original" => Ok(BlobType::Original),
            "thumbnail" => Ok(BlobType::Thumbnail),
            "waveform" => Ok(BlobType::Waveform),
            "preview" => Ok(BlobType::Preview),
            _ => Err(format!("invalid blob_type: {}", s)),
        }
    }
}

impl From<String> for BlobType {
    fn from(s: String) -> Self {
        s.parse().unwrap_or(BlobType::Original)
    }
}

/// media blob model for domain logic
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MediaBlob {
    pub id: String,
    pub sha256: String,
    pub size: Option<i64>,
    pub mime: Option<String>,
    pub source_client_id: Option<String>,
    pub local_path: Option<String>,
    pub filename: Option<String>,
    pub parent_blob_id: Option<String>,
    pub blob_type: BlobType,
    #[serde(default)]
    pub metadata: serde_json::Value,
    pub created_at: i64,         // unix timestamp UTC
    pub updated_at: i64,         // unix timestamp UTC
    pub deleted_at: Option<i64>, // unix timestamp UTC
    pub deleted_by: Option<String>,
    pub created_by: Option<String>,
    pub updated_by: Option<String>,
    /// width in pixels (for sized thumbnails)
    pub width: Option<i64>,
    /// height in pixels (for sized thumbnails)
    pub height: Option<i64>,
}

/// safe response type for blob metadata endpoint - excludes internal fields like local_path
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct BlobMetadataResponse {
    pub id: String,
    pub sha256: String,
    pub size: Option<i64>,
    pub mime: Option<String>,
    pub filename: Option<String>,
    pub blob_type: BlobType,
}

impl From<MediaBlob> for BlobMetadataResponse {
    fn from(blob: MediaBlob) -> Self {
        Self {
            id: blob.id,
            sha256: blob.sha256,
            size: blob.size,
            mime: blob.mime,
            filename: blob.filename,
            blob_type: blob.blob_type,
        }
    }
}

/// request for creating a new media blob
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateMediaBlobRequest {
    pub sha256: String,
    pub size: Option<i64>,
    pub mime: Option<String>,
    pub source_client_id: Option<String>,
    pub local_path: Option<String>,
    pub filename: Option<String>,
    pub parent_blob_id: Option<String>,
    pub blob_type: Option<BlobType>,
    #[serde(default)]
    pub metadata: serde_json::Value,
    pub created_by: Option<String>,
    /// binary data for thumbnails, waveforms, etc. (exclusive with local_path)
    #[serde(skip)]
    pub data: Option<Bytes>,
    /// width in pixels (for sized thumbnails)
    pub width: Option<i64>,
    /// height in pixels (for sized thumbnails)
    pub height: Option<i64>,
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
            ("filename", &zod_nullable(zod_string())),
            ("parent_blob_id", &zod_nullable(zod_string())),
            ("blob_type", &BlobType::zod_schema()),
            ("metadata", &"z.any()".to_string()),
            ("created_at", &zod_number()),
            ("updated_at", &zod_number()),
            ("deleted_at", &zod_nullable(zod_number())),
            ("deleted_by", &zod_nullable(zod_string())),
            ("created_by", &zod_nullable(zod_string())),
            ("updated_by", &zod_nullable(zod_string())),
            ("width", &zod_nullable(zod_number())),
            ("height", &zod_nullable(zod_number())),
        ])
    }
}
