//! admin domain handlers
//!
//! knock management for federation/discovery

pub mod knocks;

use crate::api_registry::{Method, RouteInfo};
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
    _method: Option<Method>,
) -> Option<GrimoireResponse<JsonValue>> {
    match path {
        // admin knock management
        "/api/admin/knocks" => Some(knocks::list(caller, body.clone()).await),
        "/api/admin/knocks/all" => Some(knocks::list_all(caller, body.clone()).await),
        "/api/admin/knocks/get" => Some(knocks::get(caller, body.clone()).await),
        "/api/admin/knocks/accept" => Some(knocks::accept(caller, body.clone()).await),
        "/api/admin/knocks/reject" => Some(knocks::reject(caller, body.clone()).await),
        "/api/admin/knocks/delete" => Some(knocks::delete(caller, body.clone()).await),

        _ => None,
    }
}
