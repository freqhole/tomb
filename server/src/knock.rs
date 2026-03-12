//! knock request handlers - P2P access request management

use axum::extract::Path;
use axum::http::HeaderMap;
use axum::Extension;
use axum::Json;
use grimoire::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use grimoire::config::get_config;
use grimoire::federation::knock::{
    self, CreateKnockRequest, KnockRequest, KnockStatusResponse, ProcessKnockRequest,
};
use grimoire::health::EmptyResponse;
use grimoire::response::GrimoireResponse;
use grimoire::users::UserRole;

use crate::auth::{check_role, AuthenticatedUser};
use crate::error::ApiError;

/// create or retrieve a knock request (P2P public endpoint)
/// extracts node_id from X-Peer-Node-Id header (set by P2P transport handler)
pub async fn create_knock_public(
    headers: HeaderMap,
    Json(request): Json<CreateKnockRequest>,
) -> Result<Json<GrimoireResponse<KnockRequest>>, ApiError> {
    // extract node_id from X-Peer-Node-Id header
    let node_id = headers
        .get("X-Peer-Node-Id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| ApiError::BadRequest("missing X-Peer-Node-Id header".to_string()))?;

    // check if knocking is enabled
    let config = get_config();
    let knocking_enabled = config
        .federation
        .as_ref()
        .filter(|f| f.enabled)
        .map(|f| f.knocking_enabled)
        .unwrap_or(false);

    if !knocking_enabled {
        return Err(ApiError::BadRequest(
            "knocking is not enabled on this server".to_string(),
        ));
    }

    let response = knock::create_knock(&node_id, request).await;
    Ok(Json(response))
}

inventory::submit! {
    RouteInfo {
        name: "create_knock_public",
        path: "/api/knock",
        method: Method::POST,
        domain: Domain::Admin, // domain doesn't matter for unauthenticated routes
        request_type: "CreateKnockRequest",
        response_type: "KnockRequest",
        auth: RouteAuth::Public, // public P2P endpoint
    }
}

/// check knock status (P2P public endpoint)
/// extracts node_id from X-Peer-Node-Id header
pub async fn get_knock_status_public(
    headers: HeaderMap,
) -> Result<Json<GrimoireResponse<KnockStatusResponse>>, ApiError> {
    // extract node_id from X-Peer-Node-Id header
    let node_id = headers
        .get("X-Peer-Node-Id")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| ApiError::BadRequest("missing X-Peer-Node-Id header".to_string()))?;

    let response = knock::get_knock_status(&node_id).await;
    Ok(Json(response))
}

inventory::submit! {
    RouteInfo {
        name: "get_knock_status_public",
        path: "/api/knock/status",
        method: Method::GET,
        domain: Domain::Admin,
        request_type: "String",
        response_type: "KnockStatusResponse",
        auth: RouteAuth::Public, // public P2P endpoint
    }
}

/// create or retrieve a knock request (internal - used by transport handler)
pub async fn create_knock(
    node_id: String,
    Json(request): Json<CreateKnockRequest>,
) -> Result<Json<GrimoireResponse<KnockRequest>>, ApiError> {
    // check if knocking is enabled
    let config = get_config();
    let knocking_enabled = config
        .federation
        .as_ref()
        .filter(|f| f.enabled)
        .map(|f| f.knocking_enabled)
        .unwrap_or(false);

    if !knocking_enabled {
        return Err(ApiError::BadRequest(
            "knocking is not enabled on this server".to_string(),
        ));
    }

    let response = knock::create_knock(&node_id, request).await;
    Ok(Json(response))
}

/// check knock status (internal - used by transport handler)
pub async fn get_knock_status(
    node_id: String,
) -> Result<Json<GrimoireResponse<KnockStatusResponse>>, ApiError> {
    let response = knock::get_knock_status(&node_id).await;
    Ok(Json(response))
}

/// list pending knock requests (admin only)
pub async fn list_knocks(
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<GrimoireResponse<Vec<KnockRequest>>>, ApiError> {
    check_role(&user, UserRole::Admin)?;

    let response = knock::list_knocks(false).await;
    Ok(Json(response))
}

inventory::submit! {
    RouteInfo {
        name: "list_knocks",
        path: "/api/admin/knocks",
        method: Method::GET,
        domain: Domain::Admin,
        request_type: "String",
        response_type: "Vec<KnockRequest>",
        auth: RouteAuth::Role(UserRole::Admin),
    }
}

/// list all knock requests including processed (admin only)
pub async fn list_all_knocks(
    Extension(user): Extension<AuthenticatedUser>,
) -> Result<Json<GrimoireResponse<Vec<KnockRequest>>>, ApiError> {
    check_role(&user, UserRole::Admin)?;

    let response = knock::list_knocks(true).await;
    Ok(Json(response))
}

inventory::submit! {
    RouteInfo {
        name: "list_all_knocks",
        path: "/api/admin/knocks/all",
        method: Method::GET,
        domain: Domain::Admin,
        request_type: "String",
        response_type: "Vec<KnockRequest>",
        auth: RouteAuth::Role(UserRole::Admin),
    }
}

/// get a specific knock request by ID (admin only)
pub async fn get_knock(
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> Result<Json<GrimoireResponse<KnockRequest>>, ApiError> {
    check_role(&user, UserRole::Admin)?;

    let response = knock::get_knock(&id).await;
    Ok(Json(response))
}

inventory::submit! {
    RouteInfo {
        name: "get_knock",
        path: "/api/admin/knocks/{id}",
        method: Method::GET,
        domain: Domain::Admin,
        request_type: "String",
        response_type: "KnockRequest",
        auth: RouteAuth::Role(UserRole::Admin),
    }
}

/// accept a knock request - creates user and peer mapping (admin only)
pub async fn accept_knock(
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
    Json(request): Json<ProcessKnockRequest>,
) -> Result<Json<KnockRequest>, ApiError> {
    check_role(&user, UserRole::Admin)?;

    match knock::accept_knock(&id, request, &user.user_id).await {
        Ok(knock) => Ok(Json(knock)),
        Err(e) => Err(ApiError::from(e)),
    }
}

inventory::submit! {
    RouteInfo {
        name: "accept_knock",
        path: "/api/admin/knocks/{id}/accept",
        method: Method::POST,
        domain: Domain::Admin,
        request_type: "ProcessKnockRequest",
        response_type: "KnockRequest",
        auth: RouteAuth::Role(UserRole::Admin),
    }
}

/// reject a knock request (admin only)
pub async fn reject_knock(
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> Result<Json<KnockRequest>, ApiError> {
    check_role(&user, UserRole::Admin)?;

    match knock::reject_knock(&id, &user.user_id).await {
        Ok(knock) => Ok(Json(knock)),
        Err(e) => Err(ApiError::from(e)),
    }
}

inventory::submit! {
    RouteInfo {
        name: "reject_knock",
        path: "/api/admin/knocks/{id}/reject",
        method: Method::POST,
        domain: Domain::Admin,
        request_type: "String",
        response_type: "KnockRequest",
        auth: RouteAuth::Role(UserRole::Admin),
    }
}

/// delete a knock request (admin only) - allows the node to knock again
pub async fn delete_knock(
    Extension(user): Extension<AuthenticatedUser>,
    Path(id): Path<String>,
) -> Result<Json<EmptyResponse>, ApiError> {
    check_role(&user, UserRole::Admin)?;

    match knock::delete_knock(&id).await {
        Ok(()) => Ok(Json(EmptyResponse::ok())),
        Err(e) => Err(ApiError::from(e)),
    }
}

inventory::submit! {
    RouteInfo {
        name: "delete_knock",
        path: "/api/admin/knocks/{id}",
        method: Method::DELETE,
        domain: Domain::Admin,
        request_type: "String",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    }
}
