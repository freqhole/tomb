//! `TranscodeVideo` job processor
//!
//! produces one or more rendition `MediaBlob` rows (`BlobType::Rendition`,
//! `parent_blob_id` = the original video blob) for a video, one ffmpeg
//! invocation per configured rendition in `config.media.video_transcode_renditions`.

use crate::blob_data::stream_sha256_hash;
use crate::blobz::compute_blake3_hash;
use crate::config::get_config;
use crate::error::ErrorDetail;
use crate::jobs::job_events;
use crate::jobs::models::{TranscodeVideoParams, TranscodeVideoResult};
use crate::jobs::{Job, JobError};
use crate::media_blobz::ffmpeg_runner::run_ffmpeg;
use crate::media_blobz::{create_media_blob, get_media_blob, BlobType, CreateMediaBlobRequest};
use std::path::Path;
use tracing::{info, warn};

pub async fn process_transcode_video_job(job: &Job) -> Result<Option<serde_json::Value>, JobError> {
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
                partial_failures: Vec::new(),
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
                partial_failures: Vec::new(),
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

    let input_path = source_blob
        .local_path
        .clone()
        .ok_or_else(|| JobError::ProcessingFailed {
            reason: format!(
                "source blob {} has no local_path to transcode from",
                params.media_blob_id
            ),
        })?;

    let mut rendition_blob_ids = Vec::new();
    let mut partial_failures: Vec<ErrorDetail> = Vec::new();
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

        // skip transcoding if source already matches target codec/container
        if should_skip_transcode(&source_blob, rendition) {
            info!(
                "skipping transcode for video {} rendition {}: source already compatible",
                params.video_id, rendition.label
            );
            // reuse the original blob as the "rendition" by creating a rendition
            // reference pointing to it (or just skip creating a redundant rendition
            // blob - depends on whether downstream code expects an explicit rendition
            // blob or not. for now, just skip and don't add to rendition_blob_ids).
            continue;
        }

        let renditions_dir = config.renditions_dir();
        if let Err(e) = tokio::fs::create_dir_all(&renditions_dir).await {
            warn!(
                "failed to create renditions dir {}: {}",
                renditions_dir.display(),
                e
            );
        }
        let output_path = renditions_dir
            .join(format!(
                "video_rendition_{}_{}.{}",
                rendition.label,
                uuid::Uuid::new_v4(),
                rendition.extension
            ))
            .to_string_lossy()
            .to_string();

        if let Err(e) = run_ffmpeg(
            &format!("transcode rendition '{}'", rendition.label),
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
                "transcode failed for video {} rendition {} (output path {}): {}",
                params.video_id, rendition.label, output_path, e
            );
            partial_failures.push(ErrorDetail::new(
                "transcode_rendition_ffmpeg_failed",
                "transcode rendition failed",
                format!(
                    "ffmpeg failed for video {} rendition {}: {}",
                    params.video_id, rendition.label, e
                ),
            ));
            let _ = tokio::fs::remove_file(&output_path).await;
            continue;
        }

        // stream size/hashes from disk instead of reading the whole
        // (potentially multi-GB) rendition into memory - the file stays at
        // `output_path` permanently and is referenced via `local_path`
        // rather than copied into blob storage.
        let size = match tokio::fs::metadata(&output_path).await {
            Ok(m) => m.len(),
            Err(e) => {
                warn!(
                    "failed to stat transcode output for video {} rendition {} at {}: {}",
                    params.video_id, rendition.label, output_path, e
                );
                partial_failures.push(ErrorDetail::new(
                    "transcode_rendition_stat_failed",
                    "transcode rendition failed",
                    format!(
                        "failed to stat transcode output for video {} rendition {} at {}: {}",
                        params.video_id, rendition.label, output_path, e
                    ),
                ));
                continue;
            }
        };

        if size == 0 {
            warn!(
                "transcode output empty for video {} rendition {}",
                params.video_id, rendition.label
            );
            partial_failures.push(ErrorDetail::new(
                "transcode_rendition_empty_output",
                "transcode rendition failed",
                format!(
                    "transcode output empty for video {} rendition {}",
                    params.video_id, rendition.label
                ),
            ));
            let _ = tokio::fs::remove_file(&output_path).await;
            continue;
        }

        let sha256 = match stream_sha256_hash(&output_path).await {
            Ok(hash) => hash,
            Err(e) => {
                warn!(
                    "failed to hash transcode output for video {} rendition {}: {} \
                     (output file left orphaned on disk at {} - next attempt will \
                     re-transcode from scratch rather than reuse it)",
                    params.video_id, rendition.label, e, output_path
                );
                partial_failures.push(ErrorDetail::new(
                    "transcode_rendition_hash_failed",
                    "transcode rendition failed",
                    format!(
                        "failed to hash transcode output for video {} rendition {}: {} \
                         (output file left orphaned on disk at {})",
                        params.video_id, rendition.label, e, output_path
                    ),
                ));
                continue;
            }
        };

        // non-fatal if this fails - matches create_media_blob_from_file's
        // handling; the blob just won't get mirrored into reliquary until
        // a blake3 is backfilled later.
        let blake3 = match compute_blake3_hash(Path::new(&output_path)).await {
            Ok(hash) => Some(hash),
            Err(e) => {
                warn!(
                    "failed to compute blake3 for transcode output {} (video {} rendition {}): {} \
                     - future p2p transfer verification for this rendition is disabled until backfilled",
                    output_path, params.video_id, rendition.label, e
                );
                partial_failures.push(ErrorDetail::new(
                    "transcode_rendition_blake3_failed",
                    "transcode rendition blake3 hash failed",
                    format!(
                        "failed to compute blake3 for transcode output {} (video {} rendition {}): {}",
                        output_path, params.video_id, rendition.label, e
                    ),
                ));
                None
            }
        };

        let mime = mime_guess::from_path(&output_path)
            .first()
            .map(|m| m.to_string())
            .unwrap_or_else(|| "application/octet-stream".to_string());

        match create_media_blob(CreateMediaBlobRequest {
            sha256,
            size: Some(size as i64),
            mime: Some(mime),
            source_client_id: None,
            local_path: Some(output_path.clone()),
            filename: Some(format!("{}.{}", rendition.label, rendition.extension)),
            parent_blob_id: Some(params.media_blob_id.clone()),
            blob_type: Some(BlobType::Rendition),
            metadata: serde_json::json!({
                "rendition": rendition.label,
            }),
            created_by: job.created_by.clone(),
            data: None,
            width: None,
            height: None,
            blake3,
            delete_duplicate_local_path: false,
        })
        .await
        {
            Ok(blob) => rendition_blob_ids.push(blob.id),
            Err(e) => {
                warn!(
                    "failed to create rendition blob for video {} rendition {} (output path {}): {}",
                    params.video_id, rendition.label, output_path, e
                );
                partial_failures.push(ErrorDetail::new(
                    "transcode_rendition_blob_creation_failed",
                    "transcode rendition failed",
                    format!(
                        "failed to create rendition blob for video {} rendition {} (output path {}): {}",
                        params.video_id, rendition.label, output_path, e
                    ),
                ));
            }
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
            partial_failures,
        })
        .map_err(JobError::Serialization)?,
    ))
}

/// check if source video already matches the target codec/container, allowing us to skip transcoding
///
/// pub(crate) so the renditions-listing route (offal/video/videos.rs)
/// can reuse this exact logic to report "skipped, already compatible"
/// renditions the way this job actually decided to skip them, rather
/// than re-deriving a parallel heuristic.
pub(crate) fn should_skip_transcode(
    source_blob: &crate::media_blobz::MediaBlob,
    rendition: &crate::config::VideoRenditionConfig,
) -> bool {
    // need both target_codec and target_container specified to skip
    let Some(target_codec) = &rendition.target_codec else {
        return false;
    };
    let Some(target_container) = &rendition.target_container else {
        return false;
    };

    // extract source codec and container from metadata
    let metadata = &source_blob.metadata;
    let source_codec = metadata.get("codec").and_then(|c| c.as_str()).unwrap_or("");
    let source_container = metadata
        .get("container")
        .and_then(|c| c.as_str())
        .unwrap_or("");

    // codec match (exact, case-insensitive)
    let codec_matches = source_codec.eq_ignore_ascii_case(target_codec);

    // container match: ffprobe returns comma-separated synonyms like "matroska,webm"
    // or "mov,mp4,m4a,3gp,3g2,mj2", so check if any synonym matches
    let container_matches = source_container
        .split(',')
        .any(|syn| syn.trim().eq_ignore_ascii_case(target_container));

    codec_matches && container_matches
}
