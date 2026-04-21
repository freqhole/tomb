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

use crate::admin_dispatch::types::knocks::{
    KnocksAcceptRequest, KnocksDeleteRequest, KnocksRejectAllResponse, KnocksRejectRequest,
};
use crate::config::{find_config, get_config, get_config_path, read_config_from_file};
use crate::error::ErrorDetail;
use crate::federation::knock;
use crate::offal::Caller;
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
        "peers_list_all" => to_value(UserService::new().get_all_peer_nodes().await),
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
    let params: UserQueryParams = if args.is_null() {
        UserQueryParams::default()
    } else {
        match decode(args) {
            Ok(p) => p,
            Err(r) => return r,
        }
    };
    let user = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    to_value(UserService::new().list_users(&params, &user).await)
}

async fn users_get(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let user_id = match require_str(&args, "user_id") {
        Ok(v) => v,
        Err(r) => return r,
    };
    to_value(UserService::new().get_user(&user_id).await)
}

async fn users_create(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let req: CreateUserRequest = match decode(args) {
        Ok(v) => v,
        Err(r) => return r,
    };
    to_value(UserService::new().register_user(&req).await)
}

async fn users_update_role(args: JsonValue, caller: &Caller) -> GrimoireResponse<JsonValue> {
    let user_id = match require_str(&args, "user_id") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let role: UserRole = match args.get("role") {
        Some(v) => match serde_json::from_value(v.clone()) {
            Ok(r) => r,
            Err(e) => return bad_request(format!("invalid role: {}", e)),
        },
        None => return bad_request("missing field: role"),
    };
    let admin = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    let updates = UpdateUserRequest { role: Some(role) };
    to_value(
        UserService::new()
            .update_user(&user_id, &updates, &admin)
            .await,
    )
}

async fn users_delete(args: JsonValue, caller: &Caller) -> GrimoireResponse<JsonValue> {
    let user_id = match require_str(&args, "user_id") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let admin = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    to_value(UserService::new().delete_user(&user_id, &admin).await)
}

/// generate a 24-hour account-link code for an existing user (lets them
/// add a new passkey). returns `{ code: String }`.
async fn users_generate_account_link(
    args: JsonValue,
    caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    let user_id = match require_str(&args, "user_id") {
        Ok(v) => v,
        Err(r) => return r,
    };
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

    let req = CreateInviteCodeRequest {
        code_type: Some(InviteCodeType::AccountLink),
        link_for_user_id: Some(user_id),
        expires_hours: Some(24),
        grants_role: None,
    };
    let response = service.generate_invite_codes(&req, 1, 4, &admin).await;
    match response.data {
        Some(codes) if !codes.is_empty() => {
            GrimoireResponse::success(response.message, json!({ "code": codes[0].code }))
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
    let active_only = opt_bool(&args, "active_only").unwrap_or(false);
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

    // map to UI-shaped objects (matches legacy InviteInfo)
    let infos: Vec<JsonValue> = codes
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
            serde_json::json!({
                "code": c.code,
                "code_type": format!("{:?}", c.code_type).to_lowercase(),
                "grants_role": c.grants_role.to_string(),
                "created_at": c.created_at,
                "expires_at": c.link_expires_at,
                "used_at": c.used_at,
                "used_by": c.used_by_id,
                "used_by_username": used_by_username,
                "link_for_user_id": c.link_for_user_id,
                "link_for_username": link_for_username,
                "is_active": c.is_active,
            })
        })
        .collect();

    GrimoireResponse::success(response.message, JsonValue::Array(infos))
}

async fn invites_revoke_all(caller: &Caller) -> GrimoireResponse<JsonValue> {
    let admin = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    to_value(
        UserService::new()
            .deactivate_all_active_invites(&admin)
            .await,
    )
}

async fn invites_update_role(args: JsonValue, caller: &Caller) -> GrimoireResponse<JsonValue> {
    let code = match require_str(&args, "code") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let role_str = match require_str(&args, "role") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let role: UserRole = role_str.as_str().into();
    if role == UserRole::Root {
        return bad_request("cannot set invite to grant root role".to_string());
    }
    let admin = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    to_value(
        UserService::new()
            .update_invite_role(&code, role, &admin)
            .await,
    )
}

async fn invites_generate(args: JsonValue, caller: &Caller) -> GrimoireResponse<JsonValue> {
    let count = args.get("count").and_then(|v| v.as_u64()).unwrap_or(1) as u32;
    let word_count = args.get("word_count").and_then(|v| v.as_u64()).unwrap_or(3) as usize;
    let req: CreateInviteCodeRequest = match args.get("request") {
        Some(v) => match serde_json::from_value(v.clone()) {
            Ok(r) => r,
            Err(e) => return bad_request(format!("invalid request: {}", e)),
        },
        None => CreateInviteCodeRequest {
            code_type: None,
            link_for_user_id: None,
            expires_hours: args
                .get("expires_hours")
                .and_then(|v| v.as_u64())
                .map(|n| n as u32),
            grants_role: match args.get("role") {
                Some(v) => match serde_json::from_value(v.clone()) {
                    Ok(r) => Some(r),
                    Err(e) => return bad_request(format!("invalid role: {}", e)),
                },
                None => None,
            },
        },
    };
    let admin = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    to_value(
        UserService::new()
            .generate_invite_codes(&req, count, word_count, &admin)
            .await,
    )
}

async fn invites_revoke(args: JsonValue, caller: &Caller) -> GrimoireResponse<JsonValue> {
    let code = match require_str(&args, "code") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let admin = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    to_value(
        UserService::new()
            .deactivate_invite_code(&code, &admin)
            .await,
    )
}

// =========================================================================
// peers
// =========================================================================

async fn peers_list_for_user(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let user_id = match require_str(&args, "user_id") {
        Ok(v) => v,
        Err(r) => return r,
    };
    to_value(UserService::new().get_user_peer_nodes(&user_id).await)
}

async fn peers_remove(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let user_id = match require_str(&args, "user_id") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let node_id = match require_str(&args, "node_id") {
        Ok(v) => v,
        Err(r) => return r,
    };
    to_value(
        UserService::new()
            .remove_peer_node(&user_id, &node_id)
            .await,
    )
}

/// allow a peer node by linking (or creating) a user with the given role.
/// args: `{ node_id, username?, role?, user_id? }`
/// - if `user_id` is set, links to that existing user
/// - else if `username` matches an existing user, links to it
/// - else creates a new user (`username` defaults to `peer_<first8>`)
/// returns `{ user_id, username, node_id, created_user }` to mirror the
/// legacy `allow_peer` tauri command shape.
async fn peers_allow(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let node_id = match require_str(&args, "node_id") {
        Ok(v) => v,
        Err(r) => return r,
    };

    if node_id.len() != 64 || !node_id.chars().all(|c| c.is_ascii_hexdigit()) {
        return bad_request("invalid node_id: expected 64 hex characters");
    }

    let role_str = opt_str(&args, "role").unwrap_or_else(|| "viewer".to_string());
    let user_role = match role_str.as_str() {
        "admin" => UserRole::Admin,
        "member" => UserRole::Member,
        "viewer" => UserRole::Viewer,
        other => {
            return bad_request(format!(
                "invalid role '{}': expected admin, member, or viewer",
                other
            ));
        }
    };

    let service = UserService::new();
    let (user, created_user) = if let Some(uid) = opt_str(&args, "user_id") {
        match service.get_user(&uid).await.data {
            Some(u) => (u, false),
            None => return bad_request(format!("user not found: {}", uid)),
        }
    } else {
        let username =
            opt_str(&args, "username").unwrap_or_else(|| format!("peer_{}", &node_id[..8]));

        if let Some(existing) = service.get_user_by_username(&username).await.data {
            (existing, false)
        } else {
            let req = CreateUserRequest {
                username: username.clone(),
                role: Some(user_role),
                invite_code: None,
            };
            match service.register_user(&req).await {
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

    GrimoireResponse::success(
        "peer node linked",
        json!({
            "user_id": user.id,
            "username": user.username,
            "node_id": node_id,
            "created_user": created_user,
        }),
    )
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
    let cfg = get_config();
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
            None => crate::media_blobz::get_media_blob(blob_id)
                .await
                .ok()
                .and_then(|b| b.local_path),
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
        }
    }

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
