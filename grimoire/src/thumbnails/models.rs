//! thumbnail models placeholder
//! TODO: migrate from legacylib/src/thumbnails/models.rs

use serde::{Deserialize, Serialize};

/// thumbnail generation configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailConfig {
    pub width: u32,
    pub height: u32,
    pub quality: u8,
    pub format: ThumbnailFormat,
    pub crop_strategy: CropStrategy,
}

/// supported thumbnail formats
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ThumbnailFormat {
    Jpeg,
    Png,
    Webp,
}

/// image cropping strategies
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CropStrategy {
    Center,
    Top,
    Bottom,
    Left,
    Right,
}

/// thumbnail generation dimensions
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailDimensions {
    pub width: u32,
    pub height: u32,
}

/// thumbnail generation request
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailRequest {
    pub source_blob_id: String,
    pub config: ThumbnailConfig,
    pub priority: i32,
}

/// thumbnail generation job
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailJob {
    pub id: String,
    pub source_blob_id: String,
    pub target_blob_id: Option<String>,
    pub config: ThumbnailConfig,
    pub status: ThumbnailJobStatus,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub error_message: Option<String>,
}

/// thumbnail job status
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ThumbnailJobStatus {
    Pending,
    Processing,
    Completed,
    Failed,
}

/// thumbnail generation result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThumbnailResult {
    pub thumbnail_blob_id: String,
    pub original_blob_id: String,
    pub dimensions: ThumbnailDimensions,
    pub file_size: u64,
    pub format: ThumbnailFormat,
}
