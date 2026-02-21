//! image upload and management handlers

use axum::{
    extract::{Multipart, State},
    Extension, Json,
};
use grimoire::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use grimoire::jobs::{create_job, CreateJobRequest, JobType};
use grimoire::media_blobz::{create_media_blob, BlobType};
use grimoire::music::entities::{albums, artists, playlists, songs};
use grimoire::response::GrimoireResponse;
use grimoire::upload::{
    AssociationHint, AssociationInfo, DeleteImageRequest, ImageUploadResponse,
    SetPrimaryImageRequest,
};
use grimoire::users::UserRole;
use grimoire::{media_blobz::CreateMediaBlobRequest, Bytes};
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::auth::{check_role, AuthenticatedUser};
use crate::error::ApiError;
use crate::AppState;

const MAX_IMAGE_SIZE: u64 = 10 * 1024 * 1024; // 10MB

inventory::submit! {
    RouteInfo {
        name: "upload_image",
        path: "/api/upload/image",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "String",
        response_type: "ImageUploadResponse",
        auth: RouteAuth::Role(UserRole::Member),
    }
}

inventory::submit! {
    RouteInfo {
        name: "delete_image",
        path: "/api/music/images/delete",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "DeleteImageRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    }
}

inventory::submit! {
    RouteInfo {
        name: "set_primary_image",
        path: "/api/music/images/set-primary",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "SetPrimaryImageRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    }
}

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
    check_role(&user, UserRole::Member)?;

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
    // - for albums/artists/playlists: use Original type (they ARE the primary image)
    let (blob_type, parent_blob_id) = if let Some(ref assoc) = association {
        if assoc.entity_type == "song" {
            // lookup the song's media_blob_id to use as parent
            match songs::get_song_media_blob_id(&assoc.entity_id).await {
                Ok(parent_id) => (BlobType::Thumbnail, Some(parent_id)),
                Err(_) => {
                    return Err(ApiError::BadRequest(format!(
                        "song not found: {}",
                        assoc.entity_id
                    )));
                }
            }
        } else {
            // albums, artists, playlists: use Original type with no parent
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
        filename: Some(filename.to_string()),
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
            "is_primary": assoc.is_primary,
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

/// delete (unlink) an image from an entity
///
/// POST /api/music/images/delete
///
/// unlinks the image association but doesn't delete the blob itself
/// (blobs may be shared by multiple entities)
pub async fn delete_image_handler(
    State(_state): State<AppState>,
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<DeleteImageRequest>,
) -> Result<Json<GrimoireResponse<()>>, ApiError> {
    // check user role - only member (20) or lower can delete
    if user.role.level() > grimoire::users::UserRole::Member.level() {
        return Err(ApiError::Forbidden);
    }

    tracing::debug!(
        "delete_image: entity_type={}, entity_id={}, blob_id={}",
        req.entity_type,
        req.entity_id,
        req.blob_id
    );

    // call the appropriate remove_*_image function based on entity type
    let response = match req.entity_type.as_str() {
        "song" => songs::remove_song_image(&req.entity_id, &req.blob_id).await,
        "album" => albums::remove_album_image(&req.entity_id, &req.blob_id).await,
        "artist" => artists::remove_artist_image(&req.entity_id, &req.blob_id).await,
        "playlist" => playlists::remove_playlist_image(&req.entity_id, &req.blob_id).await,
        _ => {
            return Err(ApiError::BadRequest(format!(
                "unsupported entity type: {}",
                req.entity_type
            )))
        }
    };

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    Ok(Json(GrimoireResponse::success(
        "image unlinked from entity",
        (),
    )))
}

/// set an image as primary for an entity
///
/// POST /api/music/images/set-primary
///
/// request body:
/// - entity_type: "song" | "album" | "artist" | "playlist"
/// - entity_id: entity identifier
/// - blob_id: media blob id to set as primary
pub async fn set_primary_image_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Json(req): Json<SetPrimaryImageRequest>,
) -> Result<Json<GrimoireResponse<()>>, ApiError> {
    // check user role - only member (20) or lower can modify images
    if user.role.level() > grimoire::users::UserRole::Member.level() {
        return Err(ApiError::Forbidden);
    }

    tracing::info!(
        "setting primary image for {} {} with blob {}",
        req.entity_type, req.entity_id, req.blob_id
    );

    // call the appropriate set_primary_*_image function based on entity type
    let response = match req.entity_type.as_str() {
        "song" => songs::set_primary_song_image(&req.entity_id, &req.blob_id).await,
        "album" => albums::set_primary_album_image(&req.entity_id, &req.blob_id).await,
        "artist" => artists::set_primary_artist_image(&req.entity_id, &req.blob_id).await,
        "playlist" => playlists::set_primary_playlist_image(&req.entity_id, &req.blob_id).await,
        _ => {
            return Err(ApiError::BadRequest(format!(
                "unsupported entity type: {}",
                req.entity_type
            )))
        }
    };

    if !response.success {
        return Err(ApiError::Internal(response.message));
    }

    Ok(Json(GrimoireResponse::success(
        "primary image updated",
        (),
    )))
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
