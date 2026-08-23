//! `TranscodeVideo` job processor
//!
//! produces one or more rendition `MediaBlob` rows (`BlobType::Rendition`,
//! `parent_blob_id` = the original video blob) for a video, one ffmpeg
//! invocation per configured rendition in `config.media.video_transcode_renditions`.

use crate::config::get_config;
use crate::jobs::job_events;
use crate::jobs::models::{TranscodeVideoParams, TranscodeVideoResult};
use crate::jobs::{Job, JobError};
use crate::media_blobz::ffmpeg_runner::run_ffmpeg;
use crate::media_blobz::{create_media_blob, get_media_blob, BlobType, CreateMediaBlobRequest};
use sha2::{Digest, Sha256};
use tracing::{info, warn};

pub async fn process_transcode_video_job(
    job: &Job,
) -> Result<Option<serde_json::Value>, JobError> {
    let params: TranscodeVideoParams = job.parameters()?;
    info!(
        "processing TranscodeVideo job {}: video_id={}",
        job.id, params.video_id
    );

    let config = get_config();
    if !config.media.transcode_video_enabled {
        info!(
            "transcode_video_enabled is false, skipping transcode for video {}",
            params.video_id
        );
        return Ok(Some(
            serde_json::to_value(TranscodeVideoResult {
                video_id: params.video_id,
                rendition_blob_ids: Vec::new(),
            })
            .map_err(JobError::Serialization)?,
        ));
    }
    let renditions = config.media.video_transcode_renditions.clone();
    if renditions.is_empty() {
        info!(
            "no video_transcode_renditions configured, skipping transcode for video {}",
            params.video_id
        );
        return Ok(Some(
            serde_json::to_value(TranscodeVideoResult {
                video_id: params.video_id,
                rendition_blob_ids: Vec::new(),
            })
            .map_err(JobError::Serialization)?,
        ));
    }

    let source_blob =
        get_media_blob(&params.media_blob_id)
            .await
            .map_err(|e| JobError::ProcessingFailed {
                reason: format!("failed to load source blob {}: {}", params.media_blob_id, e),
            })?;

    let input_path = source_blob.local_path.clone().ok_or_else(|| {
        JobError::ProcessingFailed {
            reason: format!(
                "source blob {} has no local_path to transcode from",
                params.media_blob_id
            ),
        }
    })?;

    let mut rendition_blob_ids = Vec::new();
    let total = renditions.len();
    for (i, rendition) in renditions.iter().enumerate() {
        job_events::emit_stage_from_job(
            job,
            "transcoding",
            Some(&format!(
                "rendition {}/{}: {}",
                i + 1,
                total,
                rendition.label
            )),
        );

        let output_path = format!(
            "/tmp/video_rendition_{}_{}.mp4",
            rendition.label,
            uuid::Uuid::new_v4()
        );

        if let Err(e) = run_ffmpeg(
            &rendition.args,
            &[
                ("{input}", input_path.as_str()),
                ("{output}", output_path.as_str()),
            ],
            &config.media.ffmpeg_path,
        )
        .await
        {
            warn!(
                "transcode failed for video {} rendition {}: {}",
                params.video_id, rendition.label, e
            );
            continue;
        }

        let output_bytes = match tokio::fs::read(&output_path).await {
            Ok(b) => b,
            Err(e) => {
                warn!(
                    "failed to read transcode output for video {} rendition {}: {}",
                    params.video_id, rendition.label, e
                );
                continue;
            }
        };
        let _ = tokio::fs::remove_file(&output_path).await;

        if output_bytes.is_empty() {
            warn!(
                "transcode output empty for video {} rendition {}",
                params.video_id, rendition.label
            );
            continue;
        }

        let blake3 = reliquary::hash_bytes(&output_bytes);
        let mut hasher = Sha256::new();
        hasher.update(&output_bytes);
        let sha256 = format!("{:x}", hasher.finalize());
        let size = output_bytes.len() as i64;

        match create_media_blob(CreateMediaBlobRequest {
            sha256,
            size: Some(size),
            mime: Some("video/mp4".to_string()),
            source_client_id: None,
            local_path: None,
            filename: Some(format!("{}.mp4", rendition.label)),
            parent_blob_id: Some(params.media_blob_id.clone()),
            blob_type: Some(BlobType::Rendition),
            metadata: serde_json::json!({
                "rendition": rendition.label,
            }),
            created_by: job.created_by.clone(),
            data: Some(crate::Bytes::from(output_bytes)),
            width: None,
            height: None,
            blake3: Some(blake3),
        })
        .await
        {
            Ok(blob) => rendition_blob_ids.push(blob.id),
            Err(e) => warn!(
                "failed to create rendition blob for video {} rendition {}: {}",
                params.video_id, rendition.label, e
            ),
        }
    }

    info!(
        "TranscodeVideo job {} completed: {} of {} renditions succeeded",
        job.id,
        rendition_blob_ids.len(),
        total
    );

    Ok(Some(
        serde_json::to_value(TranscodeVideoResult {
            video_id: params.video_id,
            rendition_blob_ids,
        })
        .map_err(JobError::Serialization)?,
    ))
}
