//! gossip repository — SQLite persistence for channels, messages, members, reactions

use crate::database::connect;
use crate::error::GrimoireResult;
use crate::gossip::models::*;

/// create a new gossip channel
pub async fn create_channel(channel: &GossipChannel) -> GrimoireResult<()> {
    let pool = connect().await?;
    sqlx::query(
        "INSERT INTO gossip_channelz (topic_id, name, description, creator_node_id, created_at, settings, music_only)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&channel.topic_id)
    .bind(&channel.name)
    .bind(&channel.description)
    .bind(&channel.creator_node_id)
    .bind(channel.created_at)
    .bind(&channel.settings)
    .bind(channel.music_only)
    .execute(&pool)
    .await?;
    Ok(())
}

/// get a channel by topic_id
pub async fn get_channel(topic_id: &str) -> GrimoireResult<Option<GossipChannel>> {
    let pool = connect().await?;
    let channel = sqlx::query_as::<_, GossipChannel>(
        "SELECT * FROM gossip_channelz WHERE topic_id = ?",
    )
    .bind(topic_id)
    .fetch_optional(&pool)
    .await?;
    Ok(channel)
}

/// list all channels
pub async fn list_channels() -> GrimoireResult<Vec<GossipChannel>> {
    let pool = connect().await?;
    let channels = sqlx::query_as::<_, GossipChannel>(
        "SELECT * FROM gossip_channelz ORDER BY last_message_at DESC NULLS LAST, created_at DESC",
    )
    .fetch_all(&pool)
    .await?;
    Ok(channels)
}

/// delete (leave) a channel
pub async fn delete_channel(topic_id: &str) -> GrimoireResult<()> {
    let pool = connect().await?;
    sqlx::query("DELETE FROM gossip_channelz WHERE topic_id = ?")
        .bind(topic_id)
        .execute(&pool)
        .await?;
    Ok(())
}

/// update last_message_at timestamp
pub async fn update_last_message_at(topic_id: &str, timestamp: i64) -> GrimoireResult<()> {
    let pool = connect().await?;
    sqlx::query("UPDATE gossip_channelz SET last_message_at = ? WHERE topic_id = ?")
        .bind(timestamp)
        .bind(topic_id)
        .execute(&pool)
        .await?;
    Ok(())
}

// --- members ---

/// add a member to a channel
pub async fn add_member(member: &GossipChannelMember) -> GrimoireResult<()> {
    let pool = connect().await?;
    sqlx::query(
        "INSERT OR REPLACE INTO gossip_channel_memberz (topic_id, node_id, display_name, role, joined_at)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(&member.topic_id)
    .bind(&member.node_id)
    .bind(&member.display_name)
    .bind(&member.role)
    .bind(member.joined_at)
    .execute(&pool)
    .await?;
    Ok(())
}

/// list members of a channel
pub async fn list_members(topic_id: &str) -> GrimoireResult<Vec<GossipChannelMember>> {
    let pool = connect().await?;
    let members = sqlx::query_as::<_, GossipChannelMember>(
        "SELECT * FROM gossip_channel_memberz WHERE topic_id = ? ORDER BY joined_at",
    )
    .bind(topic_id)
    .fetch_all(&pool)
    .await?;
    Ok(members)
}

/// remove a member from a channel
pub async fn remove_member(topic_id: &str, node_id: &str) -> GrimoireResult<()> {
    let pool = connect().await?;
    sqlx::query("DELETE FROM gossip_channel_memberz WHERE topic_id = ? AND node_id = ?")
        .bind(topic_id)
        .bind(node_id)
        .execute(&pool)
        .await?;
    Ok(())
}

// --- messages ---

/// check if a message already exists (deduplication)
pub async fn message_exists(message_id: &str) -> GrimoireResult<bool> {
    let pool = connect().await?;
    let row: (i64,) =
        sqlx::query_as("SELECT COUNT(*) FROM gossip_messagez WHERE message_id = ?")
            .bind(message_id)
            .fetch_one(&pool)
            .await?;
    Ok(row.0 > 0)
}

/// insert a gossip message
pub async fn insert_message(msg: &GossipMessage) -> GrimoireResult<()> {
    let pool = connect().await?;
    sqlx::query(
        "INSERT OR IGNORE INTO gossip_messagez
         (message_id, topic_id, sender_node_id, sender_name, msg_type, payload, timestamp, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&msg.message_id)
    .bind(&msg.topic_id)
    .bind(&msg.sender_node_id)
    .bind(&msg.sender_name)
    .bind(&msg.msg_type)
    .bind(&msg.payload)
    .bind(msg.timestamp)
    .bind(msg.received_at)
    .execute(&pool)
    .await?;
    Ok(())
}

/// get messages for a channel, paginated by timestamp
pub async fn get_messages(
    topic_id: &str,
    before_timestamp: Option<i64>,
    limit: i64,
) -> GrimoireResult<Vec<GossipMessage>> {
    let pool = connect().await?;

    let messages = if let Some(before) = before_timestamp {
        sqlx::query_as::<_, GossipMessage>(
            "SELECT * FROM gossip_messagez
             WHERE topic_id = ? AND timestamp < ? AND deleted_at IS NULL
             ORDER BY timestamp DESC LIMIT ?",
        )
        .bind(topic_id)
        .bind(before)
        .bind(limit)
        .fetch_all(&pool)
        .await?
    } else {
        sqlx::query_as::<_, GossipMessage>(
            "SELECT * FROM gossip_messagez
             WHERE topic_id = ? AND deleted_at IS NULL
             ORDER BY timestamp DESC LIMIT ?",
        )
        .bind(topic_id)
        .bind(limit)
        .fetch_all(&pool)
        .await?
    };

    Ok(messages)
}

/// soft-delete a message (set deleted_at)
pub async fn soft_delete_message(
    message_id: &str,
    sender_node_id: &str,
) -> GrimoireResult<bool> {
    let pool = connect().await?;
    let result = sqlx::query(
        "UPDATE gossip_messagez SET deleted_at = unixepoch()
         WHERE message_id = ? AND sender_node_id = ?",
    )
    .bind(message_id)
    .bind(sender_node_id)
    .execute(&pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

/// mark a message as deleted (from MessageDeleted gossip event)
pub async fn mark_message_deleted(message_id: &str) -> GrimoireResult<()> {
    let pool = connect().await?;
    sqlx::query(
        "UPDATE gossip_messagez SET deleted_at = unixepoch() WHERE message_id = ?",
    )
    .bind(message_id)
    .execute(&pool)
    .await?;
    Ok(())
}

// --- reactions ---

/// insert a reaction
pub async fn insert_reaction(reaction: &GossipReaction) -> GrimoireResult<()> {
    let pool = connect().await?;
    sqlx::query(
        "INSERT OR IGNORE INTO gossip_reactionz
         (message_id, topic_id, target_message_id, sender_node_id, sender_name, emoji, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&reaction.message_id)
    .bind(&reaction.topic_id)
    .bind(&reaction.target_message_id)
    .bind(&reaction.sender_node_id)
    .bind(&reaction.sender_name)
    .bind(&reaction.emoji)
    .bind(reaction.timestamp)
    .execute(&pool)
    .await?;
    Ok(())
}

/// get reactions for messages in a channel
pub async fn get_reactions_for_messages(
    topic_id: &str,
    message_ids: &[String],
) -> GrimoireResult<Vec<GossipReaction>> {
    if message_ids.is_empty() {
        return Ok(vec![]);
    }

    let pool = connect().await?;
    let placeholders = message_ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let query = format!(
        "SELECT * FROM gossip_reactionz WHERE topic_id = ? AND target_message_id IN ({}) ORDER BY timestamp",
        placeholders
    );

    let mut q = sqlx::query_as::<_, GossipReaction>(&query).bind(topic_id);
    for id in message_ids {
        q = q.bind(id);
    }
    let reactions = q.fetch_all(&pool).await?;
    Ok(reactions)
}

/// delete a reaction
pub async fn delete_reaction(message_id: &str) -> GrimoireResult<()> {
    let pool = connect().await?;
    sqlx::query("DELETE FROM gossip_reactionz WHERE message_id = ?")
        .bind(message_id)
        .execute(&pool)
        .await?;
    Ok(())
}

// --- knock requests ---

/// create a knock request
pub async fn create_knock(
    topic_id: &str,
    node_id: &str,
    display_name: Option<&str>,
    message: Option<&str>,
) -> GrimoireResult<()> {
    let pool = connect().await?;
    sqlx::query(
        "INSERT OR REPLACE INTO gossip_knock_requestz (topic_id, node_id, display_name, message, status)
         VALUES (?, ?, ?, ?, 'pending')",
    )
    .bind(topic_id)
    .bind(node_id)
    .bind(display_name)
    .bind(message)
    .execute(&pool)
    .await?;
    Ok(())
}

/// list knock requests for a channel
pub async fn list_knocks(topic_id: &str) -> GrimoireResult<Vec<GossipKnockRequest>> {
    let pool = connect().await?;
    let knocks = sqlx::query_as::<_, GossipKnockRequest>(
        "SELECT * FROM gossip_knock_requestz WHERE topic_id = ? ORDER BY created_at DESC",
    )
    .bind(topic_id)
    .fetch_all(&pool)
    .await?;
    Ok(knocks)
}

/// update knock status
pub async fn update_knock_status(
    topic_id: &str,
    node_id: &str,
    status: &str,
) -> GrimoireResult<bool> {
    let pool = connect().await?;
    let result = sqlx::query(
        "UPDATE gossip_knock_requestz SET status = ?, processed_at = unixepoch()
         WHERE topic_id = ? AND node_id = ?",
    )
    .bind(status)
    .bind(topic_id)
    .bind(node_id)
    .execute(&pool)
    .await?;
    Ok(result.rows_affected() > 0)
}

// -- gossip profiles --

/// upsert a gossip profile (insert or update display name + avatar)
pub async fn upsert_profile(profile: &super::models::GossipProfile) -> GrimoireResult<()> {
    let pool = connect().await?;
    sqlx::query(
        "INSERT INTO gossip_profilez (node_id, display_name, avatar_blob, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(node_id) DO UPDATE SET
           display_name = excluded.display_name,
           avatar_blob = excluded.avatar_blob,
           updated_at = excluded.updated_at",
    )
    .bind(&profile.node_id)
    .bind(&profile.display_name)
    .bind(&profile.avatar_blob)
    .bind(profile.updated_at)
    .execute(&pool)
    .await?;
    Ok(())
}

/// get a gossip profile by node_id
pub async fn get_profile(node_id: &str) -> GrimoireResult<Option<super::models::GossipProfile>> {
    let pool = connect().await?;
    let profile = sqlx::query_as::<_, super::models::GossipProfile>(
        "SELECT * FROM gossip_profilez WHERE node_id = ?",
    )
    .bind(node_id)
    .fetch_optional(&pool)
    .await?;
    Ok(profile)
}

/// get all known gossip profiles
pub async fn get_all_profiles() -> GrimoireResult<Vec<super::models::GossipProfile>> {
    let pool = connect().await?;
    let profiles = sqlx::query_as::<_, super::models::GossipProfile>(
        "SELECT * FROM gossip_profilez ORDER BY display_name",
    )
    .fetch_all(&pool)
    .await?;
    Ok(profiles)
}
