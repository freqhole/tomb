//! authentication middleware

use axum::{
    extract::{Request, State},
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
    pub user_id: uuid::Uuid,
    pub username: String,
    pub role: grimoire::users::UserRole,
}

/// require authentication middleware
///
/// validates session cookie or api key header
/// injects AuthenticatedUser into request extensions
pub async fn require_auth(
    State(_state): State<AppState>,
    session: Session,
    mut request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    // Try session authentication first
    if let Some(session_data) = session::load_session(&session).await? {
        let user = AuthenticatedUser {
            user_id: session_data.user_id,
            username: session_data.username,
            role: grimoire::users::UserRole::from(session_data.role),
        };
        request.extensions_mut().insert(user);
        return Ok(next.run(request).await);
    }

    // Try API key authentication
    if let Some(auth_header) = request.headers().get("authorization") {
        if let Ok(auth_str) = auth_header.to_str() {
            if let Some(_api_key) = auth_str.strip_prefix("Bearer ") {
                // TODO: validate api_key via grimoire
                // for now, return unauthorized
                return Err(ApiError::Unauthorized);
            }
        }
    }

    Err(ApiError::Unauthorized)
}

/// validate origin middleware
///
/// validates request Origin header against config.allowed_origins
/// injects ValidatedOrigin into request extensions for webauthn handlers
///
/// this allows supporting multiple origins (prod, staging, localhost) at runtime
pub async fn validate_origin(
    State(_state): State<AppState>,
    _headers: HeaderMap,
    request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    // TODO: implement origin validation
    // 1. extract Origin header from request
    // 2. check against config.allowed_origins list
    // 3. if match found, inject ValidatedOrigin(origin) into request.extensions_mut()
    // 4. if no match, return error (for webauthn routes) or allow (for other routes)
    //
    // pattern:
    //   if let Some(origin) = headers.get("origin") {
    //       let origin_str = origin.to_str().map_err(|_| ApiError::BadRequest("invalid origin header"))?;
    //       if config.allowed_origins.contains(&origin_str.to_string()) {
    //           request.extensions_mut().insert(ValidatedOrigin(origin_str.to_string()));
    //       } else {
    //           return Err(ApiError::BadRequest("origin not allowed"));
    //       }
    //   }

    Ok(next.run(request).await)
}

/// optional authentication middleware
///
/// similar to require_auth but allows requests to proceed without auth
/// injects AuthenticatedUser only if valid auth provided
pub async fn optional_auth(
    State(_state): State<AppState>,
    session: Session,
    mut request: Request,
    next: Next,
) -> Response {
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
    // TODO: implement API key validation

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
