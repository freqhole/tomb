//! social data models
//!
//! types for the peer identity and social relationship system.
//! these map to the `peer_friendz`, `friend_requestz`, `friend_groupz` tables,
//! and the profile/alias columns on `user_accountz` and `user_peer_nodez`.

use serde::{Deserialize, Serialize};

/// peer friendship relationship between local user and a remote user
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerFriend {
    pub id: String,
    /// the local user who owns this friendship
    pub user_id: String,
    /// the remote user (the friend) — references user_accountz
    pub friend_user_id: String,
    /// folder-style group name ("" = ungrouped)
    pub group_name: String,
    pub created_at: i64,
}

/// denormalized friend for UI display — relationship + user identity + per-node profiles
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerFriendDetail {
    /// peer_friendz.id
    pub id: String,
    /// folder-style group name
    pub group_name: String,
    pub created_at: i64,
    // identity level (from user_accountz)
    /// the friend's user_accountz.id
    pub friend_user_id: String,
    /// system username (char-restricted)
    pub username: String,
    /// local admin's free-form label for this person
    pub alias: String,
    /// identity-level bio
    pub bio: String,
    /// identity-level avatar (URL or data URL)
    pub avatar_url: String,
    /// identity-level accent color
    pub accent_color: i64,
    /// all iroh nodes belonging to this friend
    pub node_ids: Vec<PeerNodeProfile>,
}

/// per-node profile data from user_peer_nodez
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerNodeProfile {
    pub node_id: String,
    /// self-reported name from this specific node
    pub display_name: String,
    pub bio: String,
    pub avatar_url: String,
    pub accent_color: i64,
    pub instance_name: Option<String>,
    pub last_seen_at: Option<i64>,
    pub created_at: i64,
}

/// friend request with denormalized remote user info
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendRequest {
    pub id: String,
    /// always the local user
    pub user_id: String,
    /// the other party (resolved to a user_accountz entry)
    pub remote_user_id: String,
    /// "inbound" or "outbound"
    pub direction: String,
    /// "pending", "accepted", "accepted-pending-ack", or "rejected"
    pub status: String,
    pub created_at: i64,
    pub updated_at: i64,
    // denormalized from user_accountz / user_peer_nodez
    /// the remote party's system username
    pub remote_username: String,
    /// the remote party's alias
    pub remote_alias: String,
    /// primary node_id (most recently seen)
    pub remote_node_id: Option<String>,
    /// display_name from that node's self-reported profile
    pub remote_display_name: Option<String>,
}

/// friend group for organizing friends
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FriendGroup {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub color: i64,
}

/// request to update a user's identity-level profile (on user_accountz)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateProfileRequest {
    pub username: Option<String>,
    pub alias: Option<String>,
    pub bio: Option<String>,
    pub avatar_url: Option<String>,
    pub accent_color: Option<i64>,
}

/// request to update a specific node's self-reported profile (on user_peer_nodez)
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct UpdateNodeProfileRequest {
    pub display_name: Option<String>,
    pub bio: Option<String>,
    pub avatar_url: Option<String>,
    pub accent_color: Option<i64>,
}

/// social privacy/preference settings (stored in user_accountz.metadata JSON)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialSettings {
    /// "friends", "everyone", or "nobody"
    #[serde(default = "default_profile_visibility")]
    pub profile_visibility: String,
    /// "everyone" or "nobody"
    #[serde(default = "default_friend_requests_from")]
    pub friend_requests_from: String,
}

fn default_profile_visibility() -> String {
    "friends".to_string()
}

fn default_friend_requests_from() -> String {
    "everyone".to_string()
}

impl Default for SocialSettings {
    fn default() -> Self {
        Self {
            profile_visibility: default_profile_visibility(),
            friend_requests_from: default_friend_requests_from(),
        }
    }
}

/// user profile (identity-level fields from user_accountz)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UserProfile {
    pub user_id: String,
    pub username: String,
    pub alias: String,
    pub bio: String,
    pub avatar_url: String,
    pub accent_color: i64,
    /// the local iroh node_id (populated at runtime, not from DB)
    pub node_id: String,
}

/// full social state snapshot — used for initializing the UI
/// matches the SocialState typescript type
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SocialSnapshot {
    pub profile: UserProfile,
    pub friends: Vec<PeerFriendDetail>,
    pub groups: Vec<FriendGroup>,
    /// inbound requests with status "pending"
    pub pending_requests: Vec<FriendRequest>,
    /// all outbound requests
    pub outbound_requests: Vec<FriendRequest>,
    pub settings: SocialSettings,
}
