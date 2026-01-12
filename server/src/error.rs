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

    /// internal server error
    #[error("internal server error: {0}")]
    Internal(String),
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, error_message) = match self {
            ApiError::Grimoire(e) => {
                tracing::error!("grimoire error: {}", e);
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("internal error: {}", e),
                )
            }
            ApiError::Unauthorized => (StatusCode::UNAUTHORIZED, self.to_string()),
            ApiError::NotFound => (StatusCode::NOT_FOUND, self.to_string()),
            ApiError::BadRequest(ref msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            ApiError::Forbidden => (StatusCode::FORBIDDEN, self.to_string()),
            ApiError::Internal(ref msg) => {
                tracing::error!("internal error: {}", msg);
                (StatusCode::INTERNAL_SERVER_ERROR, msg.clone())
            }
        };

        let body = Json(json!({
            "error": error_message,
        }));

        (status, body).into_response()
    }
}

/// convenience type for handler results
pub type ApiResult<T> = Result<T, ApiError>;
