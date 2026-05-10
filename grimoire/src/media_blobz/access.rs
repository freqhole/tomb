use crate::blob_data::find_existing_thumbnail;
use crate::error::ErrorDetail;
use crate::media_blobz::get_media_blob;
use crate::media_blobz::get_media_blob_with_data;
use crate::response::GrimoireResponse;
use base64::Engine;
use serde_json::{json, Value as JsonValue};

/// build the standard blob-path response used by blob route handlers.
///
/// `id` is a `media_blobz.id` short pk (7-16 hex chars, generated
/// per-instance by `lower(hex(randomblob(8)))`). it is NOT a
/// sha256 or blake3 content hash. callers that only have a sha256
/// must resolve it to the local media_blob_id first (e.g. via
/// `get_media_blob_by_sha256`) before hitting this path.
pub async fn build_blob_path_response(id: &str) -> GrimoireResponse<JsonValue> {
    match get_media_blob(id).await {
        Ok(blob) => {
            if let Some(path) = blob.local_path {
                GrimoireResponse::success(
                    "blob path",
                    json!({
                        "id": blob.id,
                        "path": path,
                        "mime": blob.mime,
                    }),
                )
            } else {
                GrimoireResponse::failure(
                    "blob has no local path",
                    vec![ErrorDetail::new(
                        "no_local_path",
                        "blob has no local path",
                        "this blob is stored in database, not filesystem",
                    )],
                )
            }
        }
        Err(e) => GrimoireResponse::failure("blob not found", vec![ErrorDetail::from(e)]),
    }
}

/// build the standard blob-data response used by blob route handlers.
pub async fn build_blob_data_response(id: &str) -> GrimoireResponse<JsonValue> {
    let (blob, maybe_data) = match get_media_blob_with_data(id).await {
        Ok(v) => v,
        Err(e) => return GrimoireResponse::failure("blob not found", vec![ErrorDetail::from(e)]),
    };

    let data = match maybe_data {
        Some(d) => d,
        None => match blob.local_path.as_deref() {
            Some(path) => match tokio::fs::read(path).await {
                Ok(bytes) => bytes,
                Err(e) => {
                    return GrimoireResponse::failure(
                        "failed to read blob file",
                        vec![ErrorDetail::new(
                            "blob_file_read_failed",
                            "failed to read blob file",
                            &format!("could not read file at {path}: {e}"),
                        )],
                    )
                }
            },
            None => {
                return GrimoireResponse::failure(
                    "blob data not found",
                    vec![ErrorDetail::new(
                        "blob_data_not_found",
                        "blob data not found",
                        "no binary data stored for this blob",
                    )],
                )
            }
        },
    };

    let base64_data = base64::engine::general_purpose::STANDARD.encode(&data);

    GrimoireResponse::success(
        "blob data",
        json!({
            "id": blob.id,
            "mime": blob.mime,
            "data": base64_data,
        }),
    )
}

/// build the standard blob-thumbnail response used by blob route handlers.
pub async fn build_blob_thumbnail_response(
    id: &str,
    target_size: u32,
) -> GrimoireResponse<JsonValue> {
    match find_existing_thumbnail(id, target_size).await {
        Some(thumb) => {
            if let Some(path) = thumb.local_path {
                GrimoireResponse::success(
                    "thumbnail path",
                    json!({
                        "id": thumb.id,
                        "path": path,
                        "mime": thumb.mime,
                        "width": thumb.width,
                        "height": thumb.height,
                    }),
                )
            } else {
                GrimoireResponse::failure(
                    "thumbnail has no local path",
                    vec![ErrorDetail::new(
                        "no_local_path",
                        "thumbnail has no local path",
                        "thumbnail stored in database",
                    )],
                )
            }
        }
        None => build_blob_path_response(id).await,
    }
}

/// build the standard blob descriptor response used by blob route handlers.
pub async fn build_blob_response(id: &str) -> GrimoireResponse<JsonValue> {
    match get_media_blob(id).await {
        Ok(blob) => {
            if let Some(path) = &blob.local_path {
                GrimoireResponse::success(
                    "blob",
                    json!({
                        "id": blob.id,
                        "path": path,
                        "mime": blob.mime,
                        "size": blob.size,
                        "filename": blob.filename,
                    }),
                )
            } else {
                GrimoireResponse::success(
                    "blob (no local path)",
                    json!({
                        "id": blob.id,
                        "mime": blob.mime,
                        "size": blob.size,
                        "filename": blob.filename,
                        "note": "blob stored in database, use HTTP for streaming",
                    }),
                )
            }
        }
        Err(e) => GrimoireResponse::failure("blob not found", vec![ErrorDetail::from(e)]),
    }
}
