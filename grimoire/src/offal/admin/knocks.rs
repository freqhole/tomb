//! knock admin handlers
//!
//! admin endpoints for managing knock requests

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::federation::knock::{
    accept_knock, delete_knock, get_knock, list_knocks, reject_knock, ProcessKnockRequest,
};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::UserRole;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use zod_gen_derive::ZodSchema;

/// route metadata for knock admin
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "list_knocks",
        path: "/api/admin/knocks",
        method: Method::GET,
        domain: Domain::Admin,
        request_type: "String",
        response_type: "Vec<KnockRequest>",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "list_all_knocks",
        path: "/api/admin/knocks/all",
        method: Method::GET,
        domain: Domain::Admin,
        request_type: "String",
        response_type: "Vec<KnockRequest>",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "get_knock",
        path: "/api/admin/knocks/get",
        method: Method::POST,
        domain: Domain::Admin,
        request_type: "GetKnockRequest",
        response_type: "KnockRequest",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "accept_knock",
        path: "/api/admin/knocks/accept",
        method: Method::POST,
        domain: Domain::Admin,
        request_type: "AcceptKnockRequest",
        response_type: "KnockRequest",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "reject_knock",
        path: "/api/admin/knocks/reject",
        method: Method::POST,
        domain: Domain::Admin,
        request_type: "RejectKnockRequest",
        response_type: "KnockRequest",
        auth: RouteAuth::Role(UserRole::Admin),
    },
    RouteInfo {
        name: "delete_knock",
        path: "/api/admin/knocks/delete",
        method: Method::POST,
        domain: Domain::Admin,
        request_type: "DeleteKnockRequest",
        response_type: "EmptyResponse",
        auth: RouteAuth::Role(UserRole::Admin),
    },
];

/// list pending knocks (admin only)
///
/// path: GET /api/admin/knocks
#[derive(Deserialize, Default)]
struct ListKnocksRequest {
    include_all: Option<bool>,
}

pub async fn list(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: ListKnocksRequest = serde_json::from_value(body).unwrap_or_default();
    let response = list_knocks(req.include_all.unwrap_or(false)).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// list all knocks including processed (admin only)
///
/// path: GET /api/admin/knocks/all
pub async fn list_all(caller: &Caller, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let response = list_knocks(true).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// get a specific knock by ID (admin only)
///
/// path: GET /api/admin/knocks/{id}
pub async fn get_by_id(caller: &Caller, id: &str) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let response = get_knock(id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// accept a knock by ID (admin only)
///
/// path: POST /api/admin/knocks/{id}/accept
#[derive(Deserialize, Default)]
struct AcceptKnockBody {
    username: Option<String>,
    role: Option<String>,
    user_id: Option<String>,
}

pub async fn accept_by_id(
    caller: &Caller,
    id: &str,
    body: JsonValue,
) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: AcceptKnockBody = serde_json::from_value(body).unwrap_or_default();
    let process_req = ProcessKnockRequest {
        username: req.username,
        role: req.role.unwrap_or_else(|| "member".to_string()),
        user_id: req.user_id,
    };

    match accept_knock(id, process_req, &caller.user_id).await {
        Ok(knock) => {
            GrimoireResponse::success("knock accepted", serde_json::to_value(knock).unwrap())
        }
        Err(e) => GrimoireResponse::failure("failed to accept knock", vec![ErrorDetail::from(e)]),
    }
}

/// reject a knock by ID (admin only)
///
/// path: POST /api/admin/knocks/{id}/reject
pub async fn reject_by_id(caller: &Caller, id: &str) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    match reject_knock(id, &caller.user_id).await {
        Ok(knock) => {
            GrimoireResponse::success("knock rejected", serde_json::to_value(knock).unwrap())
        }
        Err(e) => GrimoireResponse::failure("failed to reject knock", vec![ErrorDetail::from(e)]),
    }
}

/// delete a knock by ID (admin only)
///
/// path: DELETE /api/admin/knocks/{id}
pub async fn delete_by_id(caller: &Caller, id: &str) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    match delete_knock(id).await {
        Ok(()) => GrimoireResponse::success("knock deleted", JsonValue::Null),
        Err(e) => GrimoireResponse::failure("failed to delete knock", vec![ErrorDetail::from(e)]),
    }
}

/// get a specific knock
///
/// path: POST /api/admin/knocks/get
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetKnockRequest {
    pub id: String,
}

pub async fn get(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: GetKnockRequest = match serde_json::from_value(body) {
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

    let response = get_knock(&req.id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// accept a knock
///
/// path: POST /api/admin/knocks/accept
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AcceptKnockRequest {
    pub id: String,
    pub username: Option<String>,
    pub role: Option<String>,
    pub user_id: Option<String>,
}

pub async fn accept(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: AcceptKnockRequest = match serde_json::from_value(body) {
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

    let process_req = ProcessKnockRequest {
        username: req.username,
        role: req.role.unwrap_or_else(|| "member".to_string()),
        user_id: req.user_id,
    };

    match accept_knock(&req.id, process_req, &caller.user_id).await {
        Ok(knock) => {
            GrimoireResponse::success("knock accepted", serde_json::to_value(knock).unwrap())
        }
        Err(e) => GrimoireResponse::failure("failed to accept knock", vec![ErrorDetail::from(e)]),
    }
}

/// reject a knock
///
/// path: POST /api/admin/knocks/reject
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct RejectKnockRequest {
    pub id: String,
}

pub async fn reject(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: RejectKnockRequest = match serde_json::from_value(body) {
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

    match reject_knock(&req.id, &caller.user_id).await {
        Ok(knock) => {
            GrimoireResponse::success("knock rejected", serde_json::to_value(knock).unwrap())
        }
        Err(e) => GrimoireResponse::failure("failed to reject knock", vec![ErrorDetail::from(e)]),
    }
}

/// delete a knock
///
/// path: POST /api/admin/knocks/delete
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct DeleteKnockRequest {
    pub id: String,
}

pub async fn delete(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: DeleteKnockRequest = match serde_json::from_value(body) {
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

    match delete_knock(&req.id).await {
        Ok(()) => GrimoireResponse::success("knock deleted", JsonValue::Null),
        Err(e) => GrimoireResponse::failure("failed to delete knock", vec![ErrorDetail::from(e)]),
    }
}
