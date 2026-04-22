//! typed knock admin command envelopes.
//!
//! response shapes:
//! - `knocks_list` / `knocks_list_all` -> `Vec<KnockRequest>`
//! - `knocks_accept` / `knocks_reject` -> `KnockRequest`
//! - `knocks_delete` -> `EmptyResponse`
//! - `knocks_reject_all` -> `KnocksRejectAllResponse`

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// request for `knocks_accept`.
///
/// `knock_id` matches the legacy charnel wire format (do not rename
/// without updating every caller in `client/charnel`).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct KnocksAcceptRequest {
    pub knock_id: String,
    /// role to assign: "viewer", "member", or "admin"
    pub role: String,
    /// optional username override (defaults to knock's username)
    pub username: Option<String>,
    /// optional existing user_id to link instead of creating a new user
    pub user_id: Option<String>,
}

/// request for `knocks_reject`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct KnocksRejectRequest {
    pub knock_id: String,
}

/// request for `knocks_delete`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct KnocksDeleteRequest {
    pub knock_id: String,
}

/// response for `knocks_reject_all`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct KnocksRejectAllResponse {
    pub rejected: u32,
}
