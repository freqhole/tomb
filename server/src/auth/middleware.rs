//! authentication middleware

use axum::{
    extract::{Extension, Request},
    http::HeaderMap,
    middleware::Next,
    response::Response,
};
use std::collections::HashMap;
use std::sync::RwLock;
use tower_sessions::Session;

use crate::{auth::session, error::ApiError, state::AppState};

/// in-process cache of api_key -> AuthenticatedUser.
///
/// avoids hitting sqlite on every byte-range request from the embedded
/// media server (`<audio>` issues many range gets per song; each one would
/// otherwise do a full SELECT on user_accountz). api keys are stable for
/// the lifetime of a user — invalidated explicitly by `invalidate_api_key`
/// when a key is rotated. on-disk cap is irrelevant here: realistic usage
/// is 1-N users, and `User` is small.
static API_KEY_CACHE: RwLock<Option<HashMap<String, AuthenticatedUser>>> = RwLock::new(None);

/// remove a single api key from the cache. call this whenever a user's
/// api key is rotated or the user is deleted.
pub fn invalidate_api_key(api_key: &str) {
    if let Ok(mut guard) = API_KEY_CACHE.write() {
        if let Some(map) = guard.as_mut() {
            map.remove(api_key);
        }
    }
}

/// clear the entire api-key cache. cheap; safe to call from any thread.
pub fn clear_api_key_cache() {
    if let Ok(mut guard) = API_KEY_CACHE.write() {
        *guard = None;
    }
}

fn cache_lookup(api_key: &str) -> Option<AuthenticatedUser> {
    let guard = API_KEY_CACHE.read().ok()?;
    guard.as_ref()?.get(api_key).cloned()
}

fn cache_insert(api_key: String, user: AuthenticatedUser) {
    if let Ok(mut guard) = API_KEY_CACHE.write() {
        guard.get_or_insert_with(HashMap::new).insert(api_key, user);
    }
}

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
/// validates session cookie or api key header
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

    // Try API key from query string (?api_key=...).
    // needed because <audio> / <img> elements can't set headers — used by the
    // embedded media http server in charnel (loopback only).
    if let Some(api_key) = extract_api_key_from_query(request.uri().query()) {
        if let Some(auth_user) = validate_api_key(&api_key).await {
            request.extensions_mut().insert(auth_user);
            return Ok(next.run(request).await);
        }
    }

    Err(ApiError::Unauthorized)
}

/// extract `api_key` from a query string.
///
/// returns the value of the FIRST `api_key=...` pair, or `None` if absent.
/// also accepts the alias `apiKey` (camelCase) for js-friendliness. no
/// percent-decoding: our api keys are 64-char hex strings that never need
/// escaping, and we control all callers (loopback embedded server only).
fn extract_api_key_from_query(query: Option<&str>) -> Option<String> {
    let q = query?;
    for pair in q.split('&') {
        let mut it = pair.splitn(2, '=');
        let k = it.next()?;
        let v = it.next().unwrap_or("");
        if k == "api_key" || k == "apiKey" {
            return Some(v.to_string());
        }
    }
    None
}

/// validate an API key and return AuthenticatedUser if valid.
/// publicly exported as `validate_api_key_cached` for the media server.
pub async fn validate_api_key_cached(api_key: &str) -> Option<AuthenticatedUser> {
    validate_api_key(api_key).await
}

/// validate an API key and return AuthenticatedUser if valid
async fn validate_api_key(api_key: &str) -> Option<AuthenticatedUser> {
    if let Some(cached) = cache_lookup(api_key) {
        return Some(cached);
    }
    let response = grimoire::users::find_user_by_api_key(api_key).await;
    let user = response.data?;
    let auth_user = AuthenticatedUser {
        user_id: user.id,
        username: user.username,
        role: user.role,
    };
    cache_insert(api_key.to_string(), auth_user.clone());
    Some(auth_user)
}

/// validate origin middleware
///
/// validates request Origin header against config.auth.allowed_origins
/// injects ValidatedOrigin into request extensions for webauthn handlers
///
/// this allows supporting multiple origins (prod, staging, localhost) at runtime
/// also supports "any" in allowed_origins to accept any origin
///
/// skips validation for P2P requests (those with X-Peer-Node-Id header) since
/// they don't have a browser Origin and don't use webauthn
pub async fn validate_origin(
    Extension(state): Extension<AppState>,
    headers: HeaderMap,
    mut request: Request,
    next: Next,
) -> Result<Response, ApiError> {
    // skip origin validation for P2P requests (federation transport)
    // P2P requests have X-Peer-Node-Id header set by the federation handler
    if headers.get("X-Peer-Node-Id").is_some() {
        return Ok(next.run(request).await);
    }

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
                if let Some(auth_user) = validate_api_key(api_key).await {
                    request.extensions_mut().insert(auth_user);
                }
            }
        }
    }

    // also accept ?api_key=... query param (see require_auth for rationale)
    if let Some(api_key) = extract_api_key_from_query(request.uri().query()) {
        if let Some(auth_user) = validate_api_key(&api_key).await {
            request.extensions_mut().insert(auth_user);
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
