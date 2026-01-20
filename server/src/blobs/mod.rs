//! blob streaming handlers with HTTP range request support (RFC 7233)
//!
//! serves media blobs from two sources:
//! - local filesystem (blob.local_path) for large audio/video files
//! - sqlite database (blob_data table) for small files like thumbnails
//!
//! supports efficient streaming with:
//! - range requests for seeking in media players
//! - proper content-type detection
//! - etag-based caching
//! - partial content (206) responses

use axum::{
    body::Body,
    extract::{Path, Request},
    http::{
        header::{
            ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE,
        },
        HeaderValue, StatusCode,
    },
    response::{IntoResponse, Json, Response},
    Extension,
};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::media_blobz::{get_media_blob_with_data, BlobMetadataResponse};
use std::io::SeekFrom;
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt},
};

use crate::{auth::AuthenticatedUser, error::ApiError};

inventory::submit! {
    RouteInfo {
        name: "stream_blob",
        path: "/api/blobs/{id}",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "String",
        response_type: "String", // binary response, not typed
    }
}

inventory::submit! {
    RouteInfo {
        name: "blob_metadata",
        path: "/api/blobs/{id}/metadata",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "String",
        response_type: "BlobMetadataResponse",
    }
}

/// stream blob with range request support
///
/// GET /api/blobs/{id}
pub async fn stream_blob_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Path(blob_id): Path<String>,
    req: Request,
) -> Result<Response, ApiError> {
    tracing::debug!(
        blob_id = %blob_id,
        has_range = req.headers().contains_key(RANGE),
        "streaming blob"
    );

    // get blob metadata and data (if in database)
    let (blob, db_data) = get_media_blob_with_data(&blob_id)
        .await
        .map_err(|_| ApiError::NotFound)?;

    let content_type = blob
        .mime
        .clone()
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let size = blob.size.unwrap_or(0) as u64;

    // determine data source and stream
    if let Some(local_path) = blob.local_path {
        // stream from filesystem
        stream_from_file(local_path, size, content_type, req).await
    } else if let Some(data) = db_data {
        // stream from memory (database)
        stream_from_memory(data, content_type, req).await
    } else {
        Err(ApiError::NotFound)
    }
}

/// blob metadata with sha256 for download deduplication
///
/// GET /api/blobs/{id}/metadata
pub async fn blob_metadata_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Path(blob_id): Path<String>,
) -> Result<impl IntoResponse, ApiError> {
    let blob = grimoire::media_blobz::get_media_blob(&blob_id)
        .await
        .map_err(|_| ApiError::NotFound)?;

    let response: BlobMetadataResponse = blob.into();

    Ok(Json(response))
}

// ============================================================================
// File Streaming
// ============================================================================

/// stream file from filesystem with range support
async fn stream_from_file(
    local_path: String,
    size: u64,
    content_type: String,
    req: Request,
) -> Result<Response, ApiError> {
    let path = std::path::PathBuf::from(&local_path);

    if !path.exists() {
        return Err(ApiError::NotFound);
    }

    // check for range header
    if let Some(range_header) = req.headers().get(RANGE) {
        stream_file_range(path, size, content_type, range_header).await
    } else {
        stream_file_full(path, size, content_type).await
    }
}

/// stream entire file (no range)
async fn stream_file_full(
    path: std::path::PathBuf,
    size: u64,
    content_type: String,
) -> Result<Response, ApiError> {
    let mut file = File::open(&path)
        .await
        .map_err(|_| ApiError::Internal("failed to open file".to_string()))?;

    let mut buffer = Vec::new();
    file.read_to_end(&mut buffer)
        .await
        .map_err(|_| ApiError::Internal("failed to read file".to_string()))?;

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, content_type)
        .header(CONTENT_LENGTH, size)
        .header(ACCEPT_RANGES, "bytes")
        .header(CACHE_CONTROL, "public, max-age=2592000")
        .body(Body::from(buffer))
        .unwrap();

    Ok(response)
}

/// stream file with range request
async fn stream_file_range(
    path: std::path::PathBuf,
    file_size: u64,
    content_type: String,
    range_header: &HeaderValue,
) -> Result<Response, ApiError> {
    // parse range header
    let (start, end) = parse_range_header(range_header, file_size)?;

    // validate range
    if start >= file_size || end >= file_size || start > end {
        return Err(ApiError::BadRequest("unsatisfiable range".to_string()));
    }

    // open file and seek to start
    let mut file = File::open(&path)
        .await
        .map_err(|_| ApiError::Internal("failed to open file".to_string()))?;

    file.seek(SeekFrom::Start(start))
        .await
        .map_err(|_| ApiError::Internal("failed to seek file".to_string()))?;

    // read requested range
    let content_length = end - start + 1;
    let mut buffer = vec![0; content_length as usize];
    file.read_exact(&mut buffer)
        .await
        .map_err(|_| ApiError::Internal("failed to read file".to_string()))?;

    // build 206 partial content response
    let response = Response::builder()
        .status(StatusCode::PARTIAL_CONTENT)
        .header(CONTENT_TYPE, content_type)
        .header(CONTENT_LENGTH, content_length)
        .header(ACCEPT_RANGES, "bytes")
        .header(
            CONTENT_RANGE,
            format!("bytes {}-{}/{}", start, end, file_size),
        )
        .header(CACHE_CONTROL, "public, max-age=2592000")
        .body(Body::from(buffer))
        .unwrap();

    Ok(response)
}

// ============================================================================
// Memory Streaming (Database Blobs)
// ============================================================================

/// stream data from memory with range support
async fn stream_from_memory(
    data: Vec<u8>,
    content_type: String,
    req: Request,
) -> Result<Response, ApiError> {
    // check for range header
    if let Some(range_header) = req.headers().get(RANGE) {
        stream_memory_range(data, content_type, range_header).await
    } else {
        stream_memory_full(data, content_type).await
    }
}

/// stream entire data from memory (no range)
async fn stream_memory_full(data: Vec<u8>, content_type: String) -> Result<Response, ApiError> {
    let size = data.len();

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, content_type)
        .header(CONTENT_LENGTH, size)
        .header(ACCEPT_RANGES, "bytes")
        .header(CACHE_CONTROL, "public, max-age=2592000")
        .body(Body::from(data))
        .unwrap();

    Ok(response)
}

/// stream data from memory with range request
async fn stream_memory_range(
    data: Vec<u8>,
    content_type: String,
    range_header: &HeaderValue,
) -> Result<Response, ApiError> {
    let size = data.len() as u64;

    // parse range header
    let (start, end) = parse_range_header(range_header, size)?;

    // validate range
    if start >= size || end >= size || start > end {
        return Err(ApiError::BadRequest("unsatisfiable range".to_string()));
    }

    // extract requested range
    let range_data = data[start as usize..=end as usize].to_vec();
    let content_length = range_data.len();

    // build 206 partial content response
    let response = Response::builder()
        .status(StatusCode::PARTIAL_CONTENT)
        .header(CONTENT_TYPE, content_type)
        .header(CONTENT_LENGTH, content_length)
        .header(ACCEPT_RANGES, "bytes")
        .header(CONTENT_RANGE, format!("bytes {}-{}/{}", start, end, size))
        .header(CACHE_CONTROL, "public, max-age=2592000")
        .body(Body::from(range_data))
        .unwrap();

    Ok(response)
}

// ============================================================================
// Range Parsing
// ============================================================================

/// parse range header into (start, end) byte positions
/// only supports single ranges (not multipart)
fn parse_range_header(range_header: &HeaderValue, file_size: u64) -> Result<(u64, u64), ApiError> {
    let range_str = range_header
        .to_str()
        .map_err(|_| ApiError::BadRequest("invalid range header".to_string()))?;

    if !range_str.starts_with("bytes=") {
        return Err(ApiError::BadRequest("invalid range format".to_string()));
    }

    let range_part = &range_str[6..].trim();

    // handle suffix range: -500 (last 500 bytes)
    if range_part.starts_with('-') {
        let suffix_length: u64 = range_part[1..]
            .parse()
            .map_err(|_| ApiError::BadRequest("invalid range".to_string()))?;

        if suffix_length > 0 && suffix_length <= file_size {
            return Ok((file_size - suffix_length, file_size - 1));
        } else {
            return Err(ApiError::BadRequest("unsatisfiable range".to_string()));
        }
    }

    // handle prefix range: 500- (from byte 500 to end)
    if range_part.ends_with('-') {
        let start: u64 = range_part[..range_part.len() - 1]
            .parse()
            .map_err(|_| ApiError::BadRequest("invalid range".to_string()))?;

        if start < file_size {
            return Ok((start, file_size - 1));
        } else {
            return Err(ApiError::BadRequest("unsatisfiable range".to_string()));
        }
    }

    // handle full range: 500-999
    if let Some(dash_pos) = range_part.find('-') {
        let start: u64 = range_part[..dash_pos]
            .parse()
            .map_err(|_| ApiError::BadRequest("invalid range".to_string()))?;
        let end: u64 = range_part[dash_pos + 1..]
            .parse()
            .map_err(|_| ApiError::BadRequest("invalid range".to_string()))?;

        if start <= end && start < file_size {
            return Ok((start, end.min(file_size - 1)));
        }
    }

    Err(ApiError::BadRequest("invalid range".to_string()))
}
