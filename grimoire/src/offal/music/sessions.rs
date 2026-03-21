//! listen session API handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::music::analytics::sessions::{
    create_listen_session, delete_listen_session, get_listen_session, list_listen_sessions,
    update_listen_session_progress, update_listen_session_songs, update_listen_session_status,
    CreateListenSessionRequest, DeleteListenSessionRequest, GetListenSessionRequest,
    ListListenSessionsRequest, UpdateListenSessionProgressRequest, UpdateListenSessionSongsRequest,
    UpdateListenSessionStatusRequest,
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
        path: "/api/analytics/sessions/get",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "GetListenSessionRequest",
        response_type: "ListenSession",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "update_listen_session_progress",
        path: "/api/analytics/sessions/progress",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UpdateListenSessionProgressRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Owner,
    },
    RouteInfo {
        name: "update_listen_session_songs",
        path: "/api/analytics/sessions/songs",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UpdateListenSessionSongsRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Owner,
    },
    RouteInfo {
        name: "update_listen_session_status",
        path: "/api/analytics/sessions/status",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "UpdateListenSessionStatusRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Owner,
    },
    RouteInfo {
        name: "delete_listen_session",
        path: "/api/analytics/sessions/delete",
        method: Method::POST,
        domain: Domain::Music,
        request_type: "DeleteListenSessionRequest",
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

/// get a listen session by id
///
/// path: POST /api/analytics/sessions/get
pub async fn get(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: GetListenSessionRequest = match serde_json::from_value(body) {
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

    // first get the session to check ownership
    let get_response = get_listen_session(&req.id).await;

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

/// update listen session progress
///
/// path: POST /api/analytics/sessions/progress
pub async fn update_progress(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
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

    let response = update_listen_session_progress(&req.id, &caller.user_id, &req).await;
    response.map(|_| JsonValue::Null)
}

/// update listen session songs
///
/// path: POST /api/analytics/sessions/songs
pub async fn update_songs(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
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

    let response = update_listen_session_songs(&req.id, &caller.user_id, &req).await;
    response.map(|_| JsonValue::Null)
}

/// update listen session status
///
/// path: POST /api/analytics/sessions/status
pub async fn update_status(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: UpdateListenSessionStatusRequest = match serde_json::from_value(body) {
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

    let response = update_listen_session_status(&req.id, &caller.user_id, &req.status).await;
    response.map(|_| JsonValue::Null)
}

/// delete a listen session
///
/// path: POST /api/analytics/sessions/delete
pub async fn delete(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: DeleteListenSessionRequest = match serde_json::from_value(body) {
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

    // verify ownership before deleting
    let get_response = get_listen_session(&req.id).await;
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

    let response = delete_listen_session(&req.id).await;
    response.map(|_| JsonValue::Null)
}
