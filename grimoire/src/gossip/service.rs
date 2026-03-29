//! gossip service — business logic for channel operations
//!
//! orchestrates repository calls, envelope construction, and broadcasting.

use crate::error::{GrimoireError, GrimoireResult};
use crate::gossip::models::*;
use crate::gossip::protocol::*;
use crate::gossip::repository;
use sha2::{Digest, Sha256};
use std::time::{SystemTime, UNIX_EPOCH};
use tracing::info;

/// high-level gossip operations
pub struct GossipService;

impl GossipService {
    /// derive a TopicId from creator_node_id + channel_name
    pub fn derive_topic_id(creator_node_id: &str, channel_name: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(creator_node_id.as_bytes());
        hasher.update(channel_name.as_bytes());
        hex::encode(hasher.finalize())
    }

    /// get current unix timestamp
    fn now() -> i64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs() as i64
    }

    /// create a new channel (we are the creator)
    pub async fn create_channel(
        creator_node_id: &str,
        creator_name: &str,
        name: &str,
        description: Option<&str>,
        music_only: bool,
    ) -> GrimoireResult<GossipChannel> {
        let topic_id = Self::derive_topic_id(creator_node_id, name);
        let now = Self::now();

        let channel = GossipChannel {
            topic_id: topic_id.clone(),
            name: name.to_string(),
            description: description.map(|s| s.to_string()),
            creator_node_id: creator_node_id.to_string(),
            created_at: now,
            settings: None,
            last_message_at: None,
            music_only,
            destroyed_at: None,
        };

        repository::create_channel(&channel).await?;

        // add ourselves as creator member
        let member = GossipChannelMember {
            topic_id: topic_id.clone(),
            node_id: creator_node_id.to_string(),
            display_name: Some(creator_name.to_string()),
            role: "creator".to_string(),
            joined_at: now,
        };
        repository::add_member(&member).await?;

        info!("created gossip channel '{}' ({})", name, &topic_id[..16]);

        Ok(channel)
    }

    /// join an existing channel via invite
    pub async fn join_channel(
        our_node_id: &str,
        our_name: &str,
        invite: &JoinChannelRequest,
    ) -> GrimoireResult<GossipChannel> {
        // check if already in this channel
        if let Some(existing) = repository::get_channel(&invite.topic_id).await? {
            return Ok(existing);
        }

        let now = Self::now();

        let channel = GossipChannel {
            topic_id: invite.topic_id.clone(),
            name: invite.channel_name.clone(),
            description: None,
            creator_node_id: invite.creator_node_id.clone(),
            created_at: now,
            settings: None,
            last_message_at: None,
            music_only: true,
            destroyed_at: None,
        };

        repository::create_channel(&channel).await?;

        // add creator as a known member (bootstrap peer)
        let creator_member = GossipChannelMember {
            topic_id: invite.topic_id.clone(),
            node_id: invite.creator_node_id.clone(),
            display_name: None,
            role: "creator".to_string(),
            joined_at: now,
        };
        repository::add_member(&creator_member).await?;

        // add ourselves
        let our_member = GossipChannelMember {
            topic_id: invite.topic_id.clone(),
            node_id: our_node_id.to_string(),
            display_name: Some(our_name.to_string()),
            role: "member".to_string(),
            joined_at: now,
        };
        repository::add_member(&our_member).await?;

        info!(
            "joined gossip channel '{}' ({})",
            invite.channel_name,
            &invite.topic_id[..16]
        );

        Ok(channel)
    }

    /// leave a channel
    pub async fn leave_channel(topic_id: &str) -> GrimoireResult<()> {
        repository::delete_channel(topic_id).await?;
        info!("left gossip channel {}", &topic_id[..16]);
        Ok(())
    }

    /// build a GossipEnvelope for a music share
    pub fn build_music_share_envelope(
        sender_node_id: &str,
        sender_name: &str,
        payload: &MusicSharePayload,
    ) -> GrimoireResult<GossipEnvelope> {
        if payload.items.is_empty() {
            return Err(GrimoireError::ProcessingFailed {
                message: "music share must have at least one item".to_string(),
            });
        }

        Ok(GossipEnvelope {
            msg_type: GossipMessageType::MusicShare,
            sender_node_id: sender_node_id.to_string(),
            sender_name: sender_name.to_string(),
            timestamp: Self::now(),
            message_id: uuid::Uuid::new_v4().to_string(),
            payload: serde_json::to_string(payload)?,
        })
    }

    /// build a GossipEnvelope for a reaction
    pub fn build_reaction_envelope(
        sender_node_id: &str,
        sender_name: &str,
        payload: &ReactionPayload,
    ) -> GossipEnvelope {
        GossipEnvelope {
            msg_type: GossipMessageType::Reaction,
            sender_node_id: sender_node_id.to_string(),
            sender_name: sender_name.to_string(),
            timestamp: Self::now(),
            message_id: uuid::Uuid::new_v4().to_string(),
            payload: serde_json::to_string(payload).unwrap_or_default(),
        }
    }

    /// build a GossipEnvelope for a message deletion
    pub fn build_delete_envelope(
        sender_node_id: &str,
        sender_name: &str,
        target_message_id: &str,
    ) -> GossipEnvelope {
        let payload = MessageDeletedPayload {
            target_message_id: target_message_id.to_string(),
        };
        GossipEnvelope {
            msg_type: GossipMessageType::MessageDeleted,
            sender_node_id: sender_node_id.to_string(),
            sender_name: sender_name.to_string(),
            timestamp: Self::now(),
            message_id: uuid::Uuid::new_v4().to_string(),
            payload: serde_json::to_string(&payload).unwrap_or_default(),
        }
    }

    /// process an incoming gossip envelope — persist to database
    pub async fn handle_incoming_envelope(
        topic_id: &str,
        envelope: &GossipEnvelope,
    ) -> GrimoireResult<()> {
        // dedup check
        if repository::message_exists(&envelope.message_id).await? {
            return Ok(());
        }

        let now = Self::now();

        match envelope.msg_type {
            GossipMessageType::MusicShare => {
                let msg = GossipMessage {
                    message_id: envelope.message_id.clone(),
                    topic_id: topic_id.to_string(),
                    sender_node_id: envelope.sender_node_id.clone(),
                    sender_name: Some(envelope.sender_name.clone()),
                    msg_type: envelope.msg_type.to_string(),
                    payload: envelope.payload.clone(),
                    timestamp: envelope.timestamp,
                    received_at: now,
                    deleted_at: None,
                };
                repository::insert_message(&msg).await?;
                repository::update_last_message_at(topic_id, envelope.timestamp).await?;

                // track sender as a member if not already
                let member = GossipChannelMember {
                    topic_id: topic_id.to_string(),
                    node_id: envelope.sender_node_id.clone(),
                    display_name: Some(envelope.sender_name.clone()),
                    role: "member".to_string(),
                    joined_at: now,
                };
                repository::add_member(&member).await?;
            }

            GossipMessageType::Reaction => {
                if let Ok(reaction_payload) =
                    serde_json::from_str::<ReactionPayload>(&envelope.payload)
                {
                    let reaction = GossipReaction {
                        message_id: envelope.message_id.clone(),
                        topic_id: topic_id.to_string(),
                        target_message_id: reaction_payload.target_message_id,
                        sender_node_id: envelope.sender_node_id.clone(),
                        sender_name: Some(envelope.sender_name.clone()),
                        emoji: reaction_payload.emoji,
                        timestamp: envelope.timestamp,
                    };
                    repository::insert_reaction(&reaction).await?;
                }
            }

            GossipMessageType::ReactionRemoved => {
                // payload is a ReactionPayload with the reaction's message_id
                // for now, use message_id from the envelope to identify
                // the original reaction to remove
                if let Ok(_payload) = serde_json::from_str::<ReactionPayload>(&envelope.payload) {
                    // find and delete the matching reaction
                    // (we'd need the original reaction message_id — for now store a deletion record)
                    let msg = GossipMessage {
                        message_id: envelope.message_id.clone(),
                        topic_id: topic_id.to_string(),
                        sender_node_id: envelope.sender_node_id.clone(),
                        sender_name: Some(envelope.sender_name.clone()),
                        msg_type: envelope.msg_type.to_string(),
                        payload: envelope.payload.clone(),
                        timestamp: envelope.timestamp,
                        received_at: now,
                        deleted_at: None,
                    };
                    repository::insert_message(&msg).await?;
                }
            }

            GossipMessageType::MessageDeleted => {
                if let Ok(delete_payload) =
                    serde_json::from_str::<MessageDeletedPayload>(&envelope.payload)
                {
                    repository::mark_message_deleted(&delete_payload.target_message_id).await?;
                }
            }

            GossipMessageType::ChannelMeta => {
                // store as a message for history, update channel description if changed
                let msg = GossipMessage {
                    message_id: envelope.message_id.clone(),
                    topic_id: topic_id.to_string(),
                    sender_node_id: envelope.sender_node_id.clone(),
                    sender_name: Some(envelope.sender_name.clone()),
                    msg_type: envelope.msg_type.to_string(),
                    payload: envelope.payload.clone(),
                    timestamp: envelope.timestamp,
                    received_at: now,
                    deleted_at: None,
                };
                repository::insert_message(&msg).await?;
            }

            GossipMessageType::ChannelDestroyed => {
                // verify sender is the channel creator
                if let Some(channel) = repository::get_channel(topic_id).await? {
                    if channel.creator_node_id == envelope.sender_node_id {
                        repository::mark_channel_destroyed(topic_id, envelope.timestamp).await?;

                        // store as a message so it shows in history
                        let msg = GossipMessage {
                            message_id: envelope.message_id.clone(),
                            topic_id: topic_id.to_string(),
                            sender_node_id: envelope.sender_node_id.clone(),
                            sender_name: Some(envelope.sender_name.clone()),
                            msg_type: envelope.msg_type.to_string(),
                            payload: envelope.payload.clone(),
                            timestamp: envelope.timestamp,
                            received_at: now,
                            deleted_at: None,
                        };
                        repository::insert_message(&msg).await?;
                    }
                }
            }

            GossipMessageType::MemberAdded | GossipMessageType::MemberRemoved => {
                if let Ok(member_payload) = serde_json::from_str::<MemberPayload>(&envelope.payload)
                {
                    if envelope.msg_type == GossipMessageType::MemberAdded {
                        let member = GossipChannelMember {
                            topic_id: topic_id.to_string(),
                            node_id: member_payload.node_id,
                            display_name: member_payload.display_name,
                            role: "member".to_string(),
                            joined_at: now,
                        };
                        repository::add_member(&member).await?;
                    } else {
                        repository::remove_member(topic_id, &member_payload.node_id).await?;
                    }
                }
            }

            GossipMessageType::Knock | GossipMessageType::KnockResponse => {
                // persisted as messages for now
                let msg = GossipMessage {
                    message_id: envelope.message_id.clone(),
                    topic_id: topic_id.to_string(),
                    sender_node_id: envelope.sender_node_id.clone(),
                    sender_name: Some(envelope.sender_name.clone()),
                    msg_type: envelope.msg_type.to_string(),
                    payload: envelope.payload.clone(),
                    timestamp: envelope.timestamp,
                    received_at: now,
                    deleted_at: None,
                };
                repository::insert_message(&msg).await?;
            }

            GossipMessageType::ProfileUpdate => {
                // update the sender's gossip profile in local cache
                if let Ok(profile_payload) =
                    serde_json::from_str::<ProfileUpdatePayload>(&envelope.payload)
                {
                    let profile = GossipProfile {
                        node_id: envelope.sender_node_id.clone(),
                        display_name: profile_payload.display_name,
                        avatar_blob: profile_payload.avatar_blob,
                        updated_at: envelope.timestamp,
                    };
                    repository::upsert_profile(&profile).await?;
                }
            }

            // sync, read receipt, and heartbeat messages are handled by the transport layer,
            // not persisted as regular messages
            GossipMessageType::SyncRequest
            | GossipMessageType::SyncResponse
            | GossipMessageType::ReadReceipt
            | GossipMessageType::Heartbeat => {}
        }

        Ok(())
    }

    /// get messages for a channel with reactions
    pub async fn get_messages(
        topic_id: &str,
        before_timestamp: Option<i64>,
        limit: Option<i64>,
    ) -> GrimoireResult<MessagesResponse> {
        let limit = limit.unwrap_or(50).min(200);
        let messages = repository::get_messages(topic_id, before_timestamp, limit).await?;

        let message_ids: Vec<String> = messages.iter().map(|m| m.message_id.clone()).collect();
        let reactions = repository::get_reactions_for_messages(topic_id, &message_ids).await?;

        Ok(MessagesResponse {
            messages,
            reactions,
        })
    }

    /// generate an invite payload for a channel
    pub async fn generate_invite(topic_id: &str) -> GrimoireResult<ChannelInvite> {
        let channel = repository::get_channel(topic_id).await?.ok_or_else(|| {
            GrimoireError::ProcessingFailed {
                message: format!("channel not found: {}", topic_id),
            }
        })?;

        Ok(ChannelInvite {
            topic_id: channel.topic_id,
            creator_node_id: channel.creator_node_id,
            channel_name: channel.name,
        })
    }
}
