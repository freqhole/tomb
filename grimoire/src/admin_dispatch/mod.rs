//! admin command dispatch
//!
//! single source of truth for the wizard-admin command surface. used by
//! both:
//! - the local tauri `admin_dispatch` command (slice 4) — calls with
//!   `Caller::local_admin()`
//! - the remote `freqhole-admin/1` ALPN handler (slice 2) — calls with the
//!   resolved admin caller for the connecting peer
//!
//! commands are added in slice 3 (knocks, users, invites, peers, library,
//! config, server info). this module currently contains the dispatch shell
//! only; unknown commands return a structured error.
//!
//! see docs/wizard-remote-admin.md for the full plan.

use crate::error::ErrorDetail;
use crate::offal::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

/// dispatch an admin command to its handler.
///
/// returns `GrimoireResponse<JsonValue>` for uniform serialization across
/// transports. unknown commands return a `command_not_found` error.
pub async fn handle(
    command: &str,
    _args: JsonValue,
    _caller: &Caller,
) -> GrimoireResponse<JsonValue> {
    // command implementations live in submodules added in slice 3.
    // for now everything is unknown.
    match command {
        // slice 3 will populate this match
        _ => command_not_found(command),
    }
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
