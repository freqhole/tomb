//! background-task → ui-loop messages. spawned tasks send these
//! over an `mpsc::UnboundedSender<AppAction>`; the event loop
//! drains them in `tokio::select!`.

use grimoire::response::GrimoireResponse;
use serde_json::Value as JsonValue;

#[derive(Debug)]
pub enum AppAction {
    /// result of an admin dispatch fired from the palette.
    AdminDispatchResult {
        command: String,
        response: GrimoireResponse<JsonValue>,
    },
}
