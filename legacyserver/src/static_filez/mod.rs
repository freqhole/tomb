//! Static Filez module
//!
//! This module handles all static file serving functionality including:
//! - Public static files (no authentication required)
//! - Private static files (authentication required)
//! - Main assets directory with fallback handling
//! - Range requests for media files (video/audio seeking)
//! - Compression for supported file types
//! - Enhanced MIME type detection

pub mod enhanced;
pub mod range_handler;

use axum::http::header::CACHE_CONTROL;
use axum::{
    http::{HeaderValue, StatusCode},
    middleware as axum_middleware,
    response::IntoResponse,
    Router,
};
use std::path::PathBuf;
use tower::service_fn;
use tower_http::compression::CompressionLayer;
use tower_http::services::ServeDir;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;

use crate::auth::require_authentication;
use legacylib::AppConfig;

// Re-export enhanced functions for easy access
pub use enhanced::{
    build_enhanced_assets_service, build_enhanced_private_routes, build_enhanced_public_routes,
};

/// Build public static file routes (no authentication required)
pub fn build_public_static_routes(config: &AppConfig) -> Router {
    Router::new()
        .nest_service(
            "/public",
            ServeDir::new(&config.static_files.public_directory)
                .append_index_html_on_directories(true)
                .precompressed_gzip()
                .precompressed_br(),
        )
        .layer(CompressionLayer::new())
        .layer(SetResponseHeaderLayer::if_not_present(
            CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=3600"),
        ))
        .layer(TraceLayer::new_for_http())
}

/// Build protected static file routes (authentication required)
pub fn build_protected_static_routes(config: &AppConfig) -> Router {
    Router::new()
        .nest_service(
            "/private",
            ServeDir::new(&config.static_files.private_directory)
                .append_index_html_on_directories(true)
                .precompressed_gzip()
                .precompressed_br(),
        )
        .layer(CompressionLayer::new())
        .layer(SetResponseHeaderLayer::if_not_present(
            CACHE_CONTROL,
            HeaderValue::from_static("private, max-age=1800"),
        ))
        .layer(TraceLayer::new_for_http())
        .layer(axum_middleware::from_fn(require_authentication))
}

/// Build the main assets fallback service
/// This serves the main assets directory and provides a 404 fallback
/// Includes optimizations for media files and range request support
pub fn build_assets_fallback_service(config: &AppConfig) -> Router {
    let assets_dir = &config.static_files.assets_directory;

    // Validate assets directory exists
    if !PathBuf::from(assets_dir).exists() {
        panic!("Can't find assets directory at: {}", assets_dir);
    }

    Router::new()
        .fallback_service(
            ServeDir::new(assets_dir)
                .append_index_html_on_directories(true)
                .precompressed_gzip()
                .precompressed_br()
                .not_found_service(service_fn(|_| async {
                    Ok::<_, std::convert::Infallible>(
                        (StatusCode::NOT_FOUND, "nothing to see here").into_response(),
                    )
                })),
        )
        .layer(CompressionLayer::new())
        .layer(SetResponseHeaderLayer::if_not_present(
            CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=86400"), // 24 hours for assets
        ))
        .layer(TraceLayer::new_for_http())
}

/// Build all static file routes with enhanced features
/// This is the recommended way to set up static file serving
pub fn build_all_enhanced_static_routes(config: &AppConfig) -> Router {
    Router::new()
        .merge(build_enhanced_public_routes(config))
        .merge(build_enhanced_private_routes(config))
        .merge(build_enhanced_assets_service(config))
}

/// Build all static file routes with basic features
/// Use this for simpler setups or backwards compatibility
pub fn build_all_basic_static_routes(config: &AppConfig) -> Router {
    Router::new()
        .merge(build_public_static_routes(config))
        .merge(build_protected_static_routes(config))
        .merge(build_assets_fallback_service(config))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_public_static_routes() {
        let config = AppConfig::default();
        let _router = build_public_static_routes(&config);
        // Basic test to ensure router builds without panicking
    }

    #[test]
    fn test_build_protected_static_routes() {
        let config = AppConfig::default();
        let _router = build_protected_static_routes(&config);
        // Basic test to ensure router builds without panicking
    }

    #[test]
    fn test_build_assets_fallback_service() {
        let mut config = AppConfig::default();
        // Use a directory that should exist for testing
        config.static_files.assets_directory = ".".to_string();

        let _service = build_assets_fallback_service(&config);
        // Basic test to ensure service builds without panicking
    }
}
