//! Range request handler for static files
//!
//! This module provides enhanced static file serving with support for:
//! - HTTP Range requests (RFC 7233) for video/audio streaming
//! - Proper MIME type detection
//! - Content-Length and ETag headers
//! - Conditional requests (If-Range, If-Modified-Since)

use axum::{
    body::Body,
    extract::Request,
    http::{
        header::{
            ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG,
            IF_RANGE, LAST_MODIFIED, RANGE,
        },
        HeaderMap, HeaderValue, StatusCode,
    },
    response::{IntoResponse, Response},
};
use std::{
    fs::Metadata,
    io::SeekFrom,
    path::{Path, PathBuf},
    time::SystemTime,
};
use tokio::{
    fs::File,
    io::{AsyncReadExt, AsyncSeekExt},
};
use tower::ServiceExt;
use tower_http::services::ServeFile;

/// Range request handler that supports partial content delivery
pub struct RangeHandler {
    base_path: PathBuf,
    cache_max_age: u32,
}

/// Represents a parsed Range header
#[derive(Debug, Clone)]
pub struct ByteRange {
    pub start: u64,
    pub end: Option<u64>,
}

/// Error types for range handling
#[derive(Debug)]
pub enum RangeError {
    InvalidRange,
    UnsatisfiableRange,
    IoError(std::io::Error),
    NotFound,
}

impl RangeHandler {
    pub fn new(base_path: impl Into<PathBuf>, cache_max_age: u32) -> Self {
        Self {
            base_path: base_path.into(),
            cache_max_age,
        }
    }

    /// Main handler for static file requests with range support
    pub async fn handle_request(&self, req: Request) -> Result<Response, RangeError> {
        let path = req.uri().path();
        let file_path = self.resolve_path(path)?;

        // Check if file exists and get metadata
        let metadata = match tokio::fs::metadata(&file_path).await {
            Ok(meta) => meta,
            Err(_) => return Err(RangeError::NotFound),
        };

        // Generate ETag from file metadata
        let etag = self.generate_etag(&metadata);

        // Check if this is a range request
        if let Some(_range_header) = req.headers().get(RANGE) {
            self.handle_range_request(req, file_path, metadata, etag)
                .await
        } else {
            self.handle_full_request(req, file_path, metadata, etag)
                .await
        }
    }

    /// Handle a full file request (no ranges)
    async fn handle_full_request(
        &self,
        req: Request,
        file_path: PathBuf,
        metadata: Metadata,
        etag: String,
    ) -> Result<Response<Body>, RangeError> {
        // Use tower-http's ServeFile for full requests as it's optimized
        let serve_file = ServeFile::new(&file_path);

        match serve_file.oneshot(req).await {
            Ok(response) => {
                let (parts, _body) = response.into_parts();
                let mut response = Response::from_parts(parts, Body::empty());
                self.add_common_headers(response.headers_mut(), &metadata, &etag);
                Ok(response)
            }
            Err(_) => Err(RangeError::NotFound),
        }
    }

    /// Handle a range request for partial content
    async fn handle_range_request(
        &self,
        req: Request,
        file_path: PathBuf,
        metadata: Metadata,
        etag: String,
    ) -> Result<Response<Body>, RangeError> {
        let file_size = metadata.len();
        let range_header = req.headers().get(RANGE).unwrap();

        // Parse the range header
        let ranges = self.parse_range_header(range_header, file_size)?;

        // For simplicity, we only support single ranges for now
        // Multi-part ranges would require multipart/byteranges content type
        if ranges.len() != 1 {
            return Err(RangeError::UnsatisfiableRange);
        }

        let range = &ranges[0];
        let start = range.start;
        let end = range.end.unwrap_or(file_size - 1);

        // Validate range
        if start >= file_size || end >= file_size || start > end {
            return Err(RangeError::UnsatisfiableRange);
        }

        // Check If-Range header for conditional requests
        if let Some(if_range) = req.headers().get(IF_RANGE) {
            if !self.validate_if_range(if_range, &etag, &metadata) {
                // If-Range validation failed, serve full content
                return self
                    .handle_full_request(req, file_path, metadata, etag)
                    .await;
            }
        }

        // Open file and seek to start position
        let mut file = File::open(&file_path).await.map_err(RangeError::IoError)?;
        file.seek(SeekFrom::Start(start))
            .await
            .map_err(RangeError::IoError)?;

        // Read the requested range
        let content_length = end - start + 1;
        let mut buffer = vec![0; content_length as usize];
        file.read_exact(&mut buffer)
            .await
            .map_err(RangeError::IoError)?;

        // Build response
        let mut response = Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .body(Body::from(buffer))
            .unwrap();

        let headers = response.headers_mut();
        self.add_common_headers(headers, &metadata, &etag);

        // Add range-specific headers
        headers.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
        headers.insert(CONTENT_LENGTH, HeaderValue::from(content_length));
        headers.insert(
            CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {}-{}/{}", start, end, file_size)).unwrap(),
        );

        Ok(response)
    }

    /// Parse Range header into ByteRange structs
    fn parse_range_header(
        &self,
        range_header: &HeaderValue,
        file_size: u64,
    ) -> Result<Vec<ByteRange>, RangeError> {
        let range_str = range_header
            .to_str()
            .map_err(|_| RangeError::InvalidRange)?;

        if !range_str.starts_with("bytes=") {
            return Err(RangeError::InvalidRange);
        }

        let ranges_str = &range_str[6..]; // Remove "bytes="
        let mut ranges = Vec::new();

        for range_part in ranges_str.split(',') {
            let range_part = range_part.trim();

            if range_part.starts_with('-') {
                // Suffix range: -500 (last 500 bytes)
                let suffix_length: u64 = range_part[1..]
                    .parse()
                    .map_err(|_| RangeError::InvalidRange)?;

                if suffix_length > 0 && suffix_length <= file_size {
                    ranges.push(ByteRange {
                        start: file_size - suffix_length,
                        end: Some(file_size - 1),
                    });
                }
            } else if range_part.ends_with('-') {
                // Prefix range: 500- (from byte 500 to end)
                let start: u64 = range_part[..range_part.len() - 1]
                    .parse()
                    .map_err(|_| RangeError::InvalidRange)?;

                if start < file_size {
                    ranges.push(ByteRange {
                        start,
                        end: Some(file_size - 1),
                    });
                }
            } else if let Some(dash_pos) = range_part.find('-') {
                // Full range: 500-999
                let start: u64 = range_part[..dash_pos]
                    .parse()
                    .map_err(|_| RangeError::InvalidRange)?;
                let end: u64 = range_part[dash_pos + 1..]
                    .parse()
                    .map_err(|_| RangeError::InvalidRange)?;

                if start <= end && start < file_size {
                    ranges.push(ByteRange {
                        start,
                        end: Some(end.min(file_size - 1)),
                    });
                }
            }
        }

        if ranges.is_empty() {
            Err(RangeError::UnsatisfiableRange)
        } else {
            Ok(ranges)
        }
    }

    /// Add common headers to all responses
    fn add_common_headers(&self, headers: &mut HeaderMap, metadata: &Metadata, etag: &str) {
        // MIME type detection
        let mime_type = self.detect_mime_type(&self.base_path);
        headers.insert(CONTENT_TYPE, HeaderValue::from_str(&mime_type).unwrap());

        // Cache headers
        headers.insert(
            CACHE_CONTROL,
            HeaderValue::from_str(&format!("public, max-age={}", self.cache_max_age)).unwrap(),
        );

        // ETag for caching
        headers.insert(ETAG, HeaderValue::from_str(etag).unwrap());

        // Last-Modified
        if let Ok(modified) = metadata.modified() {
            let http_date = httpdate::fmt_http_date(modified);
            headers.insert(LAST_MODIFIED, HeaderValue::from_str(&http_date).unwrap());
        }

        // Accept ranges for all responses
        headers.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    }

    /// Detect MIME type based on file extension
    fn detect_mime_type(&self, path: &Path) -> String {
        mime_guess::from_path(path)
            .first_or_octet_stream()
            .to_string()
    }

    /// Generate ETag from file metadata
    fn generate_etag(&self, metadata: &Metadata) -> String {
        let size = metadata.len();
        let modified = metadata
            .modified()
            .unwrap_or(SystemTime::UNIX_EPOCH)
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        format!("\"{}--{}\"", size, modified)
    }

    /// Validate If-Range header
    fn validate_if_range(&self, if_range: &HeaderValue, etag: &str, metadata: &Metadata) -> bool {
        let if_range_str = if_range.to_str().unwrap_or("");

        // Check if it's an ETag
        if if_range_str.starts_with('"') && if_range_str.ends_with('"') {
            if_range_str == etag
        } else {
            // Check if it's a date
            if let Ok(if_range_date) = httpdate::parse_http_date(if_range_str) {
                if let Ok(last_modified) = metadata.modified() {
                    last_modified <= if_range_date
                } else {
                    false
                }
            } else {
                false
            }
        }
    }

    /// Resolve and validate file path
    fn resolve_path(&self, request_path: &str) -> Result<PathBuf, RangeError> {
        // Remove leading slash and resolve path
        let clean_path = request_path.trim_start_matches('/');
        let mut full_path = self.base_path.clone();
        full_path.push(clean_path);

        // Normalize path to prevent directory traversal
        let canonical = full_path.canonicalize().map_err(|_| RangeError::NotFound)?;

        // Ensure the canonical path is still within base_path
        if !canonical.starts_with(&self.base_path) {
            return Err(RangeError::NotFound);
        }

        Ok(canonical)
    }
}

impl IntoResponse for RangeError {
    fn into_response(self) -> Response {
        let (status, message) = match self {
            RangeError::InvalidRange => (StatusCode::BAD_REQUEST, "Invalid Range"),
            RangeError::UnsatisfiableRange => {
                (StatusCode::RANGE_NOT_SATISFIABLE, "Range Not Satisfiable")
            }
            RangeError::IoError(_) => (StatusCode::INTERNAL_SERVER_ERROR, "IO Error"),
            RangeError::NotFound => (StatusCode::NOT_FOUND, "Not Found"),
        };

        (status, message).into_response()
    }
}

use httpdate;
