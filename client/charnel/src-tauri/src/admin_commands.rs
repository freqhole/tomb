//! single tauri command that wraps `grimoire::admin_dispatch::handle`
//!
//! this is the local-process mirror of the remote `freqhole-admin/1` ALPN
//! handler. wizard / settings UI uses this for in-process admin operations
//! against the local grimoire instance, replacing many per-operation
//! tauri commands.
//!
//! transport: this is the *local* path. the resolved caller is loaded from
//! charnel's app config (`charnel-config.toml` -> `admin_user`), which is
//! seeded during the setup wizard. being able to `invoke` into our own
//! tauri process is itself the auth boundary (the OS user is the admin).
//!
//! see docs/wizard-remote-admin.md for the full plan.

use crate::commands::{ensure_initialized_pub, get_caller_from_app_config};
use grimoire::admin_dispatch;
use serde_json::Value as JsonValue;

/// dispatch an admin command against the local grimoire instance.
///
/// `command` is the admin command name (e.g. `"users_list"`).
/// `args` is the per-command argument object as JSON.
///
/// returns the full `GrimoireResponse<JsonValue>` shape (success, message,
/// data, errors) serialized to JSON so the TS side can surface structured
/// errors the same way it does for the remote ALPN transport.
#[tauri::command]
pub async fn admin_dispatch(
    app_handle: tauri::AppHandle,
    command: String,
    args: Option<JsonValue>,
) -> Result<JsonValue, String> {
    ensure_initialized_pub(&app_handle)
        .await
        .map_err(|e| e.to_string())?;

    let caller = get_caller_from_app_config(&app_handle)?;
    let args = args.unwrap_or(JsonValue::Null);
    let response = admin_dispatch::handle(&command, args, &caller).await;

    serde_json::to_value(response).map_err(|e| e.to_string())
}

/// dispatch an admin command to a remote freqhole instance over the
/// `freqhole-admin/1` ALPN.
///
/// `peer_addr` is either a 64-char node id or full endpoint json (same
/// format accepted by the rest of the P2P client surface).
///
/// the federation endpoint must already be initialized — this is the same
/// requirement as `p2p_proxy_request` and friends. on the wire, the request
/// is framed as `AdminMessage::Request` and the response as
/// `AdminMessage::Response`; we re-shape it to a `GrimoireResponse`-style
/// JSON envelope so the TS side can treat local and remote responses the
/// same way.
#[tauri::command]
pub async fn admin_dispatch_remote(
    peer_addr: String,
    command: String,
    args: Option<JsonValue>,
) -> Result<JsonValue, String> {
    let args = args.unwrap_or(JsonValue::Null);

    let response = grimoire::federation::transport::send_admin_request(&peer_addr, &command, args)
        .await
        .map_err(|e| e.to_string())?;

    serde_json::to_value(response).map_err(|e| e.to_string())
}
