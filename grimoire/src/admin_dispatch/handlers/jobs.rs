//! background-job introspection handlers.

use crate::admin_dispatch::helpers::{opt_str, to_value};
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

pub(in crate::admin_dispatch) async fn list(args: JsonValue) -> GrimoireResponse<JsonValue> {
    let session_id = opt_str(&args, "session_id");
    let limit = args.get("limit").and_then(|v| v.as_u64()).map(|v| v as u32);
    let offset = args
        .get("offset")
        .and_then(|v| v.as_u64())
        .map(|v| v as u32);
    to_value(crate::jobs::list_jobs(session_id.as_deref(), None, limit, offset).await)
}

pub(in crate::admin_dispatch) async fn stats() -> GrimoireResponse<JsonValue> {
    to_value(crate::jobs::get_queue_stats().await)
}
