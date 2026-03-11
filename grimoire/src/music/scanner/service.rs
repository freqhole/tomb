//! Music scanner service - public API
//!
//! Provides high-level functions for scanning directories and importing audio files.
//! This module delegates to specialized submodules for implementation details.

use crate::error::ErrorDetail;
use crate::GrimoireResponse;
use std::path::Path;

pub use super::directory::{is_audio_file, scan_directory_and_create_jobs};
pub use super::import::{extract_and_import, ImportResult};

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
/// * `skip_tracked_subdirs` - Skip subdirectories already in scanned_directories table
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
    skip_tracked_subdirs: bool,
) -> GrimoireResponse<usize> {
    match scan_directory_and_create_jobs(
        path,
        session_id,
        recursive,
        max_depth,
        file_extensions,
        skip_tracked_subdirs,
    )
    .await
    {
        Ok(count) => GrimoireResponse::success(
            format!("Scanned directory and created {} jobs", count),
            count,
        ),
        Err(e) => {
            GrimoireResponse::failure(format!("Failed to scan directory: {}", e), vec![e.into()])
        }
    }
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
/// * `created_by` - Optional user ID that created/uploaded this file
///
/// # Returns
///
/// ImportResult containing song/artist/album IDs and extraction status
pub async fn import_audio_file(
    media_blob_id: &str,
    file_path: &Path,
    created_by: Option<String>,
) -> GrimoireResponse<ImportResult> {
    match extract_and_import(media_blob_id, file_path, created_by, None).await {
        Ok(result) => GrimoireResponse::success("Audio file imported successfully", result),
        Err(e) => {
            // check if this is a JobError with a wrapped GrimoireResponse
            let error_str = format!("{}", e);
            if error_str.contains("Duplicate song detected") || error_str.contains("duplicate_song")
            {
                // preserve the duplicate error for early bail-out detection
                GrimoireResponse::failure(
                    "Failed to import audio file",
                    vec![ErrorDetail::new(
                        "duplicate_song",
                        "Duplicate Song",
                        format!("job processing failed: {}", e),
                    )],
                )
            } else {
                GrimoireResponse::failure(
                    "Failed to import audio file",
                    vec![ErrorDetail::new(
                        "import_failed",
                        "Import Failed",
                        format!("Failed to import audio file: {}", e),
                    )],
                )
            }
        }
    }
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
