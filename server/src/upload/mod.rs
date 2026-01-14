//! upload handlers for file uploads with multipart form data
//!
//! two separate endpoints:
//! - POST /api/upload/image - for album art, playlist covers (max 10MB, stored in database)
//! - POST /api/upload/music - for audio files (max 1GB, stored on filesystem)
//!
//! creates processing jobs for:
//! - image webp conversion + optional entity association
//! - music metadata extraction and import

use axum::{
    extract::{Multipart, State},
    Extension, Json,
};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::jobs::{create_job, CreateJobRequest, JobType};
use grimoire::media_blobz::{create_media_blob, BlobType};
use grimoire::upload::{
    AssociationHint, AssociationInfo, ImageUploadResponse, MusicMetadataHints, MusicUploadResponse,
};
use grimoire::{media_blobz::CreateMediaBlobRequest, Bytes};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::path::PathBuf;

use crate::{auth::AuthenticatedUser, error::ApiError, AppState};

inventory::submit! {
    RouteInfo {
        name: "upload_image",
        path: "/api/upload/image",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "String",
        response_type: "ImageUploadResponse",
    }
}

inventory::submit! {
    RouteInfo {
        name: "upload_music",
        path: "/api/upload/music",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "String",
        response_type: "MusicUploadResponse",
    }
}

const MAX_IMAGE_SIZE: u64 = 10 * 1024 * 1024; // 10MB

/// upload image handler
///
/// POST /api/upload/image
///
/// multipart form fields:
/// - file: binary image data (required)
/// - associate_with: optional JSON with {"entity_type": "album", "entity_id": "abc123"}
pub async fn upload_image_handler(
    State(_state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    mut multipart: Multipart,
) -> Result<Json<ImageUploadResponse>, ApiError> {
    // check user role - only member (20) or lower can upload
    if user.role.level() > grimoire::users::UserRole::Member.level() {
        return Err(ApiError::Forbidden);
    }

    let mut file_data: Option<Vec<u8>> = None;
    let mut filename: Option<String> = None;
    let mut association: Option<AssociationHint> = None;

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
            "associate_with" => {
                let data = field.text().await.map_err(|e| {
                    ApiError::BadRequest(format!("failed to read association: {}", e))
                })?;
                association = serde_json::from_str(&data).ok();
            }
            _ => {
                // ignore unknown fields
            }
        }
    }

    let data = file_data.ok_or_else(|| ApiError::BadRequest("no file provided".to_string()))?;
    let filename = filename.unwrap_or_else(|| "image".to_string());

    // check file size
    if data.len() as u64 > MAX_IMAGE_SIZE {
        return Err(ApiError::BadRequest(format!(
            "image too large (max {} bytes)",
            MAX_IMAGE_SIZE
        )));
    }

    // calculate sha256 hash
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash = format!("{:x}", hasher.finalize());

    // detect mime type
    let mime_type = detect_image_mime_type(&filename, &data);

    if !mime_type.starts_with("image/") {
        return Err(ApiError::BadRequest(
            "file is not a valid image".to_string(),
        ));
    }

    let size = data.len() as i64;

    // determine blob_type and parent_blob_id based on association
    // - for songs: use Thumbnail type with song's media_blob_id as parent
    // - for albums/artists/playlists: use Original type with no parent
    let (blob_type, parent_blob_id) = if let Some(ref assoc) = association {
        if assoc.entity_type == "song" {
            // lookup the song's media_blob_id to use as parent
            match grimoire::music::entities::songs::get_song_media_blob_id(&assoc.entity_id).await {
                Ok(parent_id) => (BlobType::Thumbnail, Some(parent_id)),
                Err(_) => {
                    return Err(ApiError::BadRequest(format!(
                        "song not found: {}",
                        assoc.entity_id
                    )));
                }
            }
        } else {
            // albums, artists, playlists don't have a single parent blob
            (BlobType::Original, None)
        }
    } else {
        // no association specified, use Original
        (BlobType::Original, None)
    };

    // create media blob in database (with deduplication)
    let blob = create_media_blob(CreateMediaBlobRequest {
        sha256: hash.clone(),
        size: Some(size),
        mime: Some(mime_type.clone()),
        source_client_id: None,
        local_path: None,
        parent_blob_id,
        blob_type: Some(blob_type),
        metadata: json!({
            "original_filename": filename,
        }),
        created_by: Some(user.user_id.clone()),
        data: Some(Bytes::from(data)),
    })
    .await
    .map_err(|e| ApiError::Internal(format!("failed to create blob: {}", e)))?;

    // check if this was a deduplicated blob (already existed)
    let existing = blob.created_at < (time::OffsetDateTime::now_utc().unix_timestamp() - 1);

    // create webp conversion + association job
    let mut job_payload = json!({
        "blob_id": blob.id,
        "original_mime": mime_type,
    });

    // add association hint if provided
    if let Some(assoc) = &association {
        job_payload["associate_with"] = json!({
            "entity_type": assoc.entity_type,
            "entity_id": assoc.entity_id,
        });
    }

    let job_response = create_job(CreateJobRequest {
        job_type: JobType::ConvertWebp,
        session_id: None,
        parameters: job_payload,
        max_retries: Some(3),
        scheduled_at: None,
        created_by: Some(user.user_id.clone()),
    })
    .await;

    if !job_response.success {
        return Err(ApiError::Internal("failed to create job".to_string()));
    }

    let job = job_response
        .data
        .ok_or_else(|| ApiError::Internal("no job returned".to_string()))?;

    let message = if existing {
        if association.is_some() {
            "existing image found (deduplicated), association job scheduled".to_string()
        } else {
            "existing image found (deduplicated)".to_string()
        }
    } else {
        if association.is_some() {
            "image uploaded, conversion and association job scheduled".to_string()
        } else {
            "image uploaded, conversion job scheduled".to_string()
        }
    };

    Ok(Json(ImageUploadResponse {
        blob_id: blob.id,
        job_id: job.id,
        sha256: hash,
        size,
        mime: mime_type,
        existing,
        association: association.map(|a| AssociationInfo {
            entity_type: a.entity_type,
            entity_id: a.entity_id,
        }),
        message,
    }))
}

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
    if user.role.level() > grimoire::users::UserRole::Member.level() {
        return Err(ApiError::Forbidden);
    }

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
        parent_blob_id: None,
        blob_type: Some(BlobType::Original),
        metadata: json!({
            "original_filename": filename,
        }),
        created_by: Some(user.user_id.clone()),
        data: None,
    })
    .await
    .map_err(|e| ApiError::Internal(format!("failed to create blob: {}", e)))?;

    // check if this was a deduplicated blob
    let existing = blob.created_at < (time::OffsetDateTime::now_utc().unix_timestamp() - 1);

    // generate path with blob id
    let rel_path = format!("media/{:04}/{:02}/{}.{}", year, month, blob.id, ext);
    let full_path = PathBuf::from("data").join(&rel_path);

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
    })
    .await;

    if !job_response.success {
        return Err(ApiError::Internal("failed to create job".to_string()));
    }

    let job = job_response
        .data
        .ok_or_else(|| ApiError::Internal("no job returned".to_string()))?;

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

/// detect image mime type from filename and magic bytes
fn detect_image_mime_type(filename: &str, data: &[u8]) -> String {
    // try filename extension first
    let mime = mime_guess::from_path(filename).first();
    if let Some(mime) = mime {
        let mime_str = mime.to_string();
        if mime_str.starts_with("image/") {
            return mime_str;
        }
    }

    // fallback to magic bytes
    if data.len() >= 4 {
        // png
        if data.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
            return "image/png".to_string();
        }
        // jpeg
        if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
            return "image/jpeg".to_string();
        }
        // webp
        if data.starts_with(b"RIFF") && data.len() >= 12 && &data[8..12] == b"WEBP" {
            return "image/webp".to_string();
        }
        // gif
        if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
            return "image/gif".to_string();
        }
    }

    "application/octet-stream".to_string()
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
        if ext.len() <= 5 && ext.len() > 0 && ext != filename {
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
