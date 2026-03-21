//! unified API dispatch
//!
//! all transports (HTTP, Tauri, CLI, P2P) route through here.
//! dispatch owns authorization - transports handle authentication.

mod caller;
mod dispatch;

pub use caller::Caller;
pub use dispatch::dispatch;

// route handlers organized by domain
pub mod admin;
pub mod auth;
pub mod media_blobz;
pub mod music;
pub mod public; // unauthenticated routes (hello, knock)
pub mod upload;

use crate::api_registry::RouteInfo;
use crate::error::ErrorDetail;
use crate::response::GrimoireResponse;
use serde::de::DeserializeOwned;
use serde_json::Value as JsonValue;

/// parse JSON body into a typed request, returning bad_request error on failure
pub fn parse_body<T: DeserializeOwned>(body: JsonValue) -> Result<T, GrimoireResponse<JsonValue>> {
    serde_json::from_value(body).map_err(|e| {
        GrimoireResponse::failure(
            "bad request",
            vec![ErrorDetail::new(
                "bad_request",
                "bad request",
                &e.to_string(),
            )],
        )
    })
}

/// collect all route metadata from all domains
///
/// returns all routes registered in offal, for use by client-codegen
pub fn all_routes() -> Vec<RouteInfo> {
    let mut routes = Vec::new();
    routes.extend(admin::routes());
    routes.extend(auth::routes());
    routes.extend(media_blobz::routes());
    routes.extend(music::routes());
    routes.extend(public::routes());
    routes.extend(upload::routes());
    routes
}
