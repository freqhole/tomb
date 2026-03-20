//! listen session API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::analytics::sessions::{
    create_listen_session, delete_listen_session, get_listen_session, list_listen_sessions,
    update_listen_session_progress, update_listen_session_songs, update_listen_session_status,
    CreateListenSessionRequest, ListListenSessionsRequest, UpdateListenSessionProgressRequest,
    UpdateListenSessionSongsRequest,
};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use serde_json::Value as JsonValue;

/// route metadata for listen sessions
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "create_listen_session",
        path: "/api/analytics/sessions",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "CreateListenSessionRequest",
        response_type: "ListenSession",
        auth: RouteAuth::Role(UserRole::Member),
    },
    RouteInfo {
        name: "list_listen_sessions",
        path: "/api/analytics/sessions/list",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "ListListenSessionsRequest",
        response_type: "ListListenSessionsResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "get_listen_session",
        path: "/api/analytics/sessions/{id}",
        method: Method::GET,
        domain: Domain::Music,
        request_type: "String",
        response_type: "ListenSession",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "update_listen_session_progress",
        path: "/api/analytics/sessions/{id}/progress",
        method: Method::PUT,
        domain: Domain::Music,
        request_type: "UpdateListenSessionProgressRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Owner,
    },
    RouteInfo {
        name: "update_listen_session_songs",
        path: "/api/analytics/sessions/{id}/songs",
        method: Method::PUT,
        domain: Domain::Music,
        request_type: "UpdateListenSessionSongsRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Owner,
    },
    RouteInfo {
        name: "update_listen_session_status",
        path: "/api/analytics/sessions/{id}/status/{status}",
        method: Method::PUT,
        domain: Domain::Music,
        request_type: "String",
        response_type: "EmptyResponse",
        auth: RouteAuth::Owner,
    },
    RouteInfo {
        name: "delete_listen_session",
        path: "/api/analytics/sessions/{id}",
        method: Method::DELETE,
        domain: Domain::Music,
        request_type: "String",
        response_type: "EmptyResponse",
        auth: RouteAuth::Owner,
    },
];

/// create a listen session
///
/// path: POST /api/analytics/sessions
pub async fn create(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    tracing::debug!(user_id = %caller.user_id, "offal: create_listen_session");

    let req: CreateListenSessionRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!(error = %e, "offal: create_listen_session: bad request");
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            );
        }
    };

    tracing::debug!(
        song_count = req.song_ids.len(),
        session_type = %req.session_type,
        "offal: create_listen_session: parsed request"
    );

    let response = create_listen_session(&caller.user_id, &req).await;

    if !response.success {
        tracing::warn!(
            message = %response.message,
            error_count = response.errors.len(),
            "offal: create_listen_session: failed"
        );
    }

    response.map(|data| serde_json::to_value(data).unwrap())
}

/// list listen sessions
///
/// path: POST /api/analytics/sessions/list
pub async fn list(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let mut req: ListListenSessionsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    // non-admins can only list their own sessions
    match &req.user_id {
        Some(uid) if uid != &caller.user_id && caller.role != UserRole::Admin => {
            return GrimoireResponse::failure(
                "forbidden",
                vec![ErrorDetail::new(
                    "forbidden",
                    "forbidden",
                    "cannot list another user's sessions",
                )],
            );
        }
        None => req.user_id = Some(caller.user_id.clone()),
        _ => {}
    }

    let response = list_listen_sessions(&req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get a listen session by id (path param)
///
/// path: GET /api/analytics/sessions/{id}
pub async fn get(
    caller: &Caller,
    session_id: &str,
    _body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    // first get the session to check ownership
    let get_response = get_listen_session(session_id).await;

    if let Some(session) = &get_response.data {
        // verify ownership unless admin
        if session.user_id != caller.user_id && caller.role != UserRole::Admin {
            return GrimoireResponse::failure(
                "forbidden",
                vec![ErrorDetail::new(
                    "forbidden",
                    "forbidden",
                    "cannot access another user's session",
                )],
            );
        }
    }

    get_response.map(|data| serde_json::to_value(data).unwrap())
}

/// update listen session progress (path param)
///
/// path: PUT /api/analytics/sessions/{id}/progress
pub async fn update_progress(
    caller: &Caller,
    session_id: &str,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let req: UpdateListenSessionProgressRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = update_listen_session_progress(session_id, &caller.user_id, &req).await;
    response.map(|_| JsonValue::Null)
}

/// update listen session songs (path param)
///
/// path: PUT /api/analytics/sessions/{id}/songs
pub async fn update_songs(
    caller: &Caller,
    session_id: &str,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let req: UpdateListenSessionSongsRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(e) => {
            return GrimoireResponse::failure(
                "bad request",
                vec![ErrorDetail::new(
                    "bad_request",
                    "bad request",
                    &e.to_string(),
                )],
            )
        }
    };

    let response = update_listen_session_songs(session_id, &caller.user_id, &req).await;
    response.map(|_| JsonValue::Null)
}

/// update listen session status (path params: id and status)
///
/// path: PUT /api/analytics/sessions/{id}/status/{status}
pub async fn update_status(
    caller: &Caller,
    session_id: &str,
    status: &str,
    _body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let response = update_listen_session_status(session_id, &caller.user_id, status).await;
    response.map(|_| JsonValue::Null)
}

/// delete a listen session (path param)
///
/// path: DELETE /api/analytics/sessions/{id}
pub async fn delete(
    caller: &Caller,
    session_id: &str,
    _body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    // verify ownership before deleting
    let get_response = get_listen_session(session_id).await;
    if let Some(session) = &get_response.data {
        if session.user_id != caller.user_id && caller.role != UserRole::Admin {
            return GrimoireResponse::failure(
                "forbidden",
                vec![ErrorDetail::new(
                    "forbidden",
                    "forbidden",
                    "cannot delete another user's session",
                )],
            );
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

    let response = delete_listen_session(session_id).await;
    response.map(|_| JsonValue::Null)
}
