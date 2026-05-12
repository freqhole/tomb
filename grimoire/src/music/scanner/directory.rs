//! Directory scanning logic for discovering audio files
//!
//! Handles recursive directory traversal, audio file filtering,
//! and batch processing of discovered files.

use crate::config::get_config;
use crate::database;
use crate::error::GrimoireResult;
use crate::jobs::{
    create_job, get_scanned_directory_paths, update_session_progress, CreateJobRequest,
    JobProgress, JobType, ProcessFileParams,
};
use crate::users::get_root_user_id;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tracing::debug;
use walkdir::WalkDir;

/// Scan a directory for audio files and create processing jobs
///
/// Returns the number of audio files discovered and jobs created.
///
/// # Arguments
/// * `skip_tracked_subdirs` - if true, skip subdirectories that are already tracked
///   in scanned_directories table (useful for avoiding duplicate work when scanning
///   a parent directory after its children have already been scanned)
pub async fn scan_directory_and_create_jobs(
    path: &str,
    session_id: &str,
    recursive: bool,
    max_depth: Option<u32>,
    file_extensions: Option<Vec<String>>,
    skip_tracked_subdirs: bool,
) -> GrimoireResult<usize> {
    // Get audio extensions from config if not provided
    let audio_extensions = match file_extensions {
        Some(exts) => exts,
        None => get_config().media.supported_audio_formats.clone(),
    };

    // load tracked directories if we need to skip them
    let tracked_dirs: HashSet<PathBuf> = if skip_tracked_subdirs {
        get_scanned_directory_paths().await
    } else {
        HashSet::new()
    };

    // canonicalize the root path we're scanning (for comparison)
    let root_path =
        std::fs::canonicalize(path.trim_end_matches('/')).unwrap_or_else(|_| PathBuf::from(path));

    let dirs_to_skip = if skip_tracked_subdirs && !tracked_dirs.is_empty() {
        let count = tracked_dirs.len();
        debug!("will skip {} already-tracked subdirectories", count);
        Some(tracked_dirs)
    } else {
        None
    };

    // Build directory walker
    let mut walker = WalkDir::new(path);

    if !recursive {
        walker = walker.max_depth(1);
    } else if let Some(depth) = max_depth {
        walker = walker.max_depth(depth as usize);
    }

    // Collect audio files
    let mut audio_files = Vec::new();

    for entry in walker
        .into_iter()
        .filter_entry(|entry| {
            // always allow files through
            if entry.file_type().is_file() {
                return true;
            }

            // for directories, check if we should skip
            if let Some(ref tracked) = dirs_to_skip {
                if let Ok(canonical) = std::fs::canonicalize(entry.path()) {
                    // don't skip the root directory we're scanning
                    if canonical == root_path {
                        return true;
                    }
                    // skip if this directory is tracked
                    if tracked.contains(&canonical) {
                        debug!("skipping tracked subdirectory: {:?}", canonical);
                        return false;
                    }
                }
            }
            true
        })
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }

        // skip hidden files (e.g., macOS ._ resource fork files)
        if entry
            .file_name()
            .to_str()
            .map_or(false, |n| n.starts_with('.'))
        {
            continue;
        }

        let path = entry.path();
        if let Some(ext) = path.extension() {
            if let Some(ext_str) = ext.to_str() {
                if audio_extensions
                    .iter()
                    .any(|e| e.eq_ignore_ascii_case(ext_str))
                {
                    if let Some(path_str) = path.to_str() {
                        audio_files.push(path_str.to_string());
                    }
                }
            }
        }
    }

    let file_count = audio_files.len();

    // Connect to database to check for existing files
    let pool =
        database::connect()
            .await
            .map_err(|e| crate::error::GrimoireError::ProcessingFailed {
                message: format!("Failed to connect to database: {}", e),
            })?;

    // get root user ID for job attribution (scanner runs as root user)
    let root_user_id = get_root_user_id().await;

    // Create a processing job for each file (skip if unchanged)
    let mut jobs_created = 0;
    let mut files_skipped = 0;

    for file_path in audio_files {
        // Get file modified time
        let file_modified_at = std::fs::metadata(&file_path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        // Check if file already exists in database with same modified time
        let existing_blob = sqlx::query!(
            r#"
            SELECT id, metadata
            FROM media_blobz
            WHERE local_path = ? AND deleted_at IS NULL
            LIMIT 1
            "#,
            file_path
        )
        .fetch_optional(&pool)
        .await
        .ok()
        .flatten();

        // Check if we can skip this file
        if let Some(blob) = existing_blob {
            if let Some(metadata_str) = blob.metadata {
                if let Ok(metadata) = serde_json::from_str::<serde_json::Value>(&metadata_str) {
                    if let Some(stored_modified_at) =
                        metadata.get("file_modified_at").and_then(|v| v.as_i64())
                    {
                        if stored_modified_at == file_modified_at {
                            // File hasn't changed, skip it
                            debug!("skipping unchanged file: {}", file_path);
                            files_skipped += 1;
                            continue;
                        }
                    }
                }
            }
        }

        // File is new or has changed, create a processing job
        let params = ProcessFileParams {
            file_path: file_path.clone(),
            extract_metadata: true,
            generate_thumbnail: true,
            generate_waveform: true,
            source_url: None,
        };

        let job_request = CreateJobRequest {
            job_type: JobType::ProcessFile,
            session_id: Some(session_id.to_string()),
            parameters: serde_json::to_value(&params).unwrap_or_default(),
            max_retries: Some(3),
            scheduled_at: None,
            created_by: root_user_id.clone(),
            priority: None,
        };

        let job_response = create_job(job_request).await;
        if !job_response.success {
            return Err(crate::error::GrimoireError::ProcessingFailed {
                message: format!("Failed to create job: {}", job_response.message),
            });
        }
        jobs_created += 1;
    }

    debug!(
        "scan complete: {} files found, {} jobs created, {} files skipped (unchanged)",
        file_count, jobs_created, files_skipped
    );

    // record the canonical job total on the session so progress reporting
    // doesn't depend on jobz row counts (ProcessFile rows are deleted as
    // jobs complete, which would otherwise make `total` shrink to zero).
    let _ =
        update_session_progress(session_id, JobProgress::new(0, jobs_created as u64), None).await;

    Ok(file_count)
}

/// Check if a file has a supported audio extension
pub fn is_audio_file(path: &Path, extensions: &[String]) -> bool {
    if let Some(ext) = path.extension() {
        if let Some(ext_str) = ext.to_str() {
            return extensions.iter().any(|e| e.eq_ignore_ascii_case(ext_str));
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_is_audio_file() {
        let extensions = vec!["mp3".to_string(), "flac".to_string(), "wav".to_string()];

        let mp3_path = PathBuf::from("test.mp3");
        assert!(is_audio_file(&mp3_path, &extensions));

        let flac_path = PathBuf::from("test.FLAC"); // case insensitive
        assert!(is_audio_file(&flac_path, &extensions));

        let txt_path = PathBuf::from("test.txt");
        assert!(!is_audio_file(&txt_path, &extensions));
    }
}
