//! friendz protocol message types — `freqhole-friendz/1`
//!
//! all 15 message types that comprise the friendz P2P protocol.
//! these match the existing JS wire format exactly: the `type` discriminant
//! uses kebab-case, and all field names use camelCase.
//!
//! reference: `client/skein/src/p2p/friends-protocol.ts`

use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// shared enums
// ---------------------------------------------------------------------------

/// canvas collaborator role.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CanvasRole {
    Editor,
    Viewer,
}

/// ACL role including the "removed" state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AclRole {
    Editor,
    Viewer,
    Removed,
}

// ---------------------------------------------------------------------------
// sub-types used within messages
// ---------------------------------------------------------------------------

/// lightweight activity summary for a shared canvas, piggybacked on heartbeat.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasActivityEntry {
    pub canvas_doc_id: String,
    pub last_modified_at: String,
    pub widget_count: u32,
}

/// a canvas update entry in a gossip digest.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GossipDigestCanvasUpdate {
    pub canvas_doc_id: String,
    pub last_modified_at: String,
    pub last_modified_by: String,
}

/// a pending invite entry in a gossip digest.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GossipDigestPendingInvite {
    pub canvas_doc_id: String,
    pub canvas_title: String,
    pub canvas_description: String,
    pub canvas_color: u32,
    pub canvas_preview_url: String,
    pub invited_by: String,
    pub invited_by_username: String,
    pub role: CanvasRole,
    pub invited_at: String,
}

// ---------------------------------------------------------------------------
// the 15 friendz message types
// ---------------------------------------------------------------------------

/// union of all friendz protocol messages.
///
/// serialized with `{"type": "kebab-case-tag", ...fields}` to match the
/// JS wire format. the `type` discriminant uses kebab-case; field names
/// use camelCase via per-variant serde attributes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum FriendzMessage {
    /// request the peer's profile.
    ProfileRequest,

    /// response with profile data.
    ProfileResponse {
        username: String,
        bio: String,
        #[serde(rename = "avatarDataUrl")]
        avatar_data_url: String,
    },

    /// send a friend request to a peer.
    FriendRequest {
        #[serde(rename = "fromNodeId")]
        from_node_id: String,
        #[serde(rename = "fromUsername")]
        from_username: String,
    },

    /// accept an incoming friend request.
    FriendAccept {
        #[serde(rename = "fromNodeId")]
        from_node_id: String,
        #[serde(rename = "fromUsername")]
        from_username: String,
    },

    /// acknowledge a friend-accept (two-phase handshake).
    FriendAcceptAck {
        #[serde(rename = "fromNodeId")]
        from_node_id: String,
    },

    /// reject an incoming friend request.
    FriendReject {
        #[serde(rename = "fromNodeId")]
        from_node_id: String,
    },

    /// periodic presence ping.
    Heartbeat {
        #[serde(rename = "nodeId")]
        node_id: String,
        username: String,
        #[serde(rename = "canvasActivity")]
        #[serde(skip_serializing_if = "Option::is_none")]
        canvas_activity: Option<Vec<CanvasActivityEntry>>,
    },

    /// send a canvas invite (or relay via gossip).
    CanvasInvite {
        #[serde(rename = "inviteId")]
        invite_id: String,
        #[serde(rename = "canvasDocId")]
        canvas_doc_id: String,
        #[serde(rename = "canvasTitle")]
        canvas_title: String,
        #[serde(rename = "canvasDescription")]
        #[serde(skip_serializing_if = "Option::is_none")]
        canvas_description: Option<String>,
        #[serde(rename = "canvasColor")]
        #[serde(skip_serializing_if = "Option::is_none")]
        canvas_color: Option<u32>,
        #[serde(rename = "canvasPreviewUrl")]
        #[serde(skip_serializing_if = "Option::is_none")]
        canvas_preview_url: Option<String>,
        #[serde(rename = "originNodeId")]
        origin_node_id: String,
        #[serde(rename = "originUsername")]
        origin_username: String,
        role: CanvasRole,
        targets: Vec<String>,
        acked: Vec<String>,
    },

    /// acknowledge receipt of a canvas invite.
    CanvasInviteAck {
        #[serde(rename = "inviteId")]
        invite_id: String,
        #[serde(rename = "canvasDocId")]
        canvas_doc_id: String,
        #[serde(rename = "ackerNodeId")]
        acker_node_id: String,
    },

    /// accept a canvas invite.
    CanvasInviteAccept {
        #[serde(rename = "inviteId")]
        invite_id: String,
        #[serde(rename = "canvasDocId")]
        canvas_doc_id: String,
        #[serde(rename = "accepterNodeId")]
        accepter_node_id: String,
    },

    /// decline a canvas invite.
    CanvasInviteDecline {
        #[serde(rename = "inviteId")]
        invite_id: String,
        #[serde(rename = "canvasDocId")]
        canvas_doc_id: String,
        #[serde(rename = "declinerNodeId")]
        decliner_node_id: String,
    },

    /// notify a peer that their ACL role changed.
    AclChange {
        #[serde(rename = "canvasDocId")]
        canvas_doc_id: String,
        #[serde(rename = "canvasTitle")]
        canvas_title: String,
        #[serde(rename = "targetNodeId")]
        target_node_id: String,
        #[serde(rename = "newRole")]
        new_role: AclRole,
        #[serde(rename = "changedBy")]
        changed_by: String,
        #[serde(rename = "changedByUsername")]
        changed_by_username: String,
    },

    /// notify a peer that a shared canvas was modified.
    CanvasUpdate {
        #[serde(rename = "canvasDocId")]
        canvas_doc_id: String,
        #[serde(rename = "lastModifiedAt")]
        last_modified_at: String,
        #[serde(rename = "widgetCount")]
        widget_count: u32,
        #[serde(rename = "modifiedByNodeId")]
        modified_by_node_id: String,
        #[serde(rename = "modifiedByUsername")]
        modified_by_username: String,
    },

    /// sent when a peer is about to go offline.
    OfflineAnnouncement {
        #[serde(rename = "nodeId")]
        node_id: String,
    },

    /// gossip digest sent when a peer comes online.
    GossipDigest {
        #[serde(rename = "canvasUpdates")]
        canvas_updates: Vec<GossipDigestCanvasUpdate>,
        #[serde(rename = "pendingInvites")]
        pending_invites: Vec<GossipDigestPendingInvite>,
        /// sender's canvas doc IDs — lets the receiver compare and discover
        /// canvases they should be on but aren't tracking yet.
        #[serde(rename = "sharedCanvasIds")]
        #[serde(default)]
        #[serde(skip_serializing_if = "Vec::is_empty")]
        shared_canvas_ids: Vec<String>,
    },

    /// batch blob availability query — "i need these blobs, which do you have?"
    ///
    /// sent by the hub to peers when it has missing blobs without snatchedBy info.
    /// the receiver checks locally and responds with BlobOffer.
    BlobSeek {
        /// blake3 hashes of blobs the sender needs.
        needed: Vec<String>,
    },

    /// batch blob availability response — "i have these blobs."
    ///
    /// sent in response to a BlobSeek. contains the subset of requested hashes
    /// that the responder has locally.
    BlobOffer {
        /// blake3 hashes (from the original BlobSeek.needed) that the sender has.
        available: Vec<String>,
    },
}

// ---------------------------------------------------------------------------
// timing constants (matching JS)
// ---------------------------------------------------------------------------

/// how often to send heartbeat pings to friends (ms).
pub const HEARTBEAT_INTERVAL_MS: u64 = 30_000;

/// time after last heartbeat before marking a friend offline (ms).
pub const HEARTBEAT_TIMEOUT_MS: u64 = 90_000;

/// interval for probing offline friends to see if they came back (ms).
pub const DISCOVERY_SWEEP_MS: u64 = 300_000;

// ---------------------------------------------------------------------------
// ALPN identifier
// ---------------------------------------------------------------------------

/// the ALPN protocol identifier for the friendz protocol.
pub const FRIENDZ_ALPN: &[u8] = b"freqhole-friendz/1";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_heartbeat_round_trip() {
        let msg = FriendzMessage::Heartbeat {
            node_id: "abc123".to_string(),
            username: "alice".to_string(),
            canvas_activity: Some(vec![CanvasActivityEntry {
                canvas_doc_id: "doc-1".to_string(),
                last_modified_at: "2025-01-01T00:00:00Z".to_string(),
                widget_count: 5,
            }]),
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // verify discriminant is kebab-case
        assert_eq!(parsed["type"], "heartbeat");
        // verify fields are camelCase
        assert_eq!(parsed["nodeId"], "abc123");
        assert_eq!(parsed["username"], "alice");
        assert!(parsed["canvasActivity"].is_array());
        assert_eq!(parsed["canvasActivity"][0]["canvasDocId"], "doc-1");
        assert_eq!(
            parsed["canvasActivity"][0]["lastModifiedAt"],
            "2025-01-01T00:00:00Z"
        );
        assert_eq!(parsed["canvasActivity"][0]["widgetCount"], 5);

        // round-trip
        let deserialized: FriendzMessage = serde_json::from_str(&json).unwrap();
        match deserialized {
            FriendzMessage::Heartbeat {
                node_id,
                username,
                canvas_activity,
            } => {
                assert_eq!(node_id, "abc123");
                assert_eq!(username, "alice");
                assert_eq!(canvas_activity.unwrap().len(), 1);
            }
            _ => panic!("expected Heartbeat"),
        }
    }

    #[test]
    fn test_heartbeat_without_activity() {
        let msg = FriendzMessage::Heartbeat {
            node_id: "abc123".to_string(),
            username: "alice".to_string(),
            canvas_activity: None,
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();

        // canvasActivity should be absent (skip_serializing_if)
        assert!(parsed.get("canvasActivity").is_none());
    }

    #[test]
    fn test_profile_request_round_trip() {
        let msg = FriendzMessage::ProfileRequest;
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "profile-request");
        // should only have the type field
        assert_eq!(parsed.as_object().unwrap().len(), 1);

        let deserialized: FriendzMessage = serde_json::from_str(&json).unwrap();
        assert!(matches!(deserialized, FriendzMessage::ProfileRequest));
    }

    #[test]
    fn test_profile_response_round_trip() {
        let msg = FriendzMessage::ProfileResponse {
            username: "alice".to_string(),
            bio: "hello world".to_string(),
            avatar_data_url: "data:image/png;base64,abc".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "profile-response");
        assert_eq!(parsed["username"], "alice");
        assert_eq!(parsed["bio"], "hello world");
        assert_eq!(parsed["avatarDataUrl"], "data:image/png;base64,abc");
    }

    #[test]
    fn test_friend_request_round_trip() {
        let msg = FriendzMessage::FriendRequest {
            from_node_id: "node-abc".to_string(),
            from_username: "alice".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "friend-request");
        assert_eq!(parsed["fromNodeId"], "node-abc");
        assert_eq!(parsed["fromUsername"], "alice");
    }

    #[test]
    fn test_friend_accept_round_trip() {
        let msg = FriendzMessage::FriendAccept {
            from_node_id: "node-abc".to_string(),
            from_username: "alice".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "friend-accept");
        assert_eq!(parsed["fromNodeId"], "node-abc");
    }

    #[test]
    fn test_friend_accept_ack_round_trip() {
        let msg = FriendzMessage::FriendAcceptAck {
            from_node_id: "node-abc".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "friend-accept-ack");
        assert_eq!(parsed["fromNodeId"], "node-abc");
    }

    #[test]
    fn test_friend_reject_round_trip() {
        let msg = FriendzMessage::FriendReject {
            from_node_id: "node-abc".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "friend-reject");
        assert_eq!(parsed["fromNodeId"], "node-abc");
    }

    #[test]
    fn test_canvas_invite_round_trip() {
        let msg = FriendzMessage::CanvasInvite {
            invite_id: "inv-1".to_string(),
            canvas_doc_id: "doc-1".to_string(),
            canvas_title: "my canvas".to_string(),
            canvas_description: Some("a cool canvas".to_string()),
            canvas_color: Some(0xff0000),
            canvas_preview_url: None,
            origin_node_id: "node-abc".to_string(),
            origin_username: "alice".to_string(),
            role: CanvasRole::Editor,
            targets: vec!["node-def".to_string()],
            acked: vec![],
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "canvas-invite");
        assert_eq!(parsed["inviteId"], "inv-1");
        assert_eq!(parsed["canvasDocId"], "doc-1");
        assert_eq!(parsed["canvasTitle"], "my canvas");
        assert_eq!(parsed["canvasDescription"], "a cool canvas");
        assert_eq!(parsed["canvasColor"], 0xff0000);
        assert!(parsed.get("canvasPreviewUrl").is_none());
        assert_eq!(parsed["originNodeId"], "node-abc");
        assert_eq!(parsed["role"], "editor");
        assert_eq!(parsed["targets"][0], "node-def");

        // round-trip
        let deserialized: FriendzMessage = serde_json::from_str(&json).unwrap();
        match deserialized {
            FriendzMessage::CanvasInvite { role, .. } => {
                assert_eq!(role, CanvasRole::Editor);
            }
            _ => panic!("expected CanvasInvite"),
        }
    }

    #[test]
    fn test_canvas_invite_ack_round_trip() {
        let msg = FriendzMessage::CanvasInviteAck {
            invite_id: "inv-1".to_string(),
            canvas_doc_id: "doc-1".to_string(),
            acker_node_id: "node-abc".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "canvas-invite-ack");
        assert_eq!(parsed["inviteId"], "inv-1");
        assert_eq!(parsed["ackerNodeId"], "node-abc");
    }

    #[test]
    fn test_canvas_invite_accept_round_trip() {
        let msg = FriendzMessage::CanvasInviteAccept {
            invite_id: "inv-1".to_string(),
            canvas_doc_id: "doc-1".to_string(),
            accepter_node_id: "node-abc".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "canvas-invite-accept");
        assert_eq!(parsed["accepterNodeId"], "node-abc");
    }

    #[test]
    fn test_canvas_invite_decline_round_trip() {
        let msg = FriendzMessage::CanvasInviteDecline {
            invite_id: "inv-1".to_string(),
            canvas_doc_id: "doc-1".to_string(),
            decliner_node_id: "node-abc".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "canvas-invite-decline");
        assert_eq!(parsed["declinerNodeId"], "node-abc");
    }

    #[test]
    fn test_acl_change_round_trip() {
        let msg = FriendzMessage::AclChange {
            canvas_doc_id: "doc-1".to_string(),
            canvas_title: "my canvas".to_string(),
            target_node_id: "node-def".to_string(),
            new_role: AclRole::Removed,
            changed_by: "node-abc".to_string(),
            changed_by_username: "alice".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "acl-change");
        assert_eq!(parsed["newRole"], "removed");
        assert_eq!(parsed["changedByUsername"], "alice");
    }

    #[test]
    fn test_canvas_update_round_trip() {
        let msg = FriendzMessage::CanvasUpdate {
            canvas_doc_id: "doc-1".to_string(),
            last_modified_at: "2025-01-01T00:00:00Z".to_string(),
            widget_count: 10,
            modified_by_node_id: "node-abc".to_string(),
            modified_by_username: "alice".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "canvas-update");
        assert_eq!(parsed["canvasDocId"], "doc-1");
        assert_eq!(parsed["widgetCount"], 10);
        assert_eq!(parsed["modifiedByNodeId"], "node-abc");
    }

    #[test]
    fn test_offline_announcement_round_trip() {
        let msg = FriendzMessage::OfflineAnnouncement {
            node_id: "node-abc".to_string(),
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "offline-announcement");
        assert_eq!(parsed["nodeId"], "node-abc");
    }

    #[test]
    fn test_gossip_digest_round_trip() {
        let msg = FriendzMessage::GossipDigest {
            canvas_updates: vec![GossipDigestCanvasUpdate {
                canvas_doc_id: "doc-1".to_string(),
                last_modified_at: "2025-01-01T00:00:00Z".to_string(),
                last_modified_by: "node-abc".to_string(),
            }],
            pending_invites: vec![GossipDigestPendingInvite {
                canvas_doc_id: "doc-2".to_string(),
                canvas_title: "shared canvas".to_string(),
                canvas_description: "a cool canvas".to_string(),
                canvas_color: 0x6366f1,
                canvas_preview_url: "".to_string(),
                invited_by: "node-abc".to_string(),
                invited_by_username: "alice".to_string(),
                role: CanvasRole::Editor,
                invited_at: "2025-01-01T00:00:00Z".to_string(),
            }],
            shared_canvas_ids: vec![],
        };

        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "gossip-digest");
        assert_eq!(parsed["canvasUpdates"][0]["canvasDocId"], "doc-1");
        assert_eq!(parsed["canvasUpdates"][0]["lastModifiedBy"], "node-abc");
        assert_eq!(parsed["pendingInvites"][0]["canvasTitle"], "shared canvas");
        assert_eq!(parsed["pendingInvites"][0]["canvasColor"], 0x6366f1);
        assert_eq!(parsed["pendingInvites"][0]["invitedByUsername"], "alice");
        assert_eq!(parsed["pendingInvites"][0]["role"], "editor");
    }

    /// test deserializing a JSON string that looks like what JS would produce.
    /// this validates wire compatibility with the existing JS implementation.
    #[test]
    fn test_deserialize_js_wire_format() {
        // simulate a heartbeat message as JS would produce it
        let js_json = r#"{"type":"heartbeat","nodeId":"abc123def456","username":"bob","canvasActivity":[{"canvasDocId":"doc-xyz","lastModifiedAt":"2025-06-01T12:00:00Z","widgetCount":3}]}"#;

        let msg: FriendzMessage = serde_json::from_str(js_json).unwrap();
        match msg {
            FriendzMessage::Heartbeat {
                node_id,
                username,
                canvas_activity,
            } => {
                assert_eq!(node_id, "abc123def456");
                assert_eq!(username, "bob");
                let activity = canvas_activity.unwrap();
                assert_eq!(activity.len(), 1);
                assert_eq!(activity[0].canvas_doc_id, "doc-xyz");
                assert_eq!(activity[0].widget_count, 3);
            }
            _ => panic!("expected Heartbeat"),
        }

        // simulate a canvas-invite from JS
        let js_json = r#"{"type":"canvas-invite","inviteId":"inv-abc","canvasDocId":"doc-123","canvasTitle":"collab canvas","originNodeId":"node-alice","originUsername":"alice","role":"viewer","targets":["node-bob","node-carol"],"acked":["node-bob"]}"#;

        let msg: FriendzMessage = serde_json::from_str(js_json).unwrap();
        match msg {
            FriendzMessage::CanvasInvite {
                role,
                targets,
                acked,
                ..
            } => {
                assert_eq!(role, CanvasRole::Viewer);
                assert_eq!(targets.len(), 2);
                assert_eq!(acked.len(), 1);
            }
            _ => panic!("expected CanvasInvite"),
        }

        // simulate an offline-announcement from JS
        let js_json = r#"{"type":"offline-announcement","nodeId":"node-charlie"}"#;
        let msg: FriendzMessage = serde_json::from_str(js_json).unwrap();
        assert!(matches!(msg, FriendzMessage::OfflineAnnouncement { .. }));

        // simulate a gossip-digest from JS
        let js_json = r#"{"type":"gossip-digest","canvasUpdates":[{"canvasDocId":"doc-1","lastModifiedAt":"2025-01-01T00:00:00Z","lastModifiedBy":"node-a"}],"pendingInvites":[]}"#;
        let msg: FriendzMessage = serde_json::from_str(js_json).unwrap();
        match msg {
            FriendzMessage::GossipDigest {
                canvas_updates,
                pending_invites,
                shared_canvas_ids,
            } => {
                assert_eq!(canvas_updates.len(), 1);
                assert!(pending_invites.is_empty());
                assert!(shared_canvas_ids.is_empty());
            }
            _ => panic!("expected GossipDigest"),
        }
    }

    #[test]
    fn test_blob_seek_round_trip() {
        let msg = FriendzMessage::BlobSeek {
            needed: vec![
                "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262".to_string(),
                "deadbeef00000000000000000000000000000000000000000000000000000000".to_string(),
            ],
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"blob-seek\""));
        assert!(json.contains("\"needed\""));
        let back: FriendzMessage = serde_json::from_str(&json).unwrap();
        match back {
            FriendzMessage::BlobSeek { needed } => {
                assert_eq!(needed.len(), 2);
                assert!(needed[0].starts_with("af1349b9"));
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn test_blob_offer_round_trip() {
        let msg = FriendzMessage::BlobOffer {
            available: vec![
                "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262".to_string(),
            ],
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"type\":\"blob-offer\""));
        assert!(json.contains("\"available\""));
        let back: FriendzMessage = serde_json::from_str(&json).unwrap();
        match back {
            FriendzMessage::BlobOffer { available } => {
                assert_eq!(available.len(), 1);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn test_gossip_digest_with_shared_canvas_ids() {
        let msg = FriendzMessage::GossipDigest {
            canvas_updates: vec![],
            pending_invites: vec![],
            shared_canvas_ids: vec!["doc123".to_string(), "doc456".to_string()],
        };
        let json = serde_json::to_string(&msg).unwrap();
        assert!(json.contains("\"sharedCanvasIds\""));
        let back: FriendzMessage = serde_json::from_str(&json).unwrap();
        match back {
            FriendzMessage::GossipDigest {
                shared_canvas_ids, ..
            } => {
                assert_eq!(shared_canvas_ids.len(), 2);
            }
            _ => panic!("wrong variant"),
        }
    }

    #[test]
    fn test_gossip_digest_without_shared_canvas_ids() {
        // backward compat: old peers don't send sharedCanvasIds
        let json = r#"{"type":"gossip-digest","canvasUpdates":[],"pendingInvites":[]}"#;
        let msg: FriendzMessage = serde_json::from_str(json).unwrap();
        match msg {
            FriendzMessage::GossipDigest {
                shared_canvas_ids, ..
            } => {
                assert!(shared_canvas_ids.is_empty());
            }
            _ => panic!("wrong variant"),
        }
    }
}
