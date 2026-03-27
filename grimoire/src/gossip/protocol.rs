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
    MusicShare,
    Reaction,
    ReactionRemoved,
    MessageDeleted,
    MemberAdded,
    MemberRemoved,
    Knock,
    KnockResponse,
    ProfileUpdate,
}

impl std::fmt::Display for GossipMessageType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ChannelMeta => write!(f, "channel_meta"),
            Self::MusicShare => write!(f, "music_share"),
            Self::Reaction => write!(f, "reaction"),
            Self::ReactionRemoved => write!(f, "reaction_removed"),
            Self::MessageDeleted => write!(f, "message_deleted"),
            Self::MemberAdded => write!(f, "member_added"),
            Self::MemberRemoved => write!(f, "member_removed"),
            Self::Knock => write!(f, "knock"),
            Self::KnockResponse => write!(f, "knock_response"),
            Self::ProfileUpdate => write!(f, "profile_update"),
        }
    }
}

impl std::str::FromStr for GossipMessageType {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "channel_meta" => Ok(Self::ChannelMeta),
            "music_share" => Ok(Self::MusicShare),
            "reaction" => Ok(Self::Reaction),
            "reaction_removed" => Ok(Self::ReactionRemoved),
            "message_deleted" => Ok(Self::MessageDeleted),
            "member_added" => Ok(Self::MemberAdded),
            "member_removed" => Ok(Self::MemberRemoved),
            "knock" => Ok(Self::Knock),
            "knock_response" => Ok(Self::KnockResponse),
            "profile_update" => Ok(Self::ProfileUpdate),
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
}

/// member added/removed notification
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct MemberPayload {
    pub node_id: String,
    pub display_name: Option<String>,
}

/// profile update broadcast (display name and/or avatar changed)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ProfileUpdatePayload {
    pub display_name: String,
    /// base64-encoded small WebP avatar (~5-10KB)
    pub avatar_blob: Option<String>,
}
