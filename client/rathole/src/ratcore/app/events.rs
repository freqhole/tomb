//! action types + portable admin command/response shapes.
//!
//! these are the data the core needs from a shell. shells convert
//! their domain types (e.g. `grimoire::admin_dispatch::registry::AdminCommandInfo`,
//! `grimoire::response::GrimoireResponse`) into these on the seam.

use serde_json::Value as JsonValue;

/// dispatch result, transport-agnostic. mirrors the useful subset
/// of `grimoire::response::GrimoireResponse<JsonValue>`.
#[derive(Debug, Clone)]
pub struct DispatchResponse {
    pub success: bool,
    pub message: String,
    pub data: Option<JsonValue>,
}

/// admin command metadata, transport-agnostic. mirrors
/// `grimoire::admin_dispatch::registry::AdminCommandInfo` but owned
/// strings so the web shell can build them at runtime.
#[derive(Debug, Clone)]
pub struct AdminCommand {
    pub name: String,
    pub request_type: String,
    pub response_type: String,
    pub auth: String,
}

/// background-task → ui-loop messages.
#[derive(Debug)]
pub enum AppAction {
    /// result of an admin dispatch fired from the palette.
    AdminDispatchResult {
        command: String,
        response: DispatchResponse,
    },
}

/// most recent dispatch result, kept for the detail pane.
#[derive(Debug, Clone)]
pub struct LastDispatch {
    pub command: String,
    pub success: bool,
    pub message: String,
    pub data_pretty: Option<String>,
}
