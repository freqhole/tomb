//! media domain job processors
//!
//! shared types and helpers for non-music media processing jobs:
//! - photo_processor: image thumbnail generation and EXIF extraction
//! - document_processor: PDF thumbnail generation and metadata extraction
//! - audio_processor: general audio file processing (non-music domain)

pub mod audio_processor;
pub mod document_processor;
pub mod photo_processor;
pub mod video_processor;

use crate::blob_data;
use crate::jobs::JobError;
use crate::media_blobz::{self, MediaBlob};
use serde::Deserialize;
use serde_json::Value;
use std::process::Stdio;
use tracing::{debug, warn};

/// shared job parameters for media processing jobs
///
/// all media thumbnail/processing jobs receive these params from the ingest pipeline
#[derive(Debug, Clone, Deserialize)]
pub struct MediaJobParams {
    pub blob_id: String,
    pub entity_id: String,
    pub domain: String,
    pub mime: String,
}

impl MediaJobParams {
    /// parse media job params from a serde_json::Value
    pub fn from_value(value: &Value) -> Result<Self, JobError> {
        serde_json::from_value(value.clone()).map_err(|e| JobError::InvalidParameters {
            reason: format!("failed to parse media job params: {}", e),
        })
    }
}

/// get source bytes for a media blob
///
/// tries blob_data table first (for uploaded/inline blobs), then falls back
/// to reading from the local filesystem path if available
pub async fn get_source_bytes(blob_id: &str) -> Result<(MediaBlob, Vec<u8>), JobError> {
    debug!("fetching source bytes for blob {}", blob_id);

    let blob =
        media_blobz::get_media_blob(blob_id)
            .await
            .map_err(|e| JobError::ProcessingFailed {
                reason: format!("failed to get media blob {}: {}", blob_id, e),
            })?;

    // try blob_data table first (inline/uploaded data)
    let data_response = blob_data::get_blob_data(blob_id).await;
    if data_response.success {
        if let Some(data) = data_response.data {
            debug!(
                "got {} bytes from blob_data for blob {}",
                data.len(),
                blob_id
            );
            return Ok((blob, data));
        }
    }

    // fall back to local filesystem path
    if let Some(ref local_path) = blob.local_path {
        let data = tokio::fs::read(local_path)
            .await
            .map_err(|e| JobError::ProcessingFailed {
                reason: format!(
                    "failed to read blob {} from local path {}: {}",
                    blob_id, local_path, e
                ),
            })?;
        debug!(
            "got {} bytes from local path for blob {}",
            data.len(),
            blob_id
        );
        return Ok((blob, data));
    }

    Err(JobError::ProcessingFailed {
        reason: format!(
            "no data source available for blob {} (no blob_data and no local_path)",
            blob_id
        ),
    })
}

/// get filesystem path for a media blob, writing to a temp file if only inline data exists
///
/// returns (path, is_temp) — caller must clean up temp file when is_temp is true
pub async fn get_source_path(blob_id: &str) -> Result<(String, bool), JobError> {
    debug!("resolving source path for blob {}", blob_id);

    let blob =
        media_blobz::get_media_blob(blob_id)
            .await
            .map_err(|e| JobError::ProcessingFailed {
                reason: format!("failed to get media blob {}: {}", blob_id, e),
            })?;

    // prefer local filesystem path if available
    if let Some(ref local_path) = blob.local_path {
        // verify the file actually exists
        if tokio::fs::metadata(local_path).await.is_ok() {
            debug!("using local path for blob {}: {}", blob_id, local_path);
            return Ok((local_path.clone(), false));
        }
        warn!(
            "local path for blob {} does not exist: {}, falling back to blob_data",
            blob_id, local_path
        );
    }

    // fall back to reading blob_data and writing to a temp file
    let data_response = blob_data::get_blob_data(blob_id).await;
    if data_response.success {
        if let Some(data) = data_response.data {
            let temp_path = format!("/tmp/grimoire_src_{}_{}.bin", blob_id, uuid::Uuid::new_v4());
            tokio::fs::write(&temp_path, &data)
                .await
                .map_err(|e| JobError::ProcessingFailed {
                    reason: format!("failed to write temp file for blob {}: {}", blob_id, e),
                })?;
            debug!(
                "wrote {} bytes to temp path for blob {}: {}",
                data.len(),
                blob_id,
                temp_path
            );
            return Ok((temp_path, true));
        }
    }

    Err(JobError::ProcessingFailed {
        reason: format!(
            "no data source available for blob {} (no local_path and no blob_data)",
            blob_id
        ),
    })
}

/// clean up a temp file if is_temp is true
///
/// logs a warning on failure but never errors — cleanup is best-effort
pub async fn cleanup_temp_file(path: &str, is_temp: bool) {
    if !is_temp {
        return;
    }
    if let Err(e) = tokio::fs::remove_file(path).await {
        warn!("failed to remove temp file {}: {}", path, e);
    } else {
        debug!("cleaned up temp file: {}", path);
    }
}

/// run an external command with a timeout, returning (stdout, stderr) bytes
pub async fn run_command(
    program: &str,
    args: &[String],
    timeout_secs: u64,
) -> Result<(Vec<u8>, Vec<u8>), JobError> {
    use tokio::io::AsyncReadExt;

    debug!("running command: {} {:?}", program, args);

    let mut child = tokio::process::Command::new(program)
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| JobError::ProcessingFailed {
            reason: format!("failed to spawn {}: {}", program, e),
        })?;

    // take ownership of stdout/stderr handles before waiting, so we can still
    // kill the child on timeout without a borrow-after-move issue
    let mut stdout_handle = child.stdout.take();
    let mut stderr_handle = child.stderr.take();

    let wait_result =
        tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), child.wait()).await;

    match wait_result {
        Ok(Ok(status)) => {
            // collect stdout
            let mut stdout_buf = Vec::new();
            if let Some(ref mut h) = stdout_handle {
                let _ = h.read_to_end(&mut stdout_buf).await;
            }
            // collect stderr
            let mut stderr_buf = Vec::new();
            if let Some(ref mut h) = stderr_handle {
                let _ = h.read_to_end(&mut stderr_buf).await;
            }

            if !status.success() {
                let stderr_str = String::from_utf8_lossy(&stderr_buf);
                return Err(JobError::ProcessingFailed {
                    reason: format!(
                        "{} exited with status {}: {}",
                        program,
                        status,
                        stderr_str.trim()
                    ),
                });
            }
            Ok((stdout_buf, stderr_buf))
        }
        Ok(Err(e)) => Err(JobError::ProcessingFailed {
            reason: format!("failed to wait for {}: {}", program, e),
        }),
        Err(_) => {
            // timeout — kill the child process
            let _ = child.kill().await;
            Err(JobError::Timeout)
        }
    }
}

/// build command arguments from a template string with placeholder substitutions
///
/// parses the template using shell_words, then replaces each placeholder in-place.
/// example: build_args("-i {input} -o {output}", &[("{input}", "a.mp3"), ("{output}", "b.png")])
pub fn build_args(template: &str, substitutions: &[(&str, &str)]) -> Result<Vec<String>, JobError> {
    let mut args = shell_words::split(template).map_err(|e| JobError::ProcessingFailed {
        reason: format!("failed to parse command template: {}", e),
    })?;

    for arg in &mut args {
        for (placeholder, value) in substitutions {
            if arg.contains(placeholder) {
                *arg = arg.replace(placeholder, value);
            }
        }
    }

    Ok(args)
}
