//! shared helpers for admin command handlers.
//!
//! kept in a sibling module so each per-domain handler file can `use
//! super::helpers::*` rather than redefining the same bad_request /
//! decode / to_value scaffolding.

use crate::config::{find_config, get_config_path};
use crate::error::ErrorDetail;
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use crate::users::{User, UserRole, UserService};
use serde::{de::DeserializeOwned, Serialize};
use serde_json::Value as JsonValue;
use std::path::PathBuf;

pub(super) fn forbidden() -> GrimoireResponse<JsonValue> {
    GrimoireResponse::failure(
        "forbidden",
        vec![ErrorDetail::new(
            "forbidden",
            "forbidden",
            "admin role required",
        )],
    )
}

pub(super) fn command_not_found(command: &str) -> GrimoireResponse<JsonValue> {
    GrimoireResponse::failure(
        "admin command not found",
        vec![ErrorDetail::new(
            "command_not_found",
            "admin command not found",
            format!("no handler for command: {}", command),
        )],
    )
}

pub(super) fn bad_request(detail: impl Into<String>) -> GrimoireResponse<JsonValue> {
    GrimoireResponse::failure(
        "bad request",
        vec![ErrorDetail::new(
            "bad_request",
            "bad request",
            detail.into(),
        )],
    )
}

pub(super) fn internal(detail: impl Into<String>) -> GrimoireResponse<JsonValue> {
    GrimoireResponse::failure(
        "internal error",
        vec![ErrorDetail::new(
            "internal_error",
            "internal error",
            detail.into(),
        )],
    )
}

/// resolve the active config file path. prefers the path captured by
/// `init_config()` (set by tauri/cli/server bootstrap) and falls back to
/// the legacy `./freqhole-config.toml` cwd lookup.
pub(super) fn resolve_config_path() -> Result<PathBuf, crate::config::ConfigError> {
    if let Some(p) = get_config_path() {
        if p.exists() {
            return Ok(p);
        }
    }
    find_config(None)
}

/// decode args into a typed struct or return a bad_request response
pub(super) fn decode<T: DeserializeOwned>(
    args: JsonValue,
) -> Result<T, GrimoireResponse<JsonValue>> {
    serde_json::from_value(args).map_err(|e| bad_request(e.to_string()))
}

/// require a string field on a JsonValue object
pub(super) fn require_str(
    args: &JsonValue,
    field: &str,
) -> Result<String, GrimoireResponse<JsonValue>> {
    args.get(field)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| bad_request(format!("missing or non-string field: {}", field)))
}

/// optional string field
pub(super) fn opt_str(args: &JsonValue, field: &str) -> Option<String> {
    args.get(field)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// optional bool field
pub(super) fn opt_bool(args: &JsonValue, field: &str) -> Option<bool> {
    args.get(field).and_then(|v| v.as_bool())
}

/// optional i64 field with a fallback
pub(super) fn opt_i64(args: &JsonValue, field: &str, default: i64) -> i64 {
    args.get(field).and_then(|v| v.as_i64()).unwrap_or(default)
}

/// convert a typed GrimoireResponse into a JsonValue-shaped one
pub(super) fn to_value<T: Serialize>(resp: GrimoireResponse<T>) -> GrimoireResponse<JsonValue> {
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
pub(super) fn map_response<T, U>(
    resp: GrimoireResponse<T>,
    f: impl FnOnce(T) -> U,
) -> GrimoireResponse<U> {
    GrimoireResponse {
        success: resp.success,
        message: resp.message,
        data: resp.data.map(f),
        errors: resp.errors,
    }
}

/// like `to_value` but lets the caller transform `data` into a json
/// shape (useful for tuple-returning service fns).
pub(super) fn map_response_to_json<T>(
    resp: GrimoireResponse<T>,
    f: impl FnOnce(T) -> JsonValue,
) -> GrimoireResponse<JsonValue> {
    GrimoireResponse {
        success: resp.success,
        message: resp.message,
        data: resp.data.map(f),
        errors: resp.errors,
    }
}

/// parse a role string into `UserRole`, rejecting unknown values.
/// accepts "root" | "admin" | "member" | "viewer" (case-insensitive).
pub(super) fn parse_role(s: &str) -> Result<UserRole, String> {
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
pub(super) async fn fetch_caller_user(
    caller: &Caller,
) -> Result<User, GrimoireResponse<JsonValue>> {
    let resp = UserService::new().get_user(&caller.user_id).await;
    resp.data
        .ok_or_else(|| internal("caller user record not found"))
}

/// parse a tag list from args. accepts either a json array of strings
/// or a comma-separated string, matching how the cli's `--tags a,b,c`
/// flag is shaped.
pub(super) fn parse_tag_list(args: &JsonValue) -> Result<Vec<String>, GrimoireResponse<JsonValue>> {
    if let Some(arr) = args.get("tags").and_then(|v| v.as_array()) {
        let mut out = Vec::with_capacity(arr.len());
        for v in arr {
            if let Some(s) = v.as_str() {
                let t = s.trim();
                if !t.is_empty() {
                    out.push(t.to_string());
                }
            }
        }
        if out.is_empty() {
            return Err(bad_request("at least one tag name required"));
        }
        return Ok(out);
    }
    if let Some(s) = args.get("tags").and_then(|v| v.as_str()) {
        let out: Vec<String> = s
            .split(',')
            .map(|t| t.trim().to_string())
            .filter(|t| !t.is_empty())
            .collect();
        if out.is_empty() {
            return Err(bad_request("at least one tag name required"));
        }
        return Ok(out);
    }
    Err(bad_request(
        "missing field: tags (array or comma-separated string)",
    ))
}
