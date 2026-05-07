//! user-management handlers (list/get/create/update_role/delete/restore + account-link).

use crate::admin_dispatch::helpers::{
    bad_request, decode, fetch_caller_user, map_response, parse_role, to_value,
};
use crate::admin_dispatch::types::users::{
    AdminAccountLinkResponse, AdminUserSummary, AdminUsersDeleteRequest,
    AdminUsersGenerateAccountLinkRequest, AdminUsersGetRequest, AdminUsersHardDeleteRequest,
    AdminUsersListRequest, AdminUsersRestoreRequest, AdminUsersUpdateRoleRequest,
};
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use crate::users::{
    CreateInviteCodeRequest, CreateUserRequest, InviteCodeType, UpdateUserRequest, UserQueryParams,
    UserRole, UserService,
};
use serde_json::Value as JsonValue;

pub(in crate::admin_dispatch) async fn list(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let req: AdminUsersListRequest = if args.is_null() {
        AdminUsersListRequest::default()
    } else {
        match decode(args) {
            Ok(p) => p,
            Err(r) => return r,
        }
    };
    let role = match req.role.as_deref() {
        None => None,
        Some(s) => match parse_role(s) {
            Ok(r) => Some(r),
            Err(e) => return bad_request(e),
        },
    };
    let params = UserQueryParams {
        username: req.username,
        role,
        include_deleted: req.include_deleted.or(Some(false)),
        limit: req.limit.or(Some(50)),
        offset: req.offset.or(Some(0)),
    };
    let user = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    let resp = UserService::new().list_users(&params, &user).await;
    to_value(map_response(resp, |users| {
        users
            .into_iter()
            .map(AdminUserSummary::from)
            .collect::<Vec<_>>()
    }))
}

pub(in crate::admin_dispatch) async fn get(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: AdminUsersGetRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let resp = UserService::new().get_user(&req.user_id).await;
    to_value(map_response(resp, AdminUserSummary::from))
}

pub(in crate::admin_dispatch) async fn create(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: CreateUserRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    to_value(UserService::new().register_user(&req).await)
}

pub(in crate::admin_dispatch) async fn update_role(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let req: AdminUsersUpdateRoleRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let role = match parse_role(&req.role) {
        Ok(r) => r,
        Err(e) => return bad_request(e),
    };
    if role == UserRole::Root {
        return bad_request("cannot assign root role".to_string());
    }
    let admin = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    let updates = UpdateUserRequest { role: Some(role) };
    let resp = UserService::new()
        .update_user(&req.user_id, &updates, &admin)
        .await;
    to_value(map_response(resp, |_| ()))
}

pub(in crate::admin_dispatch) async fn delete(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let req: AdminUsersDeleteRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let admin = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    to_value(UserService::new().delete_user(&req.user_id, &admin).await)
}

pub(in crate::admin_dispatch) async fn hard_delete(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let req: AdminUsersHardDeleteRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let admin = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    to_value(
        UserService::new()
            .hard_delete_user(&req.user_id, &admin)
            .await,
    )
}

pub(in crate::admin_dispatch) async fn restore(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let req: AdminUsersRestoreRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let admin = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    to_value(map_response(
        UserService::new().restore_user(&req.user_id, &admin).await,
        AdminUserSummary::from,
    ))
}

/// generate a 24-hour account-link code for an existing user (lets them
/// add a new passkey). returns `{ code: String }`.
pub(in crate::admin_dispatch) async fn generate_account_link(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let req: AdminUsersGenerateAccountLinkRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let user_id = req.user_id;
    let admin = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    let service = UserService::new();

    // refuse for root accounts
    let user_resp = service.get_user(&user_id).await;
    match &user_resp.data {
        Some(u) if u.role == UserRole::Root => {
            return bad_request("cannot create account-link codes for root user".to_string());
        }
        None => return bad_request("user not found".to_string()),
        _ => {}
    }

    let create_req = CreateInviteCodeRequest {
        code_type: Some(InviteCodeType::AccountLink),
        link_for_user_id: Some(user_id),
        expires_hours: Some(24),
        grants_role: None,
    };
    let response = service
        .generate_invite_codes(&create_req, 1, 4, &admin)
        .await;
    match response.data {
        Some(codes) if !codes.is_empty() => {
            let body = AdminAccountLinkResponse {
                code: codes[0].code.clone(),
            };
            to_value(GrimoireResponse::success(response.message, body))
        }
        _ => GrimoireResponse {
            success: false,
            message: response.message,
            data: None,
            errors: response.errors,
        },
    }
}

/// generate (or regenerate) the api key for a user.
/// args: `{ user_id: String }`
pub(in crate::admin_dispatch) async fn generate_api_key(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let user_id = match crate::admin_dispatch::helpers::require_str(&args, "user_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let resp = UserService::new().generate_api_key(&user_id).await;
    to_value(map_response(resp, AdminUserSummary::from))
}

/// revoke the api key for a user.
/// args: `{ user_id: String }`
pub(in crate::admin_dispatch) async fn revoke_api_key(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let user_id = match crate::admin_dispatch::helpers::require_str(&args, "user_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let resp = UserService::new().revoke_api_key(&user_id).await;
    to_value(map_response(resp, AdminUserSummary::from))
}

/// permanently delete a peer-node row (hard DELETE — bypasses the
/// soft-delete flow used by `peers_remove`). reserved for cleanup
/// tooling.
/// args: `{ user_id: String, node_id: String }`
pub(in crate::admin_dispatch) async fn hard_delete_peer_node(
    args: JsonValue,
) -> GrimoireResponse<JsonValue> {
    let user_id = match crate::admin_dispatch::helpers::require_str(&args, "user_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let node_id = match crate::admin_dispatch::helpers::require_str(&args, "node_id") {
        Ok(s) => s,
        Err(r) => return r,
    };
    let resp = UserService::new()
        .hard_delete_peer_node(&user_id, &node_id)
        .await;
    to_value(map_response(resp, |_| ()))
}
