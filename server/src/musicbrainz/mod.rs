//! MusicBrainz integration module
//!
//! This module provides HTTP API endpoints for MusicBrainz metadata lookup and management.
//! It builds on the existing CLI and grimoire MusicBrainz implementation to provide
//! web API access to MusicBrainz functionality.

pub mod handlers;
pub mod routes;

pub use routes::create_musicbrainz_routes;

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

/// Error type for MusicBrainz API operations
#[derive(Debug, thiserror::Error)]
pub enum MusicBrainzApiError {
    #[error("MusicBrainz service error: {0}")]
    ServiceError(#[from] grimoire::musicbrainz::MusicBrainzError),

    #[error("Database error: {0}")]
    DatabaseError(#[from] sqlx::Error),

    #[error("Invalid request: {0}")]
    ValidationError(String),

    #[error("MusicBrainz integration is disabled")]
    Disabled,

    #[error("No songs provided")]
    NoSongs,

    #[error("Song not found: {0}")]
    SongNotFound(String),

    #[error("Unauthorized")]
    Unauthorized,
}

impl IntoResponse for MusicBrainzApiError {
    fn into_response(self) -> Response {
        let (status, error_message) = match &self {
            MusicBrainzApiError::ServiceError(e) => {
                tracing::error!("MusicBrainz service error: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "MusicBrainz service error",
                )
            }
            MusicBrainzApiError::DatabaseError(e) => {
                tracing::error!("Database error in MusicBrainz API: {}", e);
                (StatusCode::INTERNAL_SERVER_ERROR, "Database error")
            }
            MusicBrainzApiError::ValidationError(msg) => (StatusCode::BAD_REQUEST, msg.as_str()),
            MusicBrainzApiError::Disabled => (
                StatusCode::SERVICE_UNAVAILABLE,
                "MusicBrainz integration is disabled",
            ),
            MusicBrainzApiError::NoSongs => (StatusCode::BAD_REQUEST, "No songs provided"),
            MusicBrainzApiError::SongNotFound(_) => (StatusCode::NOT_FOUND, "Song not found"),
            MusicBrainzApiError::Unauthorized => (StatusCode::UNAUTHORIZED, "Unauthorized"),
        };

        let details = self.to_string();
        let body = Json(json!({
            "error": error_message,
            "details": details
        }));

        (status, body).into_response()
    }
}

/// Result type for MusicBrainz API operations
pub type MusicBrainzResult<T> = Result<T, MusicBrainzApiError>;
