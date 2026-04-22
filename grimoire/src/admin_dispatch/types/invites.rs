//! typed invite admin command envelopes.
//!
//! response shapes:
//! - `invites_list` -> `Vec<AdminInviteInfo>`
//! - `invites_generate` -> `AdminInvitesGenerateResponse`
//! - `invites_revoke` -> `EmptyResponse`
//! - `invites_revoke_all` -> `AdminInvitesRevokeAllResponse`
//! - `invites_update_role` -> `EmptyResponse`

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// invite code summary tailored for the admin UI.
///
/// matches the ad-hoc JSON shape previously emitted inline by the
/// `invites_list` handler (see `admin_dispatch::mod.rs::invites_list`).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminInviteInfo {
    pub code: String,
    /// "invite" | "account-link"
    pub code_type: String,
    /// role string ("admin"|"member"|"viewer")
    pub grants_role: String,
    pub created_at: i64,
    pub expires_at: Option<i64>,
    pub used_at: Option<i64>,
    pub used_by: Option<String>,
    pub used_by_username: Option<String>,
    pub link_for_user_id: Option<String>,
    pub link_for_username: Option<String>,
    pub is_active: bool,
}

/// request for `invites_list`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema)]
pub struct AdminInvitesListRequest {
    pub active_only: Option<bool>,
}

/// request for `invites_generate`.
///
/// `count` and `word_count` control code generation; `role` / `expires_hours`
/// populate the underlying `CreateInviteCodeRequest`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminInvitesGenerateRequest {
    pub count: Option<u32>,
    pub word_count: Option<u32>,
    /// "admin" | "member" | "viewer" (root is rejected)
    pub role: Option<String>,
    pub expires_hours: Option<u32>,
}

/// single generated invite returned from `invites_generate`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminGeneratedInvite {
    pub code: String,
    pub grants_role: String,
    pub expires_at: Option<i64>,
}

/// response for `invites_generate`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminInvitesGenerateResponse {
    pub codes: Vec<AdminGeneratedInvite>,
}

/// request for `invites_revoke`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminInvitesRevokeRequest {
    pub code: String,
}

/// response for `invites_revoke_all`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminInvitesRevokeAllResponse {
    pub revoked: u64,
}

/// request for `invites_update_role`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminInvitesUpdateRoleRequest {
    pub code: String,
    /// new role ("admin"|"member"|"viewer")
    pub role: String,
}
