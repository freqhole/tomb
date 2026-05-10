//! invite-code management handlers (list/generate/revoke/revoke_all/update_role).

use crate::admin_dispatch::helpers::{
    bad_request, decode, fetch_caller_user, map_response, parse_role, to_value,
};
use crate::admin_dispatch::types::invites::{
    AdminGeneratedInvite, AdminInviteInfo, AdminInvitesGenerateRequest,
    AdminInvitesGenerateResponse, AdminInvitesListRequest, AdminInvitesRevokeAllResponse,
    AdminInvitesRevokeRequest, AdminInvitesUpdateRoleRequest,
};
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use crate::users::{CreateInviteCodeRequest, UserQueryParams, UserRole, UserService};
use serde_json::Value as JsonValue;

pub(in crate::admin_dispatch) async fn list(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let req: AdminInvitesListRequest = if args.is_null() {
        AdminInvitesListRequest::default()
    } else {
        match decode(args) {
            Ok(v) => v,
            Err(r) => return r,
        }
    };
    let active_only = req.active_only.unwrap_or(false);
    let admin = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    let service = UserService::new();
    let response = service.list_invite_codes(active_only, &admin).await;
    let codes = match response.data {
        Some(c) => c,
        None => {
            return GrimoireResponse {
                success: response.success,
                message: response.message,
                data: None,
                errors: response.errors,
            };
        }
    };

    // build a lookup table for usernames referenced by used_by_id and link_for_user_id
    let mut username_map: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    let needs_lookup = codes
        .iter()
        .any(|c| c.used_by_id.is_some() || c.link_for_user_id.is_some());
    if needs_lookup {
        let users_resp = service
            .list_users(
                &UserQueryParams {
                    include_deleted: Some(true),
                    ..Default::default()
                },
                &admin,
            )
            .await;
        if let Some(users) = users_resp.data {
            for u in users {
                username_map.insert(u.id.clone(), u.username);
            }
        }
    }

    let infos: Vec<AdminInviteInfo> = codes
        .into_iter()
        .map(|c| {
            let used_by_username = c
                .used_by_id
                .as_ref()
                .and_then(|id| username_map.get(id).cloned());
            let link_for_username = c
                .link_for_user_id
                .as_ref()
                .and_then(|id| username_map.get(id).cloned());
            AdminInviteInfo {
                code: c.code,
                code_type: format!("{:?}", c.code_type).to_lowercase(),
                grants_role: c.grants_role.to_string(),
                created_at: c.created_at,
                expires_at: c.link_expires_at,
                used_at: c.used_at,
                used_by: c.used_by_id,
                used_by_username,
                link_for_user_id: c.link_for_user_id,
                link_for_username,
                is_active: c.is_active,
            }
        })
        .collect();

    to_value(GrimoireResponse::success(response.message, infos))
}

pub(in crate::admin_dispatch) async fn revoke_all(caller: &Caller) -> GrimoireResponse<JsonValue> {
    let admin = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    let resp = UserService::new()
        .deactivate_all_active_invites(&admin)
        .await;
    to_value(map_response(resp, |revoked| {
        AdminInvitesRevokeAllResponse { revoked }
    }))
}

pub(in crate::admin_dispatch) async fn update_role(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let req: AdminInvitesUpdateRoleRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let role = match parse_role(&req.role) {
        Ok(r) => r,
        Err(e) => return bad_request(e),
    };
    if role == UserRole::Root {
        return bad_request("cannot set invite to grant root role".to_string());
    }
    let admin = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    let resp = UserService::new()
        .update_invite_role(&req.code, role, &admin)
        .await;
    to_value(map_response(resp, |_| ()))
}

pub(in crate::admin_dispatch) async fn generate(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let req: AdminInvitesGenerateRequest = if args.is_null() {
        AdminInvitesGenerateRequest {
            count: None,
            word_count: None,
            role: None,
            expires_hours: None,
        }
    } else {
        match decode(args) {
            Ok(v) => v,
            Err(r) => return r,
        }
    };
    let count = req.count.unwrap_or(1);
    let word_count = req.word_count.unwrap_or(3) as usize;
    let grants_role = match req.role.as_deref() {
        None => None,
        Some(s) => match parse_role(s) {
            Ok(r) => Some(r),
            Err(e) => return bad_request(e),
        },
    };
    if grants_role == Some(UserRole::Root) {
        return bad_request("cannot create invites that grant root role".to_string());
    }
    let create_req = CreateInviteCodeRequest {
        code_type: None,
        link_for_user_id: None,
        expires_hours: req.expires_hours,
        grants_role,
    };
    let admin = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    let resp = UserService::new()
        .generate_invite_codes(&create_req, count, word_count, &admin)
        .await;
    to_value(map_response(resp, |codes| {
        let mapped: Vec<AdminGeneratedInvite> = codes
            .into_iter()
            .map(|c| AdminGeneratedInvite {
                code: c.code,
                grants_role: c.grants_role.to_string(),
                expires_at: c.link_expires_at,
            })
            .collect();
        AdminInvitesGenerateResponse { codes: mapped }
    }))
}

pub(in crate::admin_dispatch) async fn revoke(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let req: AdminInvitesRevokeRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let admin = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    let resp = UserService::new()
        .deactivate_invite_code(&req.code, &admin)
        .await;
    to_value(map_response(resp, |_| ()))
}
