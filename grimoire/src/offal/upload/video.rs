//! video upload: base64/file-path uploads plus the iroh-blobs pull variant
//! used for large files that don't fit in a single P2P message.

use base64::Engine;
use serde_json::{json, Value as JsonValue};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tokio::time::sleep;

use crate::config::get_config;
use crate::error::ErrorDetail;
use crate::jobs::{
    create_job, create_job_session, get_job, CreateJobRequest, CreateJobSessionRequest, JobType,
};
use crate::media_blobz::{
    create_media_blob, get_media_blob_by_sha256, BlobType, CreateMediaBlobRequest,
};
use crate::media_domain::MediaDomain;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::upload::VideoUploadResponse;
use crate::users::UserRole;

use super::mime::{detect_extension, detect_video_mime_type};
use super::models::{UploadVideoByBlake3Request, UploadVideoRequest};
use super::pull::pull_audio_blob_to_local_storage;
use super::{MAX_WAIT_DURATION, POLL_INTERVAL};

/// upload video from base64 data or file path
///
/// used by CharnelLocalTransport (IPC) and CLI. mirrors `upload_music` -
/// see that function for the shared shape (dedupe by sha256, write to
/// `fetch_video.output_dir`, enqueue an `ImportVideo` job).
///
/// path: POST /api/upload/video
pub async fn upload_video(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !matches!(caller.role, UserRole::Admin | UserRole::Member) {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new(
                "forbidden",
                "forbidden",
                "only members can upload video",
            )],
        );
    }

    let req: UploadVideoRequest = match serde_json::from_value(body) {
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
            let name = req.filename.unwrap_or_else(|| "video.mp4".to_string());
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
                .unwrap_or_else(|| "video.mp4".to_string());
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
    let mime_type = detect_video_mime_type(&filename, &data);
    if !mime_type.starts_with("video/") {
        return GrimoireResponse::failure(
            "invalid video file",
            vec![ErrorDetail::new(
                "bad_request",
                "invalid video file",
                "file is not a valid video file",
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
        .and_then(|s| s.fetch_video.as_ref())
        .and_then(|f| f.output_dir.as_ref())
        .map(PathBuf::from)
        .unwrap_or_else(|| config.data_dir.join("fetch"));

    let now = time::OffsetDateTime::now_utc();
    let year = now.year();
    let month = now.month() as u8;
    let rel_path = format!("{:04}/{:02}/{}.{}", year, month, blob.id, ext);
    let full_path = output_dir.join(&rel_path);

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

    // create import job
    let job_payload = json!({
        "blob_id": blob.id,
        "local_path": full_path.to_string_lossy(),
        "mime_type": mime_type,
        "filename": filename,
        "user_hints": req.metadata,
    });

    let job_response = create_job(CreateJobRequest {
        job_type: JobType::ImportVideo,
        session_id: None,
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
                    let response = VideoUploadResponse {
                        blob_id: blob.id,
                        job_id,
                        sha256: hash,
                        size,
                        mime: mime_type,
                        existing,
                        message: "video file uploaded and processed".to_string(),
                    };
                    return GrimoireResponse::success(
                        "video uploaded",
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
        "existing video file found (deduplicated), import job scheduled".to_string()
    } else {
        "video file uploaded, import job scheduled".to_string()
    };

    let response = VideoUploadResponse {
        blob_id: blob.id,
        job_id: job.id,
        sha256: hash,
        size,
        mime: mime_type,
        existing,
        message,
    };

    GrimoireResponse::success("video uploaded", serde_json::to_value(response).unwrap())
}

/// upload video via iroh-blobs pull model - mirrors `upload_music_by_blake3`.
///
/// the client imports the file into their local iroh-blobs store, gets the blake3 hash,
/// then sends a request with the hash. the server pulls the blob via verified streaming
/// instead of embedding the whole file in a single P2P message (which is capped at
/// `federation.max_message_size_mb` and unsuitable for large video files).
///
/// this route only works over P2P transport - node_id is injected by the transport handler.
///
/// path: POST /api/upload/video-by-blake3
pub async fn upload_video_by_blake3(
    caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    if !matches!(caller.role, UserRole::Admin | UserRole::Member) {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new(
                "forbidden",
                "forbidden",
                "only members can upload video",
            )],
        );
    }

    let req: UploadVideoByBlake3Request = match serde_json::from_value(body) {
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

    let pulled = match pull_audio_blob_to_local_storage(
        &node_id,
        &req.blake3,
        None, // upload route trusts the streamed sha256 (no expected hash)
        req.size,
        &req.filename,
        caller,
        MediaDomain::Video,
    )
    .await
    {
        Ok(r) => r,
        Err(e) => return e.into_grimoire_response(),
    };

    let job_payload = json!({
        "blob_id": pulled.blob.id,
        "local_path": pulled.local_path.to_string_lossy(),
        "mime_type": pulled.mime,
        "filename": req.filename,
        "user_hints": req.metadata,
    });

    let blake3_sess_resp = create_job_session(CreateJobSessionRequest {
        job_type: JobType::ImportVideo,
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
        job_type: JobType::ImportVideo,
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
        "created ImportVideo job: {} for blob {} (file: {}, via blake3 pull from {})",
        job.id,
        pulled.blob.id,
        req.filename,
        &node_id[..16.min(node_id.len())],
    );

    let message = if pulled.existing {
        "existing video file found (deduplicated), import job scheduled".to_string()
    } else {
        "video file received via P2P, import job scheduled".to_string()
    };

    let response = VideoUploadResponse {
        blob_id: pulled.blob.id,
        job_id: job.id,
        sha256: pulled.sha256,
        size: pulled.size,
        mime: pulled.mime,
        existing: pulled.existing,
        message,
    };

    GrimoireResponse::success(
        "video upload complete",
        serde_json::to_value(response).unwrap(),
    )
}
