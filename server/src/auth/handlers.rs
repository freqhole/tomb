//! authentication route handlers

use axum::{extract::Extension, response::IntoResponse, Json};
use grimoire::api_registry::{Domain, Method, RouteInfo};
use grimoire::users::{
    ApiKeyRegenerateResponse, ApiKeyStatusResponse, RedeemInviteRequest, UserService,
    WhoAmIResponse,
};
use tower_sessions::Session;

use crate::{
    auth::middleware::AuthenticatedUser, auth::session, error::ApiError, error::ApiResult,
};

// Re-export webauthn handlers when feature is enabled
#[cfg(feature = "webauthn")]
pub use crate::auth::freq_webauthn::{login_finish, login_start, register_finish, register_start};

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

inventory::submit! {
    RouteInfo {
        name: "whoami",
        path: "/auth/whoami",
        method: Method::GET,
        domain: Domain::Auth,
        request_type: "String",
        response_type: "WhoAmIResponse",
    }
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

inventory::submit! {
    RouteInfo {
        name: "logout",
        path: "/auth/logout",
        method: Method::POST,
        domain: Domain::Auth,
        request_type: "String",
        response_type: "serde_json::Value",
    }
}

/// get api key status - check if current user has an api key
///
/// requires authentication middleware
pub async fn api_key_status(
    Extension(user): Extension<AuthenticatedUser>,
) -> ApiResult<impl IntoResponse> {
    let service = UserService::new();

    let user_response = service.get_user(&user.user_id).await;
    if !user_response.is_success() {
        return Err(ApiError::Unauthorized);
    }

    let user_data = user_response
        .data
        .ok_or_else(|| ApiError::Internal("User data missing".to_string()))?;

    let has_key = user_data.api_key.is_some() && !user_data.api_key.as_ref().unwrap().is_empty();
    let api_key_preview = if has_key {
        user_data.api_key.as_ref().map(|k| {
            if k.len() >= 16 {
                format!("{}...{}", &k[..8], &k[k.len() - 8..])
            } else {
                "***".to_string()
            }
        })
    } else {
        None
    };

    let response = ApiKeyStatusResponse {
        has_api_key: has_key,
        api_key_preview,
    };

    Ok(Json(response))
}

inventory::submit! {
    RouteInfo {
        name: "regenerate_api_key",
        path: "/auth/api-key/regenerate",
        method: Method::POST,
        domain: Domain::Auth,
        request_type: "String",
        response_type: "ApiKeyRegenerateResponse",
    }
}

inventory::submit! {
    RouteInfo {
        name: "api_key_status",
        path: "/auth/api-key/status",
        method: Method::GET,
        domain: Domain::Auth,
        request_type: "String",
        response_type: "ApiKeyStatusResponse",
    }
}

/// regenerate api key - generate new api key for current user
///
/// requires authentication middleware
pub async fn regenerate_api_key(
    Extension(user): Extension<AuthenticatedUser>,
) -> ApiResult<impl IntoResponse> {
    let service = UserService::new();

    let api_key_response = service.generate_api_key(&user.user_id).await;
    if !api_key_response.is_success() {
        return Err(ApiError::Internal(format!(
            "Failed to generate API key: {}",
            api_key_response.message
        )));
    }

    let updated_user = api_key_response.data.ok_or_else(|| {
        ApiError::Internal("User data missing after API key generation".to_string())
    })?;

    let api_key = updated_user
        .api_key
        .ok_or_else(|| ApiError::Internal("API key not generated".to_string()))?;

    let response = ApiKeyRegenerateResponse {
        api_key: api_key.clone(),
        message:
            "API key regenerated successfully. Save this key securely - it won't be shown again."
                .to_string(),
    };

    Ok(Json(response))
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

inventory::submit! {
    RouteInfo {
        name: "redeem_invite",
        path: "/auth/invite",
        method: Method::POST,
        domain: Domain::Auth,
        request_type: "RedeemInviteRequest",
        response_type: "serde_json::Value",
    }
}
