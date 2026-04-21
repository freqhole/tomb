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

use crate::config::{find_config, get_config, read_config_from_file};
use crate::error::ErrorDetail;
use crate::federation::knock;
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use crate::users::{
    CreateInviteCodeRequest, CreateUserRequest, UpdateUserRequest, User, UserQueryParams, UserRole,
    UserService,
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
        "knocks_list" => to_value(knock::list_knocks(false).await),
        "knocks_list_all" => to_value(knock::list_knocks(true).await),
        "knocks_accept" => knocks_accept(args, caller).await,
        "knocks_reject" => knocks_reject(args, caller).await,
        "knocks_delete" => knocks_delete(args).await,

        // -- users --
        "users_list" => users_list(args, caller).await,
        "users_get" => users_get(args).await,
        "users_create" => users_create(args).await,
        "users_update_role" => users_update_role(args, caller).await,
        "users_delete" => users_delete(args, caller).await,

        // -- invites --
        "invites_list" => invites_list(args, caller).await,
        "invites_generate" => invites_generate(args, caller).await,
        "invites_revoke" => invites_revoke(args, caller).await,

        // -- peers --
        "peers_list_all" => to_value(UserService::new().get_all_peer_nodes().await),
        "peers_list_for_user" => peers_list_for_user(args).await,
        "peers_remove" => peers_remove(args).await,

        // -- library --
        "library_validate_path" => library_validate_path(args).await,
        "library_scan" => library_scan(args).await,
        "library_scan_status" => library_scan_status(args).await,
        "library_image_upload" => library_image_upload(args, caller).await,

        // -- config / server --
        "config_get" => config_get().await,
        "config_set" => config_set(args).await,
        "server_restart" => server_restart(args).await,
        "server_info" => crate::offal::public::health::server_info().await,
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
    let knock_id = match require_str(&args, "knock_id") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let role = match require_str(&args, "role") {
        Ok(v) => v,
        Err(r) => return r,
    };
    let username = opt_str(&args, "username");
    let user_id = opt_str(&args, "user_id");

    let req = knock::ProcessKnockRequest {
        username,
        role,
        user_id,
    };
    match knock::accept_knock(&knock_id, req, &caller.user_id).await {
        Ok(k) => to_value(GrimoireResponse::success("knock accepted", k)),
        Err(e) => GrimoireResponse::failure("failed to accept knock", vec![e.into()]),
    }
}

async fn knocks_reject(args: JsonValue, caller: &Caller) -> GrimoireResponse<JsonValue> {
    let knock_id = match require_str(&args, "knock_id") {
        Ok(v) => v,
        Err(r) => return r,
    };
    match knock::reject_knock(&knock_id, &caller.user_id).await {
        Ok(k) => to_value(GrimoireResponse::success("knock rejected", k)),
        Err(e) => GrimoireResponse::failure("failed to reject knock", vec![e.into()]),
    }
}

async fn knocks_delete(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let knock_id = match require_str(&args, "knock_id") {
        Ok(v) => v,
        Err(r) => return r,
    };
    match knock::delete_knock(&knock_id).await {
        Ok(()) => GrimoireResponse::success("knock deleted", JsonValue::Null),
        Err(e) => GrimoireResponse::failure("failed to delete knock", vec![e.into()]),
    }
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

// =========================================================================
// invites
// =========================================================================

async fn invites_list(args: JsonValue, caller: &Caller) -> GrimoireResponse<JsonValue> {
    let active_only = opt_bool(&args, "active_only").unwrap_or(false);
    let admin = match fetch_caller_user(caller).await {
        Ok(u) => u,
        Err(r) => return r,
    };
    to_value(
        UserService::new()
            .list_invite_codes(active_only, &admin)
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
    let session_id = opt_str(&args, "session_id").unwrap_or_else(|| {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        format!("admin-scan-{}", now)
    });

    let resp = crate::music::scan_directory(&path, &session_id, recursive, None, None, false).await;

    // wrap result to also expose the session_id we used
    let GrimoireResponse {
        success,
        message,
        data,
        errors,
    } = resp;
    let data_json = json!({
        "session_id": session_id,
        "files_discovered": data.unwrap_or(0),
    });
    GrimoireResponse {
        success,
        message,
        data: Some(data_json),
        errors,
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

// =========================================================================
// config / server
// =========================================================================

async fn config_get() -> GrimoireResponse<JsonValue> {
    let path = match find_config(None) {
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
    let path: PathBuf = match find_config(None) {
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
    let config_path = match find_config(None) {
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
