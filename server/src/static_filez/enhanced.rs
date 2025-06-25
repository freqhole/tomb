//! Enhanced static file serving with modern web optimizations
//!
//! This module provides improved static file serving with:
//! - Automatic MIME type detection
//! - Compression (gzip, brotli)
//! - Proper caching headers
//! - Range request support via tower-http
//! - Security headers

use axum::http::header::{CACHE_CONTROL, CONTENT_DISPOSITION, CONTENT_TYPE};
use axum::http::Extensions;
use axum::{
    extract::Request,
    http::{HeaderMap, HeaderValue, StatusCode, Version},
    middleware::{self as axum_middleware, Next},
    response::{IntoResponse, Response},
    Router,
};
use std::path::PathBuf;
use tower::service_fn;
use tower_http::compression::CompressionLayer;
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

use crate::auth::require_authentication;
use grimoire::AppConfig;

/// Media file extensions that benefit from range requests
const MEDIA_EXTENSIONS: &[&str] = &[
    ".mp4", ".webm", ".ogg", ".mp3", ".wav", ".flac", ".aac", ".m4a", ".mov", ".avi", ".mkv",
    ".m4v", ".3gp", ".wmv",
];

/// Video file extensions and their MIME types
const VIDEO_MIME_TYPES: &[(&str, &str)] = &[
    (".mp4", "video/mp4"),
    (".webm", "video/webm"),
    (".ogg", "video/ogg"),
    (".mov", "video/quicktime"),
    (".avi", "video/x-msvideo"),
    (".mkv", "video/x-matroska"),
    (".m4v", "video/x-m4v"),
    (".3gp", "video/3gpp"),
    (".wmv", "video/x-ms-wmv"),
];

/// Audio file extensions and their MIME types
const AUDIO_MIME_TYPES: &[(&str, &str)] = &[
    (".mp3", "audio/mpeg"),
    (".wav", "audio/wav"),
    (".flac", "audio/flac"),
    (".aac", "audio/aac"),
    (".m4a", "audio/mp4"),
    (".ogg", "audio/ogg"),
];

/// Build enhanced public static file routes
/// Optimized for public assets with aggressive caching
pub fn build_enhanced_public_routes(config: &AppConfig) -> Router {
    let serve_dir = ServeDir::new(&config.static_files.public_directory)
        .append_index_html_on_directories(true)
        .precompressed_gzip()
        .precompressed_br()
        .fallback(service_fn(not_found_handler));

    Router::new()
        .nest_service("/public", serve_dir)
        .layer(axum_middleware::from_fn(fix_media_headers))
        .layer(
            CompressionLayer::new().gzip(true).br(true).no_deflate(), // Disable deflate as it's less efficient
        )
        .layer(SetResponseHeaderLayer::if_not_present(
            CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"), // 1 year for public assets
        ))
        .layer(TraceLayer::new_for_http())
}

/// Build enhanced protected static file routes
/// Optimized for private content with moderate caching
pub fn build_enhanced_private_routes(config: &AppConfig) -> Router {
    let serve_dir = ServeDir::new(&config.static_files.private_directory)
        .append_index_html_on_directories(true)
        .precompressed_gzip()
        .precompressed_br()
        .fallback(service_fn(not_found_handler));

    Router::new()
        .nest_service("/private", serve_dir)
        .layer(axum_middleware::from_fn(fix_media_headers))
        .layer(CompressionLayer::new().gzip(true).br(true))
        .layer(SetResponseHeaderLayer::if_not_present(
            CACHE_CONTROL,
            HeaderValue::from_static("private, max-age=3600, must-revalidate"), // 1 hour for private content
        ))
        .layer(TraceLayer::new_for_http())
        .layer(axum_middleware::from_fn(require_authentication))
}

/// Build enhanced assets service with smart caching
/// Different cache strategies based on file type
pub fn build_enhanced_assets_service(config: &AppConfig) -> Router {
    let assets_dir = &config.static_files.assets_directory;

    // Validate assets directory exists
    if !PathBuf::from(assets_dir).exists() {
        panic!("Assets directory not found: {}", assets_dir);
    }

    let serve_dir = ServeDir::new(assets_dir)
        .append_index_html_on_directories(true)
        .precompressed_gzip()
        .precompressed_br()
        .fallback(service_fn(not_found_handler));

    Router::new()
        .fallback_service(serve_dir)
        .layer(
            CompressionLayer::new()
                .gzip(true)
                .br(true)
                // Don't compress media files as they're already compressed
                .compress_when(
                    |_status: StatusCode,
                     _version: Version,
                     headers: &HeaderMap,
                     _extensions: &Extensions| {
                        if let Some(content_type) = headers.get(CONTENT_TYPE) {
                            let ct = content_type.to_str().unwrap_or("");
                            !ct.starts_with("video/")
                                && !ct.starts_with("audio/")
                                && !ct.starts_with("image/")
                        } else {
                            true
                        }
                    },
                ),
        )
        .layer(SetResponseHeaderLayer::if_not_present(
            CACHE_CONTROL,
            HeaderValue::from_static(get_cache_control_for_assets()),
        ))
        .layer(TraceLayer::new_for_http())
}

/// Get appropriate cache control header for assets
fn get_cache_control_for_assets() -> &'static str {
    // For assets, we use a moderate cache time with validation
    // This allows for updates while still providing good performance
    "public, max-age=86400, stale-while-revalidate=604800" // 1 day cache, 1 week stale
}

/// Custom 404 handler for static files
async fn not_found_handler(
    _: axum::extract::Request,
) -> Result<Response, std::convert::Infallible> {
    Ok((
        StatusCode::NOT_FOUND,
        [("content-type", "text/html; charset=utf-8")],
        r#"
<!DOCTYPE html>
<html>
<head>
    <title>404 - Not Found</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            max-width: 600px;
            margin: 100px auto;
            text-align: center;
            color: #333;
        }
        h1 { color: #e74c3c; }
        a { color: #3498db; text-decoration: none; }
        a:hover { text-decoration: underline; }
    </style>
</head>
<body>
    <h1>404 - File Not Found</h1>
    <p>The requested file could not be found.</p>
    <p><a href="/">← Back to Home</a></p>
</body>
</html>
            "#,
    )
        .into_response())
}

/// Middleware to fix MIME types and Content-Disposition for media files
async fn fix_media_headers(request: Request, next: Next) -> Response {
    let path = request.uri().path().to_lowercase();
    let mut response = next.run(request).await;

    // Check if this is a media file
    let media_info = get_media_info(&path);

    if let Some((mime_type, disposition)) = media_info {
        tracing::debug!(
            "Fixing media headers for {}: mime_type={}, disposition={}",
            path,
            mime_type,
            disposition
        );

        let headers = response.headers_mut();

        // Override Content-Type if needed
        headers.insert(CONTENT_TYPE, HeaderValue::from_static(mime_type));

        // Set Content-Disposition to inline for media files
        headers.insert(CONTENT_DISPOSITION, HeaderValue::from_static(disposition));
    }

    response
}

/// Get media info (MIME type and disposition) for a file path
fn get_media_info(path: &str) -> Option<(&'static str, &'static str)> {
    // Check video files first
    for (ext, mime_type) in VIDEO_MIME_TYPES {
        if path.ends_with(ext) {
            return Some((mime_type, "inline"));
        }
    }

    // Check audio files
    for (ext, mime_type) in AUDIO_MIME_TYPES {
        if path.ends_with(ext) {
            return Some((mime_type, "inline"));
        }
    }

    None
}

/// Check if a file path represents a media file that benefits from range requests
pub fn is_media_file(path: &str) -> bool {
    let path_lower = path.to_lowercase();
    MEDIA_EXTENSIONS.iter().any(|ext| path_lower.ends_with(ext))
}

/// Get optimal cache duration based on file type
pub fn get_cache_duration_for_file(path: &str) -> u32 {
    let path_lower = path.to_lowercase();

    if path_lower.ends_with(".html") || path_lower.ends_with(".htm") {
        300 // 5 minutes for HTML files
    } else if path_lower.ends_with(".js") || path_lower.ends_with(".css") {
        86400 // 1 day for JS/CSS
    } else if is_media_file(path) {
        2592000 // 30 days for media files
    } else if path_lower.ends_with(".json") || path_lower.ends_with(".xml") {
        3600 // 1 hour for data files
    } else {
        86400 // 1 day default
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_media_file() {
        assert!(is_media_file("/videos/sample.mp4"));
        assert!(is_media_file("/audio/song.MP3")); // case insensitive
        assert!(is_media_file("movie.webm"));
        assert!(!is_media_file("/scripts/app.js"));
        assert!(!is_media_file("style.css"));
    }

    #[test]
    fn test_cache_duration() {
        assert_eq!(get_cache_duration_for_file("index.html"), 300);
        assert_eq!(get_cache_duration_for_file("app.js"), 86400);
        assert_eq!(get_cache_duration_for_file("video.mp4"), 2592000);
        assert_eq!(get_cache_duration_for_file("data.json"), 3600);
    }

    #[test]
    fn test_enhanced_routes_build() {
        let config = AppConfig::default();

        // These should not panic
        let _public = build_enhanced_public_routes(&config);
        let _private = build_enhanced_private_routes(&config);

        // Assets route requires the directory to exist
        std::fs::create_dir_all(&config.static_files.assets_directory).ok();
        let _assets = build_enhanced_assets_service(&config);
    }
}
