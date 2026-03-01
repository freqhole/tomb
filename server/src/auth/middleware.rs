//! authentication middleware

use axum::{
    extract::{Extension, Request},
    http::HeaderMap,
    middleware::Next,
    response::Response,
};
use tower_sessions::Session;

use crate::{auth::session, error::ApiError, state::AppState};

/// validated webauthn origin config extracted from request
///
/// middleware validates the request Origin header against config.allowed_origins
/// and injects this into request extensions for webauthn handlers to use
#[derive(Debug, Clone)]
pub struct ValidatedOrigin(pub String);

/// authenticated user extracted from session/api key
///
/// injected into request extensions by auth middleware
#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    pub user_id: String,
    pub username: String,
    pub role: grimoire::users::UserRole,
}

/// require authentication middleware
///
/// validates session cookie, api key header, or api key query param
/// injects AuthenticatedUser into request extensions
pub async fn require_auth(
    session: Session,
    mut request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    // Try session authentication first
    if let Some(session_data) = session::load_session(&session).await? {
        // fetch current user from DB to get fresh role (in case it changed since login)
        let user_response = grimoire::users::get_user(&session_data.user_id).await;
        if let Some(user) = user_response.data {
            let auth_user = AuthenticatedUser {
                user_id: user.id,
                username: user.username,
                role: user.role,
            };
            request.extensions_mut().insert(auth_user);
            return Ok(next.run(request).await);
        }
        // user not found in DB (deleted?) - fall through to unauthorized
    }

    // Try API key from Authorization header
    if let Some(auth_header) = request.headers().get("authorization") {
        if let Ok(auth_str) = auth_header.to_str() {
            if let Some(api_key) = auth_str.strip_prefix("Bearer ") {
                if let Some(auth_user) = validate_api_key(api_key).await {
                    request.extensions_mut().insert(auth_user);
                    return Ok(next.run(request).await);
                }
            }
        }
    }

    // Try API key from query parameter (for media URLs in tauri/webview)
    if let Some(query) = request.uri().query() {
        for param in query.split('&') {
            if let Some(api_key) = param.strip_prefix("key=") {
                if let Some(auth_user) = validate_api_key(api_key).await {
                    request.extensions_mut().insert(auth_user);
                    return Ok(next.run(request).await);
                }
            }
        }
    }

    Err(ApiError::Unauthorized)
}

/// validate an API key and return AuthenticatedUser if valid
async fn validate_api_key(api_key: &str) -> Option<AuthenticatedUser> {
    let response = grimoire::users::find_user_by_api_key(api_key).await;
    response.data.map(|user| AuthenticatedUser {
        user_id: user.id,
        username: user.username,
        role: user.role,
    })
}

/// validate origin middleware
///
/// validates request Origin header against config.auth.allowed_origins
/// injects ValidatedOrigin into request extensions for webauthn handlers
///
/// this allows supporting multiple origins (prod, staging, localhost) at runtime
/// also supports "any" in allowed_origins to accept any origin
pub async fn validate_origin(
    Extension(state): Extension<AppState>,
    headers: HeaderMap,
    mut request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    // Extract Origin header
    let origin = headers
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| ApiError::BadRequest("missing or invalid origin header".to_string()))?;

    // Check if webauthn is enabled
    let server_config = state
        .config
        .server
        .as_ref()
        .ok_or_else(|| ApiError::Internal("server config missing".to_string()))?;

    if !server_config.auth.webauthn_enabled {
        return Err(ApiError::BadRequest("webauthn not enabled".to_string()));
    }

    // Check if origin matches any configured origin (or "any" is configured)
    if server_config.auth.is_origin_allowed(origin) {
        // Valid origin - inject into extensions for handler use
        request
            .extensions_mut()
            .insert(ValidatedOrigin(origin.to_string()));
        Ok(next.run(request).await)
    } else {
        Err(ApiError::BadRequest(format!(
            "origin '{}' not allowed for webauthn",
            origin
        )))
    }
}

/// optional authentication middleware
///
/// similar to require_auth but allows requests to proceed without auth
/// injects AuthenticatedUser only if valid auth provided
pub async fn optional_auth(session: Session, mut request: Request, next: Next) -> Response {
    // Try session authentication
    if let Ok(Some(session_data)) = session::load_session(&session).await {
        let user = AuthenticatedUser {
            user_id: session_data.user_id,
            username: session_data.username,
            role: grimoire::users::UserRole::from(session_data.role),
        };
        request.extensions_mut().insert(user);
    }

    // If no session, try API key (silently fail if neither)
    if let Some(auth_header) = request.headers().get("authorization") {
        if let Ok(auth_str) = auth_header.to_str() {
            if let Some(api_key) = auth_str.strip_prefix("Bearer ") {
                let response = grimoire::users::find_user_by_api_key(api_key).await;
                if let Some(user) = response.data {
                    let auth_user = AuthenticatedUser {
                        user_id: user.id,
                        username: user.username,
                        role: user.role,
                    };
                    request.extensions_mut().insert(auth_user);
                }
            }
        }
    }

    next.run(request).await
}

/// require specific role middleware
///
/// must be used after require_auth
/// checks that user has required role (admin, user, viewer)
pub async fn require_role(
    _required_role: &'static str,
) -> impl Fn(Request, Next) -> futures_util::future::BoxFuture<'static, Result<Response, ApiError>> + Clone
{
    move |_request: Request, _next: Next| {
        Box::pin(async move {
            // TODO: extract AuthenticatedUser from extensions
            // TODO: check role matches required_role
            // TODO: return Forbidden if insufficient permissions

            // placeholder
            Err(ApiError::Forbidden)
        })
    }
}
