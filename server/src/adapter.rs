//! offal HTTP adapter
//!
//! generic handler that routes requests through offal dispatch.
//! converts axum extractors <-> offal types.

use axum::{
    extract::{Extension, Request},
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use grimoire::offal::{dispatch, Caller};
use grimoire::response::GrimoireResponse;
use serde_json::Value as JsonValue;

use crate::auth::middleware::AuthenticatedUser;

/// convert AuthenticatedUser to offal Caller
impl From<&AuthenticatedUser> for Caller {
    fn from(user: &AuthenticatedUser) -> Self {
        Caller::new(&user.user_id, &user.username, user.role.clone())
    }
}

/// generic offal dispatch handler
///
/// routes the request through grimoire::offal::dispatch() and returns JSON response.
/// path params (e.g. /api/playlists/{id}) are extracted by offal dispatch itself.
pub async fn offal_handler(
    Extension(user): Extension<AuthenticatedUser>,
    request: Request,
) -> Response {
    let path = request.uri().path().to_string();

    let body: JsonValue = match extract_body(request).await {
        Ok(b) => b,
        Err(e) => {
            return error_response(StatusCode::BAD_REQUEST, "bad_request", &e);
        }
    };

    let caller = Caller::from(&user);
    let response = dispatch(&path, &caller, body).await;

    grimoire_to_response(response)
}

/// offal handler for unauthenticated (public) routes
pub async fn offal_public_handler(request: Request) -> Response {
    let path = request.uri().path().to_string();

    let body: JsonValue = match extract_body(request).await {
        Ok(b) => b,
        Err(e) => {
            return error_response(StatusCode::BAD_REQUEST, "bad_request", &e);
        }
    };

    // public routes use anonymous caller with Viewer role (lowest privilege)
    let caller = Caller::new("anonymous", "anonymous", grimoire::users::UserRole::Viewer);
    let response = dispatch(&path, &caller, body).await;

    grimoire_to_response(response)
}

/// extract body as JSON value
async fn extract_body(request: Request) -> Result<JsonValue, String> {
    let bytes = match axum::body::to_bytes(request.into_body(), 10 * 1024 * 1024).await {
        Ok(b) => b,
        Err(e) => return Err(format!("failed to read body: {}", e)),
    };

    if bytes.is_empty() {
        return Ok(JsonValue::Null);
    }

    serde_json::from_slice(&bytes).map_err(|e| format!("invalid JSON: {}", e))
}

/// convert GrimoireResponse to axum Response
fn grimoire_to_response(resp: GrimoireResponse<JsonValue>) -> Response {
    let status = if resp.success {
        StatusCode::OK
    } else {
        error_status(&resp)
    };

    (status, Json(resp)).into_response()
}

/// determine HTTP status code from error response
fn error_status(resp: &GrimoireResponse<JsonValue>) -> StatusCode {
    if let Some(err) = resp.errors.first() {
        match err.error_type.as_str() {
            "unauthorized" => StatusCode::UNAUTHORIZED,
            "forbidden" | "access_denied" => StatusCode::FORBIDDEN,
            "not_found" | "route_not_found" => StatusCode::NOT_FOUND,
            "bad_request" | "validation_error" => StatusCode::BAD_REQUEST,
            "rate_limited" => StatusCode::TOO_MANY_REQUESTS,
            "conflict" | "duplicate" => StatusCode::CONFLICT,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        }
    } else {
        StatusCode::INTERNAL_SERVER_ERROR
    }
}

/// create JSON error response
fn error_response(status: StatusCode, error_type: &str, message: &str) -> Response {
    let body = serde_json::json!({
        "success": false,
        "message": message,
        "errors": [{
            "error_type": error_type,
            "title": error_type.replace('_', " "),
            "detail": message
        }]
    });
    (status, Json(body)).into_response()
}
