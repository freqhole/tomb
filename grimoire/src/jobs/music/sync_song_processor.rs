//! `SyncSongByBlake3` job processor - runs the actual pull+import that used
//! to happen inline inside the `/api/sync/song-by-blake3` request handler.
//! see `offal::sync::song::sync_song_by_blake3`'s doc comment for why this
//! moved to a background job, and `offal::sync::job_notify` for how the
//! triggering peer optionally hears back when this finishes.

use crate::jobs::models::SyncSongByBlake3JobParams;
use crate::jobs::{Job, JobError};
use crate::offal::sync::{sync_song_by_blake3_impl, SyncJobNotify};

pub async fn process_sync_song_by_blake3_job(
    job: &Job,
) -> Result<Option<serde_json::Value>, JobError> {
    let params: SyncSongByBlake3JobParams = job.parameters()?;
    let blake3 = params.request.blake3.clone();
    let title = params.request.title.clone();
    let requester_node_id = params.request.node_id.clone();

    let response = sync_song_by_blake3_impl(&params.caller, params.request, None).await;

    notify_requester(
        SyncJobNotify {
            job_id: job.id.clone(),
            domain: "song".to_string(),
            blake3,
            title,
            success: response.success,
            error: (!response.success).then(|| response.message.clone()),
        },
        requester_node_id,
    )
    .await;

    if response.success {
        Ok(response.data)
    } else {
        Err(JobError::ProcessingFailedFinal {
            reason: response.message,
            error_type: response
                .errors
                .first()
                .map(|e| e.error_type.clone())
                .unwrap_or_else(|| "sync_failed".to_string()),
        })
    }
}

/// best-effort push back to whoever triggered this job - see
/// `SyncJobNotify`'s doc comment. silently gives up if there's no
/// `node_id` to call (the triggering request didn't carry one, e.g. a
/// plain HTTP caller) or if the call itself fails (peer offline, etc) -
/// this is purely informational, nothing retries it.
async fn notify_requester(notify: SyncJobNotify, requester_node_id: Option<String>) {
    let Some(node_id) = requester_node_id else {
        return;
    };
    let body = match serde_json::to_string(&notify) {
        Ok(b) => b,
        Err(_) => return,
    };
    if let Err(e) = crate::federation::p2p_client::api_request(
        &node_id,
        "POST",
        "/api/sync/job-notify",
        Some(body),
    )
    .await
    {
        tracing::debug!(
            "process_sync_song_by_blake3_job: job-notify push to {} failed (dropped, best-effort): {}",
            &node_id[..16.min(node_id.len())],
            e
        );
    }
}
