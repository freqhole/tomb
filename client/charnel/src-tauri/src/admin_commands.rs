//! single tauri command that wraps `grimoire::admin_dispatch::handle`
//!
//! this is the local-process mirror of the remote `freqhole-admin/1` ALPN
//! handler. wizard / settings UI uses this for in-process admin operations
//! against the local grimoire instance, replacing many per-operation
//! tauri commands.
//!
//! transport: this is the *local* path. the resolved caller is always
//! `Caller::local_admin()` because being able to `invoke` into our own
//! tauri process is itself the auth boundary (the OS user is the admin).
//!
//! see docs/wizard-remote-admin.md for the full plan.

use crate::commands::ensure_initialized_pub;
use grimoire::admin_dispatch;
use grimoire::offal::Caller;
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

    let caller = Caller::local_admin();
    let args = args.unwrap_or(JsonValue::Null);
    let response = admin_dispatch::handle(&command, args, &caller).await;

    serde_json::to_value(response).map_err(|e| e.to_string())
}
