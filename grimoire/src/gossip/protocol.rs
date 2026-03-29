//! gossip protocol types — wire format for gossip messages
//!
//! these types are serialized to JSON and broadcast via iroh-gossip.
//! they define the envelope format and payload types for all gossip communication.

use serde::{Deserialize, Serialize};
use zod_gen_derive::ZodSchema;

/// outer envelope for all gossip messages
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GossipEnvelope {
    pub msg_type: GossipMessageType,
    pub sender_node_id: String,
    pub sender_name: String,
    pub timestamp: i64,
    pub message_id: String,
    /// JSON-encoded payload (type depends on msg_type)
    pub payload: String,
}

/// discriminator for gossip message types
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GossipMessageType {
    ChannelMeta,
    ChannelDestroyed,
    MusicShare,
    Reaction,
    ReactionRemoved,
    MessageDeleted,
    MemberAdded,
    MemberRemoved,
    Knock,
    KnockResponse,
    ProfileUpdate,
    SyncRequest,
    SyncResponse,
    ReadReceipt,
    Heartbeat,
}

impl std::fmt::Display for GossipMessageType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ChannelMeta => write!(f, "channel_meta"),
            Self::ChannelDestroyed => write!(f, "channel_destroyed"),
            Self::MusicShare => write!(f, "music_share"),
            Self::Reaction => write!(f, "reaction"),
            Self::ReactionRemoved => write!(f, "reaction_removed"),
            Self::MessageDeleted => write!(f, "message_deleted"),
            Self::MemberAdded => write!(f, "member_added"),
            Self::MemberRemoved => write!(f, "member_removed"),
            Self::Knock => write!(f, "knock"),
            Self::KnockResponse => write!(f, "knock_response"),
            Self::ProfileUpdate => write!(f, "profile_update"),
            Self::SyncRequest => write!(f, "sync_request"),
            Self::SyncResponse => write!(f, "sync_response"),
            Self::ReadReceipt => write!(f, "read_receipt"),
            Self::Heartbeat => write!(f, "heartbeat"),
        }
    }
}

impl std::str::FromStr for GossipMessageType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "channel_meta" => Ok(Self::ChannelMeta),
            "channel_destroyed" => Ok(Self::ChannelDestroyed),
            "music_share" => Ok(Self::MusicShare),
            "reaction" => Ok(Self::Reaction),
            "reaction_removed" => Ok(Self::ReactionRemoved),
            "message_deleted" => Ok(Self::MessageDeleted),
            "member_added" => Ok(Self::MemberAdded),
            "member_removed" => Ok(Self::MemberRemoved),
            "knock" => Ok(Self::Knock),
            "knock_response" => Ok(Self::KnockResponse),
            "profile_update" => Ok(Self::ProfileUpdate),
            "sync_request" => Ok(Self::SyncRequest),
            "sync_response" => Ok(Self::SyncResponse),
            "read_receipt" => Ok(Self::ReadReceipt),
            "heartbeat" => Ok(Self::Heartbeat),
            _ => Err(format!("unknown gossip message type: {}", s)),
        }
    }
}

/// music share: one or more music references + optional text
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct MusicSharePayload {
    pub text: Option<String>,
    pub items: Vec<MusicReference>,
}

/// tagged union of music entity references
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
#[serde(tag = "ref_type")]
pub enum MusicReference {
    Song(SongReference),
    Album(AlbumReference),
    Artist(ArtistReference),
    Playlist(PlaylistReference),
    Genre(GenreReference),
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SongReference {
    pub remote_id: String,
    pub source_node_id: String,
    /// display name of the source node (resolved at share-time)
    pub source_name: Option<String>,
    pub title: String,
    pub track_artist: Option<String>,
    pub album_title: Option<String>,
    pub duration: Option<i64>,
    pub track_number: i64,
    pub disc_number: i64,
    pub bpm: Option<i64>,
    /// small WebP thumbnails (~10-20KB each, base64-encoded)
    pub thumbnails: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct AlbumReference {
    pub remote_id: String,
    pub source_node_id: String,
    pub source_name: Option<String>,
    pub title: String,
    pub artist_name: Option<String>,
    pub album_type: String,
    pub release_date: Option<String>,
    pub song_count: i64,
    pub total_duration: i64,
    pub genres: Vec<String>,
    pub thumbnails: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ArtistReference {
    pub remote_id: String,
    pub source_node_id: String,
    pub source_name: Option<String>,
    pub name: String,
    pub bio: Option<String>,
    pub thumbnails: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct PlaylistReference {
    pub remote_id: String,
    pub source_node_id: String,
    pub source_name: Option<String>,
    pub title: String,
    pub description: Option<String>,
    pub song_count: i64,
    pub duration: Option<i64>,
    pub thumbnails: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GenreReference {
    pub remote_id: String,
    pub source_node_id: String,
    pub source_name: Option<String>,
    pub name: String,
    pub thumbnails: Vec<String>,
}

/// reaction to a message
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ReactionPayload {
    pub target_message_id: String,
    pub emoji: String,
}

/// message deletion notification
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct MessageDeletedPayload {
    pub target_message_id: String,
}

/// channel metadata (broadcast on create and updates)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ChannelMetaPayload {
    pub name: String,
    pub description: Option<String>,
    pub music_only: Option<bool>,
    pub creator_node_id: Option<String>,
}

/// member added/removed notification
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct MemberPayload {
    pub node_id: String,
    pub display_name: Option<String>,
    pub role: Option<String>,
}

/// profile update broadcast (display name and/or avatar changed)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ProfileUpdatePayload {
    pub display_name: String,
    /// base64-encoded small WebP avatar (~5-10KB)
    pub avatar_blob: Option<String>,
}

/// channel destroyed by creator (tombstone — channel becomes read-only for members)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ChannelDestroyedPayload {
    /// reason for closing, shown in the tombstone message
    pub reason: Option<String>,
}

/// sync request — pull-based: reconnecting peer asks a specific peer for messages it missed
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SyncRequestPayload {
    /// unix timestamp of the requester's most recent message for this topic
    pub since: i64,
    /// max number of messages to return (pagination)
    pub limit: Option<i64>,
    /// if set, request messages *before* this timestamp (backward pagination)
    pub before: Option<i64>,
    /// node_id of the specific peer being asked (direct addressing)
    pub to: Option<String>,
}

/// sync response — the requested messages (all event types, not just MusicShare)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SyncResponsePayload {
    /// the original envelopes, JSON-encoded as strings
    pub messages: Vec<String>,
    /// true if more messages exist before the returned range
    pub has_more: bool,
}

/// read receipt — high-water mark per peer per topic
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ReadReceiptPayload {
    /// message_id of the latest message the sender has seen
    pub latest_message_id: String,
    /// timestamp of the latest message the sender has seen
    pub latest_timestamp: i64,
}

/// heartbeat — lightweight presence ping broadcast to topics for online/offline detection
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct HeartbeatPayload {
    /// unix timestamp when this node came online (stable within a session)
    pub online_since: i64,
}
