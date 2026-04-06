//! audio file processing job processor (non-music domain)
//!
//! extracts audio metadata (duration, sample rate, channels, bitrate) via ffprobe
//! and generates a waveform visualization via ffmpeg for the audioz domain

use crate::blob_data;
use crate::config;
use crate::jobs::{Job, JobError};
use crate::media::audioz;
use crate::media_blobz::BlobType;
use serde_json::{json, Value};
use tracing::{info, warn};

/// process a ProcessMediaFile job for audioz domain
///
/// runs ffprobe to extract audio properties (duration, sample rate, channels,
/// bitrate), generates a waveform PNG via ffmpeg, converts to WebP, creates a
/// child blob with auto-generated sized thumbnails, and updates the audioz entity.
pub async fn process_media_file_job(job: &Job) -> Result<Option<Value>, JobError> {
    info!("processing ProcessMediaFile (audio) job: {}", job.id);

    let config = config::get_config();

    // parse common media job params
    let params: Value = job.parameters()?;
    let media_params = super::MediaJobParams::from_value(&params)?;
    let blob_id = &media_params.blob_id;
    let entity_id = &media_params.entity_id;

    info!(
        "audio processing job: blob_id={}, entity_id={}, mime={}",
        blob_id, entity_id, media_params.mime
    );

    // resolve filesystem path for the source blob
    let (source_path, is_temp) = super::get_source_path(blob_id).await?;

    // run the actual processing, capturing result before cleanup
    let result = extract_metadata_and_waveform(
        &config,
        blob_id,
        entity_id,
        &source_path,
        job.created_by.as_deref(),
    )
    .await;

    // always clean up the source temp file
    super::cleanup_temp_file(&source_path, is_temp).await;

    // propagate any error after cleanup
    result
}

/// inner processing logic — separated so cleanup happens regardless of outcome
async fn extract_metadata_and_waveform(
    config: &config::GrimoireConfig,
    blob_id: &str,
    entity_id: &str,
    source_path: &str,
    created_by: Option<&str>,
) -> Result<Option<Value>, JobError> {
    // -- step 1: extract audio metadata via ffprobe --
    let (duration, sample_rate, channels, bitrate) =
        extract_audio_metadata(config, source_path).await;

    // -- step 2: generate waveform visualization --
    let waveform_blob_id =
        generate_waveform(config, blob_id, entity_id, source_path, created_by).await;

    // -- step 3: update audioz entity with extracted metadata --
    match audioz::repository::update_audio_metadata(
        entity_id,
        duration,
        sample_rate,
        channels,
        bitrate,
    )
    .await
    {
        Ok(audio) => {
            info!(
                "updated audio metadata for {}: duration={:?}, sample_rate={:?}, channels={:?}, bitrate={:?}",
                audio.id, duration, sample_rate, channels, bitrate
            );
        }
        Err(e) => {
            warn!("failed to update audio metadata for {}: {}", entity_id, e);
        }
    }

    info!(
        "ProcessMediaFile (audio) complete for blob {}: waveform_blob_id={:?}, duration={:?}s",
        blob_id, waveform_blob_id, duration
    );

    Ok(Some(json!({
        "blob_id": blob_id,
        "entity_id": entity_id,
        "waveform_blob_id": waveform_blob_id,
        "duration": duration,
        "sample_rate": sample_rate,
        "channels": channels,
        "bitrate": bitrate,
    })))
}

/// extract audio properties from a file using ffprobe
///
/// returns (duration, sample_rate, channels, bitrate) — all optional because
/// extraction is best-effort; failures log a warning and return None
async fn extract_audio_metadata(
    config: &config::GrimoireConfig,
    source_path: &str,
) -> (Option<i64>, Option<i64>, Option<i64>, Option<i64>) {
    let ffprobe_path = config.media.ffprobe_path.as_deref().unwrap_or("ffprobe");

    let args = match super::build_args(
        &config.media.ffprobe_properties_args,
        &[("{input}", source_path)],
    ) {
        Ok(a) => a,
        Err(e) => {
            warn!("failed to build ffprobe args for {}: {}", source_path, e);
            return (None, None, None, None);
        }
    };

    let (stdout, _stderr) = match super::run_command(ffprobe_path, &args, 30).await {
        Ok(output) => output,
        Err(e) => {
            warn!("ffprobe failed for {}: {}", source_path, e);
            return (None, None, None, None);
        }
    };

    let probe: Value = match serde_json::from_slice(&stdout) {
        Ok(v) => v,
        Err(e) => {
            warn!("failed to parse ffprobe JSON for {}: {}", source_path, e);
            return (None, None, None, None);
        }
    };

    // extract duration from format.duration (string -> f64 -> i64 seconds)
    let duration = probe["format"]["duration"]
        .as_str()
        .and_then(|s| s.parse::<f64>().ok())
        .map(|d| d as i64);

    // extract bitrate from format.bit_rate (string -> i64)
    let bitrate = probe["format"]["bit_rate"]
        .as_str()
        .and_then(|s| s.parse::<i64>().ok());

    // find first audio stream for sample_rate and channels
    let (sample_rate, channels) = probe["streams"]
        .as_array()
        .and_then(|streams| streams.iter().find(|s| s["codec_type"] == "audio"))
        .map(|audio_stream| {
            let sr = audio_stream["sample_rate"]
                .as_str()
                .and_then(|s| s.parse::<i64>().ok());
            let ch = audio_stream["channels"].as_i64();
            (sr, ch)
        })
        .unwrap_or((None, None));

    info!(
        "ffprobe metadata for {}: duration={:?}s, sample_rate={:?}, channels={:?}, bitrate={:?}",
        source_path, duration, sample_rate, channels, bitrate
    );

    (duration, sample_rate, channels, bitrate)
}

/// generate a waveform visualization PNG via ffmpeg, convert to WebP, and create
/// a child blob
///
/// returns the waveform blob id on success, or None if generation fails (best-effort
/// for the waveform — we don't fail the whole job over it)
async fn generate_waveform(
    config: &config::GrimoireConfig,
    blob_id: &str,
    entity_id: &str,
    source_path: &str,
    created_by: Option<&str>,
) -> Option<String> {
    let temp_waveform = format!(
        "/tmp/grimoire_wave_{}_{}.png",
        blob_id,
        uuid::Uuid::new_v4()
    );

    let wave_args = match super::build_args(
        &config.media.generate_waveform_args,
        &[("{input}", source_path), ("{output}", &temp_waveform)],
    ) {
        Ok(a) => a,
        Err(e) => {
            warn!("failed to build waveform args for blob {}: {}", blob_id, e);
            return None;
        }
    };

    if let Err(e) = super::run_command(&config.media.ffmpeg_path, &wave_args, 60).await {
        warn!("waveform generation failed for blob {}: {}", blob_id, e);
        let _ = tokio::fs::remove_file(&temp_waveform).await;
        return None;
    }

    let png_data = match tokio::fs::read(&temp_waveform).await {
        Ok(data) => data,
        Err(e) => {
            warn!(
                "failed to read waveform output {} for blob {}: {}",
                temp_waveform, blob_id, e
            );
            let _ = tokio::fs::remove_file(&temp_waveform).await;
            return None;
        }
    };
    let _ = tokio::fs::remove_file(&temp_waveform).await;

    let webp_data = match blob_data::convert_to_webp(&png_data) {
        Ok(data) => data,
        Err(e) => {
            warn!(
                "webp conversion failed for waveform of blob {}: {}",
                blob_id, e
            );
            return None;
        }
    };

    info!(
        "generated waveform for blob {}: {} bytes PNG -> {} bytes WebP",
        blob_id,
        png_data.len(),
        webp_data.len()
    );

    let metadata_json = json!({
        "source": "audio_waveform",
        "parent_blob_id": blob_id,
        "entity_id": entity_id,
    });

    let resp = blob_data::create_image_blob_from_webp_data(
        webp_data,
        BlobType::Waveform,
        Some(blob_id.to_string()),
        metadata_json,
        created_by.map(|s| s.to_string()),
    )
    .await;

    match resp.data {
        Some(ref waveform_id) => {
            info!(
                "created waveform blob {} for audio blob {}",
                waveform_id, blob_id
            );
        }
        None => {
            warn!(
                "failed to create waveform blob for audio blob {}: {}",
                blob_id, resp.message
            );
        }
    }

    resp.data
}
