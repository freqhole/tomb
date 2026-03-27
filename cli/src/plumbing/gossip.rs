//! gossip channel CLI commands

use crate::plumbing::utils::CommandOutput;
use clap::Subcommand;
use grimoire::gossip::models::*;
use grimoire::gossip::repository;
use grimoire::gossip::service::GossipService;

#[derive(Subcommand)]
pub enum GossipAction {
    /// Create a new gossip channel
    Create {
        /// Channel name
        name: String,
        /// Optional description
        #[arg(short, long)]
        description: Option<String>,
        /// Creator node_id (hex)
        #[arg(long)]
        node_id: String,
        /// Creator display name
        #[arg(long)]
        display_name: String,
        /// Music-only channel (no text-only messages)
        #[arg(long, default_value_t = false)]
        music_only: bool,
    },

    /// List all gossip channels
    List,

    /// Get channel details
    Get {
        /// Topic ID (64 hex chars)
        topic_id: String,
    },

    /// Generate an invite for a channel
    Invite {
        /// Topic ID (64 hex chars)
        topic_id: String,
    },

    /// Join a channel via invite JSON
    Join {
        /// Invite JSON string (from `gossip invite`)
        invite_json: String,
        /// Your node_id (hex)
        #[arg(long)]
        node_id: String,
        /// Your display name
        #[arg(long)]
        display_name: String,
    },

    /// Leave a channel
    Leave {
        /// Topic ID (64 hex chars)
        topic_id: String,
    },

    /// List messages in a channel
    Messages {
        /// Topic ID (64 hex chars)
        topic_id: String,
        /// Number of messages to fetch
        #[arg(short, long, default_value = "50")]
        limit: i64,
    },

    /// List members of a channel
    Members {
        /// Topic ID (64 hex chars)
        topic_id: String,
    },
}

pub async fn handle_command(action: GossipAction) -> CommandOutput<serde_json::Value> {
    match action {
        GossipAction::Create {
            name,
            description,
            node_id,
            display_name,
            music_only,
        } => {
            match GossipService::create_channel(&node_id, &display_name, &name, description.as_deref(), music_only)
                .await
            {
                Ok(channel) => CommandOutput::success("channel created", channel),
                Err(e) => CommandOutput::failure(
                    format!("failed to create channel: {}", e),
                    vec![],
                    (),
                ),
            }
        }

        GossipAction::List => match repository::list_channels().await {
            Ok(channels) => CommandOutput::success("channels", channels),
            Err(e) => CommandOutput::failure(
                format!("failed to list channels: {}", e),
                vec![],
                (),
            ),
        },

        GossipAction::Get { topic_id } => {
            let channel = match repository::get_channel(&topic_id).await {
                Ok(Some(ch)) => ch,
                Ok(None) => {
                    return CommandOutput::failure("channel not found", vec![], ())
                }
                Err(e) => {
                    return CommandOutput::failure(
                        format!("failed to get channel: {}", e),
                        vec![],
                        (),
                    )
                }
            };

            let members = match repository::list_members(&topic_id).await {
                Ok(m) => m,
                Err(e) => {
                    return CommandOutput::failure(
                        format!("failed to get members: {}", e),
                        vec![],
                        (),
                    )
                }
            };

            let detail = ChannelDetailResponse { channel, members };
            CommandOutput::success("channel detail", detail)
        }

        GossipAction::Invite { topic_id } => {
            match GossipService::generate_invite(&topic_id).await {
                Ok(invite) => CommandOutput::success("invite", invite),
                Err(e) => CommandOutput::failure(
                    format!("failed to generate invite: {}", e),
                    vec![],
                    (),
                ),
            }
        }

        GossipAction::Join {
            invite_json,
            node_id,
            display_name,
        } => {
            let req: JoinChannelRequest = match serde_json::from_str(&invite_json) {
                Ok(r) => r,
                Err(e) => {
                    return CommandOutput::failure(
                        format!("invalid invite JSON: {}", e),
                        vec![],
                        (),
                    )
                }
            };

            match GossipService::join_channel(&node_id, &display_name, &req).await {
                Ok(channel) => CommandOutput::success("joined channel", channel),
                Err(e) => CommandOutput::failure(
                    format!("failed to join channel: {}", e),
                    vec![],
                    (),
                ),
            }
        }

        GossipAction::Leave { topic_id } => {
            match GossipService::leave_channel(&topic_id).await {
                Ok(()) => CommandOutput::success("left channel", ()),
                Err(e) => CommandOutput::failure(
                    format!("failed to leave channel: {}", e),
                    vec![],
                    (),
                ),
            }
        }

        GossipAction::Messages { topic_id, limit } => {
            match GossipService::get_messages(&topic_id, None, Some(limit)).await {
                Ok(response) => CommandOutput::success("messages", response),
                Err(e) => CommandOutput::failure(
                    format!("failed to get messages: {}", e),
                    vec![],
                    (),
                ),
            }
        }

        GossipAction::Members { topic_id } => match repository::list_members(&topic_id).await {
            Ok(members) => CommandOutput::success("members", members),
            Err(e) => CommandOutput::failure(
                format!("failed to list members: {}", e),
                vec![],
                (),
            ),
        },
    }
}
