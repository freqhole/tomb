//! directory-grained audio import job processor
//!
//! processes every audio file in a single directory inside one job
//! (no chunking). the scanner fans out by parent dir (not by file)
//! so the worker pool avoids cross-dir i/o thrash and redundant
//! concurrent ffmpeg / art-extraction work. files are processed
//! sequentially within the job; failures on individual files are
//! collected and reported aggregately, the job as a whole succeeds
//! as long as no fatal error stops the loop.

use super::file_processor::process_file_job;
use super::models::{
    DirectoryFileFailure, ProcessDirectoryParams, ProcessDirectoryResult, ProcessFileParams,
};
use crate::jobs::models::{Job, JobError};
use serde_json::Value;
use tracing::{info, warn};

/// process every audio file in a single directory inside one job.
///
/// each file is processed by delegating to `process_file_job` with a
/// synthesized per-file `Job` so all the existing import logic
/// (sha256, ffprobe, image collection, waveform, dedup, rescan-update
/// fallback) runs unchanged. per-file failures are captured but do
/// not abort the loop; the job as a whole succeeds and reports them
/// in `ProcessDirectoryResult.failures`.
///
/// progress at the session level is driven by the runner's per-job
/// aggregate emit (one event per dir-job completion). per-file
/// visibility is via the `info!` log line below — emitting per-file
/// `GrimoireEvent::JobProgress` here would race with the runner's
/// session-aggregate emit on the same ui consumer.
pub async fn process_directory_job(job: &Job) -> Result<Option<Value>, JobError> {
    let params: ProcessDirectoryParams = match serde_json::from_str(&job.parameters) {
        Ok(p) => p,
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("invalid parameters: {}", e),
            })
        }
    };

    let dir_start = std::time::Instant::now();
    let total = params.files.len() as u64;
    info!(
        "processing directory: {} ({} files)",
        params.directory_path, total
    );

    let mut succeeded: u64 = 0;
    let mut failed: u64 = 0;
    let mut failures: Vec<DirectoryFileFailure> = Vec::new();

    for (idx, entry) in params.files.iter().enumerate() {
        let file_params = ProcessFileParams {
            file_path: entry.file_path.clone(),
            extract_metadata: true,
            generate_thumbnail: true,
            generate_waveform: true,
            source_url: None,
            existing_blob_id: entry.existing_blob_id.clone(),
            serialization_group: None,
        };

        // synthesize a per-file Job so the existing file processor
        // sees the same shape it always has. session_id + created_by
        // are inherited from the parent dir job so attribution and
        // session progress aggregation work as before.
        let synth_job = Job {
            id: format!("{}#{}", job.id, idx),
            session_id: job.session_id.clone(),
            job_type: "ProcessFile".to_string(),
            status: "Running".to_string(),
            parameters: match serde_json::to_string(&file_params) {
                Ok(s) => s,
                Err(e) => {
                    failed += 1;
                    failures.push(DirectoryFileFailure {
                        file_path: entry.file_path.clone(),
                        error_message: format!("failed to serialize per-file params: {}", e),
                    });
                    continue;
                }
            },
            result: None,
            retry_count: 0,
            max_retries: 0,
            scheduled_at: 0,
            started_at: None,
            completed_at: None,
            error_message: None,
            created_by: job.created_by.clone(),
        };

        match process_file_job(&synth_job).await {
            Ok(_) => {
                succeeded += 1;
            }
            Err(e) => {
                let reason = match &e {
                    JobError::ProcessingFailed { reason } => reason.clone(),
                    other => format!("{:?}", other),
                };
                warn!(
                    "file failed inside dir job ({}): {} - {}",
                    params.directory_path, entry.file_path, reason
                );
                failed += 1;
                failures.push(DirectoryFileFailure {
                    file_path: entry.file_path.clone(),
                    error_message: reason,
                });
            }
        }
    }

    let elapsed = dir_start.elapsed();
    info!(
        "directory processing complete: {} | files={} succeeded={} failed={} | elapsed={:.1}s",
        params.directory_path,
        total,
        succeeded,
        failed,
        elapsed.as_secs_f64(),
    );

    let result = ProcessDirectoryResult {
        directory_path: params.directory_path,
        files_total: total,
        files_succeeded: succeeded,
        files_failed: failed,
        failures,
    };

    Ok(Some(serde_json::to_value(result).map_err(|e| {
        JobError::ProcessingFailed {
            reason: format!("failed to serialize result: {}", e),
        }
    })?))
}
