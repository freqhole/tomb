//! upload handlers for IPC/CLI transports
//!
//! accepts base64-encoded file data or local file paths.
//! used by Tauri local transport and CLI.
//!
//! optimizations for tauri local transport:
//! - `file_path`: skip base64 encoding, read directly from filesystem
//! - `wait_for_completion`: block until job completes instead of returning job_id

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value as JsonValue};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::time::{sleep, Duration};
use zod_gen_derive::ZodSchema;

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::config::get_config;
use crate::error::{ErrorDetail, GrimoireError};
use crate::federation::p2p_client;
use crate::jobs::{
    create_job, create_job_session, get_job, list_jobs, CreateJobRequest, CreateJobSessionRequest,
    JobType, ProcessFileParams,
};
use crate::media_blobz::{
    create_media_blob, get_media_blob_by_sha256, BlobType, CreateMediaBlobRequest,
};
use crate::music::scanner::{is_supported_audio_file, scan_directory};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::upload::{
    AssociationHint, AssociationInfo, ImageUploadResponse, MusicImportResponse, MusicMetadataHints,
    MusicUploadResponse,
};
use crate::users::UserRole;
use crate::Bytes;

/// route metadata for upload
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "upload_music",
        path: "/api/upload/music",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "String",
        response_type: "MusicUploadResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "upload_image",
        path: "/api/upload/image",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "String",
        response_type: "ImageUploadResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "delete_image",
        path: "/api/music/images/delete",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "DeleteImageRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "set_primary_image",
        path: "/api/music/images/set-primary",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SetPrimaryImageRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "upload_music_by_blake3",
        path: "/api/upload/music-by-blake3",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UploadMusicByBlake3Request",
        response_type: "MusicUploadResponse",
        auth: RouteAuth::Role(UserRole::Member),
    },
];

/// collect all route metadata from upload domain
pub fn routes() -> Vec<RouteInfo> {
    ROUTES.to_vec()
}

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
        "/api/upload/music-by-blake3" => Some(upload_music_by_blake3(caller, body.clone()).await),
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

    // check for existing blob by sha256 before creating
    let existing = get_media_blob_by_sha256(&hash).await.is_ok();

    // create media blob (returns existing if sha256 matches)
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

/// request for music upload via iroh-blobs pull model
///
/// the client imports the file into their local iroh-blobs store (gets blake3 hash),
/// then sends this request. the server pulls the blob via verified streaming.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct UploadMusicByBlake3Request {
    /// blake3 hash of the file (64 hex chars) - the client has this blob in their iroh store
    pub blake3: String,
    /// original filename (for mime detection)
    pub filename: String,
    /// file size in bytes (for validation)
    pub size: Option<u64>,
    /// the node_id of the uploading peer (injected by transport handler, not sent by client)
    pub node_id: Option<String>,
    /// optional metadata hints for processing
    pub metadata: Option<MusicMetadataHints>,
}

/// upload music via iroh-blobs pull model
///
/// the client imports the file into their local iroh-blobs store, gets the blake3 hash,
/// then sends a request with the hash. the server pulls the blob via verified streaming.
///
/// this route only works over P2P transport - node_id is injected by the transport handler.
///
/// path: POST /api/upload/music-by-blake3
pub async fn upload_music_by_blake3(
    caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    // check role - only member or admin can upload
    if !matches!(caller.role, UserRole::Admin | UserRole::Member) {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new(
                "forbidden",
                "forbidden",
                "only members can upload music",
            )],
        );
    }

    let req: UploadMusicByBlake3Request = match serde_json::from_value(body) {
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

    // validate blake3 hash format (64 hex chars)
    if req.blake3.len() != 64 || !req.blake3.chars().all(|c| c.is_ascii_hexdigit()) {
        return GrimoireResponse::failure(
            "invalid blake3 hash",
            vec![ErrorDetail::new(
                "bad_request",
                "invalid blake3 hash",
                "blake3 hash must be exactly 64 hex characters",
            )],
        );
    }

    // node_id is required - this route only works over P2P transport
    let node_id = match &req.node_id {
        Some(id) => id.clone(),
        None => {
            return GrimoireResponse::failure(
                "P2P transport required",
                vec![ErrorDetail::new(
                    "bad_request",
                    "P2P transport required",
                    "this route only works over P2P transport (node_id must be set)",
                )],
            )
        }
    };

    // enforce max upload size from config before pulling
    let config = get_config();
    let max_upload_bytes = config
        .federation
        .as_ref()
        .map(|f| f.max_upload_size_mb as u64 * 1024 * 1024)
        .unwrap_or(500 * 1024 * 1024); // default 500MB

    if let Some(declared_size) = req.size {
        if declared_size > max_upload_bytes {
            return GrimoireResponse::failure(
                "file too large",
                vec![ErrorDetail::new(
                    "file_too_large",
                    "file too large",
                    &format!(
                        "declared size {} bytes exceeds max upload size {} bytes",
                        declared_size, max_upload_bytes
                    ),
                )],
            );
        }
    }

    // pull the blob from the uploading peer via iroh-blobs verified streaming
    // streams directly to disk via FsStore export — no full-file memory buffering.
    // timeout after 120 seconds to prevent indefinite hangs
    tracing::info!(
        "pulling blob {} from peer {} for upload by {}",
        &req.blake3[..16],
        &node_id[..16.min(node_id.len())],
        caller.username,
    );

    // determine output path before downloading so we can stream directly to it
    let output_dir = config
        .server
        .as_ref()
        .and_then(|s| s.fetch_music.as_ref())
        .and_then(|f| f.output_dir.as_ref())
        .map(PathBuf::from)
        .unwrap_or_else(|| config.data_dir.join("fetch"));

    let ext = detect_extension(
        &mime_guess::from_path(&req.filename)
            .first()
            .map(|m| m.to_string())
            .unwrap_or_default(),
        &req.filename,
    );
    let now = time::OffsetDateTime::now_utc();
    let year = now.year();
    let month = now.month() as u8;

    // use a temp filename based on blake3 hash (will rename after blob record creation)
    let temp_filename = format!("{}.{}", &req.blake3[..16], ext);
    let temp_path = output_dir.join(format!("{:04}/{:02}/{}", year, month, temp_filename));

    // ensure directory exists
    if let Some(parent) = temp_path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return GrimoireResponse::failure(
                "failed to create directory",
                vec![ErrorDetail::new(
                    "internal_error",
                    "failed to create directory",
                    &e.to_string(),
                )],
            );
        }
    }

    let fetch_future =
        p2p_client::fetch_blob_verified_to_file_with_ensure(&node_id, &req.blake3, &temp_path);
    let file_size = match tokio::time::timeout(Duration::from_secs(120), fetch_future).await {
        Ok(Ok(size)) => {
            tracing::info!(
                "exported {} bytes for blob {} from peer {} to {}",
                size,
                &req.blake3[..16],
                &node_id[..16.min(node_id.len())],
                temp_path.display(),
            );
            size
        }
        Ok(Err(e)) => {
            tracing::error!(
                "failed to fetch blob {} from peer {}: {}",
                &req.blake3[..16],
                &node_id[..16.min(node_id.len())],
                e,
            );
            return GrimoireResponse::failure(
                "failed to fetch blob from peer",
                vec![ErrorDetail::new(
                    "fetch_failed",
                    "failed to fetch blob from peer",
                    &e.to_string(),
                )],
            );
        }
        Err(_) => {
            tracing::error!(
                "timeout fetching blob {} from peer {} (120s)",
                &req.blake3[..16],
                &node_id[..16.min(node_id.len())],
            );
            return GrimoireResponse::failure(
                "blob fetch timed out",
                vec![ErrorDetail::new(
                    "timeout",
                    "blob fetch timed out",
                    "failed to download blob from peer within 120 seconds. the peer may not be serving blobs (browser needs blob server running) or the connection may have dropped.",
                )],
            );
        }
    };

    // validate size if provided
    if let Some(expected_size) = req.size {
        if file_size != expected_size {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return GrimoireResponse::failure(
                "size mismatch",
                vec![ErrorDetail::new(
                    "bad_request",
                    "size mismatch",
                    &format!(
                        "expected {} bytes but received {} bytes",
                        expected_size, file_size
                    ),
                )],
            );
        }
    }

    // compute sha256 by streaming from the file on disk (no full-file memory load)
    let hash = {
        use tokio::io::AsyncReadExt;
        let mut file = match tokio::fs::File::open(&temp_path).await {
            Ok(f) => f,
            Err(e) => {
                return GrimoireResponse::failure(
                    "failed to read downloaded file",
                    vec![ErrorDetail::from(GrimoireError::ProcessingFailed {
                        message: e.to_string(),
                    })],
                )
            }
        };
        let mut hasher = Sha256::new();
        let mut buf = vec![0u8; 64 * 1024]; // 64KB chunks
        loop {
            let n = match file.read(&mut buf).await {
                Ok(0) => break,
                Ok(n) => n,
                Err(e) => {
                    let _ = tokio::fs::remove_file(&temp_path).await;
                    return GrimoireResponse::failure(
                        "failed to read downloaded file",
                        vec![ErrorDetail::from(GrimoireError::ProcessingFailed {
                            message: e.to_string(),
                        })],
                    );
                }
            };
            hasher.update(&buf[..n]);
        }
        format!("{:x}", hasher.finalize())
    };
    tracing::debug!(
        "computed sha256 for blob {}: {}",
        &req.blake3[..16],
        &hash[..16]
    );

    // detect mime type from filename and file header (read first 12 bytes)
    let header = {
        use tokio::io::AsyncReadExt;
        let mut f = tokio::fs::File::open(&temp_path).await.unwrap_or_else(|_| {
            // shouldn't happen since we just wrote/read the file
            panic!("failed to reopen temp file for mime detection");
        });
        let mut buf = [0u8; 12];
        let _ = f.read(&mut buf).await;
        buf
    };
    let mime_type = detect_audio_mime_type(&req.filename, &header);
    tracing::debug!(
        "detected mime type for blob {}: {}",
        &req.blake3[..16],
        &mime_type
    );
    if !mime_type.starts_with("audio/") {
        let _ = tokio::fs::remove_file(&temp_path).await;
        return GrimoireResponse::failure(
            "invalid audio file",
            vec![ErrorDetail::new(
                "bad_request",
                "invalid audio file",
                "file is not a valid audio file",
            )],
        );
    }

    let size = file_size as i64;

    // check for existing blob by sha256 before creating
    let existing = get_media_blob_by_sha256(&hash).await.is_ok();

    // create media blob entry (with deduplication via sha256 unique constraint)
    let blob = match create_media_blob(CreateMediaBlobRequest {
        sha256: hash.clone(),
        size: Some(size),
        mime: Some(mime_type.clone()),
        source_client_id: None,
        local_path: None, // will be set after writing to disk
        filename: Some(req.filename.clone()),
        parent_blob_id: None,
        blob_type: Some(BlobType::Original),
        metadata: json!({
            "original_filename": req.filename,
            "upload_method": "blake3_pull",
            "source_node_id": node_id,
        }),
        created_by: Some(caller.user_id.clone()),
        data: None,
        width: None,
        height: None,
        blake3: Some(req.blake3.clone()),
    })
    .await
    {
        Ok(b) => {
            tracing::info!(
                "created media blob {} for upload {}",
                b.id,
                &req.blake3[..16]
            );
            b
        }
        Err(e) => {
            let _ = tokio::fs::remove_file(&temp_path).await;
            return GrimoireResponse::failure("failed to create blob", vec![ErrorDetail::from(e)]);
        }
    };

    // rename temp file to final path with blob id
    let rel_path = format!("{:04}/{:02}/{}.{}", year, month, blob.id, ext);
    let full_path = output_dir.join(&rel_path);

    if temp_path != full_path {
        if let Err(_) = tokio::fs::rename(&temp_path, &full_path).await {
            // fall back to copy+delete if rename fails (cross-device)
            if let Err(e) = tokio::fs::copy(&temp_path, &full_path).await {
                return GrimoireResponse::failure(
                    "failed to move file",
                    vec![ErrorDetail::new(
                        "internal_error",
                        "failed to move file",
                        &e.to_string(),
                    )],
                );
            }
            let _ = tokio::fs::remove_file(&temp_path).await;
        }
    }
    tracing::info!("file at {}", full_path.display());

    // create ImportMusic job
    let job_payload = json!({
        "blob_id": blob.id,
        "local_path": full_path.to_string_lossy(),
        "mime_type": mime_type,
        "filename": req.filename,
        "user_hints": req.metadata,
    });

    let job_response = create_job(CreateJobRequest {
        job_type: JobType::ImportMusic,
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
                "failed to create import job",
                job_response
                    .errors
                    .into_iter()
                    .map(ErrorDetail::from)
                    .collect(),
            )
        }
    };

    tracing::info!(
        "created ImportMusic job: {} for blob {} (file: {}, via blake3 pull from {})",
        job.id,
        blob.id,
        req.filename,
        &node_id[..16.min(node_id.len())],
    );

    let message = if existing {
        "existing music file found (deduplicated), import job scheduled".to_string()
    } else {
        "music file received via P2P, import job scheduled".to_string()
    };

    let response = MusicUploadResponse {
        blob_id: blob.id,
        job_id: job.id,
        sha256: hash,
        size,
        mime: mime_type,
        existing,
        message,
    };

    GrimoireResponse::success(
        "music upload complete",
        serde_json::to_value(response).unwrap(),
    )
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
