//! thumbnail service placeholder
//! TODO: migrate from legacylib/src/thumbnails/service.rs

use super::models::{ThumbnailJob, ThumbnailJobStatus, ThumbnailRequest, ThumbnailResult};
use crate::error::GrimoireResult;

/// generate a thumbnail for a media blob
pub async fn generate_thumbnail(
    _request: ThumbnailRequest,
    _media_db_path: &str,
) -> GrimoireResult<ThumbnailResult> {
    // TODO: implement thumbnail generation
    // - load source blob from media_blob storage
    // - decode image/extract frame from video
    // - resize/crop according to config
    // - encode to target format
    // - store result as new blob
    // - return thumbnail metadata
    todo!("implement thumbnail generation")
}

/// queue a thumbnail generation job
pub async fn queue_thumbnail_job(
    _request: ThumbnailRequest,
    _app_state_db_path: &str,
) -> GrimoireResult<ThumbnailJob> {
    // TODO: implement job queuing
    // - create job record in jobz table
    // - set status to pending
    // - return job details
    todo!("implement thumbnail job queuing")
}

/// get thumbnail job by id
pub async fn get_thumbnail_job(
    _job_id: &str,
    _app_state_db_path: &str,
) -> GrimoireResult<ThumbnailJob> {
    // TODO: implement job retrieval
    todo!("implement get thumbnail job")
}

/// list all thumbnail jobs with optional status filter
pub async fn list_thumbnail_jobs(
    _status: Option<ThumbnailJobStatus>,
    _app_state_db_path: &str,
) -> GrimoireResult<Vec<ThumbnailJob>> {
    // TODO: implement job listing
    todo!("implement list thumbnail jobs")
}
