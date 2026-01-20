//! directory scanning job processor
//!
//! scans filesystem directories for audio files and creates ProcessFile jobs

use super::models::{ScanDirectoryParams, ScanDirectoryResult};
use crate::blob_data;
use crate::jobs::models::{Job, JobError};
use crate::music::crud;
use crate::music::scanner;
use serde_json::Value;

/// process directory scan job - recursively scan for audio files and create import jobs
pub async fn process_scan_directory_job(job: &Job) -> Result<Option<Value>, JobError> {
    // initialize duplicate report for this scan session
    crud::init_duplicate_report();

    // parse job parameters
    let params: ScanDirectoryParams = match serde_json::from_str(&job.parameters) {
        Ok(p) => p,
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("invalid parameters: {}", e),
            })
        }
    };

    let session_id = match job.session_id.as_ref() {
        Some(sid) => sid,
        None => {
            return Err(JobError::ProcessingFailed {
                reason: "scan directory job requires a session_id".to_string(),
            })
        }
    };

    // use music scanner to handle directory scanning and job creation
    let files_discovered = match scanner::scan_directory_and_create_jobs(
        &params.directory_path,
        session_id,
        params.recursive,
        params.max_depth,
        params.file_extensions,
    )
    .await
    {
        Ok(count) => count,
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("failed to scan directory: {}", e),
            })
        }
    };

    // clear caches and write reports
    if let Some(sid) = &job.session_id {
        blob_data::clear_scan_cache(sid).await;
    }
    if let Err(e) = crud::write_duplicate_report() {
        tracing::warn!("failed to write duplicate report: {}", e);
    }

    // return scan results
    let result = ScanDirectoryResult {
        files_discovered: files_discovered as u64,
        jobs_created: files_discovered as u64,
        errors: Vec::new(),
    };

    Ok(Some(serde_json::to_value(result).map_err(|e| {
        JobError::ProcessingFailed {
            reason: format!("failed to serialize result: {}", e),
        }
    })?))
}
