//! music job parameters and results
//!
//! request/response types for music-specific job processors

use serde::{Deserialize, Serialize};

/// parameters for directory scan jobs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanDirectoryParams {
    pub directory_path: String,
    pub recursive: bool,
    pub max_depth: Option<u32>,
    pub file_extensions: Option<Vec<String>>, // if None, use default audio extensions
}

/// parameters for file processing jobs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessFileParams {
    pub file_path: String,
    pub extract_metadata: bool,
    pub generate_thumbnail: bool,
    pub generate_waveform: bool,
}

/// results from directory scan jobs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanDirectoryResult {
    pub files_discovered: u64,
    pub jobs_created: u64,
    pub errors: Vec<String>,
}

/// results from file processing jobs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessFileResult {
    pub media_blob_id: String,
    pub song_id: Option<String>,
    pub artist_id: Option<String>,
    pub album_id: Option<String>,
    pub metadata_extracted: bool,
    pub thumbnail_generated: bool,
    pub waveform_generated: bool,
}

// ============================================================================
// CLI Response Types
// ============================================================================

/// response for scan job creation (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanJobCreatedResponse {
    pub job_id: String,
    pub session_id: String,
    pub path: String,
    pub recursive: bool,
    pub max_depth: Option<usize>,
}

/// response for process file job creation (CLI output)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessJobCreatedResponse {
    pub job_id: String,
    pub file_path: String,
}
