//! static file serving
//!
//! serves static files from configured directory
//! basic implementation without range request support

use axum::{
    body::Body,
    http::{header, StatusCode},
    response::Response,
    Extension,
};
use std::path::PathBuf;
use tokio::fs;

use crate::{error::ApiError, state::AppState};

/// serve static file handler
pub async fn serve_static(
    Extension(state): Extension<AppState>,
    uri: axum::http::Uri,
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

    let static_dir = server_config
        .static_files
        .directory
        .as_ref()
        .ok_or_else(|| ApiError::Internal("static files directory not configured".to_string()))?;

    // get requested path, removing leading slash
    let path = uri.path().trim_start_matches('/');

    // prevent directory traversal
    if path.contains("..") {
        return Err(ApiError::BadRequest("invalid path".to_string()));
    }

    // build file path
    let mut file_path = PathBuf::from(static_dir);
    file_path.push(path);

    // if path is directory, try index.html
    if file_path.is_dir() {
        file_path.push("index.html");
    }

    // check if file exists
    if !file_path.exists() {
        return Err(ApiError::NotFound);
    }

    // read file
    let content = fs::read(&file_path)
        .await
        .map_err(|e| ApiError::Internal(format!("failed to read file: {}", e)))?;

    // determine content type
    let content_type = mime_guess::from_path(&file_path)
        .first_or_octet_stream()
        .to_string();

    // build response
    Ok(Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CONTENT_LENGTH, content.len())
        .body(Body::from(content))
        .unwrap())
}
