// gossip store — message actions + incoming message handler

import * as db from "../gossipDb";
import * as transport from "../gossipTransport";
import type {
  GossipChannelMember,
  GossipMessage,
  GossipReaction,
  GossipProfile,
  GossipEnvelope,
} from "freqhole-api-client";
import { schema } from "freqhole-api-client";
import {
  channels, setChannels,
  activeTopicId,
  messagesByTopic, setMessagesByTopic,
  reactionsByTopic, setReactionsByTopic,
  membersByTopic, setMembersByTopic,
  setUnread,
  profile,
  friends, setFriends,
  generateId, nowUnix, safeJsonParse, stringifyPayload,
} from "./state";
import { debug, info, warn } from "../../utils/logger";

// ============================================================================
// outgoing message actions
// ============================================================================

export async function sendMessage(
  text: string | null,
  items: any[],
): Promise<void> {
  const tid = activeTopicId();
  if (!tid) return;

  if (text && text.length > 1024) text = text.slice(0, 1024);
  if (items.length > 10) items = items.slice(0, 10);

  debug("gossip-store", `send message on ${tid.slice(0, 16)}, text=${text?.slice(0, 30)}, items=${items.length}`);

  const p = profile();
  const now = nowUnix();

  const msg: GossipMessage = {
    message_id: generateId(),
    topic_id: tid,
    sender_node_id: p?.node_id ?? "local",
    sender_name: p?.display_name ?? null,
    msg_type: "MusicShare",
    payload: stringifyPayload("MusicShare", { text, items }),
    timestamp: now,
    received_at: now,
    deleted_at: null,
  };

  try {
    await db.putMessages([msg]);
    info("gossip-store", `persisted message ${msg.message_id.slice(0, 8)} to IDB`);
  } catch (e) {
    console.error("[gossip-store] IDB putMessages failed:", e);
  }
  setMessagesByTopic(tid, [...(messagesByTopic[tid] ?? []), msg]);

  setChannels((prev) =>
    prev.map((c) =>
      c.topic_id === tid ? { ...c, last_message_at: now } : c,
    ),
  );
  const updated = channels().find((c) => c.topic_id === tid);
  if (updated) await db.putChannel(updated);

  try {
    await transport.broadcast(tid, {
      msg_type: "MusicShare",
      sender_node_id: msg.sender_node_id,
      sender_name: msg.sender_name ?? "anonymous",
      timestamp: now,
      message_id: msg.message_id,
      payload: msg.payload,
    });
  } catch (e) {
    warn("gossip-store", "broadcast failed (message saved locally):", e);
  }
}

export async function deleteMessage(messageId: string): Promise<void> {
  const tid = activeTopicId();
  if (!tid) return;

  const now = nowUnix();
  setMessagesByTopic(
    tid,
    (messagesByTopic[tid] ?? []).map((m) =>
      m.message_id === messageId ? { ...m, deleted_at: now } : m,
    ),
  );

  const updated = (messagesByTopic[tid] ?? []).find((m) => m.message_id === messageId);
  if (updated) await db.putMessages([updated]);

  const p = profile();
  try {
    await transport.broadcast(tid, {
      msg_type: "MessageDeleted",
      sender_node_id: p?.node_id ?? "local",
      sender_name: p?.display_name ?? "anonymous",
      timestamp: now,
      message_id: generateId(),
      payload: stringifyPayload("MessageDeleted", { target_message_id: messageId }),
    });
  } catch {
    // not critical
  }
}

export async function react(targetMessageId: string, emoji: string): Promise<void> {
  const tid = activeTopicId();
  if (!tid) return;

  const p = profile();
  const senderNodeId = p?.node_id ?? "local";
  const now = nowUnix();

  const existing = (reactionsByTopic[tid] ?? []).find(
    (r) => r.target_message_id === targetMessageId && r.emoji === emoji && r.sender_node_id === senderNodeId
  );

  if (existing) {
    await db.deleteReaction(existing.message_id);
    setReactionsByTopic(tid, (reactionsByTopic[tid] ?? []).filter((r) => r.message_id !== existing.message_id));

    try {
      await transport.broadcast(tid, {
        msg_type: "ReactionRemoved",
        sender_node_id: senderNodeId,
        sender_name: p?.display_name ?? "anonymous",
        timestamp: now,
        message_id: existing.message_id,
        payload: stringifyPayload("ReactionRemoved", {
          target_message_id: targetMessageId,
          emoji,
        }),
      });
    } catch {
      // not critical
    }
    return;
  }

  const reaction: GossipReaction = {
    message_id: generateId(),
    topic_id: tid,
    target_message_id: targetMessageId,
    sender_node_id: senderNodeId,
    sender_name: p?.display_name ?? null,
    emoji,
    timestamp: now,
  };

  await db.putReactions([reaction]);
  setReactionsByTopic(tid, [...(reactionsByTopic[tid] ?? []), reaction]);

  try {
    await transport.broadcast(tid, {
      msg_type: "Reaction",
      sender_node_id: reaction.sender_node_id,
      sender_name: reaction.sender_name ?? "anonymous",
      timestamp: now,
      message_id: reaction.message_id,
      payload: stringifyPayload("Reaction", {
        target_message_id: targetMessageId,
        emoji,
      }),
    });
  } catch {
    // not critical
  }
}

// ============================================================================
// incoming message handler (called by transport layer)
// ============================================================================

export async function onIncomingMessage(envelope: GossipEnvelope, topicId: string): Promise<void> {
  debug("gossip-store", `incoming ${envelope.msg_type} from ${envelope.sender_node_id?.slice(0, 16)} on ${topicId.slice(0, 16)}`);
  const now = nowUnix();

  switch (envelope.msg_type) {
    case "MusicShare": {
      if ((messagesByTopic[topicId] ?? []).some((m) => m.message_id === envelope.message_id)) {
        debug("gossip-store", `dedup: skipping ${envelope.msg_type} ${envelope.message_id.slice(0, 8)}`);
        break;
      }
      const msg: GossipMessage = {
        message_id: envelope.message_id,
        topic_id: topicId,
        sender_node_id: envelope.sender_node_id,
        sender_name: envelope.sender_name,
        msg_type: envelope.msg_type,
        payload: envelope.payload,
        timestamp: envelope.timestamp,
        received_at: now,
        deleted_at: null,
      };
      await db.putMessages([msg]);
      setMessagesByTopic(topicId, [...(messagesByTopic[topicId] ?? []), msg]);

      setChannels((prev) =>
        prev.map((c) =>
          c.topic_id === topicId ? { ...c, last_message_at: now } : c,
        ),
      );
      const updated = channels().find((c) => c.topic_id === topicId);
      if (updated) await db.putChannel(updated);

      if (activeTopicId() !== topicId) {
        setUnread((prev) => {
          const next = new Set(prev);
          next.add(topicId);
          return next;
        });
      }
      break;
    }

    case "ChannelMeta": {
      const metaCh = channels().find((c) => c.topic_id === topicId);
      if (metaCh && metaCh.creator_node_id !== envelope.sender_node_id) {
      debug("gossip-store", `ignoring ChannelMeta from non-creator ${envelope.sender_node_id.slice(0, 16)}`);
        break;
      }
      {
        const result = schema.ChannelMetaPayloadSchema.safeParse(safeJsonParse(envelope.payload));
        if (!result.success) {
          warn("gossip-store", "invalid ChannelMeta payload", result.error.issues, envelope.payload);
          break;
        }
        const parsed = result.data;
        setChannels((prev) =>
          prev.map((c) =>
            c.topic_id === topicId
              ? {
                  ...c,
                  name: parsed.name ?? c.name,
                  description: parsed.description ?? c.description,
                  music_only: parsed.music_only ?? c.music_only,
                }
              : c,
          ),
        );
        const ch = channels().find((c) => c.topic_id === topicId);
        if (ch) await db.putChannel(ch);
      }
      break;
    }

    case "ChannelDestroyed": {
      const ch = channels().find((c) => c.topic_id === topicId);
      if (!ch || ch.creator_node_id !== envelope.sender_node_id) {
        warn("gossip-store", `ignoring ChannelDestroyed from non-creator ${envelope.sender_node_id.slice(0, 16)}`);
        break;
      }

      setChannels((prev) =>
        prev.map((c) => (c.topic_id === topicId ? { ...c, destroyed_at: envelope.timestamp } : c)),
      );
      const destroyed = channels().find((c) => c.topic_id === topicId);
      if (destroyed) await db.putChannel(destroyed);

      let reason: string | null = null;
      {
        const result = schema.ChannelDestroyedPayloadSchema.safeParse(safeJsonParse(envelope.payload));
        if (result.success) reason = result.data.reason ?? null;
      }

      const sysMsg: GossipMessage = {
        message_id: generateId(),
        topic_id: topicId,
        sender_node_id: envelope.sender_node_id,
        sender_name: envelope.sender_name,
        msg_type: "System",
        payload: JSON.stringify({
          text: reason
            ? `channel was closed by ${envelope.sender_name}: ${reason}`
            : `channel was closed by ${envelope.sender_name}`,
        }),
        timestamp: envelope.timestamp,
        received_at: now,
        deleted_at: null,
      };
      await db.putMessages([sysMsg]);
      setMessagesByTopic(topicId, [...(messagesByTopic[topicId] ?? []), sysMsg]);
      break;
    }

    case "Reaction": {
      if ((reactionsByTopic[topicId] ?? []).some((r) => r.message_id === envelope.message_id)) {
        debug("gossip-store", `dedup: skipping reaction ${envelope.message_id.slice(0, 8)}`);
        break;
      }
      const reaction: GossipReaction = {
        message_id: envelope.message_id,
        topic_id: topicId,
        target_message_id: "",
        sender_node_id: envelope.sender_node_id,
        sender_name: envelope.sender_name,
        emoji: "",
        timestamp: envelope.timestamp,
      };
      {
        const result = schema.ReactionPayloadSchema.safeParse(safeJsonParse(envelope.payload));
        if (!result.success) {
          warn("gossip-store", "invalid Reaction payload", result.error.issues, envelope.payload);
          return;
        }
        reaction.target_message_id = result.data.target_message_id;
        reaction.emoji = result.data.emoji;
      }
      await db.putReactions([reaction]);
      setReactionsByTopic(topicId, [...(reactionsByTopic[topicId] ?? []), reaction]);
      break;
    }

    case "ReactionRemoved": {
      const reactionId = envelope.message_id;
      const existingReaction = (reactionsByTopic[topicId] ?? []).find((r) => r.message_id === reactionId);
      if (existingReaction) {
        await db.deleteReaction(reactionId);
        setReactionsByTopic(topicId, (reactionsByTopic[topicId] ?? []).filter((r) => r.message_id !== reactionId));
      }
      break;
    }

    case "MessageDeleted": {
      const delResult = schema.MessageDeletedPayloadSchema.safeParse(safeJsonParse(envelope.payload));
      if (!delResult.success) {
        warn("gossip-store", "invalid MessageDeleted payload", delResult.error.issues, envelope.payload);
        break;
      }
      const targetId = delResult.data.target_message_id;
      const targetMsg = (messagesByTopic[topicId] ?? []).find((m) => m.message_id === targetId);
      if (!targetMsg) break;

      // only the original sender or the channel creator can delete a message
      const ch = channels().find((c) => c.topic_id === topicId);
      const isOriginalSender = envelope.sender_node_id === targetMsg.sender_node_id;
      const isCreator = ch && ch.creator_node_id === envelope.sender_node_id;
      if (!isOriginalSender && !isCreator) {
        warn("gossip-store", `rejecting MessageDeleted from ${envelope.sender_node_id.slice(0, 16)} — not sender or creator`);
        break;
      }

      setMessagesByTopic(
        topicId,
        (messagesByTopic[topicId] ?? []).map((m) =>
          m.message_id === targetId ? { ...m, deleted_at: envelope.timestamp } : m,
        ),
      );
      const deletedMsg = (messagesByTopic[topicId] ?? []).find((m) => m.message_id === targetId);
      if (deletedMsg) await db.putMessages([deletedMsg]);
      break;
    }

    case "MemberAdded": {
      try {
        const memberResult = schema.MemberPayloadSchema.safeParse(safeJsonParse(envelope.payload));
        if (!memberResult.success) {
          warn("gossip-store", "invalid member-added payload", memberResult.error.issues);
          break;
        }
        const parsed = memberResult.data;
        const member: GossipChannelMember = {
          topic_id: topicId,
          node_id: parsed.node_id ?? envelope.sender_node_id,
          display_name: parsed.display_name ?? envelope.sender_name,
          role: parsed.role ?? "member",
          joined_at: envelope.timestamp,
        };

        const existing = (membersByTopic[topicId] ?? []);
        const existingIdx = existing.findIndex((m) => m.node_id === member.node_id);
        if (existingIdx >= 0) {
          // member already known (e.g. from neighbor_up) — update display_name if we have a better one
          const prev = existing[existingIdx];
          if (member.display_name && member.display_name !== prev.display_name) {
            const updated = existing.map((m, i) => i === existingIdx ? { ...m, display_name: member.display_name } : m);
            setMembersByTopic(topicId, updated);
            await db.putMembers(topicId, [{ ...prev, display_name: member.display_name }]);
          }
          break;
        }

        await db.putMembers(topicId, [member]);
        setMembersByTopic(topicId, [...existing, member]);

        const sysMsg: GossipMessage = {
          message_id: generateId(),
          topic_id: topicId,
          sender_node_id: envelope.sender_node_id,
          sender_name: envelope.sender_name,
          msg_type: "System",
          payload: JSON.stringify({ text: `${member.display_name ?? "someone"} joined the channel` }),
          timestamp: envelope.timestamp,
          received_at: now,
          deleted_at: null,
        };
        await db.putMessages([sysMsg]);
        setMessagesByTopic(topicId, [...(messagesByTopic[topicId] ?? []), sysMsg]);

        // if we are the creator, broadcast authoritative ChannelMeta so the joiner gets latest state
        const metaProfile = profile();
        const metaNodeId = metaProfile?.node_id ?? "local";
        const memberCh = channels().find((c) => c.topic_id === topicId);
        if (memberCh && memberCh.creator_node_id === metaNodeId) {
          try {
            await transport.broadcast(topicId, {
              msg_type: "ChannelMeta",
              sender_node_id: metaNodeId,
              sender_name: metaProfile?.display_name ?? "anonymous",
              timestamp: nowUnix(),
              message_id: generateId(),
              payload: stringifyPayload("ChannelMeta", {
                name: memberCh.name,
                description: memberCh.description,
                music_only: memberCh.music_only,
                creator_node_id: memberCh.creator_node_id,
              }),
            });
          } catch {
            // not critical
          }
        }
      } catch {
        warn("gossip-store", "invalid member-added payload", envelope.payload);
      }
      break;
    }

    case "ProfileUpdate": {
      const profResult = schema.ProfileUpdatePayloadSchema.safeParse(safeJsonParse(envelope.payload));
      if (!profResult.success) {
        warn("gossip-store", "invalid profile-update payload", profResult.error.issues);
        break;
      }
      const newName = profResult.data.display_name ?? envelope.sender_name;
      const peerProfile: GossipProfile = {
        node_id: envelope.sender_node_id,
        display_name: newName,
        avatar_blob: profResult.data.avatar_blob ?? null,
        updated_at: envelope.timestamp,
      };
      await db.putProfile(peerProfile);

      // update display name in all channel member lists
      for (const ch of channels()) {
        const members = membersByTopic[ch.topic_id] ?? [];
        const idx = members.findIndex((m) => m.node_id === envelope.sender_node_id);
        if (idx >= 0 && members[idx].display_name !== newName) {
          const updated = members.map((m) =>
            m.node_id === envelope.sender_node_id ? { ...m, display_name: newName } : m,
          );
          setMembersByTopic(ch.topic_id, updated);
          await db.putMembers(ch.topic_id, [{ ...members[idx], display_name: newName }]);
        }
      }

      // update friend display name if known
      const friend = friends().find((f) => f.node_id === envelope.sender_node_id);
      if (friend && friend.display_name !== newName) {
        const updatedFriend = { ...friend, display_name: newName };
        await db.putFriend(updatedFriend);
        setFriends((prev) => prev.map((f) => f.node_id === envelope.sender_node_id ? updatedFriend : f));
      }
      break;
    }

    case "MemberRemoved": {
      const memberResult = schema.MemberPayloadSchema.safeParse(safeJsonParse(envelope.payload));
      if (!memberResult.success) {
        warn("gossip-store", "invalid MemberRemoved payload", memberResult.error.issues);
        break;
      }
      const removedNodeId = memberResult.data.node_id ?? envelope.sender_node_id;
      const removedName = memberResult.data.display_name ?? envelope.sender_name;

      // remove from member list
      const currentMembers = membersByTopic[topicId] ?? [];
      if (currentMembers.some((m) => m.node_id === removedNodeId)) {
        setMembersByTopic(topicId, currentMembers.filter((m) => m.node_id !== removedNodeId));
      }

      // show system message
      const leftMsg: GossipMessage = {
        message_id: generateId(),
        topic_id: topicId,
        sender_node_id: envelope.sender_node_id,
        sender_name: envelope.sender_name,
        msg_type: "System",
        payload: JSON.stringify({ text: `${removedName ?? "someone"} left the channel` }),
        timestamp: envelope.timestamp,
        received_at: now,
        deleted_at: null,
      };
      await db.putMessages([leftMsg]);
      setMessagesByTopic(topicId, [...(messagesByTopic[topicId] ?? []), leftMsg]);
      break;
    }

    default:
      warn("gossip-store", `unhandled msg_type: ${envelope.msg_type}`);
  }
}
