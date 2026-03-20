//! admin domain handlers
//!
//! knock management for federation/discovery

pub mod knocks;

use crate::api_registry::RouteInfo;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

/// collect all route metadata from admin domain
pub fn routes() -> Vec<RouteInfo> {
    knocks::ROUTES.to_vec()
}

/// dispatch admin domain routes
pub async fn dispatch(
    path: &str,
    caller: &Caller,
    body: &JsonValue,
) -> Option<GrimoireResponse<JsonValue>> {
    match path {
        // admin knock management - canonical paths
        "/api/admin/knocks" => Some(knocks::list(caller, body.clone()).await),
        "/api/admin/knocks/all" => Some(knocks::list_all(caller, body.clone()).await),

        _ => dispatch_path_params(path, caller, body).await,
    }
}

/// dispatch path-param routes for admin domain
/// handles: /api/admin/knocks/{id}, /api/admin/knocks/{id}/accept, /api/admin/knocks/{id}/reject
pub async fn dispatch_path_params(
    path: &str,
    caller: &Caller,
    body: &JsonValue,
) -> Option<GrimoireResponse<JsonValue>> {
    // /api/admin/knocks/{id}/accept
    if let Some(id) = path.strip_prefix("/api/admin/knocks/").and_then(|s| s.strip_suffix("/accept")) {
        if !id.contains('/') {
            return Some(knocks::accept_by_id(caller, id, body.clone()).await);
        }
    }

    // /api/admin/knocks/{id}/reject
    if let Some(id) = path.strip_prefix("/api/admin/knocks/").and_then(|s| s.strip_suffix("/reject")) {
        if !id.contains('/') {
            return Some(knocks::reject_by_id(caller, id).await);
        }
    }

    // /api/admin/knocks/{id} - get or delete based on method
    // note: IPC doesn't currently support DELETE method distinction,
    // so we use body { "delete": true } or separate endpoint
    if let Some(id) = path.strip_prefix("/api/admin/knocks/") {
        if !id.contains('/') && id != "all" {
            // check if this is a delete request
            if body.get("_delete").and_then(|v| v.as_bool()).unwrap_or(false) {
                return Some(knocks::delete_by_id(caller, id).await);
            }
            return Some(knocks::get_by_id(caller, id).await);
        }
    }

    None
}
