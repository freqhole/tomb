//! typed user admin command envelopes.
//!
//! response shapes:
//! - `users_list` -> `Vec<AdminUserSummary>`
//! - `users_get` -> `AdminUserSummary`
//! - `users_update_role` -> `EmptyResponse`
//! - `users_delete` -> `EmptyResponse`
//! - `users_hard_delete` -> `EmptyResponse`
//! - `users_generate_account_link` -> `AdminAccountLinkResponse`
//! - `users_add_peer_node` -> `AdminPeerNodeSummary`
//! - `users_remove_peer_node` -> `EmptyResponse`
//!
//! role fields are serialized as lowercase strings ("root" | "admin" |
//! "member" | "viewer") to match the existing `UserRole` serde output,
//! which is what every transport already emits and what charnel's
//! `UserInfo` consumes.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

use crate::users::{User, UserRole};

/// minimal user shape surfaced to admin clients.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminUserSummary {
    pub id: String,
    pub username: String,
    /// lowercase role: "root" | "admin" | "member" | "viewer"
    pub role: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub haruspex_user_id: Option<String>,
}

impl From<User> for AdminUserSummary {
    fn from(u: User) -> Self {
        Self {
            id: u.id,
            username: u.username,
            role: user_role_str(u.role).to_string(),
            created_at: u.created_at,
            updated_at: u.updated_at,
            deleted_at: u.deleted_at,
            haruspex_user_id: u.haruspex_user_id,
        }
    }
}

fn user_role_str(role: UserRole) -> &'static str {
    match role {
        UserRole::Root => "root",
        UserRole::Admin => "admin",
        UserRole::Member => "member",
        UserRole::Viewer => "viewer",
    }
}

/// request for `users_list`.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema)]
pub struct AdminUsersListRequest {
    pub include_deleted: Option<bool>,
    pub limit: Option<u32>,
    pub offset: Option<u32>,
    /// filter by exact username
    pub username: Option<String>,
    /// filter by role string ("root"|"admin"|"member"|"viewer")
    pub role: Option<String>,
}

/// request for `users_get`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminUsersGetRequest {
    pub user_id: String,
}

/// request for `users_update_role`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminUsersUpdateRoleRequest {
    pub user_id: String,
    /// new role ("admin"|"member"|"viewer" — "root" is rejected)
    pub role: String,
}

/// request for `users_delete`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminUsersDeleteRequest {
    pub user_id: String,
}

/// request for `users_hard_delete` (permanent "delete forever"; bypasses
/// soft-delete and removes the user_accountz row plus FK references).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminUsersHardDeleteRequest {
    pub user_id: String,
}

/// request for `users_restore` (clears `deleted_at` on a soft-deleted user
/// and cascade-restores any peer nodes that were soft-deleted at the same
/// timestamp).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminUsersRestoreRequest {
    pub user_id: String,
}

/// request for `users_generate_account_link`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminUsersGenerateAccountLinkRequest {
    pub user_id: String,
}

/// response for `users_generate_account_link`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminAccountLinkResponse {
    pub code: String,
}

/// request for `users_add_peer_node`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminUsersAddPeerNodeRequest {
    pub user_id: String,
    pub node_id: String,
    pub instance_name: Option<String>,
}

/// request for `users_remove_peer_node`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminUsersRemovePeerNodeRequest {
    pub user_id: String,
    pub node_id: String,
}
