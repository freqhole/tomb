//! music upload: base64/file-path uploads, the iroh-blobs pull variant, and
//! bulk import of already-on-disk paths.

use crate::config::get_config;
use crate::error::ErrorDetail;
use crate::jobs::{
    create_job, create_job_session, get_job, list_jobs, CreateJobRequest, CreateJobSessionRequest,
    JobType, ProcessFileParams,
};
use crate::media_blobz::{
    create_media_blob, get_media_blob_by_sha256, BlobType, CreateMediaBlobRequest,
};
use crate::media_domain::MediaDomain;
use crate::music::scanner::{is_supported_audio_file, scan_directory};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::upload::{MusicImportResponse, MusicUploadResponse};
use crate::users::UserRole;
use base64::Engine;
use serde_json::{json, Value as JsonValue};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::time::{sleep, Duration};
use tracing::info;

use super::mime::{detect_audio_mime_type, detect_extension};
use super::models::{ImportMusicPathsRequest, UploadMusicByBlake3Request, UploadMusicRequest};
use super::pull::pull_audio_blob_to_local_storage;
use super::{MAX_WAIT_DURATION, POLL_INTERVAL};

/// upload music from base64 data or file path
///
/// used by CharnelLocalTransport (IPC) and CLI.
/// the HTTP server handles multipart uploads separately.
///
/// path: POST /api/upload/music
pub async fn upload_music(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
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

    let req: UploadMusicRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            )
        }
    };

    // get data from either base64 or file_path
    let (data, filename) = match (&req.data, &req.file_path) {
        (Some(base64_data), None) => {
            let decoded = match base64::engine::general_purpose::STANDARD.decode(base64_data) {
                Ok(d) => d,
                Err(e) => {
                    return GrimoireResponse::failure(
                        "invalid base64 data",
                        vec![ErrorDetail::new(
                            "bad_request",
                            "invalid data",
                            format!("failed to decode base64: {}", e),
                        )],
                    )
                }
            };
            let name = req.filename.unwrap_or_else(|| "music.mp3".to_string());
            (decoded, name)
        }
        (None, Some(file_path)) => {
            let path = Path::new(file_path);
            if !path.exists() {
                return GrimoireResponse::failure(
                    "file not found",
                    vec![ErrorDetail::new(
                        "bad_request",
                        "file not found",
                        format!("file does not exist: {}", file_path),
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
                            e.to_string(),
                        )],
                    )
                }
            };
            let name = req
                .filename
                .or_else(|| path.file_name().map(|n| n.to_string_lossy().to_string()))
                .unwrap_or_else(|| "music.mp3".to_string());
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

    // detect mime type
    let mime_type = detect_audio_mime_type(&filename, &data);
    if !mime_type.starts_with("audio/") {
        return GrimoireResponse::failure(
            "invalid audio file",
            vec![ErrorDetail::new(
                "bad_request",
                "invalid audio file",
                "file is not a valid audio file",
            )],
        );
    }

    let size = data.len() as i64;

    // compute sha256
    let mut hasher = Sha256::new();
    hasher.update(&data);
    let hash = format!("{:x}", hasher.finalize());

    // compute blake3
    let blake3_hash = crate::blobz::compute_blake3_from_bytes(&data);

    let ext = detect_extension(&mime_type, &filename);

    // check for existing blob
    let existing = get_media_blob_by_sha256(&hash).await.is_ok();

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
        data: None,
        width: None,
        height: None,
        blake3: Some(blake3_hash),
        delete_duplicate_local_path: false,
    })
    .await
    {
        Ok(b) => b,
        Err(e) => {
            return GrimoireResponse::failure("failed to create blob", vec![ErrorDetail::from(e)])
        }
    };

    // write file to disk
    let config = get_config();
    let output_dir = config
        .server
        .as_ref()
        .and_then(|s| s.fetch_music.as_ref())
        .and_then(|f| f.output_dir.as_ref())
        .map(PathBuf::from)
        .unwrap_or_else(|| config.data_dir.join("fetch"));

    let now = time::OffsetDateTime::now_utc();
    let year = now.year();
    let month = now.month() as u8;
    // join each segment separately - a single format!() string with embedded
    // "/" produces a mixed \ and / path on windows once joined onto output_dir.
    let full_path = output_dir
        .join(format!("{:04}", year))
        .join(format!("{:02}", month))
        .join(format!("{}.{}", blob.id, ext));

    if let Some(parent) = full_path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return GrimoireResponse::failure(
                "failed to create directory",
                vec![ErrorDetail::new(
                    "internal_error",
                    "failed to create directory",
                    e.to_string(),
                )],
            );
        }
    }

    if let Err(e) = tokio::fs::write(&full_path, &data).await {
        return GrimoireResponse::failure(
            "failed to write file",
            vec![ErrorDetail::new(
                "internal_error",
                "failed to write file",
                e.to_string(),
            )],
        );
    }

    // create a session so this upload lands in the import review queue.
    let upload_sess_resp = create_job_session(CreateJobSessionRequest {
        job_type: JobType::ImportMusic,
        batch_size: Some(1),
        created_by: Some(caller.user_id.clone()),
    })
    .await;
    let upload_session_id = match upload_sess_resp.data {
        Some(s) => {
            tracing::info!(session_id = %s.id, "created upload session for import review tracking");
            Some(s.id)
        }
        None => {
            tracing::warn!("failed to create upload session; import review will be unavailable for this upload");
            None
        }
    };

    // create import job
    let job_payload = json!({
        "blob_id": blob.id,
        "local_path": full_path.to_string_lossy(),
        "mime_type": mime_type,
        "filename": filename,
        "user_hints": req.metadata,
    });

    let job_response = create_job(CreateJobRequest {
        job_type: JobType::ImportMusic,
        session_id: upload_session_id,
        parameters: job_payload,
        max_retries: Some(3),
        scheduled_at: None,
        created_by: Some(caller.user_id.clone()),
        priority: None,
    })
    .await;

    let job = match job_response.data {
        Some(j) => j,
        None => {
            return GrimoireResponse::failure(
                "failed to create import job",
                job_response.errors.into_iter().collect(),
            )
        }
    };

    // if wait_for_completion, poll until job finishes
    if req.wait_for_completion {
        let job_id = job.id.clone();
        let start = std::time::Instant::now();

        loop {
            if start.elapsed() > MAX_WAIT_DURATION {
                return GrimoireResponse::failure(
                    "job timed out",
                    vec![ErrorDetail::new(
                        "timeout",
                        "job timed out",
                        "import job did not complete within 30 seconds",
                    )],
                );
            }

            let job_status = get_job(&job_id).await;
            if let Some(js) = job_status.data {
                let status = js.status.as_str();
                if status == "Completed" {
                    let response = MusicUploadResponse {
                        blob_id: blob.id,
                        job_id,
                        sha256: hash,
                        size,
                        mime: mime_type,
                        existing,
                        message: "music file uploaded and processed".to_string(),
                    };
                    return GrimoireResponse::success(
                        "music uploaded",
                        serde_json::to_value(response).unwrap(),
                    );
                } else if status == "Failed" || status == "Cancelled" {
                    return GrimoireResponse::failure(
                        "import job failed",
                        vec![ErrorDetail::new(
                            "job_failed",
                            "import job failed",
                            js.error_message.as_deref().unwrap_or("unknown error"),
                        )],
                    );
                }
            }

            sleep(POLL_INTERVAL).await;
        }
    }

    let message = if existing {
        "existing music file found (deduplicated), import job scheduled".to_string()
    } else {
        "music file uploaded, import job scheduled".to_string()
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

    GrimoireResponse::success("music uploaded", serde_json::to_value(response).unwrap())
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
                    e.to_string(),
                )],
            )
        }
    };

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

    // pull + verify + dedupe via shared helper
    let pulled = match pull_audio_blob_to_local_storage(
        &node_id,
        &req.blake3,
        None, // upload route trusts the streamed sha256 (no expected hash)
        req.size,
        &req.filename,
        caller,
        MediaDomain::Music,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => return e.into_grimoire_response(),
    };

    // create ImportMusic job
    let job_payload = json!({
        "blob_id": pulled.blob.id,
        "local_path": pulled.local_path.to_string_lossy(),
        "mime_type": pulled.mime,
        "filename": req.filename,
        "user_hints": req.metadata,
    });

    // create a session so this upload lands in the import review queue.
    let blake3_sess_resp = create_job_session(CreateJobSessionRequest {
        job_type: JobType::ImportMusic,
        batch_size: Some(1),
        created_by: Some(caller.user_id.clone()),
    })
    .await;
    let blake3_session_id = match blake3_sess_resp.data {
        Some(s) => {
            tracing::info!(session_id = %s.id, "created blake3 upload session for import review tracking");
            Some(s.id)
        }
        None => {
            tracing::warn!(
                "failed to create blake3 upload session; import review will be unavailable"
            );
            None
        }
    };

    let job_response = create_job(CreateJobRequest {
        job_type: JobType::ImportMusic,
        session_id: blake3_session_id,
        parameters: job_payload,
        max_retries: Some(3),
        scheduled_at: None,
        created_by: Some(caller.user_id.clone()),
        priority: None,
    })
    .await;

    let job = match job_response.data {
        Some(j) => j,
        None => {
            return GrimoireResponse::failure(
                "failed to create import job",
                job_response.errors.into_iter().collect(),
            )
        }
    };

    tracing::info!(
        "created ImportMusic job: {} for blob {} (file: {}, via blake3 pull from {})",
        job.id,
        pulled.blob.id,
        req.filename,
        &node_id[..16.min(node_id.len())],
    );

    let message = if pulled.existing {
        "existing music file found (deduplicated), import job scheduled".to_string()
    } else {
        "music file received via P2P, import job scheduled".to_string()
    };

    let response = MusicUploadResponse {
        blob_id: pulled.blob.id,
        job_id: job.id,
        sha256: pulled.sha256,
        size: pulled.size,
        mime: pulled.mime,
        existing: pulled.existing,
        message,
    };

    GrimoireResponse::success(
        "music upload complete",
        serde_json::to_value(response).unwrap(),
    )
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
                    e.to_string(),
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

    info!(
        "import_music_paths: received {} path(s): {:?}",
        req.paths.len(),
        req.paths
    );

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
                session_response.errors.into_iter().collect(),
            )
        }
    };

    let session_id = session.id.clone();
    let mut jobs_created = 0i32;
    let mut directories_scanned = 0i32;
    let mut files_skipped = 0i32;
    let mut files_queued = 0i32;
    let mut files_already_in_library = 0i32;

    for path_str in &req.paths {
        let path = Path::new(path_str);

        if !path.exists() {
            info!(
                "import_music_paths: path does not exist, skipping: {}",
                path_str
            );
            files_skipped += 1;
            continue;
        }

        if path.is_dir() {
            info!("import_music_paths: scanning directory: {}", path_str);
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

            info!(
                "import_music_paths: scan_directory({}) -> success={} data={:?} message={}",
                path_str, scan_result.success, scan_result.data, scan_result.message
            );

            if let Some(outcome) = scan_result.data {
                jobs_created += outcome.jobs_created as i32;
                files_queued += outcome.files_queued as i32;
                files_already_in_library += outcome.files_skipped as i32;
                directories_scanned += 1;
            }
        } else if path.is_file() {
            // check if it's an audio file
            if !is_supported_audio_file(path) {
                files_skipped += 1;
                continue;
            }

            // create a ProcessFile job for this file. leave
            // serialization_group unset so the runner falls back to
            // parent-dir grouping (siblings of one album dir serialize).
            let params = ProcessFileParams {
                file_path: path_str.clone(),
                extract_metadata: true,
                generate_thumbnail: true,
                generate_waveform: true,
                source_url: None,
                existing_blob_id: None,
                serialization_group: None,
                domain: None,
            };

            let job_request = CreateJobRequest {
                job_type: JobType::ProcessFile,
                session_id: Some(session_id.clone()),
                parameters: serde_json::to_value(&params).unwrap_or_default(),
                max_retries: Some(3),
                scheduled_at: None,
                created_by: Some(caller.user_id.clone()),
                priority: None,
            };

            let job_response = create_job(job_request).await;
            if job_response.success {
                jobs_created += 1;
                files_queued += 1;
            }
        } else {
            files_skipped += 1;
        }
    }

    let message = if files_queued == 0 && files_already_in_library > 0 {
        format!(
            "nothing new to import: {} file(s) already in your library ({} directories scanned, {} files skipped)",
            files_already_in_library, directories_scanned, files_skipped
        )
    } else {
        format!(
            "queued {} file(s) across {} job(s) ({} directories scanned, {} already in library, {} files skipped)",
            files_queued, jobs_created, directories_scanned, files_already_in_library, files_skipped
        )
    };
    info!(
        "import_music_paths: {} (session_id={})",
        message, session_id
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
