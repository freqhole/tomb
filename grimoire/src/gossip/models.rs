//! gossip domain models — database-backed types for channels, messages, members, reactions

use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use zod_gen_derive::ZodSchema;

/// a gossip channel this node participates in
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, FromRow)]
pub struct GossipChannel {
    pub topic_id: String,
    pub name: String,
    pub description: Option<String>,
    pub creator_node_id: String,
    pub created_at: i64,
    pub settings: Option<String>,
    pub last_message_at: Option<i64>,
    /// if true, only music shares allowed (no text-only messages)
    pub music_only: bool,
    /// set when the creator broadcasts ChannelDestroyed — channel becomes read-only
    pub destroyed_at: Option<i64>,
}

/// a member of a gossip channel
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, FromRow)]
pub struct GossipChannelMember {
    pub topic_id: String,
    pub node_id: String,
    pub display_name: Option<String>,
    pub role: String,
    pub joined_at: i64,
}

/// a persisted gossip message
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, FromRow)]
pub struct GossipMessage {
    pub message_id: String,
    pub topic_id: String,
    pub sender_node_id: String,
    pub sender_name: Option<String>,
    pub msg_type: String,
    pub payload: String,
    pub timestamp: i64,
    pub received_at: i64,
    pub deleted_at: Option<i64>,
}

/// a reaction to a gossip message
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, FromRow)]
pub struct GossipReaction {
    pub message_id: String,
    pub topic_id: String,
    pub target_message_id: String,
    pub sender_node_id: String,
    pub sender_name: Option<String>,
    pub emoji: String,
    pub timestamp: i64,
}

/// a knock request for a gossip channel
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, FromRow)]
pub struct GossipKnockRequest {
    pub id: String,
    pub topic_id: String,
    pub node_id: String,
    pub display_name: Option<String>,
    pub message: Option<String>,
    pub status: String,
    pub created_at: i64,
    pub processed_at: Option<i64>,
}

/// a gossip participant's profile (display name + avatar)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema, FromRow)]
pub struct GossipProfile {
    pub node_id: String,
    pub display_name: String,
    /// base64-encoded small WebP avatar (~5-10KB)
    pub avatar_blob: Option<String>,
    pub updated_at: i64,
}

/// request to create a gossip channel
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct CreateChannelRequest {
    pub name: String,
    pub description: Option<String>,
    pub music_only: Option<bool>,
}

/// response with channel details + members
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ChannelDetailResponse {
    pub channel: GossipChannel,
    pub members: Vec<GossipChannelMember>,
}

/// request to join a channel via invite
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct JoinChannelRequest {
    pub topic_id: String,
    pub channel_name: String,
    pub creator_node_id: String,
}

/// request to send a music share message
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct SendMessageRequest {
    pub text: Option<String>,
    pub items: Vec<super::protocol::MusicReference>,
}

/// request to react to a message
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ReactRequest {
    pub target_message_id: String,
    pub emoji: String,
}

/// paginated message query
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GetMessagesRequest {
    pub before_timestamp: Option<i64>,
    pub limit: Option<i64>,
}

/// paginated messages response
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct MessagesResponse {
    pub messages: Vec<GossipMessage>,
    pub reactions: Vec<GossipReaction>,
}

/// channel invite payload (for sharing)
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct ChannelInvite {
    pub topic_id: String,
    pub creator_node_id: String,
    pub channel_name: String,
}

/// knock request for a gossip channel
#[derive(Debug, Clone, Serialize, Deserialize, ZodSchema)]
pub struct GossipKnockAction {
    pub node_id: String,
}
