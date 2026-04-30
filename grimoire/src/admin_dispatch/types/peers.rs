//! typed peer admin command envelopes.
//!
//! response shapes:
//! - `peers_list_all` -> `Vec<AdminPeerSummary>`
//! - `peers_list_for_user` -> `Vec<AdminPeerNodeSummary>`
//! - `peers_remove` -> `EmptyResponse`
//! - `peers_restore` -> `EmptyResponse`
//! - `peers_allow` -> `AdminPeersAllowResponse`

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

use crate::users::{PeerNodeWithUser, UserPeerNode};

/// peer node joined with its user record (response for `peers_list_all`).
///
/// matches the existing `PeerNodeWithUser` wire shape without requiring
/// `ZodSchema` on the domain type.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminPeerSummary {
    pub user_id: String,
    pub node_id: String,
    pub instance_name: Option<String>,
    pub created_at: i64,
    pub last_seen_at: Option<i64>,
    pub username: String,
    /// lowercase role string ("root"|"admin"|"member"|"viewer")
    pub role: String,
    /// soft-delete timestamp on the peer row itself.
    pub deleted_at: Option<i64>,
    /// soft-delete timestamp on the joined user row.
    pub user_deleted_at: Option<i64>,
}

impl From<PeerNodeWithUser> for AdminPeerSummary {
    fn from(p: PeerNodeWithUser) -> Self {
        Self {
            user_id: p.user_id,
            node_id: p.node_id,
            instance_name: p.instance_name,
            created_at: p.created_at,
            last_seen_at: p.last_seen_at,
            username: p.username,
            role: p.role,
            deleted_at: p.deleted_at,
            user_deleted_at: p.user_deleted_at,
        }
    }
}

/// per-user peer node listing (response for `peers_list_for_user`).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminPeerNodeSummary {
    pub user_id: String,
    pub node_id: String,
    pub instance_name: Option<String>,
    pub created_at: i64,
    pub last_seen_at: Option<i64>,
    pub deleted_at: Option<i64>,
}

impl From<UserPeerNode> for AdminPeerNodeSummary {
    fn from(p: UserPeerNode) -> Self {
        Self {
            user_id: p.user_id,
            node_id: p.node_id,
            instance_name: p.instance_name,
            created_at: p.created_at,
            last_seen_at: p.last_seen_at,
            deleted_at: p.deleted_at,
        }
    }
}

/// request for `peers_list_all`. when `include_deleted` is true,
/// soft-deleted peers and peers under soft-deleted users are returned.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ZodSchema)]
pub struct AdminPeersListAllRequest {
    pub include_deleted: Option<bool>,
}

/// request for `peers_list_for_user`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminPeersListForUserRequest {
    pub user_id: String,
    pub include_deleted: Option<bool>,
}

/// request for `peers_remove` (soft-delete).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminPeersRemoveRequest {
    pub user_id: String,
    pub node_id: String,
}

/// request for `peers_restore` (clear `deleted_at` on a peer node).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminPeersRestoreRequest {
    pub user_id: String,
    pub node_id: String,
}

/// request for `peers_allow`.
///
/// if `user_id` is set, links to that existing user; otherwise the
/// handler falls back to `username` (and creates the user if absent).
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminPeersAllowRequest {
    pub node_id: String,
    pub user_id: Option<String>,
    pub username: Option<String>,
    /// "admin"|"member"|"viewer" (defaults to viewer when absent)
    pub role: Option<String>,
}

/// response for `peers_allow`.
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AdminPeersAllowResponse {
    pub user_id: String,
    pub username: String,
    pub node_id: String,
    pub created_user: bool,
}
