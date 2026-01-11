//! Directory scanning logic for discovering audio files
//!
//! Handles recursive directory traversal, audio file filtering,
//! and batch processing of discovered files.

use crate::config::get_config;
use crate::error::GrimoireResult;
use crate::jobs::{create_job, CreateJobRequest, JobType, ProcessFileParams};
use std::path::Path;
use walkdir::WalkDir;

/// Scan a directory for audio files and create processing jobs
///
/// Returns the number of audio files discovered and jobs created.
pub async fn scan_directory_and_create_jobs(
    path: &str,
    session_id: &str,
    recursive: bool,
    max_depth: Option<u32>,
    file_extensions: Option<Vec<String>>,
) -> GrimoireResult<usize> {
    println!("scanning directory: {}", path);
    println!("recursive: {}", recursive);

    // Get audio extensions from config if not provided
    let audio_extensions = match file_extensions {
        Some(exts) => exts,
        None => get_config().media.supported_audio_formats.clone(),
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

    for entry in walker.into_iter().filter_map(|e| e.ok()) {
        if !entry.file_type().is_file() {
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
    println!("found {} audio files", file_count);

    // Create a processing job for each file
    for file_path in audio_files {
        let params = ProcessFileParams {
            file_path: file_path.clone(),
            extract_metadata: true,
            generate_thumbnail: true,
            generate_waveform: true,
        };

        let job_request = CreateJobRequest {
            job_type: JobType::ProcessFile,
            session_id: Some(session_id.to_string()),
            parameters: serde_json::to_value(&params).unwrap_or_default(),
            max_retries: Some(3),
            scheduled_at: None,
            created_by: Some("scanner".to_string()),
        };

        let job_response = create_job(job_request).await;
        if !job_response.success {
            return Err(crate::error::GrimoireError::ProcessingFailed {
                message: format!("Failed to create job: {}", job_response.message),
            });
        }
    }

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
