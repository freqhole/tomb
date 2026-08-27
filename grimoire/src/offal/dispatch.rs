//! central dispatch - routes requests to handlers
//!
//! all API requests go through dispatch(). this is the single entry point.
//! domain-level dispatch functions handle route matching within their domain.

use super::caller::Caller;
use crate::api_registry::{Method, RouteAuth};
use crate::error::ErrorDetail;
use crate::jobs::job_events::CloseReason;
use crate::response::GrimoireResponse;
use futures_util::stream::BoxStream;
use serde_json::Value as JsonValue;

/// look up the matched route (path, and optionally method) for its own
/// `name` (used as the acl scope) and auth requirement. returns None if the
/// path is not in the route registry (e.g. handled outside offal dispatch,
/// like blob streaming).
fn find_route(path: &str, method: Option<Method>) -> Option<(&'static str, RouteAuth)> {
    let routes = super::all_routes();
    let mut path_match: Option<(&'static str, RouteAuth)> = None;
    for route in &routes {
        if route.path == path {
            if let Some(m) = method {
                if route.method == m {
                    return Some((route.name, route.auth));
                }
            }
            if path_match.is_none() {
                path_match = Some((route.name, route.auth));
            }
        }
    }
    path_match
}

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

    // enforce route-level role requirements before reaching any handler.
    // Public and Authenticated variants need no check here (middleware already
    // ensures the caller is populated for authenticated routes, and Public routes
    // are open to everyone). Owner and OwnerOr cannot be checked centrally because
    // they require knowledge of the resource's owner; those remain the handler's
    // responsibility - see the allowlist test in this module's test section.
    if let Some((name, RouteAuth::Role(_))) = find_route(path, method) {
        if let Err(resp) = crate::acl_bridge::require_scope(caller, name).await {
            return resp;
        }
    }

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

    if let Some(resp) = super::video::dispatch(path, caller, &body, method).await {
        return resp;
    }

    if let Some(resp) = super::entities::dispatch(path, caller, &body, method).await {
        return resp;
    }

    // no domain handled this path
    GrimoireResponse::failure(
        "route not found",
        vec![ErrorDetail::new(
            "route_not_found",
            "route not found",
            format!("no handler for {}", path),
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

    // --- role enforcement tests ---
    //
    // the route used for admin-gate tests is /api/taxonomy/kinds/create (Role(Admin)).
    // the route used for member-gate tests is /api/analytics/sessions (Role(Member)).
    // the route used for public tests is /health (Public).
    //
    // a denied verdict now falls through to `acl_bridge::require_scope`'s
    // narrow-grant fallback, which opens the crate's real haruspex pool -
    // so any test proving a denial needs this crate's usual db-singleton
    // test setup and `#[ignore]` convention; a passing verdict never
    // reaches that fallback and stays a plain, fast unit test.

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_role_check_viewer_forbidden_on_admin_route() {
        crate::config::init_config_for_tests();
        let caller = Caller::new("u1", "viewer", UserRole::Viewer);
        let resp = dispatch("/api/taxonomy/kinds/create", &caller, JsonValue::Null, None).await;
        assert!(!resp.success);
        assert_eq!(resp.errors.len(), 1);
        assert_eq!(resp.errors[0].error_type, "forbidden");
    }

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_role_check_member_forbidden_on_admin_route() {
        crate::config::init_config_for_tests();
        let caller = Caller::new("u2", "member", UserRole::Member);
        let resp = dispatch("/api/taxonomy/kinds/create", &caller, JsonValue::Null, None).await;
        assert!(!resp.success);
        assert_eq!(resp.errors.len(), 1);
        assert_eq!(resp.errors[0].error_type, "forbidden");
    }

    #[tokio::test]
    async fn test_role_check_admin_reaches_handler_on_admin_route() {
        // admin has Role(Admin) privilege - the auth gate passes.
        // the handler receives a null body and returns bad_request (not forbidden).
        let caller = Caller::new("u3", "admin", UserRole::Admin);
        let resp = dispatch("/api/taxonomy/kinds/create", &caller, JsonValue::Null, None).await;
        // any error other than "forbidden" proves the gate was passed
        let is_forbidden = resp.errors.iter().any(|e| e.error_type == "forbidden");
        assert!(
            !is_forbidden,
            "admin should not be forbidden on admin route"
        );
    }

    #[tokio::test]
    #[ignore = "needs its own process: touches the real db pool singletons"]
    async fn test_role_check_viewer_forbidden_on_member_route() {
        crate::config::init_config_for_tests();
        let caller = Caller::new("u4", "viewer", UserRole::Viewer);
        let resp = dispatch("/api/analytics/sessions", &caller, JsonValue::Null, None).await;
        assert!(!resp.success);
        assert_eq!(resp.errors.len(), 1);
        assert_eq!(resp.errors[0].error_type, "forbidden");
    }

    #[tokio::test]
    async fn test_role_check_public_route_no_check() {
        // a Viewer-role anonymous caller can reach a Public route without restriction.
        // /api/internal/device-linked is Public and returns success even with a null body.
        let caller = Caller::new("anonymous", "anonymous", UserRole::Viewer);
        let resp = dispatch(
            "/api/internal/device-linked",
            &caller,
            JsonValue::Null,
            None,
        )
        .await;
        assert!(resp.success, "public route must be reachable by any caller");
    }

    // --- owner-route allowlist meta-test ---
    //
    // Owner and OwnerOr routes cannot be checked centrally (they require knowing
    // which user owns the resource). each such route MUST have its own handler-
    // level ownership check. this test asserts that the set of Owner/OwnerOr
    // routes in the registry exactly matches this allowlist, so any new Owner
    // route fails the test until it is reviewed and added here.
    //
    // before adding a route: verify the handler actually checks ownership.
    // passkey routes (list/delete/link-node): queries are scoped to caller.user_id.
    // session progress/songs/status: repository functions accept caller.user_id and
    //   scope the update to rows owned by that user.
    // session delete, playlist mutate routes: handler calls
    //   acl_bridge::require_owner_or_scope(owner_id, caller, scope).
    // import review mutate routes: handler checks caller_meets_scope(...) OR that the
    //   caller uploaded at least one song in the target album - a many-to-one
    //   "uploader" relationship require_owner_or_scope's single-owner-id shape
    //   can't express, so these combine caller_meets_scope with a direct async
    //   ownership check instead of require_owner_or_scope.
    #[test]
    fn test_owner_routes_match_allowlist() {
        use crate::api_registry::RouteAuth;
        use std::collections::HashSet;

        const HANDLER_ENFORCED_OWNER_ROUTES: &[&str] = &[
            // passkey management - always scoped to caller.user_id
            "list_passkeys",
            "delete_passkey",
            "link_node",
            // playback session writes - repository functions scope to caller.user_id
            "update_playback_session_progress",
            "update_playback_session_items",
            "update_playback_session_status",
            // playback session delete - handler checks owner or admin
            "delete_playback_session",
            // playlist mutations - handler checks owner or admin
            "update_playlist",
            "delete_playlist",
            "add_songs_to_playlist",
            "remove_songs_from_playlist",
            "reorder_playlist_songs",
            // import review mutations - handler checks admin, or that the
            // caller uploaded at least one song in the target album
            "mark_album_reviewed",
            "patch_album_review",
            "merge_albums_review",
            "move_song_review",
        ];

        let allowlist: HashSet<&str> = HANDLER_ENFORCED_OWNER_ROUTES.iter().copied().collect();

        let in_registry: HashSet<&str> = crate::offal::all_routes()
            .iter()
            .filter(|r| matches!(r.auth, RouteAuth::Owner | RouteAuth::OwnerOr(_)))
            .map(|r| r.name)
            .collect();

        let missing_from_allowlist: Vec<&&str> = in_registry
            .iter()
            .filter(|name| !allowlist.contains(*name))
            .collect();

        let missing_from_registry: Vec<&&str> = allowlist
            .iter()
            .filter(|name| !in_registry.contains(*name))
            .collect();

        assert!(
            missing_from_allowlist.is_empty(),
            "new Owner/OwnerOr routes found in registry but not in the allowlist - \
             verify the handler checks ownership, then add to HANDLER_ENFORCED_OWNER_ROUTES: \
             {:?}",
            missing_from_allowlist
        );
        assert!(
            missing_from_registry.is_empty(),
            "allowlist contains route names not found in the registry - \
             remove stale entries from HANDLER_ENFORCED_OWNER_ROUTES: {:?}",
            missing_from_registry
        );
    }
}
