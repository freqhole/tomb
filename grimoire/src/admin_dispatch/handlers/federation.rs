//! federation inspection handlers (status, identity).
//!
//! today this is just `status` — federation setup / sync / logout
//! are bootstrap operations the cli runs once and aren't useful in
//! the admin palette. status is a read-only snapshot of "is this
//! node federated, with what identity, against what haruspex
//! account" — handy from any admin shell.

use crate::response::GrimoireResponse;
use serde_json::{json, Value as JsonValue};

/// snapshot of federation setup + identity. async because
/// `get_setup_status_verified()` round-trips to haruspex to
/// validate credentials when present.
pub(in crate::admin_dispatch) async fn status() -> GrimoireResponse<JsonValue> {
    let setup = crate::federation::get_setup_status_verified().await;
    let identity = crate::federation::get_identity_info();
    let payload = json!({
        "federation_enabled": setup.federation_enabled,
        "credentials_exist": setup.credentials_exist,
        "credentials_path": setup.credentials_path.display().to_string(),
        "email": setup.email,
        "haruspex_user_id": setup.haruspex_user_id,
        "created_at": setup.created_at,
        "last_refreshed_at": setup.last_refreshed_at,
        "verified": setup.verified,
        "verification_error": setup.verification_error,
        "identity_exists": identity.keypair_exists,
        "identity_path": identity.keypair_path.display().to_string(),
        "node_id": identity.node_id,
    });
    GrimoireResponse::success("ok", payload)
}
