//! scanner models placeholder
//! TODO: migrate from legacylib/src/music/scanner.rs

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// scanner configuration
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannerConfig {
    pub batch_size: usize,
    pub max_depth: Option<usize>,
    pub follow_symlinks: bool,
    pub include_extensions: Vec<String>,
    pub exclude_extensions: Vec<String>,
}

/// scanner error types
#[derive(Debug, thiserror::Error)]
pub enum ScannerError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Path is not a directory: {0}")]
    NotADirectory(String),
    #[error("Media type detection error: {0}")]
    MediaTypeError(String),
    #[error("Walk directory error: {0}")]
    WalkDirError(String),
}

/// request for scanning a directory
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanRequest {
    pub directory: PathBuf,
    pub config: Option<ScannerConfig>,
    pub recursive: bool,
}

/// information about a discovered audio file
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioFileInfo {
    pub path: PathBuf,
    pub file_name: String,
    pub file_size: u64,
    pub extension: String,
    pub mime_type: Option<String>,
    pub is_supported: bool,
    pub modified_at: i64,
}

/// progress information for long-running scans
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannerProgress {
    pub total_files_found: usize,
    pub audio_files_found: usize,
    pub directories_scanned: usize,
    pub current_directory: Option<PathBuf>,
    pub percent_complete: f64,
}

/// result of a directory scan
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannerResult {
    pub audio_files: Vec<AudioFileInfo>,
    pub total_files_scanned: usize,
    pub directories_scanned: usize,
    pub scan_duration_ms: u64,
    pub errors: Vec<String>,
}
