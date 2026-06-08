//! music file upload handler

use axum::{
    extract::{Multipart, State},
    Extension, Json,
};
use grimoire::blobz::compute_blake3_from_bytes;
use grimoire::jobs::{create_job, CreateJobRequest, JobType};
use grimoire::media_blobz::CreateMediaBlobRequest;
use grimoire::media_blobz::{create_media_blob, BlobType};
use grimoire::upload::{MusicMetadataHints, MusicUploadResponse};
use grimoire::users::UserRole;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::path::PathBuf;

use crate::auth::{check_role, AuthenticatedUser};
use crate::error::ApiError;
use crate::AppState;

/// upload music handler
///
/// POST /api/upload/music
///
/// multipart form fields:
/// - file: binary audio data (required)
/// - metadata: optional JSON hints for processing (artist, album, title, etc.)
pub async fn upload_music_handler(
    State(state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    mut multipart: Multipart,
) -> Result<Json<MusicUploadResponse>, ApiError> {
    // check user role - only member (20) or lower can upload
    check_role(&user, UserRole::Member)?;

    let mut file_data: Option<Vec<u8>> = None;
    let mut filename: Option<String> = None;
    let mut metadata_hints: Option<MusicMetadataHints> = None;

    // parse multipart form
    while let Some(field) = multipart
        .next_field()
        .await
        .map_err(|e| ApiError::BadRequest(format!("invalid multipart data: {}", e)))?
    {
        let field_name = field.name().unwrap_or("").to_string();

        match field_name.as_str() {
            "file" => {
                filename = field.file_name().map(|s| s.to_string());
                let data = field
                    .bytes()
                    .await
                    .map_err(|e| ApiError::BadRequest(format!("failed to read file: {}", e)))?;
                file_data = Some(data.to_vec());
            }
            "metadata" => {
                let data = field
                    .text()
                    .await
                    .map_err(|e| ApiError::BadRequest(format!("failed to read metadata: {}", e)))?;
                metadata_hints = serde_json::from_str(&data).ok();
            }
            _ => {
                // ignore unknown fields
            }
        }
    }

    let data = file_data.ok_or_else(|| ApiError::BadRequest("no file provided".to_string()))?;
    let filename = filename.unwrap_or_else(|| "music".to_string());

    // check file size against config
    let max_size = state.config.media.max_fs_file_size;
    if data.len() as u64 > max_size {
        return Err(ApiError::BadRequest(format!(
            "file too large (max {} bytes)",
            max_size
        )));
    }

    // calculate sha256 hash
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash = format!("{:x}", hasher.finalize());

    // compute blake3 hash for iroh-blobs verified streaming
    let blake3_hash = compute_blake3_from_bytes(&data);

    // detect mime type
    let mime_type = detect_audio_mime_type(&filename, &data);

    if !mime_type.starts_with("audio/") {
        return Err(ApiError::BadRequest(
            "file is not a valid audio file".to_string(),
        ));
    }

    let size = data.len() as i64;

    // generate filesystem path with date-based structure
    let now = time::OffsetDateTime::now_utc();
    let year = now.year();
    let month = now.month() as u8;

    let ext = detect_extension(&mime_type, &filename);

    // create media blob first (to get id) - with deduplication
    let blob = create_media_blob(CreateMediaBlobRequest {
        sha256: hash.clone(),
        size: Some(size),
        mime: Some(mime_type.clone()),
        source_client_id: None,
        local_path: None, // will update after saving file
        filename: Some(filename.to_string()),
        parent_blob_id: None,
        blob_type: Some(BlobType::Original),
        metadata: json!({
            "original_filename": filename,
        }),
        created_by: Some(user.user_id.clone()),
        data: None,
        width: None,
        height: None,
        blake3: Some(blake3_hash), // computed at ingest for P2P streaming
    })
    .await
    .map_err(|e| ApiError::Internal(format!("failed to create blob: {}", e)))?;

    // check if this was a deduplicated blob
    let existing = blob.created_at < (time::OffsetDateTime::now_utc().unix_timestamp() - 1);

    // get output directory from config (fetch_music.output_dir or fallback to data_dir/fetch)
    let output_dir = state
        .config
        .server
        .as_ref()
        .and_then(|s| s.fetch_music.as_ref())
        .and_then(|f| f.output_dir.as_ref())
        .map(PathBuf::from)
        .unwrap_or_else(|| state.config.data_dir.join("fetch"));

    // generate path with date-based subdirectory and blob id
    let rel_path = format!("{:04}/{:02}/{}.{}", year, month, blob.id, ext);
    let full_path = output_dir.join(&rel_path);

    // ensure directory exists
    if let Some(parent) = full_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| ApiError::Internal(format!("failed to create directory: {}", e)))?;
    }

    // write file to disk (even if deduplicated, we still save it for now)
    // TODO: could optimize by checking if local_path already exists
    tokio::fs::write(&full_path, &data)
        .await
        .map_err(|e| ApiError::Internal(format!("failed to write file: {}", e)))?;

    // create import job
    let job_payload = json!({
        "blob_id": blob.id,
        "local_path": full_path.to_string_lossy(),
        "mime_type": mime_type,
        "filename": filename,
        "user_hints": metadata_hints,
    });

    let job_response = create_job(CreateJobRequest {
        job_type: JobType::ImportMusic,
        session_id: None,
        parameters: job_payload,
        max_retries: Some(3),
        scheduled_at: None,
        created_by: Some(user.user_id.clone()),
        priority: None,
    })
    .await;

    if !job_response.success {
        tracing::error!("failed to create import job: {}", job_response.message);
        return Err(ApiError::Internal("failed to create job".to_string()));
    }

    let job = job_response
        .data
        .ok_or_else(|| ApiError::Internal("no job returned".to_string()))?;

    tracing::info!(
        "created ImportMusic job: {} for blob {} (file: {})",
        job.id,
        blob.id,
        filename
    );

    let message = if existing {
        "existing music file found (deduplicated), import job scheduled".to_string()
    } else {
        "music file uploaded, import job scheduled".to_string()
    };

    Ok(Json(MusicUploadResponse {
        blob_id: blob.id,
        job_id: job.id,
        sha256: hash,
        size,
        mime: mime_type,
        existing,
        message,
    }))
}

/// detect audio mime type from filename and magic bytes
fn detect_audio_mime_type(filename: &str, data: &[u8]) -> String {
    // try filename extension first
    let mime = mime_guess::from_path(filename).first();
    if let Some(mime) = mime {
        let mime_str = mime.to_string();
        if mime_str.starts_with("audio/") {
            return mime_str;
        }
    }

    // fallback to magic bytes
    if data.len() >= 4 {
        // mp3
        if data.starts_with(b"ID3") || (data[0] == 0xFF && (data[1] & 0xE0) == 0xE0) {
            return "audio/mpeg".to_string();
        }
        // flac
        if data.starts_with(b"fLaC") {
            return "audio/flac".to_string();
        }
        // ogg
        if data.starts_with(b"OggS") {
            return "audio/ogg".to_string();
        }
        // wav/riff
        if data.starts_with(b"RIFF") && data.len() >= 12 && &data[8..12] == b"WAVE" {
            return "audio/wav".to_string();
        }
        // m4a/mp4
        if data.len() >= 12 && &data[4..8] == b"ftyp" {
            return "audio/mp4".to_string();
        }
    }

    "application/octet-stream".to_string()
}

/// detect file extension from mime type or filename
fn detect_extension(mime_type: &str, filename: &str) -> String {
    // try to get extension from filename first
    if let Some(ext) = filename.rsplit('.').next() {
        if ext.len() <= 5 && !ext.is_empty() && ext != filename {
            return ext.to_lowercase();
        }
    }

    // fallback to mime type mapping
    match mime_type {
        "audio/mpeg" => "mp3",
        "audio/flac" => "flac",
        "audio/ogg" | "audio/vorbis" => "ogg",
        "audio/opus" => "opus",
        "audio/wav" | "audio/wave" => "wav",
        "audio/aac" => "aac",
        "audio/m4a" | "audio/mp4" => "m4a",
        _ => "bin",
    }
    .to_string()
}
