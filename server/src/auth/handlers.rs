//! authentication route handlers

use axum::{extract::Extension, response::IntoResponse, Json};
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

/// logout handler - destroys current session
///
/// requires authentication middleware
pub async fn logout(session: Session) -> ApiResult<impl IntoResponse> {
    session::delete_session(&session).await?;
    Ok(Json(serde_json::json!({
        "message": "logged out successfully"
    })))
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

    // bust the in-process api-key cache so the OLD key (if any) stops
    // resolving to this user. clearing all is cheap and safer than
    // tracking the previous key value here.
    crate::auth::middleware::clear_api_key_cache();

    let response = ApiKeyRegenerateResponse {
        api_key: api_key.clone(),
        message:
            "API key regenerated successfully. Save this key securely - it won't be shown again."
                .to_string(),
    };

    Ok(Json(response))
}

/// redeem invite handler - creates session from invite code
///
/// for regular invite codes: creates a new user and session (requires username)
/// for account-link codes: creates a session for the existing linked user (no username needed)
/// for P2P connections: X-Peer-Node-Id header links the peer to the user
///
/// does not require authentication
pub async fn redeem_invite(
    headers: axum::http::HeaderMap,
    session: Session,
    Json(request): Json<RedeemInviteRequest>,
) -> Result<impl IntoResponse, ApiError> {
    let service = grimoire::users::UserService::new();

    // get peer node_id from header (added by federation proxy) or request body
    let peer_node_id = headers
        .get("X-Peer-Node-Id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .or_else(|| request.node_id.clone());

    // first, check what type of invite code this is
    let code_response = service.check_invite_code(&request.invite_code).await;
    if !code_response.is_success() {
        return Err(ApiError::BadRequest("invalid invite code".to_string()));
    }

    let invite_code = code_response
        .data
        .ok_or_else(|| ApiError::BadRequest("invalid invite code".to_string()))?;

    // handle account-link codes: create session for existing user
    if invite_code.code_type == grimoire::users::InviteCodeType::AccountLink {
        let linked_user_id = invite_code.link_for_user_id.ok_or_else(|| {
            ApiError::Internal("account-link code missing linked user".to_string())
        })?;

        // get the linked user
        let user_response = service.get_user(&linked_user_id).await;
        if !user_response.is_success() {
            return Err(ApiError::BadRequest("linked user not found".to_string()));
        }

        let user = user_response
            .data
            .ok_or_else(|| ApiError::Internal("failed to get linked user".to_string()))?;

        // mark invite code as used
        let _ = service
            .mark_invite_used(&request.invite_code, &user.id)
            .await;

        // link peer node_id if provided (for P2P auth)
        if let Some(ref node_id) = peer_node_id {
            let _ = service.add_peer_node(&user.id, node_id, None).await;
        }

        // create session for existing user
        session::save_session(&session, &user.id, &user.username, &user.role.to_string()).await?;

        return Ok(Json(serde_json::json!({
            "message": "logged in via account-link code",
            "user": {
                "id": user.id,
                "username": user.username,
                "role": user.role.to_string(),
            }
        })));
    }

    // handle regular invite codes: create new user and session
    let username = request
        .username
        .ok_or_else(|| ApiError::BadRequest("username is required for invite codes".to_string()))?;

    let create_request = grimoire::users::CreateUserRequest {
        username: username.clone(),
        role: None, // let the invite code's grants_role be used
        invite_code: Some(request.invite_code),
    };

    let user_response = service.register_user(&create_request).await;

    if !user_response.is_success() {
        return Err(ApiError::BadRequest(
            user_response
                .errors
                .first()
                .map(|e| e.detail.clone())
                .unwrap_or_else(|| "failed to register user".to_string()),
        ));
    }

    let user = user_response.data.ok_or_else(|| {
        ApiError::Internal("failed to get user data after registration".to_string())
    })?;

    // link peer node_id if provided (for P2P auth)
    if let Some(ref node_id) = peer_node_id {
        let _ = service.add_peer_node(&user.id, node_id, None).await;
    }

    // create session
    session::save_session(&session, &user.id, &user.username, &user.role.to_string()).await?;

    Ok(Json(serde_json::json!({
        "message": "user created and logged in",
        "user": {
            "id": user.id,
            "username": user.username,
            "role": user.role.to_string(),
        }
    })))
}
