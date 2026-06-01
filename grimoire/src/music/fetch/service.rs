//! fetch music service - external media fetching implementation
//!
//! handles fetching media from external sources (youtube, soundcloud, etc.)
//! using configurable external commands (typically yt-dlp).
//!
//! workflow:
//! 1. precheck: extract metadata without downloading
//! 2. deduplication: check if content already exists
//! 3. fetch: download media files
//! 4. import: create ProcessFile jobs for downloaded files

use std::collections::HashSet;
use std::path::Path;
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tracing::{info, warn};

use crate::config::GrimoireConfig;
use crate::response::GrimoireResponse;

use super::models::{ContentMetadata, DownloadedFile, FetchMediaParams, FetchMediaResult};

/// progress callback trait for live fetch updates
pub trait FetchProgress: Send + Sync {
    fn item_started(&self, content_id: &str, filename_hint: Option<&str>);
    fn item_complete(&self, content_id: &str, filename: &str);
    fn postprocess(&self, content_id: &str);
}

/// no-op progress callback for non-job callers
pub struct NoopFetchProgress;

impl FetchProgress for NoopFetchProgress {
    fn item_started(&self, _: &str, _: Option<&str>) {}
    fn item_complete(&self, _: &str, _: &str) {}
    fn postprocess(&self, _: &str) {}
}

/// extract metadata from URL without downloading (precheck)
///
/// returns list of content metadata (single item or playlist)
pub async fn extract_metadata(
    url: &str,
    config: &GrimoireConfig,
) -> Result<Vec<ContentMetadata>, String> {
    let fetch_config = config
        .server
        .as_ref()
        .and_then(|s| s.fetch_music.as_ref())
        .ok_or("fetch_music not configured")?;

    if !fetch_config.enabled {
        return Err("fetch_music is not enabled".to_string());
    }

    let precheck_cmd = fetch_config
        .precheck_command
        .as_ref()
        .ok_or("precheck_command not configured")?;

    info!("extracting metadata for URL: {}", url);

    // parse command and args
    let parts: Vec<&str> = precheck_cmd.split_whitespace().collect();
    if parts.is_empty() {
        return Err("precheck_command is empty".to_string());
    }

    let (cmd, args) = parts.split_first().unwrap();

    // execute precheck command
    let output = Command::new(cmd)
        .args(args)
        .arg("--") // separator before URL
        .arg(url)
        .output()
        .await
        .map_err(|e| format!("failed to execute precheck command: {}", e))?;

    if !output.status.success() {
        let error_msg = String::from_utf8_lossy(&output.stderr);
        return Err(format!("precheck command failed: {}", error_msg));
    }

    // parse output - one JSON object per line
    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut metadata_list = Vec::new();

    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        match ContentMetadata::from_json(line) {
            Ok(metadata) => metadata_list.push(metadata),
            Err(e) => warn!("failed to parse metadata line: {}", e),
        }
    }

    if metadata_list.is_empty() {
        return Err("no metadata extracted from URL".to_string());
    }

    info!(
        "extracted metadata for {} item(s) from URL: {}",
        metadata_list.len(),
        url
    );

    Ok(metadata_list)
}

/// check which content IDs already exist in database
///
/// returns list of (content_id, existing_blob_id) pairs
pub async fn check_existing_content(metadata_list: &[ContentMetadata]) -> Vec<(String, String)> {
    let mut existing = Vec::new();

    for metadata in metadata_list {
        if let Ok(Some(blob_id)) = metadata.check_exists_in_db().await {
            info!(
                "content already exists: {} (blob_id: {})",
                metadata.content_id, blob_id
            );
            existing.push((metadata.content_id.clone(), blob_id));
        }
    }

    existing
}

/// download media from URL
///
/// returns list of successfully downloaded files
pub async fn download_media(
    url: &str,
    job_id: &str,
    config: &GrimoireConfig,
    progress: &dyn FetchProgress,
) -> Result<Vec<DownloadedFile>, String> {
    let fetch_config = config
        .server
        .as_ref()
        .and_then(|s| s.fetch_music.as_ref())
        .ok_or("fetch_music not configured")?;

    if !fetch_config.enabled {
        return Err("fetch_music is not enabled".to_string());
    }

    let fetch_cmd = fetch_config
        .fetch_command
        .as_ref()
        .ok_or("fetch_command not configured")?;

    let base_output_dir = fetch_config
        .output_dir
        .as_ref()
        .ok_or("output_dir not configured")?;

    // create job-specific subdirectory
    let output_dir = format!("{}/{}", base_output_dir, job_id);

    // ensure output directory exists
    tokio::fs::create_dir_all(&output_dir)
        .await
        .map_err(|e| format!("failed to create output directory: {}", e))?;

    info!("downloading media from URL: {} to {}", url, output_dir);

    // parse command and args using shell-words for proper quoting support
    let parts = shell_words::split(fetch_cmd)
        .map_err(|e| format!("invalid fetch_command shell syntax: {}", e))?;

    if parts.is_empty() {
        return Err("fetch_command is empty".to_string());
    }

    let (cmd, args) = parts.split_first().unwrap();

    // spawn yt-dlp with piped stdout/stderr for streaming
    let mut child = Command::new(cmd)
        .args(args)
        .arg("--paths")
        .arg(&output_dir)
        .arg("--")
        .arg(url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("failed to execute fetch command: {}", e))?;

    let stdout = child.stdout.take().ok_or("failed to capture stdout")?;
    let stderr = child.stderr.take().ok_or("failed to capture stderr")?;

    // spawn task to drain stderr (log warnings)
    let stderr_task = tokio::spawn(async move {
        let reader = BufReader::new(stderr);
        let mut lines = reader.lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if !line.trim().is_empty() {
                warn!("yt-dlp stderr: {}", line);
            }
        }
    });

    // read stdout line by line
    let mut file_paths: Vec<String> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();
    let mut started_ids: HashSet<String> = HashSet::new();
    let mut postprocess_ids: HashSet<String> = HashSet::new();

    let reader = BufReader::new(stdout);
    let mut lines = reader.lines();

    while let Ok(Some(raw_line)) = lines.next_line().await {
        // yt-dlp progress emits `\r`-terminated updates that overwrite the
        // same terminal line; tokio's next_line splits only on `\n`, so a
        // single returned line may carry many `\r`-separated progress
        // chunks plus a trailing real line. handle each chunk separately.
        for line in raw_line.split('\r') {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            // yt-dlp's `--progress-template [KIND:]TEMPLATE` consumes the
            // `KIND:` prefix as a destination selector, so the actual output
            // is just the template body. distinguish progress lines from
            // final filepaths (emitted by `--print after_move:filepath`) by
            // structure: progress lines are pipe-delimited and filepaths
            // never contain `|`.
            if line.contains('|') {
                let fields: Vec<&str> = line.split('|').collect();
                match fields.len() {
                    // download: id|status|downloaded|total|filename
                    5 => {
                        let content_id = fields[0];
                        let status = fields[1];
                        // yt-dlp emits full local paths in %(progress.filename)s;
                        // strip to basename before broadcasting (no local fs
                        // paths in job events).
                        let filename = std::path::Path::new(fields[4])
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or(fields[4]);

                        if !started_ids.contains(content_id) {
                            started_ids.insert(content_id.to_string());
                            progress.item_started(content_id, Some(filename));
                        }

                        if status == "finished" && !seen_ids.contains(content_id) {
                            seen_ids.insert(content_id.to_string());
                            progress.item_complete(content_id, filename);
                        }
                    }
                    // postprocess: id|status
                    2 => {
                        let content_id = fields[0];
                        if !postprocess_ids.contains(content_id) {
                            postprocess_ids.insert(content_id.to_string());
                            progress.postprocess(content_id);
                        }
                    }
                    _ => {
                        // unknown pipe-delimited line — log and skip rather
                        // than misinterpret as a filepath.
                        warn!("yt-dlp: unrecognized progress line: {}", line);
                    }
                }
            } else {
                // non-pipe lines are final file paths from `--print after_move:filepath`
                file_paths.push(line.to_string());
            }
        } // end of inner `for line in raw_line.split('\r')`
    }

    // defensive: drop anything that doesn't actually exist on disk. yt-dlp's
    // output is messy (progress and filepaths interleave on stdout/stderr,
    // exact behavior varies by version), so trust the filesystem as the
    // source of truth rather than the parser's heuristic.
    let before = file_paths.len();
    file_paths.retain(|p| {
        let exists = Path::new(p).exists();
        if !exists {
            warn!("yt-dlp: discarding non-existent reported path: {}", p);
        }
        exists
    });
    file_paths.sort();
    file_paths.dedup();
    if file_paths.len() != before {
        warn!(
            "yt-dlp: filtered {} suspect path(s) down to {} real file(s)",
            before,
            file_paths.len()
        );
    }

    // wait for stderr drain and child process
    let _ = tokio::join!(stderr_task);
    let status = child
        .wait()
        .await
        .map_err(|e| format!("failed to wait for fetch command: {}", e))?;

    // note: we don't check status.success() because --ignore-errors means
    // partial success is still a success. check if any files were downloaded instead.

    if file_paths.is_empty() {
        return Err("no files were downloaded".to_string());
    }

    info!("downloaded {} file(s) from URL: {}", file_paths.len(), url);

    // for now, return file paths without metadata
    // actual metadata extraction happens during ProcessFile job
    let downloaded_files: Vec<DownloadedFile> = file_paths
        .into_iter()
        .enumerate()
        .map(|(idx, file_path)| {
            // extract content_id from filename pattern [content_id]
            let content_id = extract_content_id_from_path(&file_path)
                .unwrap_or_else(|| format!("unknown_{}", idx));

            DownloadedFile {
                file_path,
                content_id: content_id.clone(),
                metadata: ContentMetadata {
                    platform: "unknown".to_string(),
                    content_id,
                    title: None,
                    artist: None,
                    uploader: None,
                    duration_seconds: None,
                    url: url.to_string(),
                    playlist_title: None,
                    playlist_index: None,
                    raw_metadata: serde_json::Value::Null,
                },
            }
        })
        .collect();

    Ok(downloaded_files)
}

/// extract content ID from filename pattern like "Artist - Title [content_id].mp3"
fn extract_content_id_from_path(file_path: &str) -> Option<String> {
    let file_name = Path::new(file_path).file_name()?.to_str()?;

    // look for pattern [content_id]
    let start = file_name.find('[')?;
    let end = file_name.find(']')?;

    if start < end {
        Some(file_name[start + 1..end].to_string())
    } else {
        None
    }
}

/// complete fetch workflow: precheck, download, and create import jobs
pub async fn fetch_media(
    params: FetchMediaParams,
    job_id: &str,
    config: &GrimoireConfig,
    progress: &dyn FetchProgress,
) -> GrimoireResponse<FetchMediaResult> {
    // step 1: extract metadata (precheck)
    let metadata_list = match extract_metadata(&params.url, config).await {
        Ok(list) => list,
        Err(e) => return GrimoireResponse::failure(&format!("precheck failed: {}", e), vec![]),
    };

    let total_items = metadata_list.len() as u32;
    info!("found {} item(s) to fetch", total_items);

    // step 2: check for existing content
    let existing = check_existing_content(&metadata_list).await;
    if !existing.is_empty() {
        info!("{} item(s) already exist, skipping", existing.len());
    }

    // step 3: download media
    let downloaded_files = match download_media(&params.url, job_id, config, progress).await {
        Ok(files) => files,
        Err(e) => return GrimoireResponse::failure(&format!("download failed: {}", e), vec![]),
    };

    if downloaded_files.is_empty() {
        return GrimoireResponse::failure("no files downloaded", vec![]);
    }

    // step 4: create ProcessFile jobs for each downloaded file
    // (this will be implemented when we integrate with jobs system)
    let mut result =
        FetchMediaResult::from_downloads(total_items, downloaded_files.clone(), Vec::new());

    // add existing content to result
    for (_content_id, blob_id) in existing {
        result.media_blob_ids.push(blob_id);
        // note: we don't add to errors, existing content is fine
    }

    info!(
        "fetch completed: {}/{} items downloaded",
        result.items_downloaded, result.items_requested
    );

    GrimoireResponse::success("media fetch completed", result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_content_id_from_path() {
        let path = "/path/to/Artist - Title [abc123].mp3";
        assert_eq!(
            extract_content_id_from_path(path),
            Some("abc123".to_string())
        );

        let path = "Artist - Title [xyz789].flac";
        assert_eq!(
            extract_content_id_from_path(path),
            Some("xyz789".to_string())
        );

        let path = "no_brackets.mp3";
        assert_eq!(extract_content_id_from_path(path), None);
    }
}
