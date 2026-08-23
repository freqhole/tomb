//! video file import core
//!
//! shared entry point for both `ProcessFile`'s video branch and the
//! `ImportVideo` upload job - mirrors `music::scanner::import::extract_and_import`'s
//! role for songs. given an already-created `MediaBlob`, this:
//!
//! 1. probes duration/resolution via ffprobe
//! 2. dedupes against an already-imported video for the same blob
//! 3. creates the `videoz` row (series/season left unassigned - organizing
//!    an imported video is a separate, later, manual step)
//! 4. extracts a poster frame + any embedded subtitle tracks inline
//! 5. enqueues a `TranscodeVideo` job

use crate::config::{get_config, GrimoireConfig};
use crate::jobs::{CreateJobRequest, JobError, JobType, TranscodeVideoParams};
use crate::media_blobz::ffmpeg_runner::run_ffmpeg;
use crate::media_blobz::{create_media_blob, BlobType, CreateMediaBlobRequest};
use crate::video::{create_video, CreateVideoRequest};
use std::path::Path;
use tracing::{debug, info, warn};

/// result of importing a single video file
#[derive(Debug, Clone)]
pub struct VideoImportResult {
    pub video_id: String,
    pub poster_blob_id: Option<String>,
    pub subtitle_blob_ids: Vec<String>,
    /// true when this media blob already had a video row (no-op import)
    pub is_duplicate: bool,
}

/// ffprobe format/stream properties relevant to video import
#[derive(Debug, Clone, Default)]
struct VideoProperties {
    duration_seconds: Option<f64>,
    subtitle_stream_indices: Vec<i64>,
}

/// import a video file: probe, dedupe, create the video row, extract
/// poster/subtitles, and enqueue transcoding.
pub async fn import_video_file(
    media_blob_id: &str,
    file_path: &Path,
    created_by: Option<String>,
) -> Result<VideoImportResult, JobError> {
    let config = get_config();

    // dedupe: a video already exists for this media blob (the blob itself
    // was already deduped by sha256 in the caller's create_media_blob step,
    // so this catches "same file bytes imported before").
    if let Some(existing_video_id) = find_video_by_media_blob_id(media_blob_id).await? {
        info!(
            "video already imported for blob {}: video_id={}",
            media_blob_id, existing_video_id
        );
        return Ok(VideoImportResult {
            video_id: existing_video_id,
            poster_blob_id: None,
            subtitle_blob_ids: Vec::new(),
            is_duplicate: true,
        });
    }

    let props = probe_video_properties(file_path, &config).await;

    let title = file_path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("untitled")
        .to_string();

    let create_req = CreateVideoRequest {
        series_id: None,
        season_id: None,
        episode_number: None,
        title,
        description: None,
        media_blob_id: media_blob_id.to_string(),
        poster_blob_id: None,
        duration_seconds: props.duration_seconds,
        release_date: None,
        created_by: created_by.clone(),
    };

    let video = match create_video(create_req).await {
        response if response.success => response.data.ok_or_else(|| JobError::ProcessingFailed {
            reason: "video creation succeeded but returned no data".to_string(),
        })?,
        response => {
            // race: another worker imported the same blob concurrently.
            let is_dup = response
                .errors
                .iter()
                .any(|e| e.error_type == "duplicate_video");
            if is_dup {
                if let Some(existing_video_id) = find_video_by_media_blob_id(media_blob_id).await?
                {
                    return Ok(VideoImportResult {
                        video_id: existing_video_id,
                        poster_blob_id: None,
                        subtitle_blob_ids: Vec::new(),
                        is_duplicate: true,
                    });
                }
            }
            let error_messages: Vec<String> =
                response.errors.iter().map(|e| e.detail.clone()).collect();
            return Err(JobError::ProcessingFailed {
                reason: format!("failed to create video: {}", error_messages.join(", ")),
            });
        }
    };

    // inline poster extraction (best-effort - a failed poster grab
    // shouldn't fail the whole import, mirrors music's "no album art
    // found" being a soft failure).
    let poster_blob_id =
        match extract_video_poster(media_blob_id, file_path, &config, created_by.clone()).await {
            Ok(blob_id) => {
                let update_resp = crate::video::update_video(crate::video::UpdateVideoRequest {
                    video_id: video.id.clone(),
                    series_id: None,
                    season_id: None,
                    episode_number: None,
                    title: None,
                    description: None,
                    poster_blob_id: Some(blob_id.clone()),
                    duration_seconds: None,
                    release_date: None,
                    updated_by: created_by.clone(),
                })
                .await;
                if update_resp.success {
                    debug!("linked poster blob to video {}", video.id);
                } else {
                    warn!(
                        "failed to link poster blob to video {}: {}",
                        video.id, update_resp.message
                    );
                }
                Some(blob_id)
            }
            Err(e) => {
                warn!("poster extraction failed for {}: {}", video.id, e);
                None
            }
        };

    // inline subtitle extraction (best-effort per track)
    let mut subtitle_blob_ids = Vec::new();
    for stream_index in &props.subtitle_stream_indices {
        match extract_subtitle_track(media_blob_id, file_path, *stream_index, &config, created_by.clone())
            .await
        {
            Ok(blob_id) => subtitle_blob_ids.push(blob_id),
            Err(e) => warn!(
                "subtitle extraction failed for track {} of {}: {}",
                stream_index, video.id, e
            ),
        }
    }

    // enqueue the deferred transcode step
    let transcode_params = TranscodeVideoParams {
        media_blob_id: media_blob_id.to_string(),
        video_id: video.id.clone(),
    };
    let job_response = crate::jobs::create_job(CreateJobRequest {
        job_type: JobType::TranscodeVideo,
        session_id: None,
        parameters: serde_json::to_value(&transcode_params).map_err(|e| {
            JobError::ProcessingFailed {
                reason: format!("failed to serialize TranscodeVideo params: {}", e),
            }
        })?,
        max_retries: Some(3),
        scheduled_at: None,
        created_by,
        priority: None,
    })
    .await;

    if !job_response.success {
        warn!(
            "failed to enqueue TranscodeVideo job for video {}: {}",
            video.id, job_response.message
        );
    }

    Ok(VideoImportResult {
        video_id: video.id,
        poster_blob_id,
        subtitle_blob_ids,
        is_duplicate: false,
    })
}

/// look up an existing (non-deleted) video by its media_blob_id.
async fn find_video_by_media_blob_id(media_blob_id: &str) -> Result<Option<String>, JobError> {
    let pool = crate::database::connect().await?;
    let id = sqlx::query_scalar!(
        "SELECT id FROM videoz WHERE media_blob_id = ? AND deleted_at IS NULL LIMIT 1",
        media_blob_id
    )
    .fetch_optional(&pool)
    .await
    .map_err(|e| JobError::ProcessingFailed {
        reason: format!("failed to check for existing video: {}", e),
    })?;
    Ok(id.flatten())
}

/// probe duration + subtitle stream indices via ffprobe. best-effort:
/// returns defaults (no duration, no subtitle tracks) if ffprobe isn't
/// configured or fails, rather than failing the whole import.
async fn probe_video_properties(file_path: &Path, config: &GrimoireConfig) -> VideoProperties {
    let ffprobe_bin = config
        .media
        .ffprobe_path
        .clone()
        .unwrap_or_else(|| "ffprobe".to_string());

    let input = file_path.to_string_lossy().to_string();
    let args = match shell_words::split(&config.media.ffprobe_video_properties_args) {
        Ok(a) => a
            .into_iter()
            .map(|arg| arg.replace("{input}", &input))
            .collect::<Vec<_>>(),
        Err(e) => {
            warn!("failed to parse ffprobe_video_properties_args: {}", e);
            return VideoProperties::default();
        }
    };

    let output = match tokio::process::Command::new(&ffprobe_bin)
        .args(&args)
        .output()
        .await
    {
        Ok(o) => o,
        Err(e) => {
            warn!("failed to run ffprobe ({}): {}", ffprobe_bin, e);
            return VideoProperties::default();
        }
    };

    if !output.status.success() {
        warn!(
            "ffprobe exited with {:?} for {}",
            output.status.code(),
            input
        );
        return VideoProperties::default();
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let json: serde_json::Value = match serde_json::from_str(&stdout) {
        Ok(v) => v,
        Err(e) => {
            warn!("failed to parse ffprobe json output: {}", e);
            return VideoProperties::default();
        }
    };

    let duration_seconds = json
        .get("format")
        .and_then(|f| f.get("duration"))
        .and_then(|d| d.as_str())
        .and_then(|s| s.parse::<f64>().ok());

    let subtitle_stream_indices = json
        .get("streams")
        .and_then(|s| s.as_array())
        .map(|streams| {
            streams
                .iter()
                .filter(|s| s.get("codec_type").and_then(|t| t.as_str()) == Some("subtitle"))
                .filter_map(|s| s.get("index").and_then(|i| i.as_i64()))
                .collect()
        })
        .unwrap_or_default();

    VideoProperties {
        duration_seconds,
        subtitle_stream_indices,
    }
}

/// extract a single poster frame and store it as a `Thumbnail` blob.
async fn extract_video_poster(
    media_blob_id: &str,
    file_path: &Path,
    config: &GrimoireConfig,
    created_by: Option<String>,
) -> Result<String, crate::error::GrimoireError> {
    let temp_file = format!("/tmp/video_poster_{}.jpg", uuid::Uuid::new_v4());
    let input = file_path.to_string_lossy().to_string();

    run_ffmpeg(
        &config.media.extract_video_poster_args,
        &[("{input}", input.as_str()), ("{output}", temp_file.as_str())],
        &config.media.ffmpeg_path,
    )
    .await?;

    let jpeg_data = tokio::fs::read(&temp_file).await.map_err(|_| {
        crate::error::GrimoireError::ProcessingFailed {
            message: "no poster frame extracted from video file".to_string(),
        }
    })?;
    let _ = tokio::fs::remove_file(&temp_file).await;

    if jpeg_data.is_empty() {
        return Err(crate::error::GrimoireError::ProcessingFailed {
            message: "extracted poster frame is empty".to_string(),
        });
    }

    let webp_data = crate::blob_data::convert_to_webp(&jpeg_data)?;
    let blake3 = reliquary::hash_bytes(&webp_data);
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(&webp_data);
    let sha256 = format!("{:x}", hasher.finalize());

    let blob = create_media_blob(CreateMediaBlobRequest {
        sha256,
        size: Some(webp_data.len() as i64),
        mime: Some("image/webp".to_string()),
        source_client_id: None,
        local_path: None,
        filename: Some("poster.webp".to_string()),
        parent_blob_id: Some(media_blob_id.to_string()),
        blob_type: Some(BlobType::Thumbnail),
        metadata: serde_json::json!({ "source": "video_poster_extraction" }),
        created_by,
        data: Some(crate::Bytes::from(webp_data)),
        width: None,
        height: None,
        blake3: Some(blake3),
    })
    .await?;

    Ok(blob.id)
}

/// extract one embedded subtitle track (copy, no re-encode) and store it
/// as a `Subtitle` blob.
///
/// note: `BlobType::Subtitle` isn't yet in migration 001's
/// `media_blobz.blob_type` CHECK constraint (`original`/`thumbnail`/
/// `waveform`/`preview` only) - this insert will fail with a CHECK
/// constraint violation until a follow-up migration extends that list.
/// flagged prominently rather than silently mapped to an unrelated
/// existing blob_type.
async fn extract_subtitle_track(
    media_blob_id: &str,
    file_path: &Path,
    stream_index: i64,
    config: &GrimoireConfig,
    created_by: Option<String>,
) -> Result<String, crate::error::GrimoireError> {
    let temp_file = format!("/tmp/video_subtitle_{}_{}.srt", stream_index, uuid::Uuid::new_v4());
    let input = file_path.to_string_lossy().to_string();
    let map_arg = format!("0:{}", stream_index);

    run_ffmpeg(
        "-i {input} -map {map} -c:s srt -y {output}",
        &[
            ("{input}", input.as_str()),
            ("{map}", map_arg.as_str()),
            ("{output}", temp_file.as_str()),
        ],
        &config.media.ffmpeg_path,
    )
    .await?;

    let srt_data = tokio::fs::read(&temp_file).await.map_err(|_| {
        crate::error::GrimoireError::ProcessingFailed {
            message: format!("no subtitle data extracted for stream {}", stream_index),
        }
    })?;
    let _ = tokio::fs::remove_file(&temp_file).await;

    let blake3 = reliquary::hash_bytes(&srt_data);
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(&srt_data);
    let sha256 = format!("{:x}", hasher.finalize());

    let blob = create_media_blob(CreateMediaBlobRequest {
        sha256,
        size: Some(srt_data.len() as i64),
        mime: Some("application/x-subrip".to_string()),
        source_client_id: None,
        local_path: None,
        filename: Some(format!("subtitle_{}.srt", stream_index)),
        parent_blob_id: Some(media_blob_id.to_string()),
        blob_type: Some(BlobType::Subtitle),
        metadata: serde_json::json!({ "source_stream_index": stream_index }),
        created_by,
        data: Some(crate::Bytes::from(srt_data)),
        width: None,
        height: None,
        blake3: Some(blake3),
    })
    .await?;

    Ok(blob.id)
}
