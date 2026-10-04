//! `SyncVideoByBlake3` job processor - see `sync_song_processor.rs`'s doc
//! comment for the full rationale, this is the video counterpart.

use crate::jobs::models::SyncVideoByBlake3JobParams;
use crate::jobs::{job_events, Job, JobError};
use crate::offal::sync::{sync_video_by_blake3_impl, SyncJobNotify};

pub async fn process_sync_video_by_blake3_job(
    job: &Job,
) -> Result<Option<serde_json::Value>, JobError> {
    let params: SyncVideoByBlake3JobParams = job.parameters()?;
    let blake3 = params.request.blake3.clone();
    let title = params.request.title.clone();
    let requester_node_id = params.request.node_id.clone();
    let declared_size = params.request.size;

    // see sync_song_processor.rs's identical wiring for the rationale.
    let progress_job = job.clone();
    let progress_cb: std::sync::Arc<crate::federation::p2p_client::BlobProgressFn> =
        std::sync::Arc::new(move |bytes_received: u64| {
            let bytes_total = declared_size.unwrap_or(0);
            job_events::emit_stage_from_job_with_details(
                &progress_job,
                "downloading",
                Some(&format!("{bytes_received} of {bytes_total} bytes")),
                Some(serde_json::json!({
                    "bytes_received": bytes_received,
                    "bytes_total": bytes_total,
                })),
            );
        });

    let response =
        sync_video_by_blake3_impl(&params.caller, params.request, Some(progress_cb.as_ref())).await;

    notify_requester(
        SyncJobNotify {
            job_id: job.id.clone(),
            domain: "video".to_string(),
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

/// see `sync_song_processor.rs`'s `notify_requester` doc comment.
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
            "process_sync_video_by_blake3_job: job-notify push to {} failed (dropped, best-effort): {}",
            &node_id[..16.min(node_id.len())],
            e
        );
    }
}
