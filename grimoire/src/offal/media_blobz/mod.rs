//! media blob API handlers
//!
//! blob metadata, file paths, and thumbnails for local file access

use crate::blob_data::{self, find_existing_thumbnail};
use crate::error::ErrorDetail;
use crate::media_blobz::get_media_blob;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use base64::Engine;
use serde_json::Value as JsonValue;

/// dispatch media blob routes
///
/// handles: /api/blobs/{id}, /api/blobs/{id}/path, /api/blobs/{id}/data, /api/blobs/{id}/metadata, /api/blobs/{id}/thumb/{size}
pub async fn dispatch(
    path: &str,
    caller: &Caller,
    body: &JsonValue,
) -> Option<GrimoireResponse<JsonValue>> {
    let rest = path.strip_prefix("/api/blobs/")?;

    // /api/blobs/{id}/path - get filesystem path
    if rest.ends_with("/path") {
        let id = rest.strip_suffix("/path").unwrap();
        return Some(get_path(caller, id, body.clone()).await);
    }

    // /api/blobs/{id}/data - get base64-encoded blob data (for db-stored blobs)
    if rest.ends_with("/data") {
        let id = rest.strip_suffix("/data").unwrap();
        return Some(get_data(caller, id, body.clone()).await);
    }

    // /api/blobs/{id}/metadata - get blob metadata
    if rest.ends_with("/metadata") {
        let id = rest.strip_suffix("/metadata").unwrap();
        return Some(get_metadata(caller, id, body.clone()).await);
    }

    // /api/blobs/{id}/thumb/{size} - get thumbnail info
    if rest.contains("/thumb/") {
        let parts: Vec<&str> = rest.split("/thumb/").collect();
        if parts.len() == 2 {
            let id = parts[0];
            let size = parts[1];
            return Some(get_thumbnail(caller, id, size, body.clone()).await);
        }
    }

    // /api/blobs/{id} - get blob (returns path for local access)
    Some(get_blob(caller, rest, body.clone()).await)
}

/// get blob metadata
///
/// path: GET /api/blobs/{id}/metadata
pub async fn get_metadata(
    _caller: &Caller,
    id: &str,
    _body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    match get_media_blob(id).await {
        Ok(blob) => GrimoireResponse::success("blob metadata", serde_json::to_value(blob).unwrap()),
        Err(e) => {
            GrimoireResponse::failure("failed to get blob metadata", vec![ErrorDetail::from(e)])
        }
    }
}

/// get blob file path for direct filesystem access (Tauri/native apps)
///
/// path: GET /api/blobs/{id}/path
///
/// returns the local filesystem path for a blob, enabling native apps
/// to load files directly via convertFileSrc() or similar mechanisms
pub async fn get_path(_caller: &Caller, id: &str, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    match get_media_blob(id).await {
        Ok(blob) => {
            if let Some(path) = blob.local_path {
                GrimoireResponse::success(
                    "blob path",
                    serde_json::json!({
                        "id": id,
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

/// get blob data as base64 (for database-stored blobs)
///
/// path: GET /api/blobs/{id}/data
///
/// returns base64-encoded blob data + mime type for blobs stored in the database.
/// Tauri apps use this as a fallback when the blob has no local filesystem path.
pub async fn get_data(_caller: &Caller, id: &str, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    // first get metadata for mime type
    let blob = match get_media_blob(id).await {
        Ok(b) => b,
        Err(e) => return GrimoireResponse::failure("blob not found", vec![ErrorDetail::from(e)]),
    };

    // get binary data from blob_data table
    let data_response = blob_data::get_blob_data(id).await;
    if !data_response.success {
        return GrimoireResponse::failure(
            "failed to get blob data",
            data_response
                .errors
                .into_iter()
                .map(ErrorDetail::from)
                .collect(),
        );
    }

    let data = match data_response.data {
        Some(d) => d,
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
    };

    // encode as base64
    let base64_data = base64::engine::general_purpose::STANDARD.encode(&data);

    GrimoireResponse::success(
        "blob data",
        serde_json::json!({
            "id": id,
            "mime": blob.mime,
            "data": base64_data,
        }),
    )
}

/// get blob thumbnail path (path params: id and size)
///
/// path: GET /api/blobs/{id}/thumb/{size}
///
/// returns thumbnail path if available, or original blob path
pub async fn get_thumbnail(
    _caller: &Caller,
    id: &str,
    size: &str,
    _body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    // parse size as u32
    let target_size: u32 = size.parse().unwrap_or(200);

    // try to find a thumbnail of the requested size for this blob
    match find_existing_thumbnail(id, target_size).await {
        Some(thumb) => {
            if let Some(path) = thumb.local_path {
                GrimoireResponse::success(
                    "thumbnail path",
                    serde_json::json!({
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
        None => {
            // no thumbnail found, fall back to original blob path
            get_path(_caller, id, _body).await
        }
    }
}

/// get blob - returns path for local filesystem access
///
/// path: GET /api/blobs/{id}
///
/// for Tauri/native apps, returns file path instead of streaming bytes
pub async fn get_blob(_caller: &Caller, id: &str, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    match get_media_blob(id).await {
        Ok(blob) => {
            if let Some(path) = &blob.local_path {
                GrimoireResponse::success(
                    "blob",
                    serde_json::json!({
                        "id": id,
                        "path": path,
                        "mime": blob.mime,
                        "size": blob.size,
                        "filename": blob.filename,
                    }),
                )
            } else {
                // blob stored in database - return metadata without path
                GrimoireResponse::success(
                    "blob (no local path)",
                    serde_json::json!({
                        "id": id,
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
