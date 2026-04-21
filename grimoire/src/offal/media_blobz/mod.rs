//! media blob API handlers
//!
//! blob metadata, file paths, and thumbnails for local file access

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::blob_data::{self, find_existing_thumbnail};
use crate::error::ErrorDetail;
use crate::media_blobz::{
    find_present_blake3s, find_present_sha256s, get_media_blob, get_media_blob_by_blake3,
    BlobMetadataResponse,
};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashSet;
use zod_gen_derive::ZodSchema;

/// route metadata for media blobs (stream_blob, blob_metadata, blob_metadata_by_blake3, get_blob_thumbnail)
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "stream_blob",
        path: "/api/blobs/{id}",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "String",
        response_type: "String",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "blob_metadata",
        path: "/api/blob_metadata",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetBlobMetadataRequest",
        response_type: "BlobMetadataResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "blob_metadata_by_blake3",
        path: "/api/blob_metadata_by_blake3",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetBlobMetadataByBlake3Request",
        response_type: "BlobMetadataResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_blob_thumbnail",
        path: "/api/blobs/{id}/thumb/{size}",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "String",
        response_type: "String",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "has_blobs",
        path: "/api/blobz/has",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "HasBlobsRequest",
        response_type: "HasBlobsResponse",
        auth: RouteAuth::Authenticated,
    },
];

/// collect all route metadata from media_blobz domain
pub fn routes() -> Vec<RouteInfo> {
    ROUTES.to_vec()
}

/// dispatch media blob routes
///
/// handles: /api/blob_metadata, /api/blobs/{id}, /api/blobs/{id}/path, /api/blobs/{id}/data, /api/blobs/{id}/thumb/{size}
pub async fn dispatch(
    path: &str,
    caller: &Caller,
    body: &JsonValue,
) -> Option<GrimoireResponse<JsonValue>> {
    // exact match for blob_metadata (new POST route)
    if path == "/api/blob_metadata" {
        return Some(get_metadata(caller, body.clone()).await);
    }

    if path == "/api/blob_metadata_by_blake3" {
        return Some(get_metadata_by_blake3(caller, body.clone()).await);
    }

    if path == "/api/blobz/has" {
        return Some(has_blobs(caller, body.clone()).await);
    }

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

/// request for getting blob metadata
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetBlobMetadataRequest {
    pub id: String,
}

/// request for getting blob metadata by blake3 hash
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetBlobMetadataByBlake3Request {
    pub blake3: String,
}

/// request for `POST /api/blobz/has` — ask the server which of the supplied
/// content hashes already exist in `media_blobz`. used by the send-to-remote
/// dedupe negotiation step.
///
/// callers may pass either or both arrays. empty arrays are valid and produce
/// empty result lists.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct HasBlobsRequest {
    /// blake3 hashes for iroh-addressed audio blobs.
    #[serde(default)]
    pub blake3s: Vec<String>,
    /// sha256 hashes for content-addressed blobs (images, etc.).
    #[serde(default)]
    pub sha256s: Vec<String>,
}

/// response for `POST /api/blobz/has`. each input hash appears in exactly one
/// of the two corresponding `_present` / `_missing` lists. ordering is not
/// stable; clients should treat the lists as sets.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct HasBlobsResponse {
    pub blake3s_present: Vec<String>,
    pub blake3s_missing: Vec<String>,
    pub sha256s_present: Vec<String>,
    pub sha256s_missing: Vec<String>,
}

/// get blob metadata
///
/// path: POST /api/blob_metadata
pub async fn get_metadata(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetBlobMetadataRequest = match serde_json::from_value(body) {
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

    match get_media_blob(&req.id).await {
        Ok(blob) => GrimoireResponse::success("blob metadata", serde_json::to_value(blob).unwrap()),
        Err(e) => {
            GrimoireResponse::failure("failed to get blob metadata", vec![ErrorDetail::from(e)])
        }
    }
}

/// get blob metadata by blake3 hash
///
/// path: POST /api/blob_metadata_by_blake3
pub async fn get_metadata_by_blake3(
    _caller: &Caller,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let req: GetBlobMetadataByBlake3Request = match serde_json::from_value(body) {
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

    match get_media_blob_by_blake3(&req.blake3).await {
        Ok(blob) => {
            let response: BlobMetadataResponse = blob.into();
            GrimoireResponse::success("blob metadata", serde_json::to_value(response).unwrap())
        }
        Err(e) => GrimoireResponse::failure("blob not found by blake3", vec![ErrorDetail::from(e)]),
    }
}

/// dedupe negotiation: report which of the supplied content hashes already
/// exist locally as non-deleted media_blobz rows.
///
/// path: POST /api/blobz/has
///
/// auth: any authenticated caller (admin / member / viewer). this only leaks
/// "do you have content x?" which the caller already (presumably) sourced
/// from a peer they're allowed to talk to. no row contents are returned.
pub async fn has_blobs(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: HasBlobsRequest = match serde_json::from_value(body) {
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

    let blake3s_present = match find_present_blake3s(&req.blake3s).await {
        Ok(v) => v,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to query blake3 presence",
                vec![ErrorDetail::from(e)],
            )
        }
    };
    let sha256s_present = match find_present_sha256s(&req.sha256s).await {
        Ok(v) => v,
        Err(e) => {
            return GrimoireResponse::failure(
                "failed to query sha256 presence",
                vec![ErrorDetail::from(e)],
            )
        }
    };

    // partition into present / missing using set lookups; preserves the
    // caller's original hash strings for the missing side.
    let blake3_present_set: HashSet<&str> = blake3s_present.iter().map(String::as_str).collect();
    let sha256_present_set: HashSet<&str> = sha256s_present.iter().map(String::as_str).collect();

    let blake3s_missing: Vec<String> = req
        .blake3s
        .iter()
        .filter(|h| !blake3_present_set.contains(h.as_str()))
        .cloned()
        .collect();
    let sha256s_missing: Vec<String> = req
        .sha256s
        .iter()
        .filter(|h| !sha256_present_set.contains(h.as_str()))
        .cloned()
        .collect();

    let response = HasBlobsResponse {
        blake3s_present,
        blake3s_missing,
        sha256s_present,
        sha256s_missing,
    };
    GrimoireResponse::success("blob presence", serde_json::to_value(response).unwrap())
}

/// get blob file path for direct filesystem access (Tauri/native apps)
///
/// path: GET /api/blobs/{id}/path
///
/// returns the local filesystem path for a blob, enabling native apps
/// to load files directly via convertFileSrc() or similar mechanisms
pub async fn get_path(_caller: &Caller, id: &str, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    tracing::debug!(blob_id = %id, "offal: get_path");

    match get_media_blob(id).await {
        Ok(blob) => {
            if let Some(path) = blob.local_path {
                tracing::debug!(blob_id = %blob.id, path = %path, "offal: get_path: success");
                GrimoireResponse::success(
                    "blob path",
                    serde_json::json!({
                        "id": blob.id,
                        "path": path,
                        "mime": blob.mime,
                    }),
                )
            } else {
                tracing::debug!(blob_id = %blob.id, "offal: get_path: no local path");
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
        Err(e) => {
            tracing::warn!(blob_id = %id, error = %e, "offal: get_path: blob not found");
            GrimoireResponse::failure("blob not found", vec![ErrorDetail::from(e)])
        }
    }
}

/// get blob data as base64 (for database-stored blobs)
///
/// path: GET /api/blobs/{id}/data
///
/// returns base64-encoded blob data + mime type for blobs stored in the database.
/// Tauri apps use this as a fallback when the blob has no local filesystem path.
pub async fn get_data(_caller: &Caller, id: &str, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    let blob = match get_media_blob(id).await {
        Ok(b) => b,
        Err(e) => return GrimoireResponse::failure("blob not found", vec![ErrorDetail::from(e)]),
    };

    // get binary data from blob_data table (use actual blob ID, not sha256)
    let data_response = blob_data::get_blob_data(&blob.id).await;
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
            "id": blob.id,
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
                        "id": blob.id,
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
