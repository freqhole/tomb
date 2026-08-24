//! `ImportVideo` job processor
//!
//! upload-specific entry point, mirrors `process_import_music_job`: given an
//! already-created media blob (hash already deduped by the upload handler),
//! calls the same `video::importer` core function `ProcessFile`'s video
//! branch calls into.

use crate::jobs::{Job, JobError};
use crate::media_blobz::update_blob_local_path;
use crate::video::importer::import_video_file;
use std::path::Path;
use tracing::info;

/// job parameters:
/// - blob_id: id of the media blob containing the video data
/// - local_path: filesystem path to the video file
/// - filename (optional): original filename
pub async fn process_import_video_job(job: &Job) -> Result<Option<serde_json::Value>, JobError> {
    info!("processing ImportVideo job: {}", job.id);

    let params: serde_json::Value = job.parameters()?;
    let blob_id = params["blob_id"]
        .as_str()
        .ok_or_else(|| JobError::InvalidParameters {
            reason: "missing blob_id".to_string(),
        })?
        .to_string();

    let local_path_str =
        params["local_path"]
            .as_str()
            .ok_or_else(|| JobError::InvalidParameters {
                reason: "missing local_path".to_string(),
            })?;

    // original filename (e.g. what the user picked/uploaded) - `local_path`
    // is the on-disk storage path, named after the blob's id, so it can't
    // be used to derive a human-readable title.
    let filename = params["filename"].as_str();

    info!(
        "importing video: blob_id={}, local_path={}",
        blob_id, local_path_str
    );

    let file_path = Path::new(local_path_str);
    if !file_path.exists() {
        return Err(JobError::ProcessingFailed {
            reason: format!("file not found at path: {}", local_path_str),
        });
    }

    if let Err(e) =
        update_blob_local_path(&blob_id, local_path_str, Some("job_processor".to_string())).await
    {
        // may already be set - not fatal, mirrors ImportMusic's handling
        info!(
            "note: could not update blob local_path (may already be set): {}",
            e
        );
    }

    crate::jobs::job_events::emit_stage_from_job(job, "importing", Some("importing video"));

    let import_result =
        import_video_file(&blob_id, file_path, filename, job.created_by.clone()).await?;

    info!(
        "successfully imported video: video_id={}, is_duplicate={}",
        import_result.video_id, import_result.is_duplicate
    );

    Ok(Some(serde_json::json!({
        "video_id": import_result.video_id,
        "poster_blob_id": import_result.poster_blob_id,
        "subtitle_blob_ids": import_result.subtitle_blob_ids,
        "is_duplicate": import_result.is_duplicate,
    })))
}
