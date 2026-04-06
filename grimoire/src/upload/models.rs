//! upload module - types for file upload handling

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// response for image upload endpoint
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ImageUploadResponse {
    /// ID of the created media blob
    pub blob_id: String,
    /// ID of the processing job (for polling status)
    pub job_id: String,
    /// SHA256 hash of the uploaded file
    pub sha256: String,
    /// File size in bytes
    pub size: i64,
    /// MIME type of the file
    pub mime: String,
    /// Whether this blob already existed (deduplication)
    pub existing: bool,
    /// Optional association info
    pub association: Option<AssociationInfo>,
    /// Success message
    pub message: String,
}

/// response for music upload endpoint
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct MusicUploadResponse {
    /// ID of the created media blob
    pub blob_id: String,
    /// ID of the processing job (for polling status)
    pub job_id: String,
    /// SHA256 hash of the uploaded file
    pub sha256: String,
    /// File size in bytes
    pub size: i64,
    /// MIME type of the file
    pub mime: String,
    /// Whether this blob already existed (deduplication)
    pub existing: bool,
    /// Success message
    pub message: String,
}

/// association information for uploaded images
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AssociationHint {
    /// Entity type to associate with (album, playlist, song, artist, user, etc.)
    pub entity_type: String,
    /// ID of the entity to associate with
    pub entity_id: String,
    /// Whether this should be the primary image (ignored if it's the first image - first is always primary)
    pub is_primary: Option<bool>,
}

/// association info included in response
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AssociationInfo {
    /// Entity type
    pub entity_type: String,
    /// Entity ID
    pub entity_id: String,
}

/// metadata hints for music upload processing (optional)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct MusicMetadataHints {
    /// Artist name hint
    pub artist: Option<String>,
    /// Album title hint
    pub album: Option<String>,
    /// Song title hint
    pub title: Option<String>,
    /// Track number hint
    pub track_number: Option<i32>,
    /// Disc number hint
    pub disc_number: Option<i32>,
    /// Year hint
    pub year: Option<i32>,
    /// Genre hint
    pub genre: Option<String>,
}

/// request to delete (unlink) an image from an entity
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct DeleteImageRequest {
    /// Entity type (song, album, artist, playlist)
    pub entity_type: String,
    /// Entity ID
    pub entity_id: String,
    /// Blob ID to unlink
    pub blob_id: String,
}

/// request to set an image as primary for an entity
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SetPrimaryImageRequest {
    /// Entity type (song, album, artist, playlist)
    pub entity_type: String,
    /// Entity ID
    pub entity_id: String,
    /// Blob ID to set as primary
    pub blob_id: String,
}

/// response for music import by paths (tauri-local)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct MusicImportResponse {
    /// job session ID for tracking batch progress
    pub session_id: String,
    /// number of jobs created (files to process)
    pub jobs_created: i32,
    /// number of paths that were directories (scanned recursively)
    pub directories_scanned: i32,
    /// number of files skipped (not audio or already processed)
    pub files_skipped: i32,
    /// success message
    pub message: String,
}

/// response for universal file upload endpoint
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct FileUploadResponse {
    /// ID of the created media blob
    pub blob_id: String,
    /// media domain the file was classified into
    pub domain: String,
    /// ID of the domain entity (audioz/photoz/videoz/documentz/filez row)
    pub entity_id: String,
    /// ID of the processing job (thumbnail generation), if queued
    pub job_id: Option<String>,
    /// SHA256 hash of the uploaded file
    pub sha256: String,
    /// blake3 hash for P2P verified streaming
    pub blake3: String,
    /// file size in bytes
    pub size: i64,
    /// MIME type of the file
    pub mime: String,
    /// whether this blob already existed (deduplication)
    pub existing: bool,
    /// success message
    pub message: String,
}
