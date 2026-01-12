//! authentication route handlers

use axum::{response::IntoResponse, Json};
use serde::{Deserialize, Serialize};

use crate::error::ApiResult;

/// whoami response
#[derive(Debug, Serialize, Deserialize)]
pub struct WhoAmIResponse {
    pub user_id: uuid::Uuid,
    pub username: String,
    pub role: String,
}

/// whoami handler - returns current authenticated user
///
/// requires authentication middleware
pub async fn whoami() -> ApiResult<impl IntoResponse> {
    // TODO: extract user from request extensions (added by auth middleware)
    // TODO: return user info
    Ok(Json(serde_json::json!({
        "message": "whoami handler - not yet implemented"
    })))
}

// TODO: webauthn handlers (phase 2)
// - register_start (extracts validated origin from middleware)
// - register_finish
// - login_start (extracts validated origin from middleware)
// - login_finish
// - logout
//
// pattern for origin handling:
//   1. middleware validates request Origin header against config.allowed_origins
//   2. middleware injects validated origin into request extensions
//   3. handler extracts ValidatedOrigin from extensions
//   4. handler passes origin string to freq_webauthn methods
//
// this supports multiple origins (prod, staging, localhost) at runtime

// TODO: invite code handler (phase 2)
// - redeem_invite

// TODO: api key validation (used by middleware, not a route)
