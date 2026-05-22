//! central dispatch - routes requests to handlers
//!
//! all API requests go through dispatch(). this is the single entry point.
//! domain-level dispatch functions handle route matching within their domain.

use super::caller::Caller;
use crate::api_registry::Method;
use crate::error::ErrorDetail;
use crate::jobs::job_events::CloseReason;
use crate::response::GrimoireResponse;
use futures_util::stream::BoxStream;
use serde_json::Value as JsonValue;

/// a server-pushed event stream. items are pre-serialized to
/// `JsonValue` so transports (ws, sse, iroh, tauri) can frame them
/// without touching grimoire's event types. an `Err(CloseReason)`
/// terminates the stream; the transport should close the connection
/// and let the client reconnect + re-snapshot.
pub type EventStream = BoxStream<'static, Result<JsonValue, CloseReason>>;

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

/// dispatch a streaming API request. mirrors `dispatch()` but returns
/// an `EventStream` instead of a single response. transports that
/// don't speak streaming (legacy http POST) can poll `dispatch()` /
/// the snapshot route instead.
///
/// authentication is the transport's job (same as `dispatch`); per-
/// event visibility filtering is the handler's job (subscribe handlers
/// already wrap their stream with `caller_can_see`).
pub async fn dispatch_stream(path: &str, caller: &Caller, body: JsonValue) -> Option<EventStream> {
    let path = path.trim_end_matches('/');
    // today the only streaming routes live under music/jobs.
    // adding domains later is the same pattern as `dispatch`.
    if let Some(s) = super::music::dispatch_stream(path, caller, &body).await {
        return Some(s);
    }
    None
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

    #[tokio::test]
    async fn test_dispatch_stream_unknown_returns_none() {
        let caller = Caller::new("test", "test", UserRole::Member);
        assert!(
            dispatch_stream("/api/nonexistent", &caller, JsonValue::Null)
                .await
                .is_none()
        );
    }

    #[tokio::test]
    async fn test_dispatch_stream_subscribe_yields_emitted_event() {
        use crate::jobs::job_events::{self, EntityRef, JobStatusWire};
        use crate::jobs::JobType;
        use futures_util::StreamExt;

        // unique caller id keeps this test independent of others that
        // share the global broadcast channel.
        let user_id = format!("dispatch-stream-user-{}", std::process::id());
        let caller = Caller::new(user_id.clone(), "u", UserRole::Member);
        // filter to events owned by `user_id` only — admin pollution
        // from other tests won't match the entity_ref check either.
        let body = serde_json::json!({
            "kinds": ["MbAlbumSearch"],
            "job_ids": null,
            "session_ids": null,
            "entity_refs": null,
        });

        // subscribe BEFORE emit so the broadcast has a receiver.
        let stream = dispatch_stream("/api/jobs/events/subscribe", &caller, body)
            .await
            .expect("subscribe route must be registered");
        let mut stream = Box::pin(stream);

        // emit a status event owned by this caller so visibility passes.
        job_events::emit(job_events::JobEvent::StatusChanged {
            session_id: format!("sess-{}", std::process::id()),
            job_id: format!("job-{}", std::process::id()),
            from: None,
            to: JobStatusWire::Running,
            topic: JobType::MbAlbumSearch,
            entity_ref: Some(EntityRef::Album("alb-a".to_string())),
            created_by: Some(user_id.clone()),
        });

        let item = tokio::time::timeout(std::time::Duration::from_millis(500), stream.next())
            .await
            .expect("stream timed out")
            .expect("stream ended")
            .expect("close reason");
        assert_eq!(item["kind"], "status_changed");
        assert_eq!(item["created_by"], user_id);
    }
}
