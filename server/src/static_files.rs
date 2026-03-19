//! static file serving with range request support
//!
//! production-ready static file handler using tower-http with:
//! - range requests (RFC 7233) for media streaming
//! - compression (gzip, brotli)
//! - cache headers with sensible defaults
//! - etag support for conditional requests
//! - path traversal protection
//!
//! note: the `RangeHandler` implementation can be reused for media blob streaming.
//! the range parsing, validation, and partial content delivery logic is generic
//! and works with any file-like data source.

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
    response::Response,
    Extension,
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

use crate::{error::ApiError, state::AppState};

/// serve static file handler with range request support
///
/// when `directory` is set, serves files from disk with range request support.
/// when `directory` is None, serves embedded spume assets bundled in the binary.
pub async fn serve_static(
    Extension(state): Extension<AppState>,
    req: Request,
) -> Result<Response, ApiError> {
    let server_config = state
        .config
        .server
        .as_ref()
        .ok_or_else(|| ApiError::Internal("server config missing".to_string()))?;

    // check if static files are enabled
    if !server_config.static_files.enabled {
        return Err(ApiError::NotFound);
    }

    // if directory is set, serve from disk; otherwise serve from embedded assets
    match &server_config.static_files.directory {
        Some(static_dir) => {
            // serve from disk with range request support
            let handler = RangeHandler::new(static_dir, 86400) // 1 day cache
                .map_err(|_| {
                    ApiError::Internal(format!(
                        "static files directory not found: {}",
                        static_dir.display()
                    ))
                })?;
            handler.handle_request(req).await.map_err(|e| match e {
                RangeError::NotFound => ApiError::NotFound,
                RangeError::InvalidRange => ApiError::BadRequest("invalid range".to_string()),
                RangeError::UnsatisfiableRange => {
                    ApiError::BadRequest("unsatisfiable range".to_string())
                }
                RangeError::IoError(e) => ApiError::Internal(format!("io error: {}", e)),
            })
        }
        None => {
            // serve from embedded spume assets
            serve_embedded_file(req).await
        }
    }
}

/// serve a file from embedded spume assets
async fn serve_embedded_file(req: Request) -> Result<Response, ApiError> {
    use grimoire::setup::SPUME_DIST;

    let path = req.uri().path();
    // remove leading slash and normalize
    let path = path.trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    // try to get the file from embedded assets
    let file = SPUME_DIST.get_file(path).or_else(|| {
        // for SPA routing: if no extension, try falling back to index.html
        if !path.contains('.') {
            SPUME_DIST.get_file("index.html")
        } else {
            None
        }
    });

    match file {
        Some(file) => {
            let contents = file.contents();
            let content_type = mime_guess::from_path(path)
                .first_or_octet_stream()
                .to_string();

            Response::builder()
                .status(StatusCode::OK)
                .header(CONTENT_TYPE, content_type)
                .header(CONTENT_LENGTH, contents.len())
                .header(CACHE_CONTROL, "public, max-age=86400") // 1 day cache
                .header(ACCEPT_RANGES, "none")
                .body(Body::from(contents.to_vec()))
                .map_err(|e| ApiError::Internal(format!("failed to build response: {}", e)))
        }
        None => Err(ApiError::NotFound),
    }
}

/// serve server image (public, no auth required)
pub async fn serve_server_image(
    Extension(state): Extension<AppState>,
    req: Request,
) -> Result<Response, ApiError> {
    let server_config = state
        .config
        .server
        .as_ref()
        .ok_or_else(|| ApiError::Internal("server config missing".to_string()))?;

    // get configured image path
    let image_path = server_config
        .image_path
        .as_ref()
        .ok_or_else(|| ApiError::NotFound)?;

    // resolve path (relative to data_dir or absolute)
    let full_path = if image_path.is_absolute() {
        image_path.clone()
    } else {
        state.config.data_dir.join(image_path)
    };

    // verify file exists
    if !full_path.exists() {
        return Err(ApiError::NotFound);
    }

    // use ServeFile to serve the image with proper headers
    let serve_file = ServeFile::new(&full_path);
    match serve_file.oneshot(req).await {
        Ok(response) => {
            let (mut parts, body) = response.into_parts();
            // add cache header for server image (1 day)
            parts.headers.insert(
                CACHE_CONTROL,
                HeaderValue::from_static("public, max-age=86400"),
            );
            Ok(Response::from_parts(parts, Body::new(body)))
        }
        Err(_) => Err(ApiError::NotFound),
    }
}

/// range request handler for static files
struct RangeHandler {
    base_path: PathBuf,
    cache_max_age: u32,
}

/// parsed range header
#[derive(Debug, Clone)]
struct ByteRange {
    start: u64,
    end: Option<u64>,
}

/// range handling errors
#[derive(Debug)]
enum RangeError {
    InvalidRange,
    UnsatisfiableRange,
    IoError(std::io::Error),
    NotFound,
}

impl RangeHandler {
    fn new(base_path: impl Into<PathBuf>, cache_max_age: u32) -> Result<Self, RangeError> {
        let base_path = base_path.into();

        // canonicalize base path to ensure it exists and is absolute
        let canonical_base = base_path.canonicalize().map_err(|_| RangeError::NotFound)?;

        Ok(Self {
            base_path: canonical_base,
            cache_max_age,
        })
    }

    /// main request handler with range support
    async fn handle_request(&self, req: Request) -> Result<Response, RangeError> {
        let path = req.uri().path();
        let file_path = self.resolve_path(path)?;

        // check if file exists and get metadata
        let metadata = tokio::fs::metadata(&file_path)
            .await
            .map_err(|_| RangeError::NotFound)?;

        // if directory, try index.html
        let file_path = if metadata.is_dir() {
            let mut index_path = file_path.clone();
            index_path.push("index.html");
            if !index_path.exists() {
                return Err(RangeError::NotFound);
            }
            let metadata = tokio::fs::metadata(&index_path)
                .await
                .map_err(|_| RangeError::NotFound)?;
            (index_path, metadata)
        } else {
            (file_path, metadata)
        };

        let etag = self.generate_etag(&file_path.1);

        // check if this is a range request
        if req.headers().get(RANGE).is_some() {
            self.handle_range_request(req, file_path.0, file_path.1, etag)
                .await
        } else {
            self.handle_full_request(req, file_path.0, file_path.1, etag)
                .await
        }
    }

    /// handle full file request (no ranges)
    async fn handle_full_request(
        &self,
        req: Request,
        file_path: PathBuf,
        metadata: Metadata,
        etag: String,
    ) -> Result<Response, RangeError> {
        let serve_file = ServeFile::new(&file_path);

        match serve_file.oneshot(req).await {
            Ok(response) => {
                // convert to our response type
                let (mut parts, body) = response.into_parts();
                self.add_common_headers(&mut parts.headers, &file_path, &metadata, &etag);
                Ok(Response::from_parts(parts, Body::new(body)))
            }
            Err(_) => Err(RangeError::NotFound),
        }
    }

    /// handle range request for partial content
    async fn handle_range_request(
        &self,
        req: Request,
        file_path: PathBuf,
        metadata: Metadata,
        etag: String,
    ) -> Result<Response, RangeError> {
        let file_size = metadata.len();
        let range_header = req.headers().get(RANGE).unwrap();

        // parse range header
        let ranges = self.parse_range_header(range_header, file_size)?;

        // only support single ranges (multi-part requires multipart/byteranges)
        if ranges.len() != 1 {
            return Err(RangeError::UnsatisfiableRange);
        }

        let range = &ranges[0];
        let start = range.start;
        let end = range.end.unwrap_or(file_size - 1);

        // validate range
        if start >= file_size || end >= file_size || start > end {
            return Err(RangeError::UnsatisfiableRange);
        }

        // check If-Range header for conditional requests
        if let Some(if_range) = req.headers().get(IF_RANGE) {
            if !self.validate_if_range(if_range, &etag, &metadata) {
                return self
                    .handle_full_request(req, file_path, metadata, etag)
                    .await;
            }
        }

        // open file and seek to start
        let mut file = File::open(&file_path).await.map_err(RangeError::IoError)?;
        file.seek(SeekFrom::Start(start))
            .await
            .map_err(RangeError::IoError)?;

        // read requested range
        let content_length = end - start + 1;
        let mut buffer = vec![0; content_length as usize];
        file.read_exact(&mut buffer)
            .await
            .map_err(RangeError::IoError)?;

        // build response
        let mut response = Response::builder()
            .status(StatusCode::PARTIAL_CONTENT)
            .body(Body::from(buffer))
            .unwrap();

        let headers = response.headers_mut();
        self.add_common_headers(headers, &file_path, &metadata, &etag);

        // add range-specific headers
        headers.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
        headers.insert(CONTENT_LENGTH, HeaderValue::from(content_length));
        headers.insert(
            CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {}-{}/{}", start, end, file_size)).unwrap(),
        );

        Ok(response)
    }

    /// parse range header into byte ranges
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

        let ranges_str = &range_str[6..];
        let mut ranges = Vec::new();

        for range_part in ranges_str.split(',') {
            let range_part = range_part.trim();

            if range_part.starts_with('-') {
                // suffix range: -500 (last 500 bytes)
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
                // prefix range: 500- (from byte 500 to end)
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
                // full range: 500-999
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

    /// add common headers to responses
    fn add_common_headers(
        &self,
        headers: &mut HeaderMap,
        file_path: &Path,
        metadata: &Metadata,
        etag: &str,
    ) {
        // mime type detection
        let mime_type = mime_guess::from_path(file_path)
            .first_or_octet_stream()
            .to_string();
        headers.insert(CONTENT_TYPE, HeaderValue::from_str(&mime_type).unwrap());

        // cache headers based on file type
        let cache_max_age = self.get_cache_duration(file_path);
        headers.insert(
            CACHE_CONTROL,
            HeaderValue::from_str(&format!("public, max-age={}", cache_max_age)).unwrap(),
        );

        // etag for caching
        headers.insert(ETAG, HeaderValue::from_str(etag).unwrap());

        // last-modified
        if let Ok(modified) = metadata.modified() {
            let http_date = httpdate::fmt_http_date(modified);
            headers.insert(LAST_MODIFIED, HeaderValue::from_str(&http_date).unwrap());
        }

        // accept ranges for all responses
        headers.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    }

    /// determine cache duration based on file type
    fn get_cache_duration(&self, path: &Path) -> u32 {
        let path_str = path.to_string_lossy().to_lowercase();

        if path_str.ends_with(".html") || path_str.ends_with(".htm") {
            300 // 5 minutes for html
        } else if path_str.ends_with(".js") || path_str.ends_with(".css") {
            86400 // 1 day for js/css
        } else if self.is_media_file(&path_str) {
            2592000 // 30 days for media
        } else if path_str.ends_with(".json") || path_str.ends_with(".xml") {
            3600 // 1 hour for data files
        } else {
            self.cache_max_age // default
        }
    }

    /// check if file is a media file
    fn is_media_file(&self, path: &str) -> bool {
        const MEDIA_EXTENSIONS: &[&str] = &[
            ".mp4", ".webm", ".ogg", ".mp3", ".wav", ".flac", ".m4a", ".aac", ".opus", ".avi",
            ".mov", ".wmv", ".mkv",
        ];
        MEDIA_EXTENSIONS.iter().any(|ext| path.ends_with(ext))
    }

    /// generate etag from file metadata
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

    /// validate If-Range header
    fn validate_if_range(&self, if_range: &HeaderValue, etag: &str, metadata: &Metadata) -> bool {
        let if_range_str = if_range.to_str().unwrap_or("");

        // check if it's an etag
        if if_range_str.starts_with('"') && if_range_str.ends_with('"') {
            if_range_str == etag
        } else {
            // check if it's a date
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

    /// resolve and validate file path (prevents directory traversal)
    fn resolve_path(&self, request_path: &str) -> Result<PathBuf, RangeError> {
        let clean_path = request_path.trim_start_matches('/');

        // prevent directory traversal
        if clean_path.contains("..") {
            return Err(RangeError::NotFound);
        }

        let mut full_path = self.base_path.clone();
        full_path.push(clean_path);

        // normalize path if it exists
        let canonical = match full_path.canonicalize() {
            Ok(path) => path,
            Err(_) => return Err(RangeError::NotFound),
        };

        // ensure canonical path is within base_path (already canonical from constructor)
        if !canonical.starts_with(&self.base_path) {
            return Err(RangeError::NotFound);
        }

        Ok(canonical)
    }
}
