//! playback session API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::analytics::sessions::{
    create_playback_session, delete_playback_session, get_playback_session, list_playback_sessions,
    update_playback_session_items, update_playback_session_progress,
    update_playback_session_status, CreatePlaybackSessionRequest, DeletePlaybackSessionRequest,
    GetPlaybackSessionRequest, ListPlaybackSessionsRequest, UpdatePlaybackSessionItemsRequest,
    UpdatePlaybackSessionProgressRequest, UpdatePlaybackSessionStatusRequest,
};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use serde_json::Value as JsonValue;

/// route metadata for playback sessions
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "create_playback_session",
        path: "/api/analytics/sessions",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "CreatePlaybackSessionRequest",
        response_type: "PlaybackSession",
        // a session is just a viewer's own playback/feed record (scoped to
        // caller.user_id); mutating it after creation still requires
        // Owner, so viewers can't touch anyone else's sessions.
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "list_playback_sessions",
        path: "/api/analytics/sessions/list",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ListPlaybackSessionsRequest",
        response_type: "ListPlaybackSessionsResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_playback_session",
        path: "/api/analytics/sessions/get",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetPlaybackSessionRequest",
        response_type: "PlaybackSession",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "update_playback_session_progress",
        path: "/api/analytics/sessions/progress",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UpdatePlaybackSessionProgressRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Owner,
    },
    RouteInfo {
        name: "update_playback_session_items",
        path: "/api/analytics/sessions/items",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UpdatePlaybackSessionItemsRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Owner,
    },
    RouteInfo {
        name: "update_playback_session_status",
        path: "/api/analytics/sessions/status",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UpdatePlaybackSessionStatusRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Owner,
    },
    RouteInfo {
        name: "delete_playback_session",
        path: "/api/analytics/sessions/delete",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "DeletePlaybackSessionRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::OwnerOr(UserRole::Admin),
    },
];

/// create a playback session
///
/// path: POST /api/analytics/sessions
pub async fn create(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    tracing::debug!(user_id = %caller.user_id, "offal: create_playback_session");

    let req: CreatePlaybackSessionRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "offal: create_playback_session: bad request");
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            );
        }
    };

    tracing::debug!(
        item_count = req.items.len(),
        session_type = %req.session_type,
        "offal: create_playback_session: parsed request"
    );

    let response = create_playback_session(&caller.user_id, &req).await;

    if !response.success {
        tracing::warn!(
            message = %response.message,
            error_count = response.errors.len(),
            "offal: create_playback_session: failed"
        );
    }

    response.map(|data| serde_json::to_value(data).unwrap())
}

/// list playback sessions
///
/// path: POST /api/analytics/sessions/list
pub async fn list(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let mut req: ListPlaybackSessionsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            )
        }
    };

    // non-admins can only list their own sessions
    match &req.user_id {
        Some(uid) => {
            if let Err(resp) = crate::acl_bridge::require_owner_or_scope(
                Some(uid.as_str()),
                caller,
                "list_playback_sessions",
            )
            .await
            {
                return resp;
            }
        }
        None => req.user_id = Some(caller.user_id.clone()),
    }

    let response = list_playback_sessions(&req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get a playback session by id
///
/// path: POST /api/analytics/sessions/get
pub async fn get(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetPlaybackSessionRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            )
        }
    };

    // first get the session to check ownership
    let get_response = get_playback_session(&req.id).await;

    if let Some(session) = &get_response.data {
        // verify ownership unless admin
        if let Err(resp) = crate::acl_bridge::require_owner_or_scope(
            Some(session.user_id.as_str()),
            caller,
            "get_playback_session",
        )
        .await
        {
            return resp;
        }
    }

    get_response.map(|data| serde_json::to_value(data).unwrap())
}

/// update playback session progress
///
/// path: POST /api/analytics/sessions/progress
pub async fn update_progress(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: UpdatePlaybackSessionProgressRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            )
        }
    };

    let response = update_playback_session_progress(&req.id, &caller.user_id, &req).await;
    response.map(|_| JsonValue::Null)
}

/// update playback session items
///
/// path: POST /api/analytics/sessions/items
pub async fn update_items(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: UpdatePlaybackSessionItemsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            )
        }
    };

    let response = update_playback_session_items(&req.id, &caller.user_id, &req).await;
    response.map(|_| JsonValue::Null)
}

/// update playback session status
///
/// path: POST /api/analytics/sessions/status
pub async fn update_status(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: UpdatePlaybackSessionStatusRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            )
        }
    };

    let response = update_playback_session_status(&req.id, &caller.user_id, &req.status).await;
    response.map(|_| JsonValue::Null)
}

/// delete a playback session
///
/// path: POST /api/analytics/sessions/delete
pub async fn delete(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: DeletePlaybackSessionRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    e.to_string(),
                )],
            )
        }
    };

    // verify ownership before deleting
    let get_response = get_playback_session(&req.id).await;
    if let Some(session) = &get_response.data {
        if let Err(resp) = crate::acl_bridge::require_owner_or_scope(
            Some(session.user_id.as_str()),
            caller,
            "delete_playback_session",
        )
        .await
        {
            return resp;
        }
    } else {
        return GrimoireResponse::failure(
            "session not found",
            vec![ErrorDetail::new(
                "not_found",
                "not found",
                "session not found",
            )],
        );
    }

    let response = delete_playback_session(&req.id).await;
    response.map(|_| JsonValue::Null)
}
