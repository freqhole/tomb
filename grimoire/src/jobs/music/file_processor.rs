//! audio file processing job processor
//!
//! imports audio files by creating media blobz, extracting metadata,
//! creating song/artist/album records, and generating thumbnails/waveforms

use super::models::{ProcessFileParams, ProcessFileResult};
use crate::blob_data;
use crate::config;
use crate::jobs::models::{Job, JobError};
use crate::music::scanner;
use serde_json::Value;
use std::fs;
use std::path::Path;
use tracing::{debug, info, warn};

/// process audio file import job - extract metadata, create song record, generate assets
pub async fn process_file_job(job: &Job) -> Result<Option<Value>, JobError> {
    // get config
    let config = config::get_config();

    // parse job parameters
    let params: ProcessFileParams = match serde_json::from_str(&job.parameters) {
        Ok(p) => p,
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("invalid parameters: {}", e),
            })
        }
    };

    let file_path = Path::new(&params.file_path);

    // verify file exists
    if !file_path.exists() {
        return Err(JobError::ProcessingFailed {
            reason: format!("file does not exist: {}", params.file_path),
        });
    }

    info!("processing file: {}", params.file_path);

    // read file metadata
    let metadata = match fs::metadata(file_path) {
        Ok(m) => m,
        Err(e) => {
            return Err(JobError::ProcessingFailed {
                reason: format!("failed to read file metadata: {}", e),
            })
        }
    };

    let file_size = metadata.len();
    debug!("file size: {} bytes", file_size);

    // get file modified time
    let file_modified_at = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    // step 1: create media blob in database
    let media_blob_id = match blob_data::create_media_blob_from_file(
        &params.file_path,
        file_size,
        file_modified_at,
    )
    .await
    {
        response if response.success => match response.data {
            Some(id) => id,
            None => {
                return Err(JobError::ProcessingFailed {
                    reason: "failed to create media blob: no data returned".to_string(),
                })
            }
        },
        response => {
            let error_msg = if !response.errors.is_empty() {
                response.errors[0].detail.clone()
            } else {
                response.message
            };
            return Err(JobError::ProcessingFailed {
                reason: format!("failed to create media blob: {}", error_msg),
            });
        }
    };
    debug!("created media blob: {}", media_blob_id);

    // step 2: import audio file (extracts metadata and creates song)
    let mut song_id = None;
    let mut artist_id = None;
    let mut album_id = None;
    let mut metadata_extracted = false;

    if params.extract_metadata {
        match scanner::import_audio_file(&media_blob_id, file_path).await {
            crate::GrimoireResponse {
                success: true,
                data: Some(import_result),
                ..
            } => {
                song_id = Some(import_result.song_id);
                artist_id = import_result.artist_id;
                album_id = import_result.album_id;
                metadata_extracted = import_result.metadata_extracted;
                debug!("metadata extracted successfully");
            }
            response => {
                let error_msg = if !response.errors.is_empty() {
                    response.errors[0].detail.clone()
                } else {
                    response.message
                };
                warn!("metadata extraction failed: {}", error_msg);
            }
        }
    }

    // step 3: generate thumbnail if requested
    let thumbnail_generated = if params.generate_thumbnail {
        match blob_data::create_audio_thumbnail_blob(&media_blob_id, &params.file_path, &config)
            .await
        {
            response if response.success => match response.data {
                Some(thumbnail_blob_id) => {
                    debug!("thumbnail generated as blob: {}", thumbnail_blob_id);
                    true
                }
                None => {
                    warn!("thumbnail generation failed: no data returned");
                    false
                }
            },
            response => {
                let error_msg = if !response.errors.is_empty() {
                    response.errors[0].detail.clone()
                } else {
                    response.message
                };
                warn!("thumbnail generation failed: {}", error_msg);
                false
            }
        }
    } else {
        false
    };

    // step 4: generate waveform if requested
    let waveform_generated = if params.generate_waveform {
        match blob_data::create_audio_waveform_blob(&media_blob_id, &params.file_path, &config)
            .await
        {
            response if response.success => match response.data {
                Some(waveform_blob_id) => {
                    debug!("waveform generated as blob: {}", waveform_blob_id);
                    true
                }
                None => {
                    warn!("waveform generation failed: no data returned");
                    false
                }
            },
            response => {
                let error_msg = if !response.errors.is_empty() {
                    response.errors[0].detail.clone()
                } else {
                    response.message
                };
                warn!("waveform generation failed: {}", error_msg);
                false
            }
        }
    } else {
        false
    };

    let result = ProcessFileResult {
        media_blob_id,
        song_id,
        artist_id,
        album_id,
        metadata_extracted,
        thumbnail_generated,
        waveform_generated,
    };

    info!("file processing complete: blob={}", result.media_blob_id);

    Ok(Some(serde_json::to_value(result).map_err(|e| {
        JobError::ProcessingFailed {
            reason: format!("failed to serialize result: {}", e),
        }
    })?))
}
