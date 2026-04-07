//! social state document types — profile, friends, groups, requests.
//!
//! reference: `client/skein/widgets/narthex/social/schema.ts`

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// privacy enums
// ---------------------------------------------------------------------------

/// who can see our profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProfileVisibility {
    Friends,
    Everyone,
    Nobody,
}

/// who can send us friend requests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FriendRequestsFrom {
    Everyone,
    Nobody,
}

/// status of a friend request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FriendRequestStatus {
    Pending,
    Accepted,
    AcceptedPendingAck,
    Rejected,
}

// ---------------------------------------------------------------------------
// friend types
// ---------------------------------------------------------------------------

/// a single node ID associated with a friend, with profile data.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendNodeId {
    pub node_id: String,
    #[serde(default)]
    pub added_at: String,
    #[serde(default)]
    pub last_seen_at: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub bio: String,
    #[serde(default)]
    pub avatar_data_url: String,
}

/// a friend entry — may have multiple node IDs (device-linked).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendEntry {
    /// UUID — canonical friend identity.
    pub id: String,
    /// user-set nickname (display priority).
    #[serde(default)]
    pub alias: String,
    /// best-effort: from most recently seen nodeId's profile.
    #[serde(default)]
    pub username: String,
    /// folder-style group name ("" = ungrouped).
    #[serde(default)]
    pub group: String,
    #[serde(default)]
    pub node_ids: Vec<FriendNodeId>,
    #[serde(default)]
    pub created_at: String,
}

/// a friend group for organizing friends.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FriendGroup {
    pub name: String,
    #[serde(default)]
    pub created_at: String,
}

/// an inbound friend request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingFriendRequest {
    pub from_node_id: String,
    #[serde(default)]
    pub from_username: String,
    #[serde(default)]
    pub received_at: String,
    #[serde(default = "default_pending")]
    pub status: FriendRequestStatus,
}

fn default_pending() -> FriendRequestStatus {
    FriendRequestStatus::Pending
}

/// an outbound friend request.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboundFriendRequest {
    pub to_node_id: String,
    #[serde(default)]
    pub to_username: String,
    #[serde(default)]
    pub sent_at: String,
    #[serde(default = "default_pending")]
    pub status: FriendRequestStatus,
}

// ---------------------------------------------------------------------------
// profile
// ---------------------------------------------------------------------------

/// local profile state.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileState {
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub bio: String,
    #[serde(default)]
    pub avatar_data_url: String,
    /// accent color for UI theming (default: 0x6366f1 — indigo).
    #[serde(default = "default_accent_color")]
    pub accent_color: u32,
    #[serde(default)]
    pub node_id: String,
}

fn default_accent_color() -> u32 {
    0x6366f1
}

// ---------------------------------------------------------------------------
// root social state
// ---------------------------------------------------------------------------

/// the root social automerge document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SocialState {
    /// local identity — username, bio, avatar, accent color, node ID.
    #[serde(default = "default_profile")]
    pub profile: ProfileState,
    /// peer directory.
    #[serde(default)]
    pub friends: Vec<FriendEntry>,
    /// friend groups.
    #[serde(default)]
    pub groups: Vec<FriendGroup>,
    /// inbound friend requests.
    #[serde(default)]
    pub pending_requests: Vec<PendingFriendRequest>,
    /// outbound friend requests.
    #[serde(default)]
    pub outbound_requests: Vec<OutboundFriendRequest>,
    /// who can see our profile.
    #[serde(default = "default_profile_visibility")]
    pub profile_visibility: ProfileVisibility,
    /// who can send us friend requests.
    #[serde(default = "default_friend_requests_from")]
    pub friend_requests_from: FriendRequestsFrom,
}

fn default_profile() -> ProfileState {
    ProfileState {
        username: String::new(),
        bio: String::new(),
        avatar_data_url: String::new(),
        accent_color: 0x6366f1,
        node_id: String::new(),
    }
}

fn default_profile_visibility() -> ProfileVisibility {
    ProfileVisibility::Friends
}

fn default_friend_requests_from() -> FriendRequestsFrom {
    FriendRequestsFrom::Everyone
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_social_state_round_trip() {
        let state = SocialState {
            profile: ProfileState {
                username: "alice".to_string(),
                bio: "hello".to_string(),
                avatar_data_url: String::new(),
                accent_color: 0x6366f1,
                node_id: "node-abc".to_string(),
            },
            friends: vec![FriendEntry {
                id: "friend-1".to_string(),
                alias: String::new(),
                username: "bob".to_string(),
                group: String::new(),
                node_ids: vec![FriendNodeId {
                    node_id: "node-bob".to_string(),
                    added_at: String::new(),
                    last_seen_at: String::new(),
                    username: "bob".to_string(),
                    bio: String::new(),
                    avatar_data_url: String::new(),
                }],
                created_at: "2025-01-01T00:00:00Z".to_string(),
            }],
            groups: vec![],
            pending_requests: vec![],
            outbound_requests: vec![],
            profile_visibility: ProfileVisibility::Friends,
            friend_requests_from: FriendRequestsFrom::Everyone,
        };

        let json = serde_json::to_string(&state).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // verify camelCase
        assert_eq!(parsed["profile"]["username"], "alice");
        assert_eq!(parsed["profile"]["accentColor"], 0x6366f1);
        assert_eq!(parsed["profile"]["nodeId"], "node-abc");
        assert_eq!(parsed["profile"]["avatarDataUrl"], "");
        assert_eq!(parsed["profileVisibility"], "friends");
        assert_eq!(parsed["friendRequestsFrom"], "everyone");
        assert_eq!(parsed["friends"][0]["nodeIds"][0]["nodeId"], "node-bob");
        assert_eq!(parsed["pendingRequests"].as_array().unwrap().len(), 0);
        assert_eq!(parsed["outboundRequests"].as_array().unwrap().len(), 0);

        // round-trip
        let deserialized: SocialState = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.profile.username, "alice");
        assert_eq!(deserialized.friends.len(), 1);
    }

    #[test]
    fn test_friend_request_status_serde() {
        let status = FriendRequestStatus::AcceptedPendingAck;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, "\"accepted-pending-ack\"");

        let parsed: FriendRequestStatus = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, FriendRequestStatus::AcceptedPendingAck);
    }

    /// test deserializing a social state as JS would produce it.
    #[test]
    fn test_deserialize_js_social_state() {
        let js_json = r#"{
            "profile": {
                "username": "bob",
                "bio": "",
                "avatarDataUrl": "",
                "accentColor": 6582001,
                "nodeId": "node-bob-123"
            },
            "friends": [],
            "groups": [],
            "pendingRequests": [
                {
                    "fromNodeId": "node-alice",
                    "fromUsername": "alice",
                    "receivedAt": "2025-06-01T12:00:00Z",
                    "status": "pending"
                }
            ],
            "outboundRequests": [],
            "profileVisibility": "friends",
            "friendRequestsFrom": "everyone"
        }"#;

        let state: SocialState = serde_json::from_str(js_json).unwrap();
        assert_eq!(state.profile.username, "bob");
        assert_eq!(state.profile.accent_color, 6582001);
        assert_eq!(state.pending_requests.len(), 1);
        assert_eq!(state.pending_requests[0].from_node_id, "node-alice");
        assert_eq!(
            state.pending_requests[0].status,
            FriendRequestStatus::Pending
        );
    }
}
