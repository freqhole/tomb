//! admin command dispatch
//!
//! single source of truth for the wizard-admin command surface. used by:
//! - the local tauri `admin_dispatch` command (slice 4) — calls with
//!   `Caller::local_admin()`
//! - the remote `freqhole-admin/1` ALPN handler (slice 2) — calls with the
//!   resolved admin caller for the connecting peer
//!
//! every entry point enforces `caller.role.is_admin()` defense-in-depth,
//! independent of transport-level checks.
//!
//! see docs/wizard-remote-admin.md for the full plan and command list.

pub mod registry;
pub mod types;

use crate::admin_dispatch::types::invites::{
    AdminGeneratedInvite, AdminInviteInfo, AdminInvitesGenerateRequest,
    AdminInvitesGenerateResponse, AdminInvitesListRequest, AdminInvitesRevokeAllResponse,
    AdminInvitesRevokeRequest, AdminInvitesUpdateRoleRequest,
};
use crate::admin_dispatch::types::knocks::{
    KnocksAcceptRequest, KnocksDeleteRequest, KnocksRejectAllResponse, KnocksRejectRequest,
};
use crate::admin_dispatch::types::peers::{
    AdminPeerNodeSummary, AdminPeerSummary, AdminPeersAllowRequest, AdminPeersAllowResponse,
    AdminPeersListForUserRequest, AdminPeersRemoveRequest,
};
use crate::admin_dispatch::types::radio::{
    RadioBumper, RadioBumpersAddRequest, RadioBumpersListRequest, RadioBumpersRemoveRequest,
    RadioBumpersSetFrequencyRequest, RadioConfigPayload, RadioFiltersAddRequest,
    RadioFiltersRemoveRequest, RadioSeedSuggestRequest, RadioSeedSuggestion, RadioSongsAddRequest,
    RadioSongsRemoveRequest, RadioStationByStationIdRequest, RadioStationSupervisorStatus,
    RadioStationsByIdRequest, RadioSupervisorStationRequest, RadioSupervisorStatusResponse,
};
use crate::admin_dispatch::types::users::{
    AdminAccountLinkResponse, AdminUserSummary, AdminUsersDeleteRequest,
    AdminUsersGenerateAccountLinkRequest, AdminUsersGetRequest, AdminUsersListRequest,
    AdminUsersUpdateRoleRequest,
};
use crate::config::{find_config, get_config, get_config_path, read_config_from_file};
use crate::error::ErrorDetail;
use crate::federation::knock;
use crate::offal::Caller;
use crate::radio::stations::models::{CreateStationRequest, UpdateStationRequest};
use crate::radio::stations::repository as radio_stations;
use crate::response::GrimoireResponse;
use crate::users::{
    CreateInviteCodeRequest, CreateUserRequest, InviteCodeType, UpdateUserRequest, User,
    UserQueryParams, UserRole, UserService,
};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value as JsonValue};
use std::path::PathBuf;

/// dispatch an admin command to its handler.
///
/// returns `GrimoireResponse<JsonValue>` for uniform serialization across
/// transports. unknown commands return a `command_not_found` error.
pub async fn handle(
    command: &str,
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    if !caller.role.is_admin() {
        return forbidden();
    }

    match command {
        // -- knocks --
        "knocks_list" => {
            let resp = knock::list_knocks(false).await;
            tracing::info!(
                "[admin-dispatch] knocks_list success={} count={}",
                resp.success,
                resp.data.as_ref().map(|v| v.len()).unwrap_or(0)
            );
            to_value(resp)
        }
        "knocks_list_all" => {
            let resp = knock::list_knocks(true).await;
            tracing::info!(
                "[admin-dispatch] knocks_list_all success={} count={}",
                resp.success,
                resp.data.as_ref().map(|v| v.len()).unwrap_or(0)
            );
            to_value(resp)
        }
        "knocks_accept" => knocks_accept(args, caller).await,
        "knocks_reject" => knocks_reject(args, caller).await,
        "knocks_delete" => knocks_delete(args).await,
        "knocks_reject_all" => knocks_reject_all(caller).await,

        // -- users --
        "users_list" => users_list(args, caller).await,
        "users_get" => users_get(args).await,
        "users_create" => users_create(args).await,
        "users_update_role" => users_update_role(args, caller).await,
        "users_delete" => users_delete(args, caller).await,
        "users_generate_account_link" => users_generate_account_link(args, caller).await,

        // -- invites --
        "invites_list" => invites_list(args, caller).await,
        "invites_generate" => invites_generate(args, caller).await,
        "invites_revoke" => invites_revoke(args, caller).await,
        "invites_revoke_all" => invites_revoke_all(caller).await,
        "invites_update_role" => invites_update_role(args, caller).await,

        // -- peers --
        "peers_list_all" => {
            let resp = UserService::new().get_all_peer_nodes().await;
            to_value(map_response(resp, |peers| {
                peers
                    .into_iter()
                    .map(AdminPeerSummary::from)
                    .collect::<Vec<_>>()
            }))
        }
        "peers_list_for_user" => peers_list_for_user(args).await,
        "peers_remove" => peers_remove(args).await,
        "peers_allow" => peers_allow(args).await,

        // -- library --
        "library_validate_path" => library_validate_path(args).await,
        "library_scan" => library_scan(args).await,
        "library_scan_status" => library_scan_status(args).await,
        "library_image_upload" => library_image_upload(args, caller).await,
        "library_list_directories" => library_list_directories().await,
        "library_remove_directory" => library_remove_directory(args).await,
        "library_rescan_all" => library_rescan_all(caller).await,

        // -- config / server --
        "config_get" => config_get().await,
        "config_set" => config_set(args).await,
        "server_restart" => server_restart(args).await,
        "server_info" => crate::offal::public::health::server_info().await,
        "server_get_config" => server_get_config().await,
        "server_get_image_thumbnail" => server_get_image_thumbnail(args).await,
        "server_update_info" => server_update_info(args).await,
        "server_update_image" => server_update_image(args).await,

        // -- radio --
        "radio_stations_list" => radio_stations_list().await,
        "radio_stations_get" => radio_stations_get(args).await,
        "radio_stations_create" => radio_stations_create(args).await,
        "radio_stations_update" => radio_stations_update(args).await,
        "radio_stations_delete" => radio_stations_delete(args).await,
        "radio_filters_list" => radio_filters_list(args).await,
        "radio_filters_add" => radio_filters_add(args).await,
        "radio_filters_remove" => radio_filters_remove(args).await,
        "radio_songs_list" => radio_songs_list(args).await,
        "radio_songs_add" => radio_songs_add(args).await,
        "radio_songs_remove" => radio_songs_remove(args).await,
        "radio_seed_suggest" => radio_seed_suggest(args).await,
        "radio_config_get" => radio_config_get().await,
        "radio_config_set" => radio_config_set(args).await,
        "radio_supervisor_status" => radio_supervisor_status().await,
        "radio_supervisor_start" => radio_supervisor_start(args).await,
        "radio_supervisor_stop" => radio_supervisor_stop(args).await,
        "radio_supervisor_restart" => radio_supervisor_restart(args).await,
        "radio_supervisor_skip_track" => radio_supervisor_skip_track(args).await,
        "radio_bumpers_list" => radio_bumpers_list(args).await,
        "radio_bumpers_add" => radio_bumpers_add(args).await,
        "radio_bumpers_remove" => radio_bumpers_remove(args).await,
        "radio_bumpers_set_frequency" => radio_bumpers_set_frequency(args).await,

        _ => command_not_found(command),
    }
}

// =========================================================================
// helpers
// =========================================================================

fn forbidden() -> GrimoireResponse<JsonValue> {
    GrimoireResponse::failure(
        "forbidden",
        vec![ErrorDetail::new(
            "forbidden",
            "forbidden",
            "admin role required",
        )],
    )
}

fn command_not_found(command: &str) -> GrimoireResponse<JsonValue> {
    GrimoireResponse::failure(
        "admin command not found",
        vec![ErrorDetail::new(
            "command_not_found",
            "admin command not found",
            &format!("no handler for command: {}", command),
        )],
    )
}

fn bad_request(detail: impl Into<String>) -> GrimoireResponse<JsonValue> {
    GrimoireResponse::failure(
        "bad request",
        vec![ErrorDetail::new(
            "bad_request",
            "bad request",
            &detail.into(),
        )],
    )
}

fn internal(detail: impl Into<String>) -> GrimoireResponse<JsonValue> {
    GrimoireResponse::failure(
        "internal error",
        vec![ErrorDetail::new(
            "internal_error",
            "internal error",
            &detail.into(),
        )],
    )
}

/// resolve the active config file path. prefers the path captured by
/// `init_config()` (set by tauri/cli/server bootstrap) and falls back to
/// the legacy `./freqhole-config.toml` cwd lookup.
fn resolve_config_path() -> Result<PathBuf, crate::config::ConfigError> {
    if let Some(p) = get_config_path() {
        if p.exists() {
            return Ok(p);
        }
    }
    find_config(None)
}

/// decode args into a typed struct or return a bad_request response
fn decode<T: DeserializeOwned>(args: JsonValue) -> Result<T, GrimoireResponse<JsonValue>> {
    serde_json::from_value(args).map_err(|e| bad_request(e.to_string()))
}

/// require a string field on a JsonValue object
fn require_str(args: &JsonValue, field: &str) -> Result<String, GrimoireResponse<JsonValue>> {
    args.get(field)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| bad_request(format!("missing or non-string field: {}", field)))
}

/// optional string field
fn opt_str(args: &JsonValue, field: &str) -> Option<String> {
    args.get(field)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// optional bool field
fn opt_bool(args: &JsonValue, field: &str) -> Option<bool> {
    args.get(field).and_then(|v| v.as_bool())
}

/// convert a typed GrimoireResponse into a JsonValue-shaped one
fn to_value<T: Serialize>(resp: GrimoireResponse<T>) -> GrimoireResponse<JsonValue> {
    let GrimoireResponse {
        success,
        message,
        data,
        errors,
    } = resp;
    let data_json = match data {
        Some(d) => match serde_json::to_value(d) {
            Ok(v) => Some(v),
            Err(e) => {
                return internal(format!("serialize failed: {}", e));
            }
        },
        None => None,
    };
    GrimoireResponse {
        success,
        message,
        data: data_json,
        errors,
    }
}

/// map the `data` of a `GrimoireResponse<T>` through `f`, preserving
/// success/message/errors. used when adapting service-layer types to the
/// admin wire shape (`AdminUserSummary`, etc.).
fn map_response<T, U>(resp: GrimoireResponse<T>, f: impl FnOnce(T) -> U) -> GrimoireResponse<U> {
    GrimoireResponse {
        success: resp.success,
        message: resp.message,
        data: resp.data.map(f),
        errors: resp.errors,
    }
}

/// parse a role string into `UserRole`, rejecting unknown values.
/// accepts "root" | "admin" | "member" | "viewer" (case-insensitive).
fn parse_role(s: &str) -> Result<UserRole, String> {
    match s.to_lowercase().as_str() {
        "root" => Ok(UserRole::Root),
        "admin" => Ok(UserRole::Admin),
        "member" => Ok(UserRole::Member),
        "viewer" => Ok(UserRole::Viewer),
        other => Err(format!(
            "invalid role '{}': expected root, admin, member, or viewer",
            other
        )),
    }
}

/// fetch the User record for the caller. needed by services that demand `&User`.
async fn fetch_caller_user(caller: &Caller) -> Result<User, GrimoireResponse<JsonValue>> {
    let resp = UserService::new().get_user(&caller.user_id).await;
    resp.data
        .ok_or_else(|| internal("caller user record not found"))
}

// =========================================================================
// knocks
// =========================================================================

async fn knocks_accept(args: JsonValue, caller: &Caller) -> GrimoireResponse<JsonValue> {
    let req: KnocksAcceptRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let process = knock::ProcessKnockRequest {
        username: req.username,
        role: req.role,
        user_id: req.user_id,
    };
    match knock::accept_knock(&req.knock_id, process, &caller.user_id).await {
        Ok(k) => to_value(GrimoireResponse::success("knock accepted", k)),
        Err(e) => GrimoireResponse::failure("failed to accept knock", vec![e.into()]),
    }
}

async fn knocks_reject(args: JsonValue, caller: &Caller) -> GrimoireResponse<JsonValue> {
    let req: KnocksRejectRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match knock::reject_knock(&req.knock_id, &caller.user_id).await {
        Ok(k) => to_value(GrimoireResponse::success("knock rejected", k)),
        Err(e) => GrimoireResponse::failure("failed to reject knock", vec![e.into()]),
    }
}

async fn knocks_delete(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: KnocksDeleteRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match knock::delete_knock(&req.knock_id).await {
        Ok(()) => GrimoireResponse::success("knock deleted", JsonValue::Null),
        Err(e) => GrimoireResponse::failure("failed to delete knock", vec![e.into()]),
    }
}

/// reject every currently-pending knock. returns `{ rejected: <count> }`.
async fn knocks_reject_all(caller: &Caller) -> GrimoireResponse<JsonValue> {
    let list = knock::list_knocks(false).await;
    let knocks = match list.data {
        Some(k) => k,
        None => return GrimoireResponse::failure("failed to list knocks", list.errors),
    };
    let mut rejected = 0u32;
    for k in knocks {
        if knock::reject_knock(&k.id, &caller.user_id).await.is_ok() {
            rejected += 1;
        }
    }
    let body = KnocksRejectAllResponse { rejected };
    to_value(GrimoireResponse::success(
        format!("rejected {} knocks", rejected),
        body,
    ))
}

// =========================================================================
// users
// =========================================================================

async fn users_list(args: JsonValue, caller: &Caller) -> GrimoireResponse<JsonValue> {
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

async fn users_get(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: AdminUsersGetRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let resp = UserService::new().get_user(&req.user_id).await;
    to_value(map_response(resp, AdminUserSummary::from))
}

async fn users_create(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: CreateUserRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    to_value(UserService::new().register_user(&req).await)
}

async fn users_update_role(args: JsonValue, caller: &Caller) -> GrimoireResponse<JsonValue> {
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

async fn users_delete(args: JsonValue, caller: &Caller) -> GrimoireResponse<JsonValue> {
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

/// generate a 24-hour account-link code for an existing user (lets them
/// add a new passkey). returns `{ code: String }`.
async fn users_generate_account_link(
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

// =========================================================================
// invites
// =========================================================================

async fn invites_list(args: JsonValue, caller: &Caller) -> GrimoireResponse<JsonValue> {
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

async fn invites_revoke_all(caller: &Caller) -> GrimoireResponse<JsonValue> {
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

async fn invites_update_role(args: JsonValue, caller: &Caller) -> GrimoireResponse<JsonValue> {
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

async fn invites_generate(args: JsonValue, caller: &Caller) -> GrimoireResponse<JsonValue> {
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

async fn invites_revoke(args: JsonValue, caller: &Caller) -> GrimoireResponse<JsonValue> {
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

// =========================================================================
// peers
// =========================================================================

async fn peers_list_for_user(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: AdminPeersListForUserRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let resp = UserService::new().get_user_peer_nodes(&req.user_id).await;
    to_value(map_response(resp, |peers| {
        peers
            .into_iter()
            .map(AdminPeerNodeSummary::from)
            .collect::<Vec<_>>()
    }))
}

async fn peers_remove(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: AdminPeersRemoveRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let resp = UserService::new()
        .remove_peer_node(&req.user_id, &req.node_id)
        .await;
    to_value(map_response(resp, |_| ()))
}

/// allow a peer node by linking (or creating) a user with the given role.
/// args: `{ node_id, username?, role?, user_id? }`
/// - if `user_id` is set, links to that existing user
/// - else if `username` matches an existing user, links to it
/// - else creates a new user (`username` defaults to `peer_<first8>`)
/// returns `{ user_id, username, node_id, created_user }` to mirror the
/// legacy `allow_peer` tauri command shape.
async fn peers_allow(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: AdminPeersAllowRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };

    let node_id = req.node_id;
    if node_id.len() != 64 || !node_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return bad_request("invalid node_id: expected 64 hex characters");
    }

    let user_role = match req.role.as_deref() {
        None => UserRole::Viewer,
        Some(s) => match parse_role(s) {
            Ok(r) => r,
            Err(e) => return bad_request(e),
        },
    };
    if user_role == UserRole::Root {
        return bad_request("cannot allow peer with root role".to_string());
    }

    let service = UserService::new();
    let (user, created_user) = if let Some(uid) = req.user_id {
        match service.get_user(&uid).await.data {
            Some(u) => (u, false),
            None => return bad_request(format!("user not found: {}", uid)),
        }
    } else {
        let username = req
            .username
            .unwrap_or_else(|| format!("peer_{}", &node_id[..8]));

        if let Some(existing) = service.get_user_by_username(&username).await.data {
            (existing, false)
        } else {
            let create_req = CreateUserRequest {
                username: username.clone(),
                role: Some(user_role),
                invite_code: None,
            };
            match service.register_user(&create_req).await {
                GrimoireResponse { data: Some(u), .. } => (u, true),
                resp => {
                    return GrimoireResponse::failure("failed to create user", resp.errors);
                }
            }
        }
    };

    let peer_resp = service.upsert_peer_node(&user.id, &node_id, None).await;
    if peer_resp.data.is_none() {
        return GrimoireResponse::failure("failed to link peer node", peer_resp.errors);
    }

    let body = AdminPeersAllowResponse {
        user_id: user.id,
        username: user.username,
        node_id,
        created_user,
    };
    to_value(GrimoireResponse::success("peer node linked", body))
}

// =========================================================================
// library
// =========================================================================

async fn library_validate_path(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let path = match require_str(&args, "path") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let p = std::path::Path::new(&path);
    let (exists, is_dir, is_readable) = match std::fs::metadata(p) {
        Ok(m) => {
            let dir = m.is_dir();
            // crude readable probe: if dir, try read_dir; else open file
            let readable = if dir {
                std::fs::read_dir(p).is_ok()
            } else {
                std::fs::File::open(p).is_ok()
            };
            (true, dir, readable)
        }
        Err(_) => (false, false, false),
    };
    GrimoireResponse::success(
        "path validated",
        json!({
            "path": path,
            "exists": exists,
            "is_dir": is_dir,
            "is_readable": is_readable,
        }),
    )
}

async fn library_scan(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let path = match require_str(&args, "path") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let recursive = opt_bool(&args, "recursive").unwrap_or(true);

    // optional tag list to apply to the directory
    let tags: Vec<String> = args
        .get("tags")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_default();

    // session id can be supplied; otherwise create a fresh job session so
    // the scan inherits a real session row (foreign-key requirement).
    let session_id = match opt_str(&args, "session_id") {
        Some(s) => s,
        None => {
            let req = crate::jobs::CreateJobSessionRequest {
                job_type: crate::jobs::JobType::ProcessFile,
                batch_size: None,
                created_by: Some("admin-dispatch-scan".to_string()),
            };
            let sess = crate::jobs::create_job_session(req).await;
            match sess.data {
                Some(s) => s.id,
                None => {
                    return GrimoireResponse::failure("failed to create scan session", sess.errors);
                }
            }
        }
    };

    if !tags.is_empty() {
        let _ = crate::jobs::add_directory_tags(
            &path,
            tags.clone(),
            Some("admin-dispatch-scan".to_string()),
        )
        .await;
    }

    let resp = crate::music::scan_directory(&path, &session_id, recursive, None, None, false).await;

    let count = resp.data.unwrap_or(0);
    if count > 0 {
        let _ = crate::jobs::record_scanned_directory(&path, count as i64, None).await;
    }

    if resp.success {
        GrimoireResponse::success(
            format!("created {} import jobs", count),
            json!({
                "session_id": session_id,
                "files_discovered": count,
                "jobs_created": count,
                "success": true,
                "message": format!("created {} import jobs", count),
            }),
        )
    } else {
        GrimoireResponse::failure(resp.message, resp.errors)
    }
}

async fn library_scan_status(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let session_id = match require_str(&args, "session_id") {
        Ok(v) => v,
        Err(r) => return r,
    };
    to_value(crate::jobs::get_session_job_counts(&session_id).await)
}

async fn library_image_upload(args: JsonValue, caller: &Caller) -> GrimoireResponse<JsonValue> {
    // delegate to existing upload handler. body shape mirrors UploadImageRequest:
    // { filename?, mime?, data: base64, associate_with?, wait_for_completion? }
    crate::offal::upload::upload_image(caller, args).await
}

/// list every directory ever scanned, with the tags applied via
/// directory tag rules. shape mirrors the legacy `list_scanned_directories`
/// tauri command so the UI can use one shape for both targets.
async fn library_list_directories() -> GrimoireResponse<JsonValue> {
    let list = crate::jobs::list_scanned_directories().await;
    let dirs = match list.data {
        Some(d) => d,
        None => return GrimoireResponse::failure("failed to list directories", list.errors),
    };
    let mut out = Vec::with_capacity(dirs.len());
    for d in dirs {
        let tags_resp = crate::jobs::list_directory_tags(&d.path).await;
        let tags: Vec<String> = tags_resp
            .data
            .unwrap_or_default()
            .into_iter()
            .filter_map(|r| r.tag_name)
            .collect();
        out.push(json!({
            "id": d.id,
            "path": d.path,
            "file_count": d.file_count,
            "last_scanned_at": d.last_scanned_at,
            "tags": tags,
        }));
    }
    GrimoireResponse::success(
        format!("found {} directories", out.len()),
        JsonValue::Array(out),
    )
}

/// stop tracking a previously-scanned directory.
async fn library_remove_directory(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let path = match require_str(&args, "path") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let resp = crate::jobs::remove_scanned_directory(&path).await;
    if resp.success {
        GrimoireResponse::success("directory removed", JsonValue::Null)
    } else {
        GrimoireResponse::failure(resp.message, resp.errors)
    }
}

/// kick off a `RescanDirectories` background job. mirrors the legacy
/// `rescan_directories` tauri command shape (`{ success, jobs_created,
/// message }`); `jobs_created` is always 1 here (the rescan job itself)
/// since the per-directory work happens inside the job.
async fn library_rescan_all(caller: &Caller) -> GrimoireResponse<JsonValue> {
    let req = crate::jobs::CreateJobRequest {
        job_type: crate::jobs::JobType::RescanDirectories,
        session_id: None,
        parameters: json!({}),
        max_retries: Some(0),
        scheduled_at: None,
        created_by: Some(caller.user_id.clone()),
    };
    let resp = crate::jobs::create_job(req).await;
    if resp.success {
        GrimoireResponse::success(
            "rescan started",
            json!({
                "success": true,
                "jobs_created": 1,
                "message": "rescan job created",
            }),
        )
    } else {
        GrimoireResponse::failure(resp.message, resp.errors)
    }
}

// =========================================================================
// config / server
// =========================================================================

async fn config_get() -> GrimoireResponse<JsonValue> {
    let path = match resolve_config_path() {
        Ok(p) => p,
        Err(e) => return internal(format!("could not locate config file: {}", e)),
    };
    let toml_str = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => return internal(format!("failed to read config file: {}", e)),
    };
    let parsed = get_config();
    let parsed_json = match serde_json::to_value(&parsed) {
        Ok(v) => v,
        Err(e) => return internal(format!("failed to serialize config: {}", e)),
    };
    GrimoireResponse::success(
        "ok",
        json!({
            "path": path.display().to_string(),
            "toml": toml_str,
            "parsed": parsed_json,
        }),
    )
}

async fn config_set(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let toml_str = match require_str(&args, "toml") {
        Ok(v) => v,
        Err(r) => return r,
    };
    // validate by parsing into GrimoireConfig before writing
    if let Err(e) = toml::from_str::<crate::config::GrimoireConfig>(&toml_str) {
        return bad_request(format!("invalid toml: {}", e));
    }
    let path: PathBuf = match resolve_config_path() {
        Ok(p) => p,
        Err(e) => return internal(format!("could not locate config file: {}", e)),
    };
    if let Err(e) = std::fs::write(&path, toml_str.as_bytes()) {
        return internal(format!("failed to write config: {}", e));
    }
    // reload cached CONFIG so subsequent reads reflect the new values.
    if let Err(e) = crate::config::init_config(Some(path.clone())) {
        return internal(format!("config written but reload failed: {}", e));
    }
    let parsed = match read_config_from_file(&path) {
        Ok(p) => p,
        Err(e) => return internal(format!("config written but re-read failed: {}", e)),
    };
    let parsed_json = match serde_json::to_value(&parsed) {
        Ok(v) => v,
        Err(e) => return internal(format!("failed to serialize config: {}", e)),
    };
    GrimoireResponse::success(
        "config updated",
        json!({
            "path": path.display().to_string(),
            "parsed": parsed_json,
        }),
    )
}

async fn server_restart(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let reason = opt_str(&args, "reason").unwrap_or_else(|| "admin requested".to_string());

    // delegate to the registered shutdown hook. the cli `serve` server
    // registers one that drives a graceful drain (axum + iroh + jobs).
    // tauri does not register a hook; restart there is a UI/window-level
    // concern (`AppHandle::restart`) and should not go through this path.
    if !crate::shutdown::request_shutdown(reason.clone()) {
        return GrimoireResponse::failure(
            "server_restart not supported on this binary",
            vec![ErrorDetail::new(
                "no_shutdown_hook",
                "no shutdown hook registered",
                "this process does not support remote restart; \
                 use the local app's restart facility instead",
            )],
        );
    }

    GrimoireResponse::success(
        "graceful shutdown initiated; supervisor must respawn the process",
        json!({
            "reason": reason,
        }),
    )
}

/// upload a new server image. accepts base64-encoded raw image data + the
/// original filename (used only for logging / mime hint). resizes to a
/// 200x200 webp, persists it under `data_dir/freqhole-icon.webp`, updates
/// `[server].image_path`, and refreshes `image_blob_id`.
///
/// this is the remote-target counterpart to the local
/// `update_server_image` tauri command — that one reads from a local file
/// path the user picked; this one accepts the bytes directly so the
/// wizard can talk to a remote freqhole instance.
async fn server_update_image(args: JsonValue) -> GrimoireResponse<JsonValue> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    let data_b64 = match require_str(&args, "data") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let filename = opt_str(&args, "filename").unwrap_or_else(|| "image".to_string());

    // strip optional data url prefix
    let raw_b64 = data_b64
        .split_once(",")
        .map(|(prefix, rest)| {
            if prefix.starts_with("data:") {
                rest
            } else {
                data_b64.as_str()
            }
        })
        .unwrap_or(data_b64.as_str());

    let bytes = match B64.decode(raw_b64) {
        Ok(b) => b,
        Err(e) => return bad_request(format!("invalid base64 image data: {}", e)),
    };

    // resize to 200x200 webp using grimoire helper
    let webp = match crate::blob_data::resize_to_square_webp(&bytes, 200) {
        Ok(b) => b,
        Err(e) => return internal(format!("failed to resize image: {}", e)),
    };

    let cfg = get_config();
    let dest = cfg.data_dir.join("freqhole-icon.webp");
    if let Err(e) = std::fs::write(&dest, &webp) {
        return internal(format!("failed to write image: {}", e));
    }
    let dest_str = dest.display().to_string();

    // persist absolute path into the config file
    let config_path = match resolve_config_path() {
        Ok(p) => p,
        Err(e) => return internal(format!("could not locate config file: {}", e)),
    };
    if let Err(e) = crate::config::set_config_values(
        &config_path,
        &[("server.image_path", dest_str.clone().into())],
    ) {
        return internal(format!("failed to update config: {}", e));
    }

    // (re)create the blob and capture its id
    let blob_id = match crate::config::ensure_server_image_blob(&config_path).await {
        Ok(id) => id,
        Err(e) => return internal(format!("failed to create image blob: {}", e)),
    };

    GrimoireResponse::success(
        "server image updated",
        json!({
            "filename": filename,
            "image_path": dest_str,
            "image_blob_id": blob_id,
        }),
    )
}

/// read the server-display fields out of the running config.
/// shape mirrors the local `get_server_config` tauri command so the wizard
/// can use one shape for both targets.
async fn server_get_config() -> GrimoireResponse<JsonValue> {
    // read from disk to avoid stale in-memory CONFIG. cheap (small toml)
    // and immune to any write path that forgets to reload after mutating.
    let cfg = match resolve_config_path() {
        Ok(p) => crate::config::read_config_from_file(&p).unwrap_or_else(|_| get_config()),
        Err(_) => get_config(),
    };
    let server = cfg.server.as_ref();
    let name = server
        .map(|s| s.name.clone())
        .unwrap_or_else(|| "freqhole".to_string());
    let description = server.and_then(|s| s.description.clone());
    let image_path = server
        .and_then(|s| s.image_path.as_ref())
        .map(|p| p.display().to_string());
    let image_blob_id = server.and_then(|s| s.image_blob_id.clone());
    GrimoireResponse::success(
        "ok",
        json!({
            "name": name,
            "description": description,
            "image_path": image_path,
            "image_blob_id": image_blob_id,
        }),
    )
}

/// return the server image as base64. tries a 128px thumbnail first, then
/// falls back to the original blob, then to `[server].image_path` on disk.
/// args: optional `{ size: u32 }` (default 128).
async fn server_get_image_thumbnail(args: JsonValue) -> GrimoireResponse<JsonValue> {
    use base64::{engine::general_purpose::STANDARD as B64, Engine as _};

    let size = args
        .get("size")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32)
        .unwrap_or(128);

    let cfg = get_config();
    let server = match cfg.server.as_ref() {
        Some(s) => s,
        None => return bad_request("no server config"),
    };

    // prefer blob_id (has thumbnails)
    if let Some(blob_id) = &server.image_blob_id {
        let path = match crate::blob_data::find_existing_thumbnail(blob_id, size).await {
            Some(t) => t.local_path,
            None => {
                let parent = crate::media_blobz::get_media_blob(blob_id).await.ok();
                parent.and_then(|b| b.local_path)
            }
        };
        if let Some(p) = path {
            match std::fs::read(&p) {
                Ok(bytes) => {
                    return GrimoireResponse::success("ok", json!({ "data": B64.encode(&bytes) }));
                }
                Err(e) => return internal(format!("failed to read image: {}", e)),
            }
        }
    }

    // fall back to image_path
    if let Some(image_path) = &server.image_path {
        let full = if image_path.is_absolute() {
            image_path.clone()
        } else {
            cfg.data_dir.join(image_path)
        };
        if full.exists() {
            match std::fs::read(&full) {
                Ok(bytes) => {
                    return GrimoireResponse::success("ok", json!({ "data": B64.encode(&bytes) }));
                }
                Err(e) => return internal(format!("failed to read image: {}", e)),
            }
        } else {
            tracing::warn!(
                "[server_get_image_thumbnail] image_path does not exist: {}",
                full.display()
            );
        }
    }

    tracing::warn!("[server_get_image_thumbnail] no image found, returning failure");
    GrimoireResponse::failure(
        "no server image configured",
        vec![ErrorDetail::new(
            "no_server_image",
            "no server image configured",
            "neither image_blob_id nor image_path resolved to a readable file",
        )],
    )
}

/// update `[server].name` and/or `[server].description`. either field
/// may be omitted to leave it unchanged.
async fn server_update_info(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let name = opt_str(&args, "name");
    let description = opt_str(&args, "description");
    if name.is_none() && description.is_none() {
        return bad_request("must provide at least one of: name, description");
    }

    let config_path = match resolve_config_path() {
        Ok(p) => p,
        Err(e) => return internal(format!("could not locate config file: {}", e)),
    };

    let mut updates: Vec<(&str, toml_edit::Value)> = Vec::new();
    if let Some(n) = &name {
        updates.push(("server.name", n.clone().into()));
    }
    if let Some(d) = &description {
        updates.push(("server.description", d.clone().into()));
    }
    if let Err(e) = crate::config::set_config_values(&config_path, &updates) {
        return internal(format!("failed to update config: {}", e));
    }

    // reload cached CONFIG so subsequent reads see the new values
    if let Err(e) = crate::config::init_config(Some(config_path.clone())) {
        return internal(format!("config written but reload failed: {}", e));
    }

    GrimoireResponse::success(
        "server info updated",
        json!({
            "name": name,
            "description": description,
        }),
    )
}

// =========================================================================
// radio
// =========================================================================

async fn radio_stations_list() -> GrimoireResponse<JsonValue> {
    match radio_stations::list_stations().await {
        Ok(stations) => to_value(GrimoireResponse::success("radio stations listed", stations)),
        Err(e) => GrimoireResponse::failure("failed to list radio stations", vec![e.into()]),
    }
}

async fn radio_stations_get(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioStationsByIdRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match radio_stations::get_station(&req.id).await {
        Ok(Some(s)) => to_value(GrimoireResponse::success("radio station found", s)),
        Ok(None) => GrimoireResponse::failure(
            "radio station not found",
            vec![ErrorDetail::new(
                "not_found",
                "radio station not found",
                &format!("no station with id {}", req.id),
            )],
        ),
        Err(e) => GrimoireResponse::failure("failed to get radio station", vec![e.into()]),
    }
}

async fn radio_stations_create(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let mut req: CreateStationRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if !radio_ffmpeg_available() {
        req.timeline_only_mode = Some(true);
    }
    match radio_stations::create_station(req).await {
        Ok(s) => {
            if crate::radio::config::effective().enabled && s.is_enabled != 0 {
                if let Err(e) = crate::radio::broadcaster::start_station(&s.id).await {
                    return GrimoireResponse::failure(
                        "radio station created but failed to start broadcaster",
                        vec![e.into()],
                    );
                }
            }
            to_value(GrimoireResponse::success("radio station created", s))
        }
        Err(e) => GrimoireResponse::failure("failed to create radio station", vec![e.into()]),
    }
}

async fn radio_stations_update(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let mut req: UpdateStationRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if !radio_ffmpeg_available() && req.timeline_only_mode == Some(false) {
        req.timeline_only_mode = Some(true);
    }
    let station_id = req.id.clone();
    let timeline_only_requested = req.timeline_only_mode;
    match radio_stations::update_station(req).await {
        Ok(s) => {
            if crate::radio::config::effective().enabled {
                if s.is_enabled != 0 {
                    if let Err(e) = crate::radio::broadcaster::start_station(&station_id).await {
                        return GrimoireResponse::failure(
                            "radio station updated but failed to start broadcaster",
                            vec![e.into()],
                        );
                    }
                } else if let Err(e) = crate::radio::broadcaster::stop_station(&station_id).await {
                    return GrimoireResponse::failure(
                        "radio station updated but failed to stop broadcaster",
                        vec![e.into()],
                    );
                }
            }

            // propagate timeline_only_mode change to the running broadcaster
            // immediately so the flag takes effect without a server restart.
            if let Some(tlo) = timeline_only_requested {
                if let Some(bc) = crate::radio::broadcaster::get_station(&station_id).await {
                    bc.set_timeline_only(tlo);
                }
            }
            to_value(GrimoireResponse::success("radio station updated", s))
        }
        Err(e) => GrimoireResponse::failure("failed to update radio station", vec![e.into()]),
    }
}

fn radio_ffmpeg_available() -> bool {
    crate::setup::check_dependencies().has_ffmpeg()
}

async fn radio_stations_delete(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioStationsByIdRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match radio_stations::delete_station(&req.id).await {
        Ok(()) => {
            if let Err(e) = crate::radio::broadcaster::stop_station(&req.id).await {
                return GrimoireResponse::failure(
                    "radio station deleted but failed to stop broadcaster",
                    vec![e.into()],
                );
            }
            GrimoireResponse::success("radio station deleted", JsonValue::Null)
        }
        Err(e) => GrimoireResponse::failure("failed to delete radio station", vec![e.into()]),
    }
}

async fn radio_filters_list(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioStationByStationIdRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match radio_stations::list_filters(&req.station_id).await {
        Ok(filters) => to_value(GrimoireResponse::success("filters listed", filters)),
        Err(e) => GrimoireResponse::failure("failed to list filters", vec![e.into()]),
    }
}

async fn radio_filters_add(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioFiltersAddRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match radio_stations::add_filter(
        &req.station_id,
        &req.filter_type,
        &req.filter_value,
        &req.mode,
    )
    .await
    {
        Ok(f) => to_value(GrimoireResponse::success("filter added", f)),
        Err(e) => GrimoireResponse::failure("failed to add filter", vec![e.into()]),
    }
}

async fn radio_filters_remove(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioFiltersRemoveRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match radio_stations::remove_filter(&req.filter_id).await {
        Ok(()) => GrimoireResponse::success("filter removed", JsonValue::Null),
        Err(e) => GrimoireResponse::failure("failed to remove filter", vec![e.into()]),
    }
}

async fn radio_songs_list(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioStationByStationIdRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match radio_stations::list_songs(&req.station_id).await {
        Ok(songs) => to_value(GrimoireResponse::success("songs listed", songs)),
        Err(e) => GrimoireResponse::failure("failed to list songs", vec![e.into()]),
    }
}

async fn radio_songs_add(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioSongsAddRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let sort_order = req.sort_order.unwrap_or(0);
    match radio_stations::add_song(&req.station_id, &req.song_id, sort_order).await {
        Ok(()) => GrimoireResponse::success("song added", JsonValue::Null),
        Err(e) => GrimoireResponse::failure("failed to add song", vec![e.into()]),
    }
}

async fn radio_songs_remove(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioSongsRemoveRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match radio_stations::remove_song(&req.station_id, &req.song_id).await {
        Ok(()) => GrimoireResponse::success("song removed", JsonValue::Null),
        Err(e) => GrimoireResponse::failure("failed to remove song", vec![e.into()]),
    }
}

async fn radio_seed_suggest(args: JsonValue) -> GrimoireResponse<JsonValue> {
    use crate::music::crud::{query_albums, query_artists, search_songs, QueryParams};
    use crate::music::entities::genres::query_genres;
    use crate::music::entities::tags::query_tags;

    let req: RadioSeedSuggestRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let limit = req.limit.unwrap_or(15).min(50);
    let q = req.query.trim().to_string();

    let suggestions: Vec<RadioSeedSuggestion> = match req.kind.as_str() {
        "tag" => {
            let resp = query_tags(&q).await;
            resp.data
                .unwrap_or_default()
                .into_iter()
                .take(limit as usize)
                .map(|t| RadioSeedSuggestion {
                    id: t.id,
                    name: t.name,
                    subtitle: None,
                })
                .collect()
        }
        "genre" => {
            let resp = query_genres(&q).await;
            resp.data
                .unwrap_or_default()
                .into_iter()
                .take(limit as usize)
                .map(|g| RadioSeedSuggestion {
                    id: g.id,
                    name: g.name,
                    subtitle: None,
                })
                .collect()
        }
        "artist" => {
            let params = QueryParams {
                q: if q.is_empty() { None } else { Some(q.clone()) },
                search_fields: None,
                filters: std::collections::HashMap::new(),
                sort_by: Some("name".to_string()),
                sort_direction: Some("asc".to_string()),
                limit: Some(limit),
                offset: Some(0),
                user_id: None,
                favorites_only: None,
                min_rating: None,
            };
            let resp = query_artists(params).await;
            resp.data
                .map(|qr| qr.items)
                .unwrap_or_default()
                .into_iter()
                .map(|r| RadioSeedSuggestion {
                    id: r.artist.id,
                    name: r.artist.name,
                    subtitle: None,
                })
                .collect()
        }
        "album" => {
            let params = QueryParams {
                q: if q.is_empty() { None } else { Some(q.clone()) },
                search_fields: None,
                filters: std::collections::HashMap::new(),
                sort_by: Some("title".to_string()),
                sort_direction: Some("asc".to_string()),
                limit: Some(limit),
                offset: Some(0),
                user_id: None,
                favorites_only: None,
                min_rating: None,
            };
            let resp = query_albums(params).await;
            resp.data
                .map(|qr| qr.items)
                .unwrap_or_default()
                .into_iter()
                .map(|r| RadioSeedSuggestion {
                    id: r.album.id,
                    name: r.album.title,
                    subtitle: r.artist.map(|a| a.name),
                })
                .collect()
        }
        "song" => {
            if q.is_empty() {
                Vec::new()
            } else {
                let resp = search_songs(&q, Some(limit), Some(0)).await;
                resp.data
                    .map(|qr| qr.items)
                    .unwrap_or_default()
                    .into_iter()
                    .map(|r| {
                        let artist_name = r
                            .artist
                            .as_ref()
                            .map(|a| a.name.clone())
                            .unwrap_or_default();
                        let album_name = r.album.as_ref().map(|a| a.title.clone());
                        let label = if artist_name.is_empty() {
                            r.song.title.clone()
                        } else {
                            format!("{} — {}", r.song.title, artist_name)
                        };
                        RadioSeedSuggestion {
                            id: r.song.id,
                            name: label,
                            subtitle: album_name,
                        }
                    })
                    .collect()
            }
        }
        other => {
            return GrimoireResponse::failure(
                &format!("unknown seed-suggest kind: {}", other),
                vec![],
            );
        }
    };

    to_value(GrimoireResponse::success("suggestions", suggestions))
}

async fn radio_config_get() -> GrimoireResponse<JsonValue> {
    let cfg = crate::radio::config::effective();
    let payload = RadioConfigPayload {
        enabled: cfg.enabled,
        encode_args: cfg.encode_args,
        ffmpeg_available: radio_ffmpeg_available(),
    };
    to_value(GrimoireResponse::success("ok", payload))
}

async fn radio_config_set(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioConfigPayload = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let path = match resolve_config_path() {
        Ok(p) => p,
        Err(e) => return internal(format!("could not locate config file: {}", e)),
    };
    let toml_str = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => return internal(format!("failed to read config file: {}", e)),
    };
    // parse to a generic toml::Value table so we can swap just the
    // [radio] section without touching any other keys.
    let mut doc: toml::Value = match toml::from_str(&toml_str) {
        Ok(v) => v,
        Err(e) => return internal(format!("config file is not valid toml: {}", e)),
    };
    let table = match doc.as_table_mut() {
        Some(t) => t,
        None => return internal("config root is not a table".to_string()),
    };
    let radio_table = toml::Value::Table({
        let mut m = toml::map::Map::new();
        m.insert("enabled".into(), toml::Value::Boolean(req.enabled));
        m.insert(
            "encode_args".into(),
            toml::Value::String(req.encode_args.clone()),
        );
        m
    });
    table.insert("radio".into(), radio_table);
    let new_toml = match toml::to_string_pretty(&doc) {
        Ok(s) => s,
        Err(e) => return internal(format!("failed to serialize config: {}", e)),
    };
    // validate full document still parses as a `GrimoireConfig`.
    if let Err(e) = toml::from_str::<crate::config::GrimoireConfig>(&new_toml) {
        return bad_request(format!("invalid resulting config: {}", e));
    }
    if let Err(e) = std::fs::write(&path, new_toml.as_bytes()) {
        return internal(format!("failed to write config: {}", e));
    }
    if let Err(e) = crate::config::init_config(Some(path.clone())) {
        return internal(format!("config written but reload failed: {}", e));
    }
    let cfg = crate::radio::config::effective();
    // act on the new effective state. flipping the master switch on
    // spawns broadcasters for every enabled station; flipping it off
    // tears them all down. note: the iroh router's RADIO_ALPN handler
    // is wired during `init_p2p_client` (app startup) — without an app
    // restart, broadcasters are running but unreachable from peers
    // unless radio was already enabled at startup.
    if cfg.enabled {
        if let Err(e) = crate::radio::broadcaster::init_registry().await {
            return internal(format!(
                "config saved but broadcasters failed to start: {}",
                e
            ));
        }
    } else if let Err(e) = crate::radio::broadcaster::stop_all().await {
        return internal(format!(
            "config saved but broadcasters failed to stop: {}",
            e
        ));
    }
    let out = RadioConfigPayload {
        enabled: cfg.enabled,
        encode_args: cfg.encode_args,
        ffmpeg_available: radio_ffmpeg_available(),
    };
    to_value(GrimoireResponse::success("config updated", out))
}

// =========================================================================
// radio supervisor (start/stop/restart broadcasters)
// =========================================================================

async fn build_supervisor_status() -> GrimoireResponse<JsonValue> {
    let stations = match crate::radio::stations::list_stations().await {
        Ok(v) => v,
        Err(e) => return GrimoireResponse::failure("failed to list stations", vec![e.into()]),
    };
    let default_id = crate::radio::broadcaster::current_default_station_id().await;
    let mut rows: Vec<RadioStationSupervisorStatus> = Vec::with_capacity(stations.len());
    for st in stations {
        let bc = crate::radio::broadcaster::get_station(&st.id).await;
        let (is_running, listener_count, current_seq, np) = if let Some(bc) = bc {
            let np = bc.now_playing().await;
            (true, bc.listener_count(), bc.current_seq(), Some(np))
        } else {
            (false, 0u32, 0u32, None)
        };
        let (current_song_id, current_title) = match np {
            Some(np) => {
                let song_id = if np.song_id.is_empty() {
                    None
                } else {
                    Some(np.song_id.clone())
                };
                let title = if np.title.is_empty() {
                    None
                } else {
                    Some(np.title.clone())
                };
                (song_id, title)
            }
            None => (None, None),
        };
        rows.push(RadioStationSupervisorStatus {
            station_id: st.id.clone(),
            name: st.name,
            is_enabled: st.is_enabled != 0,
            is_running,
            listener_count,
            current_seq,
            current_song_id,
            current_title,
            is_default: default_id.as_deref() == Some(st.id.as_str()),
        });
    }
    let payload = RadioSupervisorStatusResponse {
        radio_enabled: crate::radio::config::effective().enabled,
        stations: rows,
    };
    to_value(GrimoireResponse::success("ok", payload))
}

async fn radio_supervisor_status() -> GrimoireResponse<JsonValue> {
    build_supervisor_status().await
}

async fn radio_supervisor_start(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioSupervisorStationRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if let Err(e) = crate::radio::broadcaster::start_station(&req.station_id).await {
        return GrimoireResponse::failure("failed to start station", vec![e.into()]);
    }
    build_supervisor_status().await
}

async fn radio_supervisor_stop(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioSupervisorStationRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if let Err(e) = crate::radio::broadcaster::stop_station(&req.station_id).await {
        return GrimoireResponse::failure("failed to stop station", vec![e.into()]);
    }
    build_supervisor_status().await
}

async fn radio_supervisor_restart(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioSupervisorStationRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if let Err(e) = crate::radio::broadcaster::restart_station(&req.station_id).await {
        return GrimoireResponse::failure("failed to restart station", vec![e.into()]);
    }
    build_supervisor_status().await
}

async fn radio_supervisor_skip_track(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioSupervisorStationRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    if let Err(e) = crate::radio::broadcaster::skip_station_track(&req.station_id).await {
        return GrimoireResponse::failure("failed to skip current track", vec![e.into()]);
    }
    build_supervisor_status().await
}

// =========================================================================
// radio bumpers
// =========================================================================

fn bumper_to_payload(b: crate::radio::bumpers::Bumper) -> RadioBumper {
    RadioBumper {
        id: b.id,
        station_id: b.station_id,
        song_id: b.song_id,
        label: b.label,
        weight: b.weight,
        created_at: b.created_at,
    }
}

async fn radio_bumpers_list(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioBumpersListRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match crate::radio::bumpers::list_bumpers(&req.station_id).await {
        Ok(rows) => {
            let payload: Vec<RadioBumper> = rows.into_iter().map(bumper_to_payload).collect();
            to_value(GrimoireResponse::success("bumpers listed", payload))
        }
        Err(e) => GrimoireResponse::failure("failed to list bumpers", vec![e.into()]),
    }
}

async fn radio_bumpers_add(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioBumpersAddRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    let weight = req.weight.unwrap_or(1);
    match crate::radio::bumpers::add_bumper(&req.station_id, &req.song_id, &req.label, Some(weight))
        .await
    {
        Ok(b) => {
            let payload = bumper_to_payload(b);
            to_value(GrimoireResponse::success("bumper added", payload))
        }
        Err(e) => GrimoireResponse::failure("failed to add bumper", vec![e.into()]),
    }
}

async fn radio_bumpers_remove(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioBumpersRemoveRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match crate::radio::bumpers::remove_bumper(&req.bumper_id).await {
        Ok(()) => GrimoireResponse::success("bumper removed", JsonValue::Null),
        Err(e) => GrimoireResponse::failure("failed to remove bumper", vec![e.into()]),
    }
}

async fn radio_bumpers_set_frequency(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: RadioBumpersSetFrequencyRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    match crate::radio::bumpers::set_frequency(&req.station_id, req.frequency_seconds).await {
        Ok(()) => GrimoireResponse::success("frequency updated", JsonValue::Null),
        Err(e) => GrimoireResponse::failure("failed to set bumper frequency", vec![e.into()]),
    }
}
