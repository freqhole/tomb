//! user management handlers

use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::{
    CreateUserRequest, UpdateUserRequest, UserQueryParams, UserRole, UserService, WhoAmIResponse,
};
use serde::Deserialize;
use serde_json::Value as JsonValue;

/// get current user info
///
/// path: GET /api/auth/whoami
pub async fn me(caller: &Caller, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    let service = UserService::new();
    let response = service.get_user(&caller.user_id).await;
    response.map(|user| {
        serde_json::to_value(WhoAmIResponse {
            user_id: user.id,
            username: user.username,
            role: user.role.to_string(),
        })
        .unwrap()
    })
}

/// list all users (admin only)
///
/// path: POST /api/auth/users/list
pub async fn list(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let params: UserQueryParams = match serde_json::from_value(body) {
        Ok(p) => p,
        Err(_) => UserQueryParams::default(),
    };

    let service = UserService::new();
    // get caller user for the admin check in list_users
    match service.get_user(&caller.user_id).await.data {
        Some(user) => {
            let response = service.list_users(&params, &user).await;
            response.map(|data| serde_json::to_value(data).unwrap())
        }
        None => GrimoireResponse::failure(
            "user not found",
            vec![ErrorDetail::new(
                "not_found",
                "not found",
                "caller not found",
            )],
        ),
    }
}

/// create a new user (admin only)
///
/// path: POST /api/auth/users/create
pub async fn create(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: CreateUserRequest = match serde_json::from_value(body) {
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

    let service = UserService::new();
    let response = service.register_user(&req).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// update a user
///
/// path: POST /api/auth/users/update
#[derive(Deserialize)]
struct UpdateRequest {
    user_id: String,
    #[serde(flatten)]
    updates: UpdateUserRequest,
}

pub async fn update(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: UpdateRequest = match serde_json::from_value(body) {
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

    // can only update self unless admin
    if req.user_id != caller.user_id && caller.role != UserRole::Admin {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new(
                "forbidden",
                "forbidden",
                "can only update own account",
            )],
        );
    }

    let service = UserService::new();
    // get caller user for the admin check
    match service.get_user(&caller.user_id).await.data {
        Some(admin_user) => {
            let response = service
                .update_user(&req.user_id, &req.updates, &admin_user)
                .await;
            response.map(|data| serde_json::to_value(data).unwrap())
        }
        None => GrimoireResponse::failure(
            "user not found",
            vec![ErrorDetail::new(
                "not_found",
                "not found",
                "caller not found",
            )],
        ),
    }
}

/// delete a user (admin only)
///
/// path: POST /api/auth/users/delete
#[derive(Deserialize)]
struct DeleteRequest {
    user_id: String,
}

pub async fn delete(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    if !caller.is_admin() {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new("forbidden", "forbidden", "admin only")],
        );
    }

    let req: DeleteRequest = match serde_json::from_value(body) {
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

    let service = UserService::new();
    match service.get_user(&caller.user_id).await.data {
        Some(admin_user) => {
            let response = service.delete_user(&req.user_id, &admin_user).await;
            response.map(|_| JsonValue::Null)
        }
        None => GrimoireResponse::failure(
            "user not found",
            vec![ErrorDetail::new(
                "not_found",
                "not found",
                "caller not found",
            )],
        ),
    }
}

/// generate API key for user
///
/// path: POST /api/auth/api-key/generate
#[derive(Deserialize)]
struct ApiKeyRequest {
    user_id: Option<String>,
}

pub async fn generate_api_key(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ApiKeyRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(_) => ApiKeyRequest { user_id: None },
    };

    let target_user = req.user_id.unwrap_or_else(|| caller.user_id.clone());

    // can only generate for self unless admin
    if target_user != caller.user_id && caller.role != UserRole::Admin {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new(
                "forbidden",
                "forbidden",
                "can only generate key for own account",
            )],
        );
    }

    let service = UserService::new();
    let response = service.generate_api_key(&target_user).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// revoke API key for user
///
/// path: POST /api/auth/api-key/revoke
pub async fn revoke_api_key(caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: ApiKeyRequest = match serde_json::from_value(body) {
        Ok(r) => r,
        Err(_) => ApiKeyRequest { user_id: None },
    };

    let target_user = req.user_id.unwrap_or_else(|| caller.user_id.clone());

    // can only revoke for self unless admin
    if target_user != caller.user_id && caller.role != UserRole::Admin {
        return GrimoireResponse::failure(
            "forbidden",
            vec![ErrorDetail::new(
                "forbidden",
                "forbidden",
                "can only revoke key for own account",
            )],
        );
    }

    let service = UserService::new();
    let response = service.revoke_api_key(&target_user).await;
    response.map(|data| serde_json::to_value(data).unwrap())
}

/// logout - stub for offal (actual session handling is HTTP-specific)
///
/// path: POST /api/auth/logout
pub async fn logout(_caller: &Caller, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    // in Tauri/IPC context, logout is primarily about clearing client-side state
    // the session is managed by the transport layer
    GrimoireResponse::success(
        "logged out successfully",
        serde_json::json!({
            "message": "logged out successfully"
        }),
    )
}

/// regenerate API key for current user
///
/// path: POST /api/auth/api-key/regenerate
pub async fn regenerate_api_key(caller: &Caller, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    let service = UserService::new();
    let response = service.generate_api_key(&caller.user_id).await;

    match response.data {
        Some(user) => match user.api_key {
            Some(api_key) => GrimoireResponse::success(
                "API key regenerated successfully. Save this key securely - it won't be shown again.",
                serde_json::json!({
                    "api_key": api_key,
                    "message": "API key regenerated successfully. Save this key securely - it won't be shown again."
                }),
            ),
            None => GrimoireResponse::failure(
                "API key not generated",
                vec![ErrorDetail::new(
                    "api_key_error",
                    "key generation failed",
                    "API key not generated",
                )],
            ),
        },
        None => GrimoireResponse::failure(
            &response.message,
            response.errors,
        ),
    }
}

/// get API key status for current user
///
/// path: GET /api/auth/api-key/status
pub async fn api_key_status(caller: &Caller, _body: JsonValue) -> GrimoireResponse<JsonValue> {
    let service = UserService::new();
    let user_response = service.get_user(&caller.user_id).await;

    match user_response.data {
        Some(user) => {
            let has_key = user
                .api_key
                .as_ref()
                .map(|k| !k.is_empty())
                .unwrap_or(false);
            let api_key_preview = if has_key {
                user.api_key.as_ref().map(|k| {
                    if k.len() >= 16 {
                        format!("{}...{}", &k[..8], &k[k.len() - 8..])
                    } else {
                        "***".to_string()
                    }
                })
            } else {
                None
            };

            GrimoireResponse::success(
                "api key status retrieved",
                serde_json::json!({
                    "has_api_key": has_key,
                    "api_key_preview": api_key_preview
                }),
            )
        }
        None => GrimoireResponse::failure(
            "user not found",
            vec![ErrorDetail::new("not_found", "not found", "user not found")],
        ),
    }
}
