//! central dispatch - routes requests to handlers
//!
//! all API requests go through dispatch(). this is the single entry point.
//! domain-level dispatch functions handle route matching within their domain.

use super::caller::Caller;
use crate::api_registry::Method;
use crate::error::ErrorDetail;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

/// dispatch an API request to its handler
///
/// transports call this after authenticating the caller.
/// returns GrimoireResponse<Value> - preserves errors vec from handlers.
///
/// # arguments
/// * `path` - route path (e.g., "/api/music/playlists/list")
/// * `caller` - authenticated caller identity
/// * `body` - request body as JSON value (can be null for no-body requests)
/// * `method` - optional HTTP method (used to differentiate GET vs DELETE on same path)
pub async fn dispatch(
    path: &str,
    caller: &Caller,
    body: JsonValue,
    method: Option<Method>,
) -> GrimoireResponse<JsonValue> {
    // normalize path (strip trailing slash)
    let path = path.trim_end_matches('/');

    // try each domain dispatcher in turn
    // domains return Some(response) if they handle the path, None otherwise

    // public routes first (no auth required)
    if let Some(resp) = super::public::dispatch(path, caller, &body).await {
        return resp;
    }

    if let Some(resp) = super::music::dispatch(path, caller, &body, method).await {
        return resp;
    }

    if let Some(resp) = super::auth::dispatch(path, caller, &body).await {
        return resp;
    }

    if let Some(resp) = super::admin::dispatch(path, caller, &body, method).await {
        return resp;
    }

    if let Some(resp) = super::upload::dispatch(path, caller, &body).await {
        return resp;
    }

    if let Some(resp) = super::sync::dispatch(path, caller, &body).await {
        return resp;
    }

    // no domain handled this path
    GrimoireResponse::failure(
        "route not found",
        vec![ErrorDetail::new(
            "route_not_found",
            "route not found",
            &format!("no handler for {}", path),
        )],
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::users::UserRole;

    #[tokio::test]
    async fn test_dispatch_unknown_route_returns_rfc9457_error() {
        let caller = Caller::new("test", "test", UserRole::Member);
        let response = dispatch("/api/nonexistent", &caller, JsonValue::Null, None).await;

        assert!(!response.success);
        assert_eq!(response.errors.len(), 1);

        let err = &response.errors[0];
        assert_eq!(err.error_type, "route_not_found");
        assert!(!err.title.is_empty());
        assert!(!err.detail.is_empty());
    }
}
