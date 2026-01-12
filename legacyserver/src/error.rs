use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum WebauthnError {
    #[error("unknown webauthn error")]
    Unknown,
    #[error("Corrupt Session")]
    CorruptSession,
    #[error("User Not Found")]
    UserNotFound,
    #[error("User Has No Credentials")]
    UserHasNoCredentials,
    #[error("Invalid Invite Code")]
    InvalidInviteCode,
    #[error("User Already Exists")]
    UserAlreadyExists,
    #[error("Database Error")]
    DatabaseError,
    #[error("Bad Request")]
    BadRequest,
    #[error("Invalid RP Origin")]
    InvalidRPOrigin,
    #[error("Deserialising Session failed: {0}")]
    InvalidSessionState(#[from] tower_sessions::session::Error),
    #[error("Database operation failed: {0}")]
    SqlxError(#[from] sqlx::Error),
}
impl IntoResponse for WebauthnError {
    fn into_response(self) -> Response {
        let (status, body) = match self {
            WebauthnError::CorruptSession => (StatusCode::BAD_REQUEST, "Corrupt Session"),
            WebauthnError::UserNotFound => (StatusCode::NOT_FOUND, "User Not Found"),
            WebauthnError::Unknown => (StatusCode::INTERNAL_SERVER_ERROR, "Unknown Error"),
            WebauthnError::UserHasNoCredentials => {
                (StatusCode::BAD_REQUEST, "User Has No Credentials")
            }
            WebauthnError::InvalidInviteCode => {
                (StatusCode::BAD_REQUEST, "Invalid or expired invite code")
            }
            WebauthnError::UserAlreadyExists => (StatusCode::CONFLICT, "Username already exists"),
            WebauthnError::DatabaseError => {
                (StatusCode::INTERNAL_SERVER_ERROR, "Database error occurred")
            }
            WebauthnError::InvalidRPOrigin => {
                (StatusCode::BAD_REQUEST, "Invalid Relying Party origin")
            }
            WebauthnError::InvalidSessionState(_) => {
                (StatusCode::BAD_REQUEST, "Invalid session state")
            }
            WebauthnError::SqlxError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Database operation failed",
            ),
            WebauthnError::BadRequest => (StatusCode::BAD_REQUEST, "Bad Request"),
        };

        // its often easiest to implement `IntoResponse` by calling other implementations
        (status, body).into_response()
    }
}

#[derive(Error, Debug)]
pub enum AppError {
    #[error("Bad Request: {0}")]
    BadRequest(String),
    #[error("Unauthorized: {0}")]
    Unauthorized(String),
    #[error("Forbidden: {0}")]
    Forbidden(String),
    #[error("Not Found: {0}")]
    NotFound(String),
    #[error("Conflict: {0}")]
    Conflict(String),
    #[error("Internal Server Error: {0}")]
    InternalServerError(String),
    #[error("Database Error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Webauthn Error: {0}")]
    Webauthn(#[from] WebauthnError),
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            AppError::BadRequest(msg) => (StatusCode::BAD_REQUEST, msg.clone()),
            AppError::Unauthorized(msg) => (StatusCode::UNAUTHORIZED, msg.clone()),
            AppError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg.clone()),
            AppError::NotFound(msg) => (StatusCode::NOT_FOUND, msg.clone()),
            AppError::Conflict(msg) => (StatusCode::CONFLICT, msg.clone()),
            AppError::InternalServerError(msg) => (StatusCode::INTERNAL_SERVER_ERROR, msg.clone()),
            AppError::Database(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Database error occurred".to_string(),
            ),
            AppError::Webauthn(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Authentication error occurred".to_string(),
            ),
        };

        let body = Json(json!({
            "error": message,
            "status": status.as_u16()
        }));

        (status, body).into_response()
    }
}
