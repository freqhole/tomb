//! the unified friendz protocol message set - the normative wire-message
//! table for peer-to-peer presence, friend requests, knocks, and identity
//! updates. see PHASE_4_HARUSPEX_RUST.md's "wire-message mapping" section
//! (in the tomb repo's xl-refactor plan) for the full normative table this
//! implements.
//!
//! # normalization rules applied here
//!
//! 1. discriminants are kebab-case.
//! 2. fields are camelCase everywhere.
//! 3. every message carries `v: 1`; missing `v` is still accepted on
//!    deserialize via `#[serde(default)]`, since a transition window where
//!    not every peer sends it is expected.
//! 4. identity naming: `nodeId` everywhere; `username` for handle-like
//!    names; avatars use a blob-id reference (`avatarBlobId`) on handshakes
//!    (hello/hello-ok) and an inline data url (`avatarDataUrl`) is allowed
//!    on profile-response/identity-update (status quo, documented here).
//! 5. knock outcome status vocabulary is `pending | accepted | denied`
//!    (`crate::stores::KnockStatus` already matches this).
//! 6. optionality style: every `Option<T>` field is
//!    `skip_serializing_if = "Option::is_none"` and every `Vec<T>` field is
//!    `#[serde(default, skip_serializing_if = "Vec::is_empty")]` - applied
//!    uniformly across the whole message set, so an empty `sharedCanvasIds`
//!    and an empty `pendingKnocks` serialize the same way.
//!
//! # profile-response fields
//!
//! the `ProfileResponse` variant carries `profileDocId` and
//! `profileUpdatedAt` alongside the rest of the profile fields
//! but were never added to the rust enum. both fields are present below.
//!
//! # app extension mechanism (decision Q6)
//!
//! an unknown `type` string containing a `:` (e.g. `skein:canvas-invite`,
//! `playlistz:list-playlists`) deserializes into
//! [`FriendzMessage::AppExtension`] - a raw json passthrough haruspex never
//! inspects the shape of. an app registers its own handler against
//! `message_type` and parses `payload` with its own types (zod on the ts
//! side, serde on the rust side) - haruspex only owns the framing + the
//! `:` - prefixed routing convention, never the app payload shapes
//! themselves. a `type` with no `:` that fails to match any core message is
//! a real protocol error (propagated, not silently swallowed).

use serde::de::Error as DeError;
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::stores::{KnockScope, KnockStatus, Role};

fn default_version() -> u8 {
    1
}

// ---------------------------------------------------------------------------
// sub-types used within messages
// ---------------------------------------------------------------------------

/// capability bag carried on the `hello`/`hello-ok` handshake - replaces
/// playlistz's bare `public: bool` (`public` becomes `capabilities.browse ==
/// "public"`, per PHASE_4_HARUSPEX_RUST.md's wire-message-mapping section).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub browse: BrowseCapability,
}

/// whether a peer may browse without knocking first, or must knock.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum BrowseCapability {
    Public,
    Knock,
}

/// the wire shape of a knock's scope - camelCase, distinct from
/// `crate::stores::KnockScope` (whose fields are snake_case, a storage
/// concern) but otherwise structurally identical. converts to/from the
/// store type via [`WireKnockScope::to_store`]/[`WireKnockScope::from_store`]
/// at the app/store boundary.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum WireKnockScope {
    #[serde(rename_all = "camelCase")]
    Account {
        #[serde(skip_serializing_if = "Option::is_none")]
        requested_username: Option<String>,
    },
    Browse,
    #[serde(rename_all = "camelCase")]
    Resource {
        resource_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        requested_role: Option<Role>,
    },
}

impl WireKnockScope {
    pub fn from_store(scope: KnockScope) -> Self {
        match scope {
            KnockScope::Account { requested_username } => {
                WireKnockScope::Account { requested_username }
            }
            KnockScope::Browse => WireKnockScope::Browse,
            KnockScope::Resource {
                resource_id,
                requested_role,
            } => WireKnockScope::Resource {
                resource_id,
                requested_role,
            },
        }
    }

    pub fn to_store(self) -> KnockScope {
        match self {
            WireKnockScope::Account { requested_username } => {
                KnockScope::Account { requested_username }
            }
            WireKnockScope::Browse => KnockScope::Browse,
            WireKnockScope::Resource {
                resource_id,
                requested_role,
            } => KnockScope::Resource {
                resource_id,
                requested_role,
            },
        }
    }
}

/// a pending-knock entry gossiped in a `gossip-digest` - the unified knock
/// shape (per the phase doc: "pendingKnocks (re-expressed with the unified
/// knock shape)"), minus `v`/`type` since it is always nested, not a
/// top-level message.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GossipDigestPendingKnock {
    pub knock_id: String,
    pub node_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    pub message: String,
    pub scope: WireKnockScope,
    pub knocked_at: String,
}

/// a profile-doc pointer entry in a gossip digest - lets the receiver
/// compare against any cached copy for staleness without needing a direct
/// connection to the profile's owner. ported from skein/loam unchanged
/// (already generic, not canvas-specific).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GossipDigestProfileEntry {
    pub peer_node_id: String,
    pub profile_doc_id: String,
    pub updated_at: String,
}

// ---------------------------------------------------------------------------
// the core message set
// ---------------------------------------------------------------------------

/// the derive-based union of every core (non-namespaced) friendz message.
/// public so callers can construct/match every variant - [`FriendzMessage`]
/// just wraps this plus the app-extension passthrough.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum CoreMessage {
    /// request the peer's profile.
    ProfileRequest {
        #[serde(default = "default_version")]
        v: u8,
    },

    /// response with profile data.
    #[serde(rename_all = "camelCase")]
    ProfileResponse {
        #[serde(default = "default_version")]
        v: u8,
        username: String,
        bio: String,
        avatar_data_url: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        accent_color: Option<i64>,
        /// bug-fix: skein's rust variant silently dropped this field (see
        /// the module doc comment's "known divergence fixed here").
        #[serde(skip_serializing_if = "Option::is_none")]
        profile_doc_id: Option<String>,
        /// bug-fix: same as `profile_doc_id` above.
        #[serde(skip_serializing_if = "Option::is_none")]
        profile_updated_at: Option<String>,
    },

    /// send a friend request to a peer.
    #[serde(rename_all = "camelCase")]
    FriendRequest {
        #[serde(default = "default_version")]
        v: u8,
        from_node_id: String,
        from_username: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_hub: Option<bool>,
    },

    /// accept an incoming friend request.
    #[serde(rename_all = "camelCase")]
    FriendAccept {
        #[serde(default = "default_version")]
        v: u8,
        from_node_id: String,
        from_username: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        is_hub: Option<bool>,
    },

    /// acknowledge a friend-accept (two-phase handshake).
    #[serde(rename_all = "camelCase")]
    FriendAcceptAck {
        #[serde(default = "default_version")]
        v: u8,
        from_node_id: String,
    },

    /// reject an incoming friend request.
    #[serde(rename_all = "camelCase")]
    FriendReject {
        #[serde(default = "default_version")]
        v: u8,
        from_node_id: String,
    },

    /// periodic presence ping. app-specific activity summaries (skein's
    /// `canvasActivity`) live in `app_payload`, not a dedicated field.
    #[serde(rename_all = "camelCase")]
    Heartbeat {
        #[serde(default = "default_version")]
        v: u8,
        node_id: String,
        username: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        app_payload: Option<serde_json::Value>,
    },

    /// sent when a peer is about to go offline.
    #[serde(rename_all = "camelCase")]
    OfflineAnnouncement {
        #[serde(default = "default_version")]
        v: u8,
        node_id: String,
    },

    /// capability handshake: "here's who i am and what i support".
    #[serde(rename_all = "camelCase")]
    Hello {
        #[serde(default = "default_version")]
        v: u8,
        node_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        username: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        avatar_blob_id: Option<String>,
        capabilities: Capabilities,
    },

    /// reply to `hello`.
    #[serde(rename_all = "camelCase")]
    HelloOk {
        #[serde(default = "default_version")]
        v: u8,
        node_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        username: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        avatar_blob_id: Option<String>,
        capabilities: Capabilities,
    },

    /// request access (a "knock") - unifies skein's canvas-knock,
    /// playlistz's knock, and tomb's `POST /api/knock`.
    #[serde(rename_all = "camelCase")]
    KnockRequest {
        #[serde(default = "default_version")]
        v: u8,
        knock_id: String,
        node_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        username: Option<String>,
        message: String,
        scope: WireKnockScope,
    },

    /// acknowledge receipt of a knock request. delivery ack, optional to
    /// send - the actual accept/deny decision is `knock-outcome`.
    #[serde(rename_all = "camelCase")]
    KnockAck {
        #[serde(default = "default_version")]
        v: u8,
        knock_id: String,
        acker_node_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        resource_id: Option<String>,
    },

    /// the outcome of a knock - serves both the pull (status re-check) and
    /// push (notify) paths. unifies skein's canvas-knock-approve/decline,
    /// playlistz's knock_status/knock_notify, and tomb's
    /// `GET /api/knock/status` response.
    #[serde(rename_all = "camelCase")]
    KnockOutcome {
        #[serde(default = "default_version")]
        v: u8,
        #[serde(skip_serializing_if = "Option::is_none")]
        knock_id: Option<String>,
        status: KnockStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        granted_role: Option<Role>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        granted_resource_ids: Vec<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        by_node_id: Option<String>,
    },

    /// proactive identity update: a peer broadcasts its current
    /// username/avatar to peers it has an established connection with.
    #[serde(rename_all = "camelCase")]
    IdentityUpdate {
        #[serde(default = "default_version")]
        v: u8,
        node_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        username: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        avatar_data_url: Option<String>,
    },

    /// notify a peer that their role on a resource changed.
    /// `new_role: None` means access was removed entirely (replaces
    /// skein's `newRole: "removed"` string convention with a typed
    /// `Option<Role>` - no grant is exactly "no role").
    #[serde(rename_all = "camelCase")]
    AclChange {
        #[serde(default = "default_version")]
        v: u8,
        resource_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        resource_title: Option<String>,
        target_node_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        new_role: Option<Role>,
        changed_by: String,
        changed_by_username: String,
    },

    /// gossip digest sent when a peer comes online. the core shape keeps
    /// `pendingKnocks` + `profiles`; app-specific sections (skein's
    /// `canvasUpdates`/`pendingInvites`/`sharedCanvasIds`) live in
    /// `app_payload`, namespaced by the app.
    #[serde(rename_all = "camelCase")]
    GossipDigest {
        #[serde(default = "default_version")]
        v: u8,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        pending_knocks: Vec<GossipDigestPendingKnock>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        profiles: Vec<GossipDigestProfileEntry>,
        #[serde(skip_serializing_if = "Option::is_none")]
        app_payload: Option<serde_json::Value>,
    },

    /// batch blob availability query - "i need these blobs, which do you
    /// have?".
    #[serde(rename_all = "camelCase")]
    BlobSeek {
        #[serde(default = "default_version")]
        v: u8,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        needed: Vec<String>,
    },

    /// batch blob availability response - "i have these blobs".
    #[serde(rename_all = "camelCase")]
    BlobOffer {
        #[serde(default = "default_version")]
        v: u8,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        available: Vec<String>,
    },

    /// a protocol-level error.
    #[serde(rename_all = "camelCase")]
    Error {
        #[serde(default = "default_version")]
        v: u8,
        code: String,
        message: String,
    },
}

impl CoreMessage {
    pub fn message_type(&self) -> &'static str {
        match self {
            CoreMessage::ProfileRequest { .. } => "profile-request",
            CoreMessage::ProfileResponse { .. } => "profile-response",
            CoreMessage::FriendRequest { .. } => "friend-request",
            CoreMessage::FriendAccept { .. } => "friend-accept",
            CoreMessage::FriendAcceptAck { .. } => "friend-accept-ack",
            CoreMessage::FriendReject { .. } => "friend-reject",
            CoreMessage::Heartbeat { .. } => "heartbeat",
            CoreMessage::OfflineAnnouncement { .. } => "offline-announcement",
            CoreMessage::Hello { .. } => "hello",
            CoreMessage::HelloOk { .. } => "hello-ok",
            CoreMessage::KnockRequest { .. } => "knock-request",
            CoreMessage::KnockAck { .. } => "knock-ack",
            CoreMessage::KnockOutcome { .. } => "knock-outcome",
            CoreMessage::IdentityUpdate { .. } => "identity-update",
            CoreMessage::AclChange { .. } => "acl-change",
            CoreMessage::GossipDigest { .. } => "gossip-digest",
            CoreMessage::BlobSeek { .. } => "blob-seek",
            CoreMessage::BlobOffer { .. } => "blob-offer",
            CoreMessage::Error { .. } => "error",
        }
    }
}

// ---------------------------------------------------------------------------
// FriendzMessage - core messages + the namespaced app-extension passthrough
// ---------------------------------------------------------------------------

/// the full friendz protocol message set: every core (unified) message plus
/// the namespaced app-extension passthrough. see the module doc comment for
/// the app-extension mechanism (decision Q6).
///
/// hand-rolls `Serialize`/`Deserialize` rather than deriving them, because a
/// derived internally-tagged enum has no way to fall back to a raw-payload
/// variant for a `type` it doesn't recognize - see the `Deserialize` impl
/// below.
#[derive(Debug, Clone, PartialEq)]
pub enum FriendzMessage {
    Core(CoreMessage),
    /// an unknown, namespace-prefixed `type` (e.g. `skein:canvas-invite`,
    /// `playlistz:list-playlists`) - haruspex never inspects `payload`'s
    /// shape, only routes on `message_type`. `payload` is the full received
    /// json object (including `type` and `v`), so an app can deserialize it
    /// with its own types directly.
    AppExtension {
        message_type: String,
        payload: serde_json::Value,
    },
}

impl FriendzMessage {
    /// the wire `type` discriminant, for logging/dispatch - `"profile-
    /// request"`, `"heartbeat"`, or the app-extension's own namespaced type
    /// string (e.g. `"skein:canvas-invite"`).
    pub fn message_type(&self) -> &str {
        match self {
            FriendzMessage::Core(core) => core.message_type(),
            FriendzMessage::AppExtension { message_type, .. } => message_type,
        }
    }
}

impl Serialize for FriendzMessage {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            FriendzMessage::Core(core) => core.serialize(serializer),
            FriendzMessage::AppExtension { payload, .. } => payload.serialize(serializer),
        }
    }
}

impl<'de> Deserialize<'de> for FriendzMessage {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = serde_json::Value::deserialize(deserializer)?;
        let type_str = value
            .get("type")
            .and_then(|t| t.as_str())
            .ok_or_else(|| DeError::missing_field("type"))?
            .to_string();

        // a namespace-prefixed type (e.g. "skein:canvas-invite") is always
        // an app extension - core message types never contain ':'.
        if type_str.contains(':') {
            return Ok(FriendzMessage::AppExtension {
                message_type: type_str,
                payload: value,
            });
        }

        let core: CoreMessage = serde_json::from_value(value).map_err(DeError::custom)?;
        Ok(FriendzMessage::Core(core))
    }
}

// ---------------------------------------------------------------------------
// timing constants (matching skein/loam)
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

/// the ALPN protocol identifier for the friendz protocol (tomb's string
/// wins, per PHASE_4_HARUSPEX_RUST.md's protocol section).
pub const FRIENDZ_ALPN: &[u8] = b"freqhole-friendz/1";

#[cfg(test)]
mod tests {
    use super::*;

    fn v(msg: &serde_json::Value) -> &serde_json::Value {
        msg.get("v").expect("v field must be present")
    }

    #[test]
    fn profile_request_round_trips_with_v() {
        let msg = FriendzMessage::Core(CoreMessage::ProfileRequest { v: 1 });
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "profile-request");
        assert_eq!(v(&parsed), 1);

        let back: FriendzMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(back, msg);
    }

    #[test]
    fn profile_response_carries_the_two_bug_fix_fields() {
        let msg = FriendzMessage::Core(CoreMessage::ProfileResponse {
            v: 1,
            username: "alice".to_string(),
            bio: "hello".to_string(),
            avatar_data_url: "data:image/png;base64,abc".to_string(),
            accent_color: None,
            profile_doc_id: Some("doc-123".to_string()),
            profile_updated_at: Some("2026-07-07T00:00:00Z".to_string()),
        });
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["profileDocId"], "doc-123");
        assert_eq!(parsed["profileUpdatedAt"], "2026-07-07T00:00:00Z");

        let back: FriendzMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(back, msg);
    }

    #[test]
    fn profile_response_omits_absent_optionals() {
        let msg = FriendzMessage::Core(CoreMessage::ProfileResponse {
            v: 1,
            username: "alice".to_string(),
            bio: String::new(),
            avatar_data_url: String::new(),
            accent_color: None,
            profile_doc_id: None,
            profile_updated_at: None,
        });
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(parsed.get("accentColor").is_none());
        assert!(parsed.get("profileDocId").is_none());
        assert!(parsed.get("profileUpdatedAt").is_none());
    }

    #[test]
    fn empty_vecs_are_omitted_everywhere_consistently() {
        let digest = FriendzMessage::Core(CoreMessage::GossipDigest {
            v: 1,
            pending_knocks: vec![],
            profiles: vec![],
            app_payload: None,
        });
        let json = serde_json::to_string(&digest).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(parsed.get("pendingKnocks").is_none());
        assert!(parsed.get("profiles").is_none());

        let seek = FriendzMessage::Core(CoreMessage::BlobSeek {
            v: 1,
            needed: vec![],
        });
        let json = serde_json::to_string(&seek).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(parsed.get("needed").is_none());
    }

    #[test]
    fn missing_v_defaults_to_one_on_deserialize() {
        let json = r#"{"type":"offline-announcement","nodeId":"node-abc"}"#;
        let msg: FriendzMessage = serde_json::from_str(json).unwrap();
        match msg {
            FriendzMessage::Core(CoreMessage::OfflineAnnouncement { v, node_id }) => {
                assert_eq!(v, 1);
                assert_eq!(node_id, "node-abc");
            }
            _ => panic!("expected OfflineAnnouncement"),
        }
    }

    #[test]
    fn hello_capabilities_round_trip() {
        let msg = FriendzMessage::Core(CoreMessage::Hello {
            v: 1,
            node_id: "node-abc".to_string(),
            username: Some("alice".to_string()),
            avatar_blob_id: None,
            capabilities: Capabilities {
                browse: BrowseCapability::Knock,
            },
        });
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "hello");
        assert_eq!(parsed["capabilities"]["browse"], "knock");
        assert!(parsed.get("avatarBlobId").is_none());

        let back: FriendzMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(back, msg);
    }

    #[test]
    fn knock_request_resource_scope_round_trips() {
        let msg = FriendzMessage::Core(CoreMessage::KnockRequest {
            v: 1,
            knock_id: "knock-1".to_string(),
            node_id: "node-stranger".to_string(),
            username: Some("stranger".to_string()),
            message: "let me in".to_string(),
            scope: WireKnockScope::Resource {
                resource_id: "doc-1".to_string(),
                requested_role: Some(Role::Member),
            },
        });
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "knock-request");
        assert_eq!(parsed["scope"]["kind"], "resource");
        assert_eq!(parsed["scope"]["resourceId"], "doc-1");
        assert_eq!(parsed["scope"]["requestedRole"], "member");

        let back: FriendzMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(back, msg);
    }

    #[test]
    fn acl_change_new_role_none_means_removed() {
        let msg = FriendzMessage::Core(CoreMessage::AclChange {
            v: 1,
            resource_id: "doc-1".to_string(),
            resource_title: Some("my doc".to_string()),
            target_node_id: "node-def".to_string(),
            new_role: None,
            changed_by: "node-abc".to_string(),
            changed_by_username: "alice".to_string(),
        });
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(parsed.get("newRole").is_none());

        let back: FriendzMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(back, msg);
    }

    #[test]
    fn unknown_namespaced_type_becomes_app_extension() {
        let json =
            r#"{"v":1,"type":"skein:canvas-invite","inviteId":"inv-1","canvasDocId":"doc-1"}"#;
        let msg: FriendzMessage = serde_json::from_str(json).unwrap();
        match &msg {
            FriendzMessage::AppExtension {
                message_type,
                payload,
            } => {
                assert_eq!(message_type, "skein:canvas-invite");
                assert_eq!(payload["inviteId"], "inv-1");
            }
            _ => panic!("expected AppExtension"),
        }
        assert_eq!(msg.message_type(), "skein:canvas-invite");

        // round trip: serializing an AppExtension emits the payload as-is.
        let back_json = serde_json::to_string(&msg).unwrap();
        let back_parsed: serde_json::Value = serde_json::from_str(&back_json).unwrap();
        assert_eq!(back_parsed["type"], "skein:canvas-invite");
        assert_eq!(back_parsed["inviteId"], "inv-1");
    }

    #[test]
    fn unknown_non_namespaced_type_is_a_real_error() {
        let json = r#"{"v":1,"type":"totally-unknown-type"}"#;
        let result: Result<FriendzMessage, _> = serde_json::from_str(json);
        assert!(result.is_err());
    }

    #[test]
    fn playlistz_prefixed_extension_also_works() {
        let json = r#"{"v":1,"type":"playlistz:list-playlists"}"#;
        let msg: FriendzMessage = serde_json::from_str(json).unwrap();
        assert_eq!(msg.message_type(), "playlistz:list-playlists");
    }

    #[test]
    fn error_message_round_trips() {
        let msg = FriendzMessage::Core(CoreMessage::Error {
            v: 1,
            code: "not_found".to_string(),
            message: "resource not found".to_string(),
        });
        let json = serde_json::to_string(&msg).unwrap();
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["type"], "error");
        assert_eq!(parsed["code"], "not_found");

        let back: FriendzMessage = serde_json::from_str(&json).unwrap();
        assert_eq!(back, msg);
    }
}
