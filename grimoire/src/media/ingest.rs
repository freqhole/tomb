//! file ingestion service
//!
//! core business logic for ingesting files into the multi-domain media system.
//! handles both raw bytes (browser upload) and on-disk files (tauri/CLI).
//! called by offal handlers and tauri IPC — not directly by transports.

use crate::blobz::{compute_blake3_from_bytes, compute_blake3_hash};
use crate::config;
use crate::error::{GrimoireError, GrimoireResult};
use crate::jobs::{create_job, CreateJobRequest, JobType};
use crate::media::domain::{classify_domain, MediaDomain};
use crate::media_blobz::{create_media_blob, BlobType, CreateMediaBlobRequest};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::io::AsyncReadExt;
use zod_gen_derive::ZodSchema;

/// how the file data is provided
pub enum FileSource {
    /// raw bytes (from browser base64 upload) — will be written to storage
    Bytes { data: Vec<u8>, filename: String },
    /// file already on disk (tauri/CLI) — just track the path, don't copy
    Path { path: PathBuf },
}

/// options for file ingestion
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IngestOptions {
    pub title: Option<String>,
    pub description: Option<String>,
    pub metadata: Option<String>,
    pub created_by: Option<String>,
}

/// result of file ingestion
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct IngestResult {
    /// media blob ID
    pub blob_id: String,
    /// which domain the file was classified into
    pub domain: String,
    /// ID of the domain entity (audioz/photoz/videoz/documentz/filez row)
    pub entity_id: String,
    /// thumbnail generation job ID, if one was queued
    pub job_id: Option<String>,
    /// SHA256 content hash
    pub sha256: String,
    /// blake3 content hash for P2P verified streaming
    pub blake3: String,
    /// file size in bytes
    pub size: i64,
    /// detected MIME type
    pub mime: String,
    /// true if blob already existed (SHA256 dedup)
    pub existing: bool,
    /// original filename
    pub filename: String,
}

/// ingest a file into the media system.
///
/// handles both raw bytes (browser upload) and on-disk files (tauri/CLI):
/// - bytes: hash → dedup → write to storage → create domain entity → queue thumbnail job
/// - path: stream-hash from disk → dedup → track path (no copy) → create domain entity → queue thumbnail job
pub async fn ingest_file(
    source: FileSource,
    options: IngestOptions,
) -> GrimoireResult<IngestResult> {
    // step 1: resolve file data, filename, hashes based on source
    let resolved = resolve_source(source).await?;

    // step 2: detect mime type
    let mime = detect_mime(&resolved.filename, resolved.data.as_deref());

    // step 3: classify domain
    let domain = classify_domain(&resolved.filename, Some(&mime));

    tracing::info!(
        "ingesting file: filename={}, mime={}, domain={}, size={}, source={}",
        resolved.filename,
        mime,
        domain,
        resolved.size,
        if resolved.local_path.is_some() {
            "path"
        } else {
            "bytes"
        },
    );

    // step 4: check file size limit
    let cfg = config::get_config();
    let max_size = cfg.media.max_fs_file_size;
    if resolved.size as u64 > max_size {
        return Err(GrimoireError::Validation {
            field: "size".to_string(),
            message: format!("file too large: {} bytes (max {})", resolved.size, max_size),
        });
    }

    // step 5: create media blob (with SHA256 dedup)
    let blob = create_media_blob(CreateMediaBlobRequest {
        sha256: resolved.sha256.clone(),
        size: Some(resolved.size),
        mime: Some(mime.clone()),
        source_client_id: None,
        local_path: resolved.local_path.clone(),
        filename: Some(resolved.filename.clone()),
        parent_blob_id: None,
        blob_type: Some(BlobType::Original),
        metadata: serde_json::json!({
            "original_filename": resolved.filename,
            "domain": domain.as_str(),
        }),
        created_by: options.created_by.clone(),
        data: None, // we write to filesystem separately
        width: None,
        height: None,
        blake3: Some(resolved.blake3.clone()),
    })
    .await?;

    let existing = blob.created_at < (time::OffsetDateTime::now_utc().unix_timestamp() - 1);

    // step 6: for bytes source, write to filesystem storage
    if let Some(data) = &resolved.data {
        let storage_path = write_to_storage(data, &blob.id, &resolved.filename).await?;

        // update blob with local_path
        crate::media_blobz::update_blob_local_path(
            &blob.id,
            &storage_path.to_string_lossy(),
            options.created_by.clone(),
        )
        .await?;
    }

    // step 7: create domain entity
    let entity_id = create_domain_entity(domain, &blob.id, &resolved.filename, &options).await?;

    // step 8: queue thumbnail generation job
    let job_id = queue_thumbnail_job(domain, &blob.id, &entity_id, &mime, &options).await?;

    Ok(IngestResult {
        blob_id: blob.id,
        domain: domain.as_str().to_string(),
        entity_id,
        job_id,
        sha256: resolved.sha256,
        blake3: resolved.blake3,
        size: resolved.size,
        mime,
        existing,
        filename: resolved.filename,
    })
}

// ---------------------------------------------------------------------------
// internal helpers
// ---------------------------------------------------------------------------

/// resolved file data from any source
struct ResolvedSource {
    /// raw bytes (only present for Bytes source)
    data: Option<Vec<u8>>,
    /// filename (from source or derived from path)
    filename: String,
    /// SHA256 hash
    sha256: String,
    /// blake3 hash
    blake3: String,
    /// file size in bytes
    size: i64,
    /// local filesystem path (only present for Path source)
    local_path: Option<String>,
}

/// resolve a FileSource into hashes, filename, and optional data
async fn resolve_source(source: FileSource) -> GrimoireResult<ResolvedSource> {
    match source {
        FileSource::Bytes { data, filename } => {
            // compute hashes from memory
            let mut hasher = Sha256::new();
            hasher.update(&data);
            let sha256 = format!("{:x}", hasher.finalize());
            let blake3 = compute_blake3_from_bytes(&data);
            let size = data.len() as i64;

            Ok(ResolvedSource {
                data: Some(data),
                filename,
                sha256,
                blake3,
                size,
                local_path: None,
            })
        }
        FileSource::Path { path } => {
            if !path.exists() {
                return Err(GrimoireError::FileNotFound {
                    path: path.display().to_string(),
                });
            }

            let filename = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "unknown".to_string());

            // stream-hash the file (avoids loading into memory for large files)
            let sha256 = stream_sha256(&path).await?;
            let blake3 = compute_blake3_hash(&path).await?;

            let metadata =
                tokio::fs::metadata(&path)
                    .await
                    .map_err(|e| GrimoireError::ProcessingFailed {
                        message: format!("failed to read file metadata: {}", e),
                    })?;
            let size = metadata.len() as i64;

            Ok(ResolvedSource {
                data: None,
                filename,
                sha256,
                blake3,
                size,
                local_path: Some(path.to_string_lossy().to_string()),
            })
        }
    }
}

/// stream SHA256 hash of a file (avoids loading entirely into memory)
async fn stream_sha256(path: &Path) -> GrimoireResult<String> {
    let mut file =
        tokio::fs::File::open(path)
            .await
            .map_err(|e| GrimoireError::ProcessingFailed {
                message: format!("failed to open file for hashing: {}", e),
            })?;

    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 64 * 1024]; // 64KB chunks

    loop {
        let n = file
            .read(&mut buffer)
            .await
            .map_err(|e| GrimoireError::ProcessingFailed {
                message: format!("failed to read file for hashing: {}", e),
            })?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }

    Ok(format!("{:x}", hasher.finalize()))
}

/// detect mime type from filename extension, with optional magic bytes fallback
fn detect_mime(filename: &str, data: Option<&[u8]>) -> String {
    // try mime_guess from filename first (already a dependency)
    if let Some(mime) = mime_guess::from_path(filename).first() {
        return mime.to_string();
    }

    // magic bytes fallback for common types
    if let Some(bytes) = data {
        if bytes.len() >= 12 {
            // PNG
            if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
                return "image/png".to_string();
            }
            // JPEG
            if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
                return "image/jpeg".to_string();
            }
            // PDF
            if bytes.starts_with(b"%PDF") {
                return "application/pdf".to_string();
            }
            // MP3 (ID3 tag or sync word)
            if bytes.starts_with(b"ID3") || (bytes[0] == 0xFF && (bytes[1] & 0xE0) == 0xE0) {
                return "audio/mpeg".to_string();
            }
            // FLAC
            if bytes.starts_with(b"fLaC") {
                return "audio/flac".to_string();
            }
            // OGG
            if bytes.starts_with(b"OggS") {
                return "audio/ogg".to_string();
            }
            // RIFF (WAV or WebP)
            if bytes.starts_with(b"RIFF") {
                if &bytes[8..12] == b"WAVE" {
                    return "audio/wav".to_string();
                }
                if &bytes[8..12] == b"WEBP" {
                    return "image/webp".to_string();
                }
            }
            // MP4/M4A/MOV
            if &bytes[4..8] == b"ftyp" {
                // could be video/mp4 or audio/mp4 — default to video
                return "video/mp4".to_string();
            }
        }
    }

    "application/octet-stream".to_string()
}

/// write uploaded bytes to date-organized filesystem storage
async fn write_to_storage(data: &[u8], blob_id: &str, filename: &str) -> GrimoireResult<PathBuf> {
    let cfg = config::get_config();

    // use the fetch directory as storage root (same as music upload)
    let output_dir = cfg
        .server
        .as_ref()
        .and_then(|s| s.fetch_music.as_ref())
        .and_then(|f| f.output_dir.as_ref())
        .map(PathBuf::from)
        .unwrap_or_else(|| cfg.data_dir.join("fetch"));

    // date-based subdirectory
    let now = time::OffsetDateTime::now_utc();
    let year = now.year();
    let month = now.month() as u8;

    // get extension from filename
    let ext = filename
        .rsplit('.')
        .next()
        .filter(|e| e.len() <= 10 && !e.is_empty())
        .unwrap_or("bin");

    let rel_path = format!("{:04}/{:02}/{}.{}", year, month, blob_id, ext);
    let full_path = output_dir.join(&rel_path);

    // ensure parent directory exists
    if let Some(parent) = full_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| GrimoireError::ProcessingFailed {
                message: format!("failed to create storage directory: {}", e),
            })?;
    }

    // write file
    tokio::fs::write(&full_path, data)
        .await
        .map_err(|e| GrimoireError::ProcessingFailed {
            message: format!("failed to write file to storage: {}", e),
        })?;

    tracing::info!("wrote file to storage: {}", full_path.display());
    Ok(full_path)
}

/// create the appropriate domain entity based on classified domain
async fn create_domain_entity(
    domain: MediaDomain,
    blob_id: &str,
    filename: &str,
    options: &IngestOptions,
) -> GrimoireResult<String> {
    match domain {
        MediaDomain::Audio => {
            // check if domain entity already exists for this blob (dedup)
            if let Ok(existing) =
                crate::media::audioz::repository::get_audio_by_blob_id(blob_id).await
            {
                tracing::info!("audio entity already exists for blob {}, reusing", blob_id);
                return Ok(existing.id);
            }
            let entity = crate::media::audioz::repository::create_audio(
                crate::media::audioz::CreateAudioRequest {
                    media_blob_id: blob_id.to_string(),
                    title: options.title.clone(),
                    description: options.description.clone(),
                    original_filename: Some(filename.to_string()),
                    duration: None,
                    sample_rate: None,
                    channels: None,
                    bitrate: None,
                    metadata: options.metadata.clone(),
                    created_by: options.created_by.clone(),
                },
            )
            .await?;
            Ok(entity.id)
        }
        MediaDomain::Photo => {
            // check if domain entity already exists for this blob (dedup)
            if let Ok(existing) =
                crate::media::photoz::repository::get_photo_by_blob_id(blob_id).await
            {
                tracing::info!("photo entity already exists for blob {}, reusing", blob_id);
                return Ok(existing.id);
            }
            let entity = crate::media::photoz::repository::create_photo(
                crate::media::photoz::CreatePhotoRequest {
                    media_blob_id: blob_id.to_string(),
                    title: options.title.clone(),
                    description: options.description.clone(),
                    original_filename: Some(filename.to_string()),
                    taken_at: None,
                    width: None,
                    height: None,
                    camera_make: None,
                    camera_model: None,
                    gps_lat: None,
                    gps_lon: None,
                    orientation: None,
                    metadata: options.metadata.clone(),
                    created_by: options.created_by.clone(),
                },
            )
            .await?;
            Ok(entity.id)
        }
        MediaDomain::Video => {
            // check if domain entity already exists for this blob (dedup)
            if let Ok(existing) =
                crate::media::videoz::repository::get_video_by_blob_id(blob_id).await
            {
                tracing::info!("video entity already exists for blob {}, reusing", blob_id);
                return Ok(existing.id);
            }
            let entity = crate::media::videoz::repository::create_video(
                crate::media::videoz::CreateVideoRequest {
                    media_blob_id: blob_id.to_string(),
                    title: options.title.clone(),
                    description: options.description.clone(),
                    original_filename: Some(filename.to_string()),
                    duration: None,
                    width: None,
                    height: None,
                    codec: None,
                    framerate: None,
                    bitrate: None,
                    metadata: options.metadata.clone(),
                    created_by: options.created_by.clone(),
                },
            )
            .await?;
            Ok(entity.id)
        }
        MediaDomain::Document => {
            // check if domain entity already exists for this blob (dedup)
            if let Ok(existing) =
                crate::media::documentz::repository::get_document_by_blob_id(blob_id).await
            {
                tracing::info!(
                    "document entity already exists for blob {}, reusing",
                    blob_id
                );
                return Ok(existing.id);
            }
            let entity = crate::media::documentz::repository::create_document(
                crate::media::documentz::CreateDocumentRequest {
                    media_blob_id: blob_id.to_string(),
                    title: options.title.clone(),
                    description: options.description.clone(),
                    original_filename: Some(filename.to_string()),
                    author: None,
                    page_count: None,
                    doc_type: None,
                    language: None,
                    metadata: options.metadata.clone(),
                    created_by: options.created_by.clone(),
                },
            )
            .await?;
            Ok(entity.id)
        }
        MediaDomain::File => {
            // check if domain entity already exists for this blob (dedup)
            if let Ok(existing) =
                crate::media::filez::repository::get_file_by_blob_id(blob_id).await
            {
                tracing::info!("file entity already exists for blob {}, reusing", blob_id);
                return Ok(existing.id);
            }
            let entity = crate::media::filez::repository::create_file(
                crate::media::filez::CreateFileRequest {
                    media_blob_id: blob_id.to_string(),
                    title: options.title.clone(),
                    description: options.description.clone(),
                    original_filename: Some(filename.to_string()),
                    metadata: options.metadata.clone(),
                    created_by: options.created_by.clone(),
                },
            )
            .await?;
            Ok(entity.id)
        }
    }
}

/// queue the appropriate thumbnail generation job for this domain
async fn queue_thumbnail_job(
    domain: MediaDomain,
    blob_id: &str,
    entity_id: &str,
    mime: &str,
    options: &IngestOptions,
) -> GrimoireResult<Option<String>> {
    let job_type = match domain {
        MediaDomain::Photo => JobType::GeneratePhotoThumbnail,
        MediaDomain::Video => JobType::GenerateVideoThumbnail,
        MediaDomain::Document => {
            // only queue thumbnail for PDFs and similar for now
            if mime == "application/pdf" {
                JobType::GenerateDocumentThumbnail
            } else {
                return Ok(None);
            }
        }
        MediaDomain::Audio => {
            // audio gets waveform generation via the existing ProcessMediaFile flow
            JobType::ProcessMediaFile
        }
        MediaDomain::File => {
            // generic files don't get thumbnails
            return Ok(None);
        }
    };

    let job_params = serde_json::json!({
        "blob_id": blob_id,
        "entity_id": entity_id,
        "domain": domain.as_str(),
        "mime": mime,
    });

    let job_response = create_job(CreateJobRequest {
        job_type,
        session_id: None,
        parameters: job_params,
        max_retries: Some(3),
        scheduled_at: None,
        created_by: options.created_by.clone(),
    })
    .await;

    match job_response.data {
        Some(job) => Ok(Some(job.id)),
        None => {
            // job creation failed — log but don't fail the ingest
            tracing::warn!(
                "failed to queue thumbnail job for blob {}: {}",
                blob_id,
                job_response.message
            );
            Ok(None)
        }
    }
}
