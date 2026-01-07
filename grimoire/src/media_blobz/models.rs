//! media blob domain models

use serde::{Deserialize, Serialize};

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
#[derive(Debug, Clone, Serialize, Deserialize)]
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
    pub data: Option<Vec<u8>>,
}
