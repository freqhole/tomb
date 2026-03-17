//! central dispatch - routes requests to handlers
//!
//! all API requests go through dispatch(). this is the single entry point.
//! domain-level dispatch functions handle route matching within their domain.

use super::caller::Caller;
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
pub async fn dispatch(path: &str, caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    // normalize path (strip trailing slash)
    let path = path.trim_end_matches('/');

    // try each domain dispatcher in turn
    // domains return Some(response) if they handle the path, None otherwise

    // public routes first (no auth required)
    if let Some(resp) = super::public::dispatch(path, caller, &body).await {
        return resp;
    }

    if let Some(resp) = super::music::dispatch(path, caller, &body).await {
        return resp;
    }

    if let Some(resp) = super::auth::dispatch(path, caller, &body).await {
        return resp;
    }

    if let Some(resp) = super::admin::dispatch(path, caller, &body).await {
        return resp;
    }

    if let Some(resp) = super::upload::dispatch(path, caller, &body).await {
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
    async fn test_dispatch_unknown_route() {
        let caller = Caller::new("test", "test", UserRole::Member);
        let response = dispatch("/api/nonexistent", &caller, JsonValue::Null).await;
        assert!(!response.success);
        // verify RFC 9457 style error is preserved
        assert_eq!(response.errors.len(), 1);
        assert_eq!(response.errors[0].error_type, "route_not_found");
    }

    #[tokio::test]
    async fn test_dispatch_errors_have_detail() {
        let caller = Caller::new("test", "test", UserRole::Member);
        let response = dispatch("/api/missing", &caller, JsonValue::Null).await;
        // errors should have all three RFC 9457 fields
        let err = &response.errors[0];
        assert!(!err.error_type.is_empty());
        assert!(!err.title.is_empty());
        assert!(!err.detail.is_empty());
    }
}
