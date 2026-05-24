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
            ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG,
            IF_NONE_MATCH, RANGE,
        },
        HeaderValue, Method, StatusCode,
    },
    response::Response,
    Extension,
};
use grimoire::media_blobz::get_media_blob_with_data;
use std::io::SeekFrom;
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt},
};
use tokio_util::io::ReaderStream;

use crate::{auth::AuthenticatedUser, error::ApiError};

/// chunk size for streaming media file bodies. larger chunks = fewer
/// syscalls + lower per-byte overhead, but also higher memory per
/// in-flight request. 64 KiB is a good balance for audio: webkit / chrome
/// typically request ~2 MiB chunks via Range, so each request resolves in
/// ~32 reads.
const STREAM_CHUNK_SIZE: usize = 64 * 1024;

// ============================================================================
// ETag + HEAD helpers
// ============================================================================

/// build a quoted strong etag from a content sha256.
///
/// blobs are content-addressed so the sha256 *is* the etag. quoted form
/// per RFC 7232 \u00a72.3.
fn format_etag(sha256: &str) -> String {
    format!("\"{}\"", sha256)
}

/// check whether the request's `If-None-Match` matches our etag.
///
/// supports `*` (match anything) and exact-string match. ignores weak/strong
/// distinction since our etags are always strong.
fn etag_matches(req: &Request, etag: &str) -> bool {
    let Some(header) = req.headers().get(IF_NONE_MATCH) else {
        return false;
    };
    let Ok(value) = header.to_str() else {
        return false;
    };
    let value = value.trim();
    if value == "*" {
        return true;
    }
    // value may be a comma-separated list. split and compare each entry.
    value
        .split(',')
        .map(str::trim)
        .any(|entry| entry == etag || entry.trim_start_matches("W/") == etag)
}

/// build a 304 Not Modified response (empty body, etag echoed back).
fn not_modified_response(etag: &str) -> Response {
    Response::builder()
        .status(StatusCode::NOT_MODIFIED)
        .header(ETAG, etag)
        .header(CACHE_CONTROL, "public, max-age=2592000")
        .body(Body::empty())
        .unwrap()
}

/// build a HEAD response: same headers as a full GET would have, but no
/// body and no file IO. lets webkit probe Content-Length + Accept-Ranges
/// before issuing a Range GET.
fn head_response(size: u64, content_type: &str, etag: &str) -> Response {
    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, content_type)
        .header(CONTENT_LENGTH, size)
        .header(ACCEPT_RANGES, "bytes")
        .header(CACHE_CONTROL, "public, max-age=2592000")
        .header(ETAG, etag)
        .body(Body::empty())
        .unwrap()
}

/// stream blob with range request support
///
/// GET /api/blobs/{id}
/// HEAD /api/blobs/{id}  -- returns headers only, no body, no file IO
pub async fn stream_blob_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    Path(blob_id): Path<String>,
    req: Request,
) -> Result<Response, ApiError> {
    tracing::debug!(
        blob_id = %blob_id,
        method = %req.method(),
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

    // content-addressed etag — sha256 is stable and unique per blob version.
    // wrapped in quotes per RFC 7232. lets webkit's media cache revalidate
    // (cheap 304) instead of re-streaming on `audio.src` reassignment.
    let etag = format_etag(&blob.sha256);

    // 304 Not Modified short-circuit: skip ALL data work if the client
    // already has this exact blob cached.
    if etag_matches(&req, &etag) {
        return Ok(not_modified_response(&etag));
    }

    // HEAD short-circuit: respond with headers only, no body, no file IO.
    // webkit issues this to probe Content-Length + Accept-Ranges before a
    // Range GET; without explicit handling axum returns 405 and webkit may
    // fall back to non-range full-body GETs (the stutter path).
    if req.method() == Method::HEAD {
        return Ok(head_response(size, &content_type, &etag));
    }

    // determine data source and stream
    if let Some(local_path) = blob.local_path {
        // stream from filesystem
        stream_from_file(local_path, size, content_type, &etag, req).await
    } else if let Some(data) = db_data {
        // stream from memory (database)
        stream_from_memory(data, content_type, &etag, req).await
    } else {
        Err(ApiError::NotFound)
    }
}

/// get or generate a sized thumbnail for a blob
///
/// GET /api/blobs/{id}/thumb/{size}
///
/// size must be one of the configured thumbnail sizes (default: 50 or 200 pixels)
/// if on-demand generation is enabled, creates thumbnail if it doesn't exist
/// if on-demand is disabled, returns 404 if thumbnail doesn't exist
pub async fn blob_thumbnail_handler(
    Extension(user): Extension<AuthenticatedUser>,
    Path((blob_id, size_str)): Path<(String, String)>,
    req: Request,
) -> Result<Response, ApiError> {
    // parse size parameter
    let size: u32 = size_str
        .parse()
        .map_err(|_| ApiError::BadRequest("invalid size parameter".to_string()))?;

    // validate size is one of the configured values
    if !grimoire::blob_data::is_valid_size(size) {
        return Err(ApiError::BadRequest(format!(
            "size must be one of: {:?}",
            grimoire::blob_data::get_thumbnail_sizes()
        )));
    }

    // get or generate the thumbnail based on config
    let thumb_blob_id = if grimoire::blob_data::is_on_demand_enabled() {
        // on-demand enabled: generate if needed
        grimoire::blob_data::get_or_generate_thumbnail(&blob_id, size, Some(user.user_id.clone()))
            .await
            .map_err(|e| ApiError::Internal(format!("thumbnail generation failed: {}", e)))?
    } else {
        // on-demand disabled: only return existing thumbnail
        grimoire::blob_data::find_existing_thumbnail(&blob_id, size)
            .await
            .map(|b| b.id)
            .ok_or(ApiError::NotFound)?
    };

    // stream the thumbnail blob
    let (blob, db_data) = grimoire::media_blobz::get_media_blob_with_data(&thumb_blob_id)
        .await
        .map_err(|_| ApiError::NotFound)?;

    let content_type = blob
        .mime
        .clone()
        .unwrap_or_else(|| "image/webp".to_string());

    // content-addressed etag from sha256 (RFC 7232 quoted form). enables
    // 304 short-circuit on revalidation - cheap for thumbnails which the
    // ui re-requests on every list re-render.
    let etag = format_etag(&blob.sha256);

    if etag_matches(&req, &etag) {
        return Ok(not_modified_response(&etag));
    }

    if req.method() == Method::HEAD {
        let size = blob.size.unwrap_or(0) as u64;
        return Ok(head_response(size, &content_type, &etag));
    }

    // thumbnails are always in database (not local files)
    if let Some(data) = db_data {
        stream_from_memory(data, content_type, &etag, req).await
    } else {
        Err(ApiError::NotFound)
    }
}

// ============================================================================
// File Streaming
// ============================================================================

/// stream file from filesystem with range support
async fn stream_from_file(
    local_path: String,
    size: u64,
    content_type: String,
    etag: &str,
    req: Request,
) -> Result<Response, ApiError> {
    let path = std::path::PathBuf::from(&local_path);

    if !path.exists() {
        return Err(ApiError::NotFound);
    }

    // check for range header
    if let Some(range_header) = req.headers().get(RANGE) {
        stream_file_range(path, size, content_type, etag, range_header).await
    } else {
        stream_file_full(path, size, content_type, etag).await
    }
}

/// stream entire file (no range)
///
/// uses chunked streaming via `ReaderStream` so the first byte hits the
/// wire immediately (no full read-into-Vec stall) and memory usage stays
/// flat regardless of file size. critical for `<audio>` on linux/webkitgtk
/// where high time-to-first-byte causes the gstreamer decoder to underrun
/// and audibly stutter.
async fn stream_file_full(
    path: std::path::PathBuf,
    size: u64,
    content_type: String,
    etag: &str,
) -> Result<Response, ApiError> {
    let file = File::open(&path)
        .await
        .map_err(|_| ApiError::Internal("failed to open file".to_string()))?;

    let stream = ReaderStream::with_capacity(file, STREAM_CHUNK_SIZE);
    let body = Body::from_stream(stream);

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, content_type)
        .header(CONTENT_LENGTH, size)
        .header(ACCEPT_RANGES, "bytes")
        .header(CACHE_CONTROL, "public, max-age=2592000")
        .header(ETAG, etag)
        .body(body)
        .unwrap();

    Ok(response)
}

/// stream file with range request
///
/// like `stream_file_full`, this streams the requested byte range in
/// chunks via `ReaderStream` instead of reading the whole range into a
/// `Vec` first.
async fn stream_file_range(
    path: std::path::PathBuf,
    file_size: u64,
    content_type: String,
    etag: &str,
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

    let content_length = end - start + 1;

    // limit the reader to exactly content_length bytes so we don't stream
    // past the requested range.
    let limited = file.take(content_length);
    let stream = ReaderStream::with_capacity(limited, STREAM_CHUNK_SIZE);
    let body = Body::from_stream(stream);

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
        .header(ETAG, etag)
        .body(body)
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
    etag: &str,
    req: Request,
) -> Result<Response, ApiError> {
    // check for range header
    if let Some(range_header) = req.headers().get(RANGE) {
        stream_memory_range(data, content_type, etag, range_header).await
    } else {
        stream_memory_full(data, content_type, etag).await
    }
}

/// stream entire data from memory (no range)
async fn stream_memory_full(
    data: Vec<u8>,
    content_type: String,
    etag: &str,
) -> Result<Response, ApiError> {
    let size = data.len();

    let response = Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, content_type)
        .header(CONTENT_LENGTH, size)
        .header(ACCEPT_RANGES, "bytes")
        .header(CACHE_CONTROL, "public, max-age=2592000")
        .header(ETAG, etag)
        .body(Body::from(data))
        .unwrap();

    Ok(response)
}

/// stream data from memory with range request
async fn stream_memory_range(
    data: Vec<u8>,
    content_type: String,
    etag: &str,
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
        .header(ETAG, etag)
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

// ============================================================================
// Atlas (batched thumbnail packing) for the graph view
// ============================================================================

/// POST `/api/blobs/atlas` \u2014 pack a batch of pre-existing thumbnails into a
/// single image so the graph view can issue one request per ~100 nodes
/// instead of one per node.
///
/// wire format (response body, `application/octet-stream`):
///
/// ```text
/// [u32 LE manifest_len][manifest_len bytes JSON][image bytes ...]
/// ```
///
/// the manifest JSON is `AtlasManifest`; the image bytes are a webp
/// containing a tightly-packed grid of the resolved thumbs. ids the
/// server can't resolve are listed in `manifest.missing` and occupy no
/// cell. see `grimoire::media_blobz::atlas` for details.
///
/// auth: required (this is in the protected blob_routes group).
pub async fn build_atlas_handler(
    Extension(_user): Extension<AuthenticatedUser>,
    axum::Json(req): axum::Json<grimoire::media_blobz::BuildAtlasRequest>,
) -> Result<Response, ApiError> {
    let resp = grimoire::media_blobz::build_atlas_response(req)
        .await
        .map_err(|e| ApiError::BadRequest(format!("atlas build failed: {e}")))?;

    let manifest_json = serde_json::to_vec(&resp.manifest)
        .map_err(|e| ApiError::Internal(format!("manifest serialize failed: {e}")))?;

    let manifest_len = u32::try_from(manifest_json.len())
        .map_err(|_| ApiError::Internal("manifest too large for u32 length prefix".to_string()))?;

    // single contiguous buffer to keep the response Body a single chunk.
    // manifest is small (~100 entries * ~32 bytes), image dominates.
    let mut body = Vec::with_capacity(4 + manifest_json.len() + resp.image_bytes.len());
    body.extend_from_slice(&manifest_len.to_le_bytes());
    body.extend_from_slice(&manifest_json);
    body.extend_from_slice(&resp.image_bytes);

    Response::builder()
        .status(StatusCode::OK)
        .header(CONTENT_TYPE, "application/octet-stream")
        .header(CONTENT_LENGTH, body.len())
        // atlas pages are content-derived from a request-specific id list;
        // safe to cache aggressively on the client side. no etag yet \u2014
        // would need to hash (sorted ids, size) to be meaningful.
        .header(CACHE_CONTROL, "private, max-age=3600")
        .body(Body::from(body))
        .map_err(|e| ApiError::Internal(format!("atlas response build failed: {e}")))
}
