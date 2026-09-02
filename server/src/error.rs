//! error types for http api

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;

/// api error type
///
/// maps domain errors to http responses
#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    /// grimoire domain error
    #[error("grimoire error: {0}")]
    Grimoire(#[from] grimoire::error::GrimoireError),

    /// unauthorized access
    #[error("unauthorized")]
    Unauthorized,

    /// resource not found
    #[error("not found")]
    NotFound,

    /// bad request (client error)
    #[error("bad request: {0}")]
    BadRequest(String),

    /// forbidden (authenticated but insufficient permissions)
    #[error("forbidden")]
    Forbidden,

    /// rate limited (upstream or local)
    #[error("rate limited: {0}")]
    RateLimited(String),

    /// internal server error
    #[error("internal server error: {0}")]
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, error_code, error_message) = match self {
            ApiError::Grimoire(e) => {
                // preserve the underlying GrimoireError's real error_type and
                // status code instead of collapsing every domain error into a
                // generic 500 "internal_error" - both already exist on
                // GrimoireError (error_type()/status_code()), they just
                // weren't wired up at this http boundary.
                let status = StatusCode::from_u16(e.status_code())
                    .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
                let error_type = e.error_type();
                if status.is_server_error() {
                    tracing::error!("grimoire error ({}): {}", error_type, e);
                } else {
                    tracing::debug!("grimoire error ({}): {}", error_type, e);
                }
                (status, error_type, e.to_string())
            }
            ApiError::Unauthorized => (
                StatusCode::UNAUTHORIZED,
                "unauthorized".to_string(),
                self.to_string(),
            ),
            ApiError::NotFound => (
                StatusCode::NOT_FOUND,
                "not_found".to_string(),
                self.to_string(),
            ),
            ApiError::BadRequest(ref msg) => (
                StatusCode::BAD_REQUEST,
                "bad_request".to_string(),
                msg.clone(),
            ),
            ApiError::Forbidden => (
                StatusCode::FORBIDDEN,
                "forbidden".to_string(),
                self.to_string(),
            ),
            ApiError::RateLimited(ref msg) => {
                tracing::warn!("rate limited: {}", msg);
                (
                    StatusCode::TOO_MANY_REQUESTS,
                    "rate_limited".to_string(),
                    msg.clone(),
                )
            }
            ApiError::Internal(ref msg) => {
                tracing::error!("internal error: {}", msg);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal_error".to_string(),
                    msg.clone(),
                )
            }
        };

        // `error_type` mirrors `code` under its RFC-9457/ErrorDetail name -
        // client-side parsing (client-codegen's errors.ts) prefers
        // `error_type` but still falls back to `code` for older callers.
        let body = Json(json!({
            "error": error_message,
            "code": error_code,
            "error_type": error_code,
        }));

        (status, body).into_response()
    }
}

/// convenience type for handler results
pub type ApiResult<T> = Result<T, ApiError>;
