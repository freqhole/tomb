//! image upload: cover art / posters / avatars, optionally associated with
//! an album, artist, playlist or video entity.

use base64::Engine;
use serde_json::{json, Value as JsonValue};
use sha2::{Digest, Sha256};
use std::path::Path;
use tokio::time::sleep;

use crate::error::ErrorDetail;
use crate::jobs::{create_job, get_job, CreateJobRequest, JobType};
use crate::media_blobz::{
    create_media_blob, get_media_blob_by_sha256, BlobType, CreateMediaBlobRequest,
};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::upload::{AssociationInfo, ImageUploadResponse};
use crate::users::UserRole;
use crate::Bytes;

use super::mime::detect_image_mime_type;
use super::models::UploadImageRequest;
use super::{MAX_WAIT_DURATION, POLL_INTERVAL};

/// max image size: 10MB
const MAX_IMAGE_SIZE: u64 = 10 * 1024 * 1024;

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
                    e.to_string(),
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
                            format!("failed to decode base64: {}", e),
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

    tracing::info!(
        "upload_image(offal): START from {} filename=\"{}\" size={} associate={:?} wait_for_completion={}",
        caller.username,
        filename,
        data.len(),
        req.associate_with.as_ref().map(|a| format!("{}:{}", a.entity_type, a.entity_id)),
        req.wait_for_completion,
    );

    // check file size
    if data.len() as u64 > MAX_IMAGE_SIZE {
        tracing::warn!(
            "upload_image(offal): REJECT from {} filename=\"{}\" size={} exceeds max {}",
            caller.username,
            filename,
            data.len(),
            MAX_IMAGE_SIZE,
        );
        return GrimoireResponse::failure(
            "image too large",
            vec![ErrorDetail::new(
                "bad_request",
                "image too large",
                format!("max size is {} bytes", MAX_IMAGE_SIZE),
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
        delete_duplicate_local_path: false,
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
        priority: None,
    })
    .await;

    let job = match job_response.data {
        Some(j) => j,
        None => {
            tracing::error!(
                "upload_image(offal): FAIL to create job for blob {} sha256={}",
                blob.id,
                &hash[..16.min(hash.len())],
            );
            return GrimoireResponse::failure(
                "failed to create job",
                job_response.errors.into_iter().collect(),
            );
        }
    };

    tracing::info!(
        "upload_image(offal): OK from {} filename=\"{}\" blob_id={} sha256={} existing={} associate={:?} job_id={}",
        caller.username,
        filename,
        blob.id,
        &hash[..16.min(hash.len())],
        existing,
        req.associate_with.as_ref().map(|a| format!("{}:{}", a.entity_type, a.entity_id)),
        job.id,
    );

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
                    job_response.errors.into_iter().collect(),
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
