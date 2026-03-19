//! upload handlers for IPC/CLI transports
//!
//! accepts base64-encoded file data or local file paths.
//! used by Tauri local transport and CLI.
//!
//! optimizations for tauri local transport:
//! - `file_path`: skip base64 encoding, read directly from filesystem
//! - `wait_for_completion`: block until job completes instead of returning job_id

use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value as JsonValue};
use sha2::{Digest, Sha256};
use std::path::Path;
use tokio::time::{sleep, Duration};

use crate::error::ErrorDetail;
use crate::jobs::{
    create_job, create_job_session, get_job, list_jobs, CreateJobRequest, CreateJobSessionRequest,
    JobType, ProcessFileParams,
};
use crate::media_blobz::{create_media_blob, BlobType, CreateMediaBlobRequest};
use crate::music::scanner::{is_supported_audio_file, scan_directory};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::upload::{AssociationHint, AssociationInfo, ImageUploadResponse, MusicImportResponse};
use crate::users::UserRole;
use crate::Bytes;

/// max image size: 10MB
const MAX_IMAGE_SIZE: u64 = 10 * 1024 * 1024;

/// max time to wait for job completion (30 seconds)
const MAX_WAIT_DURATION: Duration = Duration::from_secs(30);

/// poll interval when waiting for job completion
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// request for image upload (supports both base64 data and file paths)
#[derive(Debug, Deserialize)]
pub struct UploadImageRequest {
    /// base64-encoded image data (use this OR file_path, not both)
    #[serde(default)]
    pub data: Option<String>,
    /// local filesystem path to image (tauri-local optimization)
    #[serde(default)]
    pub file_path: Option<String>,
    /// original filename (for mime detection, required if using file_path)
    #[serde(default)]
    pub filename: Option<String>,
    /// optional association hint
    pub associate_with: Option<AssociationHint>,
    /// if true, wait for job to complete before returning (tauri-local optimization)
    #[serde(default)]
    pub wait_for_completion: bool,
}

/// dispatch upload routes
pub async fn dispatch(
    path: &str,
    caller: &Caller,
    body: &JsonValue,
) -> Option<GrimoireResponse<JsonValue>> {
    match path {
        "/api/upload/image" => Some(upload_image(caller, body.clone()).await),
        "/api/upload/music-paths" => Some(import_music_paths(caller, body.clone()).await),
        _ => None,
    }
}

/// upload image from base64 data or file path
///
/// path: POST /api/upload/image
pub async fn upload_image(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    // check role - only member or admin can upload
    if !matches!(caller.role, UserRole::Admin | UserRole::Member) {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new(
                "forbidden",
                "forbidden",
                "only members can upload images",
            )],
        );
    }

    let req: UploadImageRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    // get data from either base64 or file_path
    let (data, filename) = match (&req.data, &req.file_path) {
        (Some(base64_data), None) => {
            // decode base64 data
            let decoded = match base64::engine::general_purpose::STANDARD.decode(base64_data) {
                Ok(d) => d,
                Err(e) => {
                    return GrimoireResponse::failure(
                        "invalid base64 data",
                        vec![ErrorDetail::new(
                            "bad_request",
                            "invalid data",
                            &format!("failed to decode base64: {}", e),
                        )],
                    )
                }
            };
            let name = req.filename.unwrap_or_else(|| "image.bin".to_string());
            (decoded, name)
        }
        (None, Some(file_path)) => {
            // read from filesystem (tauri-local optimization)
            let path = Path::new(file_path);
            if !path.exists() {
                return GrimoireResponse::failure(
                    "file not found",
                    vec![ErrorDetail::new(
                        "bad_request",
                        "file not found",
                        &format!("file does not exist: {}", file_path),
                    )],
                );
            }
            let file_data = match std::fs::read(path) {
                Ok(d) => d,
                Err(e) => {
                    return GrimoireResponse::failure(
                        "failed to read file",
                        vec![ErrorDetail::new(
                            "internal_error",
                            "failed to read file",
                            &e.to_string(),
                        )],
                    )
                }
            };
            let name = req
                .filename
                .or_else(|| path.file_name().map(|n| n.to_string_lossy().to_string()))
                .unwrap_or_else(|| "image.bin".to_string());
            (file_data, name)
        }
        (Some(_), Some(_)) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "invalid request",
                    "provide either 'data' or 'file_path', not both",
                )],
            )
        }
        (None, None) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "invalid request",
                    "must provide 'data' (base64) or 'file_path'",
                )],
            )
        }
    };

    // check file size
    if data.len() as u64 > MAX_IMAGE_SIZE {
        return GrimoireResponse::failure(
            "image too large",
            vec![ErrorDetail::new(
                "bad_request",
                "image too large",
                &format!("max size is {} bytes", MAX_IMAGE_SIZE),
            )],
        );
    }

    // calculate sha256 hash
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash = format!("{:x}", hasher.finalize());

    // detect mime type from filename extension and magic bytes
    let mime_type = detect_image_mime_type(&filename, &data);
    if !mime_type.starts_with("image/") {
        return GrimoireResponse::failure(
            "invalid image",
            vec![ErrorDetail::new(
                "bad_request",
                "invalid image",
                "file is not a valid image",
            )],
        );
    }

    let size = data.len() as i64;

    // create media blob
    let blob = match create_media_blob(CreateMediaBlobRequest {
        sha256: hash.clone(),
        size: Some(size),
        mime: Some(mime_type.clone()),
        source_client_id: None,
        local_path: None,
        filename: Some(filename.clone()),
        parent_blob_id: None,
        blob_type: Some(BlobType::Original),
        metadata: json!({
            "original_filename": filename,
        }),
        created_by: Some(caller.user_id.clone()),
        data: Some(Bytes::from(data)),
        width: None,
        height: None,
        blake3: None,
    })
    .await
    {
        Ok(b) => b,
        Err(e) => {
            return GrimoireResponse::failure("failed to create blob", vec![ErrorDetail::from(e)])
        }
    };

    // check if this was a deduplicated blob
    let existing = blob.created_at < (time::OffsetDateTime::now_utc().unix_timestamp() - 1);

    // create webp conversion + association job
    let mut job_payload = json!({
        "blob_id": blob.id,
        "original_mime": mime_type,
    });

    if let Some(ref assoc) = req.associate_with {
        job_payload["associate_with"] = json!({
            "entity_type": assoc.entity_type,
            "entity_id": assoc.entity_id,
            "is_primary": assoc.is_primary,
        });
    }

    let job_response = create_job(CreateJobRequest {
        job_type: JobType::ConvertWebp,
        session_id: None,
        parameters: job_payload,
        max_retries: Some(3),
        scheduled_at: None,
        created_by: Some(caller.user_id.clone()),
    })
    .await;

    let job = match job_response.data {
        Some(j) => j,
        None => {
            return GrimoireResponse::failure(
                "failed to create job",
                job_response
                    .errors
                    .into_iter()
                    .map(ErrorDetail::from)
                    .collect(),
            )
        }
    };

    let message = if existing {
        if req.associate_with.is_some() {
            "existing image found (deduplicated), association job scheduled".to_string()
        } else {
            "existing image found (deduplicated)".to_string()
        }
    } else if req.associate_with.is_some() {
        "image uploaded, conversion and association job scheduled".to_string()
    } else {
        "image uploaded, conversion job scheduled".to_string()
    };

    // if wait_for_completion is set, poll until job completes (tauri-local optimization)
    if req.wait_for_completion {
        let job_id = job.id.clone();
        let start = std::time::Instant::now();

        loop {
            // check timeout
            if start.elapsed() > MAX_WAIT_DURATION {
                return GrimoireResponse::failure(
                    "job timed out",
                    vec![ErrorDetail::new(
                        "timeout",
                        "job timed out",
                        "job did not complete within 30 seconds",
                    )],
                );
            }

            // check job status
            let job_response = get_job(&job_id).await;
            if let Some(job_status) = job_response.data {
                let status = job_status.status.as_str();
                if status == "Completed" {
                    // job completed successfully
                    let response = ImageUploadResponse {
                        blob_id: blob.id,
                        job_id,
                        sha256: hash,
                        size,
                        mime: mime_type,
                        existing,
                        association: req.associate_with.map(|a| AssociationInfo {
                            entity_type: a.entity_type,
                            entity_id: a.entity_id,
                        }),
                        message: "image uploaded and processed".to_string(),
                    };
                    return GrimoireResponse::success(
                        "image uploaded",
                        serde_json::to_value(response).unwrap(),
                    );
                } else if status == "Failed" || status == "Cancelled" {
                    // job failed - error_message contains the failure reason
                    return GrimoireResponse::failure(
                        "job failed",
                        vec![ErrorDetail::new(
                            "job_failed",
                            "job failed",
                            job_status
                                .error_message
                                .as_deref()
                                .unwrap_or("unknown error"),
                        )],
                    );
                }
                // still pending/running, continue polling
            } else if !job_response.errors.is_empty() {
                // error fetching job
                return GrimoireResponse::failure(
                    "failed to check job status",
                    job_response
                        .errors
                        .into_iter()
                        .map(ErrorDetail::from)
                        .collect(),
                );
            }

            // wait before next poll
            sleep(POLL_INTERVAL).await;
        }
    }

    let response = ImageUploadResponse {
        blob_id: blob.id,
        job_id: job.id,
        sha256: hash,
        size,
        mime: mime_type,
        existing,
        association: req.associate_with.map(|a| AssociationInfo {
            entity_type: a.entity_type,
            entity_id: a.entity_id,
        }),
        message,
    };

    GrimoireResponse::success("image uploaded", serde_json::to_value(response).unwrap())
}

/// request for music import by paths (tauri-local optimization)
#[derive(Debug, Deserialize)]
pub struct ImportMusicPathsRequest {
    /// list of file or directory paths to import
    pub paths: Vec<String>,
    /// if true, wait for all jobs to complete before returning
    #[serde(default)]
    pub wait_for_completion: bool,
}

/// import music from filesystem paths
///
/// paths can be:
/// - individual audio files: creates ProcessFile jobs
/// - directories: scans recursively for audio files
///
/// this is optimized for tauri-local transport where files are already on disk.
/// files are not copied - the local_path is stored in the blob record.
///
/// path: POST /api/upload/music-paths
pub async fn import_music_paths(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    // check role - only member or admin can import
    if !matches!(caller.role, UserRole::Admin | UserRole::Member) {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new(
                "forbidden",
                "forbidden",
                "only members can import music",
            )],
        );
    }

    let req: ImportMusicPathsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    if req.paths.is_empty() {
        return GrimoireResponse::failure(
            "no paths provided",
            vec![ErrorDetail::new(
                "bad_request",
                "no paths",
                "must provide at least one path",
            )],
        );
    }

    // create a job session for this import batch
    let session_request = CreateJobSessionRequest {
        job_type: JobType::ProcessFile,
        batch_size: Some(req.paths.len()),
        created_by: Some(caller.user_id.clone()),
    };

    let session_response = create_job_session(session_request).await;
    let session = match session_response.data {
        Some(s) => s,
        None => {
            return GrimoireResponse::failure(
                "failed to create job session",
                session_response
                    .errors
                    .into_iter()
                    .map(ErrorDetail::from)
                    .collect(),
            )
        }
    };

    let session_id = session.id.clone();
    let mut jobs_created = 0i32;
    let mut directories_scanned = 0i32;
    let mut files_skipped = 0i32;

    for path_str in &req.paths {
        let path = Path::new(path_str);

        if !path.exists() {
            files_skipped += 1;
            continue;
        }

        if path.is_dir() {
            // scan directory for audio files
            let scan_result = scan_directory(
                path_str,
                &session_id,
                true,  // recursive
                None,  // no max depth
                None,  // default extensions
                false, // don't skip tracked subdirs
            )
            .await;

            if let Some(count) = scan_result.data {
                jobs_created += count as i32;
                directories_scanned += 1;
            }
        } else if path.is_file() {
            // check if it's an audio file
            if !is_supported_audio_file(path) {
                files_skipped += 1;
                continue;
            }

            // create a ProcessFile job for this file
            let params = ProcessFileParams {
                file_path: path_str.clone(),
                extract_metadata: true,
                generate_thumbnail: true,
                generate_waveform: true,
                source_url: None,
            };

            let job_request = CreateJobRequest {
                job_type: JobType::ProcessFile,
                session_id: Some(session_id.clone()),
                parameters: serde_json::to_value(&params).unwrap_or_default(),
                max_retries: Some(3),
                scheduled_at: None,
                created_by: Some(caller.user_id.clone()),
            };

            let job_response = create_job(job_request).await;
            if job_response.success {
                jobs_created += 1;
            }
        } else {
            files_skipped += 1;
        }
    }

    let message = format!(
        "queued {} import jobs ({} directories scanned, {} files skipped)",
        jobs_created, directories_scanned, files_skipped
    );

    // if wait_for_completion is set, poll until all jobs complete
    if req.wait_for_completion && jobs_created > 0 {
        let start = std::time::Instant::now();
        let max_wait = Duration::from_secs(300); // 5 minute timeout for batch imports

        loop {
            if start.elapsed() > max_wait {
                return GrimoireResponse::failure(
                    "import timed out",
                    vec![ErrorDetail::new(
                        "timeout",
                        "import timed out",
                        "import jobs did not complete within 5 minutes",
                    )],
                );
            }

            // check session status
            let jobs_response = list_jobs(Some(&session_id), None, Some(1000), None).await;
            if let Some(jobs) = jobs_response.data {
                let pending = jobs
                    .iter()
                    .filter(|j| j.status == "Pending" || j.status == "Running")
                    .count();
                let failed = jobs.iter().filter(|j| j.status == "Failed").count();
                let completed = jobs.iter().filter(|j| j.status == "Completed").count();

                if pending == 0 {
                    // all jobs finished
                    let response = MusicImportResponse {
                        session_id,
                        jobs_created,
                        directories_scanned,
                        files_skipped,
                        message: format!(
                            "import complete: {} completed, {} failed",
                            completed, failed
                        ),
                    };
                    return GrimoireResponse::success(
                        "import complete",
                        serde_json::to_value(response).unwrap(),
                    );
                }
            }

            sleep(Duration::from_millis(500)).await;
        }
    }

    let response = MusicImportResponse {
        session_id,
        jobs_created,
        directories_scanned,
        files_skipped,
        message,
    };

    GrimoireResponse::success("import started", serde_json::to_value(response).unwrap())
}

/// detect image mime type from filename extension and magic bytes
fn detect_image_mime_type(filename: &str, data: &[u8]) -> String {
    // check magic bytes first
    if data.len() >= 8 {
        // PNG: 89 50 4E 47 0D 0A 1A 0A
        if data.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
            return "image/png".to_string();
        }
        // JPEG: FF D8 FF
        if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
            return "image/jpeg".to_string();
        }
        // GIF: GIF87a or GIF89a
        if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
            return "image/gif".to_string();
        }
        // WebP: RIFF....WEBP
        if data.len() >= 12 && data.starts_with(b"RIFF") && &data[8..12] == b"WEBP" {
            return "image/webp".to_string();
        }
        // BMP: BM
        if data.starts_with(b"BM") {
            return "image/bmp".to_string();
        }
    }

    // fallback to extension
    let ext = filename.rsplit('.').next().unwrap_or("").to_lowercase();

    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        _ => "application/octet-stream",
    }
    .to_string()
}
