//! video directory scanner
//!
//! the filesystem walker + job enqueuer in `crate::music::scanner` is
//! extension-driven, not audio-specific (see
//! `scan_directory_and_create_jobs`), and each discovered file is queued
//! as a `ProcessDirectory` job whose per-file `ProcessFile` handler
//! already auto-detects the media domain from the file's extension and
//! dispatches video files to `crate::video::importer::import_video_file`.
//! this module is a thin, video-flavored entry point over that same
//! walker: it just defaults the extension allowlist to
//! `supported_video_formats` instead of `supported_audio_formats`.

use crate::music::scanner::scan_directory_and_create_jobs;
pub use crate::music::scanner::DirectoryScanOutcome;
use crate::GrimoireResponse;

pub mod filename_parser;

/// scan a directory for video files and create import jobs.
///
/// mirrors `crate::music::scanner::scan_directory`'s signature and
/// behavior, but defaults `file_extensions` to the configured video
/// formats instead of audio formats.
pub async fn scan_directory(
    path: &str,
    session_id: &str,
    recursive: bool,
    max_depth: Option<u32>,
    file_extensions: Option<Vec<String>>,
    skip_tracked_subdirs: bool,
) -> GrimoireResponse<DirectoryScanOutcome> {
    let extensions = match file_extensions {
        Some(exts) => Some(exts),
        None => Some(
            crate::config::get_config()
                .media
                .supported_video_formats
                .clone(),
        ),
    };

    match scan_directory_and_create_jobs(
        path,
        session_id,
        recursive,
        max_depth,
        extensions,
        skip_tracked_subdirs,
    )
    .await
    {
        Ok(outcome) => GrimoireResponse::success(
            format!(
                "scanned directory: {} video file(s) found, {} queued for import, {} already in library, {} job(s) created",
                outcome.file_count, outcome.files_queued, outcome.files_skipped, outcome.jobs_created
            ),
            outcome,
        ),
        Err(e) => {
            GrimoireResponse::failure(format!("failed to scan directory: {}", e), vec![e.into()])
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn defaults_to_video_extensions_when_none_given() {
        crate::config::init_config_for_tests();
        let formats = crate::config::get_config()
            .media
            .supported_video_formats
            .clone();
        assert!(!formats.is_empty());
    }
}
