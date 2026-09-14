//! Directory scanning logic for discovering audio files
//!
//! Handles recursive directory traversal, audio file filtering,
//! and batch processing of discovered files.

use crate::config::get_config;
use crate::database;
use crate::error::GrimoireResult;
use crate::jobs::{
    create_job, get_scanned_directory_paths, update_session_progress, CreateJobRequest,
    DirectoryFileEntry, JobProgress, JobType, ProcessDirectoryParams,
};
use crate::users::get_root_user_id;
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use tracing::{debug, info};
use walkdir::WalkDir;

/// outcome of a directory scan. separates "how many audio files exist"
/// from "how many jobs did this actually create" - a scan can discover
/// files and still create zero jobs (every file already imported and
/// unchanged), which callers must not mistake for "jobs are running".
#[derive(Debug, Clone, Copy, Default)]
pub struct DirectoryScanOutcome {
    /// total audio files discovered under the scanned root
    pub file_count: usize,
    /// files queued into a ProcessDirectory job (not skipped)
    pub files_queued: usize,
    /// files skipped because they're unchanged since the last import
    pub files_skipped: usize,
    /// number of ProcessDirectory jobs actually created
    pub jobs_created: usize,
}

/// outcome of the cheap (no-hash) "have I already imported this exact path"
/// check - a plain `local_path` lookup plus an mtime/size comparison
/// against what's recorded, with no sha256/blake3 computation at all.
/// shared by the directory scanner (below) and `import_music_paths`'s
/// individual-file branch, so both "add files" and "add folder" get the
/// same cheap-skip behavior instead of only the directory scanner having
/// it.
///
/// this only ever matches on an EXACT path equal to what's being checked -
/// it can't and doesn't need to detect "this content already exists under
/// a different (possibly now-stale) path". that's a separate, unavoidably
/// hash-based case already handled once hashing happens anyway (see
/// `media_blobz::service::maybe_relocate_existing_blob`, which repoints an
/// existing row's `local_path` to wherever the content was just
/// rediscovered, including repairing a path that no longer resolves to a
/// real file).
#[derive(Debug, Clone)]
pub enum ExistingPathCheck {
    /// no media_blobz row has this exact local_path - process normally.
    New,
    /// a row exists at this exact path and its recorded size/mtime still
    /// match what's on disk right now - nothing to do, skip entirely.
    UnchangedSkip,
    /// a row exists at this exact path but size/mtime differ from what's
    /// recorded - the file changed in place. carries the existing blob id
    /// so the caller can take the rescan-update path (preserves song id,
    /// playlist memberships, favorites, etc.) instead of creating a
    /// duplicate.
    ChangedNeedsRescan { blob_id: String },
}

/// see [`ExistingPathCheck`]. `file_path` should already be canonicalized
/// (same convention every `local_path` in the db is stored under).
pub async fn check_existing_blob_for_path(
    pool: &sqlx::SqlitePool,
    file_path: &str,
) -> ExistingPathCheck {
    let file_meta = std::fs::metadata(file_path).ok();
    let file_modified_at = file_meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let file_size = file_meta.as_ref().map(|m| m.len() as i64).unwrap_or(0);

    let existing_blob = sqlx::query!(
        r#"
        SELECT id, metadata
        FROM media_blobz
        WHERE local_path = ? AND deleted_at IS NULL
        LIMIT 1
        "#,
        file_path
    )
    .fetch_optional(pool)
    .await
    .ok()
    .flatten();

    let Some(blob) = existing_blob else {
        return ExistingPathCheck::New;
    };

    let mut stored_modified_at: Option<i64> = None;
    let mut stored_size: Option<i64> = None;
    if let Some(metadata_str) = blob.metadata.as_deref() {
        if let Ok(metadata) = serde_json::from_str::<serde_json::Value>(metadata_str) {
            stored_modified_at = metadata.get("file_modified_at").and_then(|v| v.as_i64());
            stored_size = metadata.get("file_size").and_then(|v| v.as_i64());
        }
    }

    // cheap unchanged check: both mtime and size match what we recorded
    let mtime_match = stored_modified_at == Some(file_modified_at);
    let size_match = match stored_size {
        Some(s) => s == file_size,
        // legacy rows without recorded file_size fall back to mtime-only match
        None => mtime_match,
    };
    if mtime_match && size_match {
        return ExistingPathCheck::UnchangedSkip;
    }

    let blob_id = blob.id.unwrap_or_default();
    if blob_id.is_empty() {
        ExistingPathCheck::New
    } else {
        ExistingPathCheck::ChangedNeedsRescan { blob_id }
    }
}

/// Scan a directory for audio files and create processing jobs
///
/// Returns a breakdown of files discovered vs. actually queued/skipped
/// and the number of jobs created - see `DirectoryScanOutcome`.
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
) -> GrimoireResult<DirectoryScanOutcome> {
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

    // canonicalize the root path we're scanning. this becomes the prefix of every
    // per-file path we record in media_blobz.local_path, so a non-canonical root
    // (tilde, symlink chain, flatpak portal path, etc.) would poison every blob
    // path that we then hand to iroh-blobs FsStore. see `grimoire::paths` docs.
    let root_path = crate::paths::canonical_path(Path::new(path.trim_end_matches('/')));
    let walk_root = root_path.clone();

    let dirs_to_skip = if skip_tracked_subdirs && !tracked_dirs.is_empty() {
        let count = tracked_dirs.len();
        debug!("will skip {} already-tracked subdirectories", count);
        Some(tracked_dirs)
    } else {
        None
    };

    info!(
        "scan_directory_and_create_jobs: root={:?} recursive={} max_depth={:?} skip_tracked_subdirs={}",
        walk_root, recursive, max_depth, skip_tracked_subdirs
    );

    // Build directory walker
    let mut walker = WalkDir::new(&walk_root);

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
            .is_some_and(|n| n.starts_with('.'))
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
    info!(
        "scan_directory_and_create_jobs: found {} audio file(s) under {:?}",
        file_count, walk_root
    );

    // Connect to database to check for existing files
    let pool =
        database::connect()
            .await
            .map_err(|e| crate::error::GrimoireError::ProcessingFailed {
                message: format!("Failed to connect to database: {}", e),
            })?;

    // get root user ID for job attribution (scanner runs as root user)
    let root_user_id = get_root_user_id().await;

    // group discovered audio files by their immediate parent directory.
    // each parent dir becomes one ProcessDirectory job (no chunking —
    // a dir with 1000s of files is still one job). cheap dedup happens
    // per-file here so we never even enqueue a dir job whose files are
    // all unchanged.
    let mut by_dir: BTreeMap<String, Vec<DirectoryFileEntry>> = BTreeMap::new();
    let mut files_skipped = 0usize;
    let mut files_to_process = 0usize;

    for file_path in audio_files {
        // when an existing blob is found, decide between cheap-skip and rescan-update
        let existing_blob_id_for_update =
            match check_existing_blob_for_path(&pool, &file_path).await {
                ExistingPathCheck::UnchangedSkip => {
                    debug!("skipping unchanged file: {}", file_path);
                    files_skipped += 1;
                    continue;
                }
                ExistingPathCheck::ChangedNeedsRescan { blob_id } => {
                    debug!(
                    "file changed since last scan, will update existing record: {} (blob_id={})",
                    file_path, blob_id
                );
                    Some(blob_id)
                }
                ExistingPathCheck::New => None,
            };

        // bucket by immediate parent directory
        let parent_dir = Path::new(&file_path)
            .parent()
            .map(|p| p.display().to_string())
            .unwrap_or_else(|| ".".to_string());

        by_dir
            .entry(parent_dir)
            .or_default()
            .push(DirectoryFileEntry {
                file_path: file_path.clone(),
                existing_blob_id: existing_blob_id_for_update,
            });
        files_to_process += 1;
    }

    info!(
        "scan_directory_and_create_jobs: bucketed {} file(s) into {} directory group(s) ({} skipped as unchanged)",
        files_to_process, by_dir.len(), files_skipped
    );

    // emit one ProcessDirectory job per non-empty dir bucket
    let mut jobs_created = 0usize;
    for (directory_path, files) in by_dir {
        if files.is_empty() {
            continue;
        }
        info!(
            "scan_directory_and_create_jobs: creating ProcessDirectory job for {:?} with {} file(s)",
            directory_path, files.len()
        );
        let params = ProcessDirectoryParams {
            directory_path: directory_path.clone(),
            files,
        };

        let job_request = CreateJobRequest {
            job_type: JobType::ProcessDirectory,
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

    info!(
        "scan complete: {} files found, {} files queued across {} directory jobs, {} files skipped (unchanged)",
        file_count, files_to_process, jobs_created, files_skipped
    );

    // record the canonical job total on the session as the number of
    // ProcessDirectory jobs so the runner's count-derived progress math
    // (completed = total - in_flight - failed) lines up with reality.
    // ProcessDirectory rows are deleted on completion so live counts
    // shrink over time; this snapshot is what the runner reads as
    // "total". per-file visibility is via dir-handler `info!` logs.
    let _ =
        update_session_progress(session_id, JobProgress::new(0, jobs_created as u64), None).await;

    Ok(DirectoryScanOutcome {
        file_count,
        files_queued: files_to_process,
        files_skipped,
        jobs_created,
    })
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

    async fn init_test_env(data_dir: &std::path::Path) {
        let config_toml = format!(
            r#"data_dir = "{data_dir}"

[database]
filename = "grimoire.db"

[media]
max_fs_file_size = 104857600
supported_audio_formats = ["mp3", "flac"]

[musicbrainz]
enabled = false

[logging]
level = "warn"
"#,
            data_dir = data_dir.display()
        );
        let config_path = data_dir.join("freqhole-config.toml");
        std::fs::write(&config_path, config_toml).expect("write config");
        std::fs::write(data_dir.join("grimoire.db"), b"").expect("touch grimoire.db");

        crate::config::init_config(Some(config_path)).expect("init config");
        database::run_migrations().await.expect("run migrations");
    }

    /// cargo test -p grimoire --lib -- --ignored --exact music::scanner::directory::tests::test_check_existing_blob_for_path
    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_check_existing_blob_for_path() {
        let tmp = tempfile::tempdir().expect("tempdir");
        init_test_env(tmp.path()).await;
        let pool = database::connect().await.expect("connect");

        let file_path = tmp.path().join("song.mp3");
        std::fs::write(&file_path, b"some audio bytes").expect("write test file");
        let file_path_str = file_path.to_str().unwrap().to_string();

        // no row for this path at all yet.
        assert!(matches!(
            check_existing_blob_for_path(&pool, &file_path_str).await,
            ExistingPathCheck::New
        ));

        let meta = std::fs::metadata(&file_path).unwrap();
        let mtime = meta
            .modified()
            .unwrap()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let size = meta.len() as i64;

        sqlx::query(
            "INSERT INTO media_blobz (id, sha256, blob_type, local_path, metadata)
             VALUES ('blob0001', ?, 'original', ?, ?)",
        )
        .bind("a".repeat(64))
        .bind(&file_path_str)
        .bind(serde_json::json!({ "file_modified_at": mtime, "file_size": size }).to_string())
        .execute(&pool)
        .await
        .expect("insert media blob row");

        // recorded mtime/size match what's on disk - unchanged, cheap-skip.
        assert!(matches!(
            check_existing_blob_for_path(&pool, &file_path_str).await,
            ExistingPathCheck::UnchangedSkip
        ));

        // file changed on disk (different size/mtime than recorded) -
        // needs a rescan-update on the existing row, not a fresh import.
        std::fs::write(&file_path, b"different, longer audio bytes now").expect("rewrite file");
        match check_existing_blob_for_path(&pool, &file_path_str).await {
            ExistingPathCheck::ChangedNeedsRescan { blob_id } => {
                assert_eq!(blob_id, "blob0001");
            }
            other => panic!("expected ChangedNeedsRescan, got {other:?}"),
        }
    }
}
