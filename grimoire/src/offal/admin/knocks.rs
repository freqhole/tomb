//! knock admin handlers
//!
//! admin endpoints for managing knock requests

use crate::error::ErrorDetail;
use crate::federation::knock::{
    accept_knock, delete_knock, get_knock, list_knocks, reject_knock, ProcessKnockRequest,
};
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use serde::Deserialize;
use serde_json::Value as JsonValue;

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

pub async fn accept_by_id(caller: &Caller, id: &str, body: JsonValue) -> GrimoireResponse<JsonValue> {
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

// --- legacy body-based handlers (kept for compatibility) ---

/// get a specific knock (legacy body-based)
#[derive(Deserialize)]
struct GetKnockRequest {
    knock_id: String,
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
                    &e.to_string(),
                )],
            )
        }
    };

    let response = get_knock(&req.knock_id).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// accept a knock (legacy body-based)
#[derive(Deserialize)]
struct AcceptKnockRequest {
    knock_id: String,
    username: Option<String>,
    role: Option<String>,
    user_id: Option<String>,
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
                    &e.to_string(),
                )],
            )
        }
    };

    let process_req = ProcessKnockRequest {
        username: req.username,
        role: req.role.unwrap_or_else(|| "member".to_string()),
        user_id: req.user_id,
    };

    match accept_knock(&req.knock_id, process_req, &caller.user_id).await {
        Ok(knock) => {
            GrimoireResponse::success("knock accepted", serde_json::to_value(knock).unwrap())
        }
        Err(e) => GrimoireResponse::failure("failed to accept knock", vec![ErrorDetail::from(e)]),
    }
}

/// reject a knock (legacy body-based)
#[derive(Deserialize)]
struct RejectKnockRequest {
    knock_id: String,
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
                    &e.to_string(),
                )],
            )
        }
    };

    match reject_knock(&req.knock_id, &caller.user_id).await {
        Ok(knock) => {
            GrimoireResponse::success("knock rejected", serde_json::to_value(knock).unwrap())
        }
        Err(e) => GrimoireResponse::failure("failed to reject knock", vec![ErrorDetail::from(e)]),
    }
}

/// delete a knock (legacy body-based)
#[derive(Deserialize)]
struct DeleteKnockRequest {
    knock_id: String,
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
                    &e.to_string(),
                )],
            )
        }
    };

    match delete_knock(&req.knock_id).await {
        Ok(()) => GrimoireResponse::success("knock deleted", JsonValue::Null),
        Err(e) => GrimoireResponse::failure("failed to delete knock", vec![ErrorDetail::from(e)]),
    }
}
