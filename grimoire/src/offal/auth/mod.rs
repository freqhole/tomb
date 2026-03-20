//! auth domain handlers
//!
//! webauthn registration/authentication, user management, sessions

pub mod users;

use crate::api_registry::RouteInfo;
use crate::offal::caller::Caller;
use crate::response::GrimoireResponse;
use serde_json::Value as JsonValue;

/// collect all route metadata from auth domain
pub fn routes() -> Vec<RouteInfo> {
    users::ROUTES.to_vec()
}

/// dispatch auth domain routes
pub async fn dispatch(
    path: &str,
    caller: &Caller,
    body: &JsonValue,
) -> Option<GrimoireResponse<JsonValue>> {
    match path {
        // user management - canonical paths from routes.ts
        "/api/auth/whoami" => Some(users::me(caller, body.clone()).await),
        "/api/auth/logout" => Some(users::logout(caller, body.clone()).await),
        "/api/auth/api-key/regenerate" => Some(users::regenerate_api_key(caller, body.clone()).await),
        "/api/auth/api-key/status" => Some(users::api_key_status(caller, body.clone()).await),

        // admin user management (these aren't in routes.ts yet but keep for CLI)
        "/api/auth/users/list" => Some(users::list(caller, body.clone()).await),
        "/api/auth/users/create" => Some(users::create(caller, body.clone()).await),
        "/api/auth/users/update" => Some(users::update(caller, body.clone()).await),
        "/api/auth/users/delete" => Some(users::delete(caller, body.clone()).await),

        _ => None,
    }
}
