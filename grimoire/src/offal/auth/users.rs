//! user management handlers

use crate::api_registry::{Domain, Method, RouteAuth, RouteInfo};
use crate::error::ErrorDetail;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use crate::users::{
    CreateUserRequest, InviteCodeType, RedeemInviteRequest, UpdateUserRequest, UserQueryParams,
    UserService, WhoAmIResponse,
};
use serde::Deserialize;
use serde_json::Value as JsonValue;

/// route metadata for auth/user management
pub const ROUTES: &[RouteInfo] = &[
    RouteInfo {
        name: "whoami",
        path: "/api/auth/whoami",
        method: Method::GET,
        domain: Domain::Auth,
        request_type: "String",
        response_type: "WhoAmIResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "logout",
        path: "/api/auth/logout",
        method: Method::POST,
        domain: Domain::Auth,
        request_type: "String",
        response_type: "serde_json::Value",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "api_key_status",
        path: "/api/auth/api-key/status",
        method: Method::GET,
        domain: Domain::Auth,
        request_type: "String",
        response_type: "ApiKeyStatusResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "regenerate_api_key",
        path: "/api/auth/api-key/regenerate",
        method: Method::POST,
        domain: Domain::Auth,
        request_type: "String",
        response_type: "ApiKeyRegenerateResponse",
        auth: RouteAuth::Authenticated,
    },
    RouteInfo {
        name: "redeem_invite",
        path: "/api/auth/invite",
        method: Method::POST,
        domain: Domain::Auth,
        request_type: "RedeemInviteRequest",
        response_type: "serde_json::Value",
        auth: RouteAuth::Public,
    },
    // webauthn routes
    RouteInfo {
        name: "register_start",
        path: "/api/auth/webauthn/register/start",
        method: Method::POST,
        domain: Domain::Auth,
        request_type: "RegisterStartRequest",
        response_type: "serde_json::Value",
        auth: RouteAuth::Public,
    },
    RouteInfo {
        name: "register_finish",
        path: "/api/auth/webauthn/register/finish",
        method: Method::POST,
        domain: Domain::Auth,
        request_type: "serde_json::Value",
        response_type: "serde_json::Value",
        auth: RouteAuth::Public,
    },
    RouteInfo {
        name: "login_start",
        path: "/api/auth/webauthn/login/start",
        method: Method::POST,
        domain: Domain::Auth,
        request_type: "StartLoginRequest",
        response_type: "serde_json::Value",
        auth: RouteAuth::Public,
    },
    RouteInfo {
        name: "login_finish",
        path: "/api/auth/webauthn/login/finish",
        method: Method::POST,
        domain: Domain::Auth,
        request_type: "serde_json::Value",
        response_type: "serde_json::Value",
        auth: RouteAuth::Public,
    },
];

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
    if req.user_id != caller.user_id && !caller.is_admin() {
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
    if target_user != caller.user_id && !caller.is_admin() {
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
    if target_user != caller.user_id && !caller.is_admin() {
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

/// redeem invite code (public endpoint)
///
/// for regular invite codes: creates a new user with the given username
/// for account-link codes: returns the existing linked user
/// for P2P: links the peer node_id to the user
///
/// path: POST /api/auth/invite
pub async fn redeem_invite(_caller: &Caller, body: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RedeemInviteRequest = match serde_json::from_value(body) {
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

    // check what type of invite code this is
    let code_response = service.check_invite_code(&req.invite_code).await;
    if !code_response.is_success() {
        return GrimoireResponse::failure(
            "invalid invite code",
            vec![ErrorDetail::new(
                "bad_request",
                "invalid invite code",
                "the invite code is invalid or has already been used",
            )],
        );
    }

    let invite_code = match code_response.data {
        Some(c) => c,
        None => {
            return GrimoireResponse::failure(
                "invalid invite code",
                vec![ErrorDetail::new(
                    "bad_request",
                    "invalid invite code",
                    "the invite code is invalid",
                )],
            )
        }
    };

    // handle account-link codes: return linked user
    if invite_code.code_type == InviteCodeType::AccountLink {
        let linked_user_id = match invite_code.link_for_user_id {
            Some(id) => id,
            None => {
                return GrimoireResponse::failure(
                    "invalid account-link code",
                    vec![ErrorDetail::new(
                        "bad_request",
                        "invalid code",
                        "account-link code missing linked user",
                    )],
                )
            }
        };

        // get the linked user
        let user_response = service.get_user(&linked_user_id).await;
        if !user_response.is_success() {
            return GrimoireResponse::failure(
                "linked user not found",
                vec![ErrorDetail::new(
                    "not_found",
                    "user not found",
                    "the linked user no longer exists",
                )],
            );
        }

        let user = match user_response.data {
            Some(u) => u,
            None => {
                return GrimoireResponse::failure(
                    "linked user not found",
                    vec![ErrorDetail::new(
                        "not_found",
                        "user not found",
                        "failed to get linked user",
                    )],
                )
            }
        };

        // mark invite code as used
        let _ = service.mark_invite_used(&req.invite_code, &user.id).await;

        // link peer node_id if provided (for P2P auth)
        if let Some(ref node_id) = req.node_id {
            let _ = service.add_peer_node(&user.id, node_id, None).await;
        }

        return GrimoireResponse::success(
            "logged in via account-link code",
            serde_json::json!({
                "message": "logged in via account-link code",
                "user": {
                    "id": user.id,
                    "username": user.username,
                    "role": user.role.to_string(),
                }
            }),
        );
    }

    // handle regular invite codes: create new user
    let username = match req.username {
        Some(u) => u,
        None => {
            return GrimoireResponse::failure(
                "username required",
                vec![ErrorDetail::new(
                    "bad_request",
                    "username required",
                    "username is required for invite codes",
                )],
            )
        }
    };

    let create_request = CreateUserRequest {
        username: username.clone(),
        role: None, // let the invite code's grants_role be used
        invite_code: Some(req.invite_code),
    };

    let user_response = service.register_user(&create_request).await;

    if !user_response.is_success() {
        return GrimoireResponse::failure(&user_response.message, user_response.errors);
    }

    let user = match user_response.data {
        Some(u) => u,
        None => {
            return GrimoireResponse::failure(
                "registration failed",
                vec![ErrorDetail::new(
                    "internal_error",
                    "registration failed",
                    "failed to get user data after registration",
                )],
            )
        }
    };

    // link peer node_id if provided (for P2P auth)
    if let Some(ref node_id) = req.node_id {
        let _ = service.add_peer_node(&user.id, node_id, None).await;
    }

    GrimoireResponse::success(
        "user created successfully",
        serde_json::json!({
            "message": "user created and logged in",
            "user": {
                "id": user.id,
                "username": user.username,
                "role": user.role.to_string(),
            }
        }),
    )
}
