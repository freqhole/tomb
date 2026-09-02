//! request payloads for the upload routes.
//!
//! kept together rather than beside each handler: the codegen type registry
//! references them by name.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

use crate::upload::{AssociationHint, MusicMetadataHints, VideoMetadataHints};

/// request for image upload (supports both base64 data and file paths)
#[derive(Debug, Deserialize)]
pub struct UploadImageRequest {
    /// base64-encoded image data (use this OR file_path, not both)
    #[serde(default)]
    pub data: Option<String>,
    /// local filesystem path to image (tauri-local optimization)
    #[serde(default)]
    pub file_path: Option<String>,
    /// original filename (for mime detection, required if using file_path)
    #[serde(default)]
    pub filename: Option<String>,
    /// optional association hint
    pub associate_with: Option<AssociationHint>,
    /// if true, wait for job to complete before returning (tauri-local optimization)
    #[serde(default)]
    pub wait_for_completion: bool,
}

/// request for music upload via base64 data or file path
#[derive(Debug, Deserialize)]
pub struct UploadMusicRequest {
    /// base64-encoded audio data (use this OR file_path, not both)
    #[serde(default)]
    pub data: Option<String>,
    /// local filesystem path to audio file (tauri-local optimization)
    #[serde(default)]
    pub file_path: Option<String>,
    /// original filename (for mime detection)
    #[serde(default)]
    pub filename: Option<String>,
    /// optional metadata hints for processing
    #[serde(default)]
    pub metadata: Option<MusicMetadataHints>,
    /// if true, wait for job to complete before returning
    #[serde(default)]
    pub wait_for_completion: bool,
}

/// request for video upload via base64 data or file path
#[derive(Debug, Deserialize)]
pub struct UploadVideoRequest {
    /// base64-encoded video data (use this OR file_path, not both)
    #[serde(default)]
    pub data: Option<String>,
    /// local filesystem path to video file (tauri-local optimization)
    #[serde(default)]
    pub file_path: Option<String>,
    /// original filename (for mime detection)
    #[serde(default)]
    pub filename: Option<String>,
    /// optional metadata hints for processing
    #[serde(default)]
    pub metadata: Option<VideoMetadataHints>,
    /// if true, wait for job to complete before returning
    #[serde(default)]
    pub wait_for_completion: bool,
}

/// request for music import by paths (tauri-local optimization)
#[derive(Debug, Deserialize)]
pub struct ImportMusicPathsRequest {
    /// list of file or directory paths to import
    pub paths: Vec<String>,
    /// if true, wait for all jobs to complete before returning
    #[serde(default)]
    pub wait_for_completion: bool,
}

/// request for music upload via iroh-blobs pull model
///
/// the client imports the file into their local iroh-blobs store (gets blake3 hash),
/// then sends this request. the server pulls the blob via verified streaming.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UploadMusicByBlake3Request {
    /// blake3 hash of the file (64 hex chars) - the client has this blob in their iroh store
    pub blake3: String,
    /// original filename (for mime detection)
    pub filename: String,
    /// file size in bytes (for validation)
    pub size: Option<u64>,
    /// the node_id of the uploading peer (injected by transport handler, not sent by client)
    pub node_id: Option<String>,
    /// optional metadata hints for processing
    pub metadata: Option<MusicMetadataHints>,
}

/// request for video upload via iroh-blobs pull model - mirrors
/// `UploadMusicByBlake3Request`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UploadVideoByBlake3Request {
    /// blake3 hash of the file (64 hex chars) - the client has this blob in their iroh store
    pub blake3: String,
    /// original filename (for mime detection)
    pub filename: String,
    /// file size in bytes (for validation)
    pub size: Option<u64>,
    /// the node_id of the uploading peer (injected by transport handler, not sent by client)
    pub node_id: Option<String>,
    /// optional metadata hints for processing
    pub metadata: Option<VideoMetadataHints>,
}
