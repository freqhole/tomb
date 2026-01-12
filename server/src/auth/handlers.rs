//! authentication route handlers

use axum::{extract::Extension, response::IntoResponse, Json};
use serde::{Deserialize, Serialize};
use tower_sessions::Session;

use crate::{
    auth::middleware::AuthenticatedUser, auth::session, error::ApiError, error::ApiResult,
};

/// whoami response
#[derive(Debug, Serialize, Deserialize)]
pub struct WhoAmIResponse {
    pub user_id: String,
    pub username: String,
    pub role: String,
}

/// whoami handler - returns current authenticated user
///
/// requires authentication middleware
pub async fn whoami(Extension(user): Extension<AuthenticatedUser>) -> ApiResult<impl IntoResponse> {
    let response = WhoAmIResponse {
        user_id: user.user_id,
        username: user.username,
        role: user.role.to_string(),
    };
    Ok(Json(response))
}

/// logout handler - destroys current session
///
/// requires authentication middleware
pub async fn logout(session: Session) -> ApiResult<impl IntoResponse> {
    session::delete_session(&session).await?;
    Ok(Json(serde_json::json!({
        "message": "logged out successfully"
    })))
}

/// redeem invite code request
#[derive(Debug, Deserialize)]
pub struct RedeemInviteRequest {
    pub invite_code: String,
    pub username: String,
}

/// redeem invite handler - creates new user and session from invite code
///
/// does not require authentication
pub async fn redeem_invite(
    session: Session,
    Json(request): Json<RedeemInviteRequest>,
) -> Result<impl IntoResponse, ApiError> {
    // Create user via grimoire
    let create_request = grimoire::users::CreateUserRequest {
        username: request.username.clone(),
        role: Some(grimoire::users::UserRole::Member),
        invite_code: Some(request.invite_code),
    };

    let service = grimoire::users::UserService::new();
    let user_response = service.register_user(&create_request).await;

    if !user_response.is_success() {
        return Err(ApiError::BadRequest(
            user_response
                .errors
                .first()
                .map(|e| e.detail.clone())
                .unwrap_or_else(|| "Failed to register user".to_string()),
        ));
    }

    let user = user_response.data.ok_or_else(|| {
        ApiError::Internal("Failed to get user data after registration".to_string())
    })?;

    // Create session
    let user_id = user.id.clone();
    session::save_session(&session, &user_id, &user.username, &user.role.to_string()).await?;

    Ok(Json(serde_json::json!({
        "message": "user created and logged in",
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role.to_string(),
        }
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
