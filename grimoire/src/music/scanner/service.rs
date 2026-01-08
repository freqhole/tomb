//! Music scanner service - public API
//!
//! Provides high-level functions for scanning directories and importing audio files.
//! This module delegates to specialized submodules for implementation details.

use crate::error::GrimoireResult;
use std::path::Path;

pub use super::directory::{is_audio_file, scan_directory_and_create_jobs};
pub use super::import::{extract_and_import, import_basic, ImportResult};

/// Scan a directory for audio files and create import jobs
///
/// This is the main entry point for directory scanning. It will:
/// - Traverse the directory tree (respecting max_depth if provided)
/// - Filter for audio files by extension
/// - Create a processing job for each audio file found
///
/// # Arguments
///
/// * `path` - Directory path to scan
/// * `session_id` - Job session ID to associate jobs with
/// * `recursive` - Whether to scan subdirectories
/// * `max_depth` - Maximum depth for recursive scanning (None = unlimited)
/// * `file_extensions` - Custom audio extensions (None = use defaults)
///
/// # Returns
///
/// Number of audio files discovered and jobs created
pub async fn scan_directory(
    path: &str,
    session_id: &str,
    recursive: bool,
    max_depth: Option<u32>,
    file_extensions: Option<Vec<String>>,
) -> GrimoireResult<usize> {
    scan_directory_and_create_jobs(path, session_id, recursive, max_depth, file_extensions).await
}

/// Import a single audio file into the music library
///
/// Attempts to extract metadata from the file and create a complete
/// song record with artist/album relationships. Falls back to basic
/// import if metadata extraction fails.
///
/// # Arguments
///
/// * `media_blob_id` - ID of the media blob for this file
/// * `file_path` - Path to the audio file
///
/// # Returns
///
/// ImportResult containing song/artist/album IDs and extraction status
pub async fn import_audio_file(
    media_blob_id: &str,
    file_path: &Path,
) -> GrimoireResult<ImportResult> {
    extract_and_import(media_blob_id, file_path)
        .await
        .map_err(|e| crate::error::GrimoireError::ProcessingFailed {
            message: format!("Failed to import audio file: {}", e),
        })
}

/// Check if a file is a supported audio format
///
/// # Arguments
///
/// * `path` - Path to check
///
/// # Returns
///
/// true if the file has a supported audio extension
pub fn is_supported_audio_file(path: &Path) -> bool {
    use crate::config::get_config;
    let extensions = get_config().media.supported_audio_formats.clone();
    is_audio_file(path, &extensions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_is_supported_audio_file() {
        let mp3 = PathBuf::from("test.mp3");
        assert!(is_supported_audio_file(&mp3));

        let txt = PathBuf::from("test.txt");
        assert!(!is_supported_audio_file(&txt));
    }
}
