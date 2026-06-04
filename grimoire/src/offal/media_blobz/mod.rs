//! media blob API handlers
//!
//! blob metadata, file paths, and thumbnails for local file access

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::media_blobz::{
    build_blob_data_response, build_blob_path_response, build_blob_response,
    build_blob_thumbnail_response, find_present_blake3s, find_present_sha256s, get_media_blob,
    get_media_blob_by_blake3, BlobMetadataResponse,
};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
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
    // atlas-packed thumbnail batches for the graph view. response is a
    // binary wire format ([u32 le manifest_len][manifest JSON][image bytes]),
    // not JSON — the server has a custom handler that bypasses offal
    // dispatch. the route is still registered here so codegen + auth
    // gating stay consistent with the rest of the surface.
    RouteInfo {
        name: "build_atlas",
        path: "/api/blobs/atlas",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "BuildAtlasRequest",
        response_type: "AtlasManifest",
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

    tracing::debug!(
        "blobz/has: asked about {} blake3s, {} sha256s",
        req.blake3s.len(),
        req.sha256s.len(),
    );

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
    tracing::debug!(
        "blobz/has: blake3 {}/{} present; sha256 {}/{} present",
        response.blake3s_present.len(),
        req.blake3s.len(),
        response.sha256s_present.len(),
        req.sha256s.len(),
    );
    GrimoireResponse::success("blob presence", serde_json::to_value(response).unwrap())
}

/// get blob file path for direct filesystem access (Tauri/native apps)
///
/// path: GET /api/blobs/{id}/path
///
/// returns the local filesystem path for a blob, enabling native apps
/// to load files directly via convertFileSrc() or similar mechanisms
pub async fn get_path(_caller: &Caller, id: &str, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    build_blob_path_response(id).await
}

/// get blob data as base64 (for database-stored blobs)
///
/// path: GET /api/blobs/{id}/data
///
/// returns base64-encoded blob data + mime type for blobs stored in the database.
/// Tauri apps use this as a fallback when the blob has no local filesystem path.
pub async fn get_data(_caller: &Caller, id: &str, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    build_blob_data_response(id).await
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
    let target_size: u32 = size.parse().unwrap_or(200);
    build_blob_thumbnail_response(id, target_size).await
}

/// get blob - returns path for local filesystem access
///
/// path: GET /api/blobs/{id}
///
/// for Tauri/native apps, returns file path instead of streaming bytes
pub async fn get_blob(_caller: &Caller, id: &str, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    build_blob_response(id).await
}
