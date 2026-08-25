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
    has_audio_stream: bool,
    container_format: Option<String>,
    bit_rate: Option<i64>,
    codec_name: Option<String>,
    width: Option<i64>,
    height: Option<i64>,
    frame_rate: Option<f64>,
}

/// import a video file: probe, dedupe, create the video row, extract
/// poster/subtitles, and enqueue transcoding.
pub async fn import_video_file(
    media_blob_id: &str,
    file_path: &Path,
    original_filename: Option<&str>,
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

    // update the media blob with video metadata (codec, container, bitrate, framerate, dimensions)
    let _ = update_media_blob_with_video_metadata(media_blob_id, &props).await;

    // prefer the caller-supplied original filename (e.g. the name the user
    // uploaded/picked) over `file_path`'s basename - on the upload path,
    // `file_path` is the on-disk storage path, named after the media blob's
    // id (not the original filename), so falling back to it as a title
    // source would show a uuid instead of a human-readable name.
    let title = original_filename
        .map(|s| Path::new(s))
        .or(Some(file_path))
        .and_then(|p| p.file_stem())
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
        response if response.success => {
            response.data.ok_or_else(|| JobError::ProcessingFailed {
                reason: "video creation succeeded but returned no data".to_string(),
            })?
        }
        response => {
            // race: another worker imported the same blob concurrently.
            let is_dup = response
                .errors
                .iter()
                .any(|e| e.error_type == "duplicate_video");
            if is_dup {
                if let Some(existing_video_id) = find_video_by_media_blob_id(media_blob_id).await? {
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
    let poster_blob_id = match extract_video_poster(
        media_blob_id,
        file_path,
        props.duration_seconds,
        &config,
        created_by.clone(),
    )
    .await
    {
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
            let image_resp = crate::video::add_entity_image(
                crate::video::VideoEntityType::Video,
                &video.id,
                &blob_id,
                Some(true),
                BlobType::Thumbnail,
                created_by.as_deref(),
            )
            .await;
            if !image_resp.success {
                warn!(
                    "failed to link poster blob to entity_imagez for video {}: {}",
                    video.id, image_resp.message
                );
            }
            Some(blob_id)
        }
        Err(e) => {
            warn!("poster extraction failed for {}: {}", video.id, e);
            None
        }
    };

    // inline waveform generation (best-effort - mirrors music's
    // `create_audio_waveform_blob` pipeline exactly: ffmpeg's `showwavespic`
    // filter reads the `[0:a]` audio stream, which works unchanged whether
    // the input file is a standalone audio file or a video container, so no
    // video-specific waveform-generation code is needed at all). videos with
    // no audio track at all (silent clips) have nothing for `[0:a]` to bind
    // to, so ffmpeg's filtergraph setup fails outright - skip the attempt
    // entirely rather than logging a spurious-looking ffmpeg error.
    if !props.has_audio_stream {
        debug!(
            "skipping waveform generation for video {}: no audio stream",
            video.id
        );
    } else {
        match crate::blob_data::create_audio_waveform_blob(
            media_blob_id,
            &file_path.to_string_lossy(),
            &config,
            created_by.clone(),
        )
        .await
        {
            response if response.success => {
                if let Some(waveform_blob_id) = response.data {
                    let image_resp = crate::video::add_entity_image(
                        crate::video::VideoEntityType::Video,
                        &video.id,
                        &waveform_blob_id,
                        Some(false),
                        BlobType::Waveform,
                        created_by.as_deref(),
                    )
                    .await;
                    if image_resp.success {
                        debug!("linked waveform blob to video {}", video.id);
                    } else {
                        warn!(
                            "failed to link waveform blob to entity_imagez for video {}: {}",
                            video.id, image_resp.message
                        );
                    }
                } else {
                    warn!(
                        "waveform generation for video {} returned no data",
                        video.id
                    );
                }
            }
            response => {
                let error_msg = if !response.errors.is_empty() {
                    response.errors[0].detail.clone()
                } else {
                    response.message
                };
                warn!(
                    "waveform generation failed for video {}: {}",
                    video.id, error_msg
                );
            }
        }
    }

    // inline subtitle extraction (best-effort per track)
    let mut subtitle_blob_ids = Vec::new();
    for stream_index in &props.subtitle_stream_indices {
        match extract_subtitle_track(
            media_blob_id,
            file_path,
            *stream_index,
            &config,
            created_by.clone(),
        )
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

    let container_format = json
        .get("format")
        .and_then(|f| f.get("format_name"))
        .and_then(|n| n.as_str())
        .map(|s| s.to_string());

    let bit_rate = json
        .get("format")
        .and_then(|f| f.get("bit_rate"))
        .and_then(|b| b.as_str())
        .and_then(|s| s.parse::<i64>().ok());

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

    let has_audio_stream = json
        .get("streams")
        .and_then(|s| s.as_array())
        .map(|streams| {
            streams
                .iter()
                .any(|s| s.get("codec_type").and_then(|t| t.as_str()) == Some("audio"))
        })
        .unwrap_or(false);

    // extract video stream properties from the first video stream
    let video_stream = json
        .get("streams")
        .and_then(|s| s.as_array())
        .and_then(|streams| {
            streams
                .iter()
                .find(|s| s.get("codec_type").and_then(|t| t.as_str()) == Some("video"))
        });

    let codec_name = video_stream
        .and_then(|s| s.get("codec_name"))
        .and_then(|c| c.as_str())
        .map(|s| s.to_string());

    let width = video_stream
        .and_then(|s| s.get("width"))
        .and_then(|w| w.as_i64());

    let height = video_stream
        .and_then(|s| s.get("height"))
        .and_then(|h| h.as_i64());

    // parse avg_frame_rate (e.g. "24000/1001" or "30/1") into decimal fps
    let frame_rate = video_stream
        .and_then(|s| s.get("avg_frame_rate"))
        .and_then(|r| r.as_str())
        .and_then(|s| {
            let parts: Vec<&str> = s.split('/').collect();
            if parts.len() == 2 {
                let numerator = parts[0].parse::<f64>().ok()?;
                let denominator = parts[1].parse::<f64>().ok()?;
                if denominator > 0.0 {
                    Some(numerator / denominator)
                } else {
                    None
                }
            } else {
                s.parse::<f64>().ok()
            }
        });

    VideoProperties {
        duration_seconds,
        subtitle_stream_indices,
        has_audio_stream,
        container_format,
        bit_rate,
        codec_name,
        width,
        height,
        frame_rate,
    }
}

/// update a media blob row with video metadata (codec, container, bitrate, framerate, dimensions)
async fn update_media_blob_with_video_metadata(
    media_blob_id: &str,
    props: &VideoProperties,
) -> Result<(), JobError> {
    let pool = crate::database::connect().await?;

    // build metadata JSON with video properties
    let mut metadata = serde_json::json!({});
    if let Some(codec) = &props.codec_name {
        metadata["codec"] = serde_json::json!(codec);
    }
    if let Some(container) = &props.container_format {
        metadata["container"] = serde_json::json!(container);
    }
    if let Some(bitrate) = props.bit_rate {
        metadata["bitrate"] = serde_json::json!(bitrate);
    }
    if let Some(fps) = props.frame_rate {
        metadata["frame_rate"] = serde_json::json!(fps);
    }

    let metadata_str = serde_json::to_string(&metadata).unwrap_or_else(|_| "{}".to_string());

    // update the media blob with width/height and metadata
    sqlx::query!(
        "UPDATE media_blobz 
         SET width = ?, height = ?, metadata = ?, updated_at = unixepoch()
         WHERE id = ?",
        props.width,
        props.height,
        metadata_str,
        media_blob_id
    )
    .execute(&pool)
    .await
    .map_err(|e| JobError::ProcessingFailed {
        reason: format!("failed to update media blob metadata: {}", e),
    })?;

    Ok(())
}

/// extract a single poster frame and store it as a `Thumbnail` blob.
async fn extract_video_poster(
    media_blob_id: &str,
    file_path: &Path,
    duration_seconds: Option<f64>,
    config: &GrimoireConfig,
    created_by: Option<String>,
) -> Result<String, crate::error::GrimoireError> {
    // use the app's own data-dir-relative temp dir, not the OS-global `/tmp`:
    // a packaged/sandboxed desktop (tauri) build may not have write access to
    // `/tmp`, which would otherwise make poster extraction silently fail (this
    // is a soft-fail path, so it wouldn't surface as a visible error - just a
    // missing thumbnail).
    let temp_dir = config.temp_dir();
    if let Err(e) = tokio::fs::create_dir_all(&temp_dir).await {
        warn!("failed to create temp dir {}: {}", temp_dir.display(), e);
    }
    let temp_file = temp_dir
        .join(format!("video_poster_{}.jpg", uuid::Uuid::new_v4()))
        .to_string_lossy()
        .to_string();
    let input = file_path.to_string_lossy().to_string();

    // clamp the seek point to 10% into the clip (capped at 5s) rather than
    // a fixed 5s - a fixed seek past the end of a short clip (e.g. a few
    // seconds long) leaves ffmpeg with no frame to grab at all, failing
    // the whole extraction ("No filtered frames for output stream").
    let seek_seconds = match duration_seconds {
        Some(d) if d > 0.0 => (d * 0.1).clamp(0.1, 5.0),
        _ => 1.0,
    };
    let seek = format!("{:.2}", seek_seconds);

    run_ffmpeg(
        &config.media.extract_video_poster_args,
        &[
            ("{input}", input.as_str()),
            ("{seek}", seek.as_str()),
            ("{output}", temp_file.as_str()),
        ],
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
        // Original (not Thumbnail) - matches music's create_album_art_blob
        // pattern: only Original/Waveform parents are eligible for the
        // server's on-demand /thumb/:size generation pipeline (a Thumbnail
        // parent is rejected there to avoid infinite recursion), so a
        // poster stored as Thumbnail could never get sized variants.
        blob_type: Some(BlobType::Original),
        metadata: serde_json::json!({ "source": "video_poster_extraction" }),
        created_by: created_by.clone(),
        data: Some(crate::Bytes::from(webp_data)),
        width: None,
        height: None,
        blake3: Some(blake3),
    })
    .await?;

    // eagerly generate sized thumbnails (mirrors create_image_blob_from_webp_data's
    // behavior for album art) rather than relying on lazy on-demand
    // generation, which the /thumb/:size route doesn't actually do.
    let thumb_result = crate::blob_data::generate_sized_thumbnails(&blob.id, created_by).await;
    if !thumb_result.success {
        warn!(
            "failed to generate sized thumbnails for video poster {}: {}",
            blob.id, thumb_result.message
        );
    }

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
    let temp_dir = config.temp_dir();
    if let Err(e) = tokio::fs::create_dir_all(&temp_dir).await {
        warn!("failed to create temp dir {}: {}", temp_dir.display(), e);
    }
    let temp_file = temp_dir
        .join(format!(
            "video_subtitle_{}_{}.srt",
            stream_index,
            uuid::Uuid::new_v4()
        ))
        .to_string_lossy()
        .to_string();
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
