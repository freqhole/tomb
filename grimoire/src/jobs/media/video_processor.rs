//! video thumbnail generation job processor
//!
//! extracts a frame from a video file at ~10% of duration, converts to WebP,
//! and creates a child blob with auto-generated sized thumbnails. also extracts
//! and stores video metadata (duration, dimensions, codec, framerate, bitrate).

use crate::blob_data;
use crate::config;
use crate::jobs::{Job, JobError};
use crate::media::videoz;
use crate::media_blobz::BlobType;
use serde_json::{json, Value};
use tracing::{debug, info, warn};

/// process a GenerateVideoThumbnail job
///
/// extracts video metadata via ffprobe, captures a frame at ~10% duration,
/// converts it to WebP, creates a child blob (which auto-generates sized thumbnails),
/// and updates the videoz entity with extracted metadata.
pub async fn process_generate_video_thumbnail_job(job: &Job) -> Result<Option<Value>, JobError> {
    info!("processing GenerateVideoThumbnail job: {}", job.id);

    // parse job parameters
    let params_value: Value = job.parameters()?;
    let params = super::MediaJobParams::from_value(&params_value)?;

    debug!(
        "video thumbnail job: blob_id={}, entity_id={}, domain={}, mime={}",
        params.blob_id, params.entity_id, params.domain, params.mime
    );

    // get filesystem path for the video blob
    let (source_path, is_temp) = super::get_source_path(&params.blob_id).await?;
    debug!("source path: {} (temp: {})", source_path, is_temp);

    // run ffprobe to extract video metadata
    let config = config::get_config();
    let probe_result = run_ffprobe(&config, &source_path).await;

    let (duration_secs, width, height, codec, framerate, bitrate) = match probe_result {
        Ok(metadata) => metadata,
        Err(e) => {
            warn!(
                "ffprobe failed for blob {}: {}, continuing without metadata",
                params.blob_id, e
            );
            (None, None, None, None, None, None)
        }
    };

    // calculate thumbnail timestamp at ~10% of duration (default to 1.0s if unknown)
    let timestamp_secs = duration_secs
        .map(|d| (d as f64) * 0.1)
        .unwrap_or(1.0)
        .max(0.0);

    // capture a frame via ffmpeg into a temp file
    let temp_thumb_path = format!(
        "/tmp/grimoire_vthumb_{}_{}.png",
        params.blob_id,
        uuid::Uuid::new_v4()
    );

    let thumbnail_result =
        capture_video_frame(&config, &source_path, &temp_thumb_path, timestamp_secs).await;

    // clean up source temp file regardless of capture result
    super::cleanup_temp_file(&source_path, is_temp).await;

    // now check if frame capture succeeded
    if let Err(e) = thumbnail_result {
        let _ = tokio::fs::remove_file(&temp_thumb_path).await;
        return Err(e);
    }

    // read the captured frame and clean up the temp file
    let frame_data = match tokio::fs::read(&temp_thumb_path).await {
        Ok(data) => {
            let _ = tokio::fs::remove_file(&temp_thumb_path).await;
            data
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&temp_thumb_path).await;
            return Err(JobError::ProcessingFailed {
                reason: format!("failed to read captured frame: {}", e),
            });
        }
    };

    if frame_data.is_empty() {
        return Err(JobError::ProcessingFailed {
            reason: "captured frame is empty".to_string(),
        });
    }

    // convert frame to WebP
    let webp_data =
        blob_data::convert_to_webp(&frame_data).map_err(|e| JobError::ProcessingFailed {
            reason: format!("webp conversion failed: {}", e),
        })?;

    debug!(
        "converted frame to webp: {} bytes -> {} bytes",
        frame_data.len(),
        webp_data.len()
    );

    // create child blob with auto-generated sized thumbnails
    let metadata = json!({
        "type": "video_thumbnail",
        "source_blob_id": params.blob_id,
        "format": "webp",
        "timestamp_secs": timestamp_secs,
        "generated_with": "grimoire"
    });

    let blob_response = blob_data::create_image_blob_from_webp_data(
        webp_data,
        BlobType::Original,
        Some(params.blob_id.clone()),
        metadata,
        job.created_by.clone(),
    )
    .await;

    if !blob_response.success {
        return Err(JobError::ProcessingFailed {
            reason: format!("failed to create thumbnail blob: {}", blob_response.message),
        });
    }

    let thumbnail_blob_id = blob_response.data.unwrap_or_default();
    info!(
        "created video thumbnail blob: {} for entity {}",
        thumbnail_blob_id, params.entity_id
    );

    // update videoz entity with extracted metadata
    if let Err(e) = videoz::repository::update_video_metadata(
        &params.entity_id,
        duration_secs,
        width,
        height,
        codec.clone(),
        framerate,
        bitrate,
    )
    .await
    {
        warn!(
            "failed to update video metadata for entity {}: {}",
            params.entity_id, e
        );
    }

    Ok(Some(json!({
        "blob_id": params.blob_id,
        "entity_id": params.entity_id,
        "thumbnail_blob_id": thumbnail_blob_id,
        "duration_secs": duration_secs,
        "width": width,
        "height": height,
        "codec": codec,
        "framerate": framerate,
        "bitrate": bitrate,
        "timestamp_secs": timestamp_secs,
    })))
}

/// run ffprobe to extract video metadata
///
/// returns (duration_secs, width, height, codec, framerate, bitrate)
async fn run_ffprobe(
    config: &config::GrimoireConfig,
    source_path: &str,
) -> Result<
    (
        Option<i64>,
        Option<i64>,
        Option<i64>,
        Option<String>,
        Option<f64>,
        Option<i64>,
    ),
    JobError,
> {
    let ffprobe_path = config.media.ffprobe_path.as_deref().unwrap_or("ffprobe");

    let args = super::build_args(
        &config.media.ffprobe_properties_args,
        &[("{input}", source_path)],
    )?;

    let (stdout, _stderr) = super::run_command(ffprobe_path, &args, 30).await?;
    let probe_data: Value = serde_json::from_slice(&stdout)?;

    // extract duration from format section (string -> f64 seconds -> i64 seconds)
    let duration_secs = probe_data["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .map(|d| d as i64);

    // extract bitrate from format section (string -> i64)
    let bitrate = probe_data["format"]["bit_rate"]
        .as_str()
        .and_then(|s| s.parse::<i64>().ok());

    // find the first video stream
    let video_stream = probe_data["streams"].as_array().and_then(|streams| {
        streams
            .iter()
            .find(|s| s["codec_type"].as_str() == Some("video"))
    });

    let width = video_stream.and_then(|s| s["width"].as_i64());
    let height = video_stream.and_then(|s| s["height"].as_i64());
    let codec = video_stream.and_then(|s| s["codec_name"].as_str().map(|c| c.to_string()));

    // parse framerate from "num/den" format (e.g., "24000/1001")
    let framerate = video_stream
        .and_then(|s| s["r_frame_rate"].as_str())
        .and_then(parse_frame_rate);

    debug!(
        "ffprobe results: duration={}s, {}x{}, codec={:?}, fps={:?}, bitrate={:?}",
        duration_secs.unwrap_or(-1),
        width.unwrap_or(0),
        height.unwrap_or(0),
        codec,
        framerate,
        bitrate
    );

    Ok((duration_secs, width, height, codec, framerate, bitrate))
}

/// capture a single video frame at the given timestamp via ffmpeg
async fn capture_video_frame(
    config: &config::GrimoireConfig,
    source_path: &str,
    output_path: &str,
    timestamp_secs: f64,
) -> Result<(), JobError> {
    let timestamp_str = format!("{:.3}", timestamp_secs);

    let args = super::build_args(
        &config.media.video_thumbnail_args,
        &[
            ("{input}", source_path),
            ("{output}", output_path),
            ("{timestamp}", &timestamp_str),
        ],
    )?;

    debug!("capturing frame at {}s from {}", timestamp_str, source_path);

    super::run_command(&config.media.ffmpeg_path, &args, 60).await?;

    Ok(())
}

/// parse a frame rate string like "24000/1001" or "30/1" into a float
fn parse_frame_rate(rate_str: &str) -> Option<f64> {
    if let Some((num_str, den_str)) = rate_str.split_once('/') {
        let num: f64 = num_str.parse().ok()?;
        let den: f64 = den_str.parse().ok()?;
        if den > 0.0 {
            Some(num / den)
        } else {
            None
        }
    } else {
        // plain number (e.g., "30")
        rate_str.parse().ok()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_frame_rate_fraction() {
        let fps = parse_frame_rate("24000/1001");
        assert!(fps.is_some());
        let fps = fps.unwrap();
        assert!((fps - 23.976).abs() < 0.01);
    }

    #[test]
    fn test_parse_frame_rate_simple_fraction() {
        let fps = parse_frame_rate("30/1");
        assert!(fps.is_some());
        assert!((fps.unwrap() - 30.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_frame_rate_plain_number() {
        let fps = parse_frame_rate("25");
        assert!(fps.is_some());
        assert!((fps.unwrap() - 25.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_frame_rate_zero_denominator() {
        let fps = parse_frame_rate("30/0");
        assert!(fps.is_none());
    }

    #[test]
    fn test_parse_frame_rate_invalid() {
        assert!(parse_frame_rate("abc").is_none());
        assert!(parse_frame_rate("").is_none());
        assert!(parse_frame_rate("abc/def").is_none());
    }
}
