// gossip store — message actions + incoming message handler

import * as db from "../gossipDb";
import * as transport from "../gossipTransport";
import type {
  GossipMessage,
  GossipReaction,
  GossipProfile,
  GossipEnvelope,
} from "freqhole-api-client";
import type { GossipChannelMember } from "../gossipTypes";
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

  // persist with delivered=0 (will be marked delivered on successful broadcast)
  const msgWithDelivered: db.StoredMessage = { ...msg, delivered: 0 };
  try {
    await db.putMessages([msgWithDelivered]);
    info("gossip-store", `persisted message ${msg.message_id.slice(0, 8)} to IDB`);
  } catch (e) {
    console.error("[gossip-store] IDB putMessages failed:", e);
  }
  // use msgWithDelivered so in-memory and IDB stay consistent
  setMessagesByTopic(tid, [...(messagesByTopic[tid] ?? []), msgWithDelivered]);

  setChannels((prev) =>
    prev.map((c) =>
      c.topic_id === tid ? { ...c, last_message_at: now } : c,
    ),
  );
  const updated = channels().find((c) => c.topic_id === tid);
  if (updated) await db.putChannel(updated);

  try {
    const hasPeers = transport.getTopicPeerCount(tid) > 0;
    await transport.broadcast(tid, {
      msg_type: "MusicShare",
      sender_node_id: msg.sender_node_id,
      sender_name: msg.sender_name ?? "anonymous",
      timestamp: now,
      message_id: msg.message_id,
      payload: msg.payload,
    });
    // mark delivered if peers were connected when we broadcast
    if (hasPeers) {
      await db.markMessagesDelivered([msg.message_id]);
    }
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
// read receipts — debounced outbound + per-message reader tracking
// ============================================================================

/** per-topic: map of message_id → list of members who have read up to that message */
export type ReadReceiptMap = Record<string, { node_id: string; display_name: string | null }[]>;

/** compute read receipt positions for the active topic.
 *  returns a map: message_id → list of members whose "last read" is that message.
 *  only includes other members (not self). */
export function readReceiptsForTopic(topicId: string | null, currentNodeId: string): ReadReceiptMap {
  if (!topicId) return {};
  const members = membersByTopic[topicId] ?? [];
  const result: ReadReceiptMap = {};
  for (const m of members) {
    if (m.node_id === currentNodeId) continue;
    const msgId = m.last_read_message_id;
    if (!msgId) continue;
    if (!result[msgId]) result[msgId] = [];
    result[msgId].push({ node_id: m.node_id, display_name: m.display_name });
  }
  return result;
}

let _readReceiptTimer: ReturnType<typeof setTimeout> | null = null;

/** send a read receipt for the latest message in the active topic (debounced 500ms) */
export function sendReadReceipt(): void {
  if (_readReceiptTimer) clearTimeout(_readReceiptTimer);
  _readReceiptTimer = setTimeout(() => {
    _readReceiptTimer = null;
    _sendReadReceiptNow();
  }, 500);
}

async function _sendReadReceiptNow(): Promise<void> {
  const tid = activeTopicId();
  if (!tid) return;

  const msgs = messagesByTopic[tid] ?? [];
  if (!msgs.length) return;

  // find the latest non-system message
  const latest = [...msgs].reverse().find((m) => m.msg_type !== "System" && !m.deleted_at);
  if (!latest) return;

  const p = profile();
  const myNodeId = p?.node_id ?? "local";
  if (myNodeId === "local") return;

  // skip if we already sent a receipt for this message (avoid redundant broadcasts)
  const myMember = (membersByTopic[tid] ?? []).find((m) => m.node_id === myNodeId);
  if (myMember?.last_read_message_id === latest.message_id) return;

  // update our own member record locally + persist to IDB
  const members = membersByTopic[tid] ?? [];
  const idx = members.findIndex((m) => m.node_id === myNodeId);
  if (idx >= 0) {
    const updatedMember = { ...members[idx], last_read_message_id: latest.message_id, last_read_at: latest.timestamp };
    const updated = members.map((m, i) => i === idx ? updatedMember : m);
    setMembersByTopic(tid, updated);
    await db.putMembers(tid, [updatedMember]);
  }

  try {
    await transport.broadcast(tid, {
      msg_type: "ReadReceipt",
      sender_node_id: myNodeId,
      sender_name: p?.display_name ?? "anonymous",
      timestamp: nowUnix(),
      message_id: generateId(),
      payload: JSON.stringify({
        latest_message_id: latest.message_id,
        latest_timestamp: latest.timestamp,
      }),
    });
    debug("gossip-store", `sent read receipt for ${latest.message_id.slice(0, 8)}`);
  } catch {
    // not critical
  }
}

// ============================================================================
// incoming message handler (called by transport layer)
// ============================================================================

/** convert a raw envelope into a GossipMessage for IDB storage (sync-only, not displayed) */
function envelopeToSyncMsg(envelope: GossipEnvelope, topicId: string, now: number): GossipMessage {
  return {
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
}

export async function onIncomingMessage(envelope: GossipEnvelope, topicId: string): Promise<void> {
  debug("gossip-store", `incoming ${envelope.msg_type} from ${envelope.sender_node_id?.slice(0, 16)} on ${topicId.slice(0, 16)}`);
  const now = nowUnix();

  switch (envelope.msg_type) {
    case "MusicShare": {
      if ((messagesByTopic[topicId] ?? []).some((m) => m.message_id === envelope.message_id)) {
        debug("gossip-store", `dedup: skipping ${envelope.msg_type} ${envelope.message_id.slice(0, 8)}`);
        break;
      }
      // IDB-level dedup: after page reload in-memory is empty, but IDB may
      // already have this message. check before writing to avoid overwriting
      // our authoritative local copy (which may have extra fields like delivered).
      const existing = await db.getMessageById(envelope.message_id);
      if (existing) {
        debug("gossip-store", `dedup (IDB): skipping ${envelope.msg_type} ${envelope.message_id.slice(0, 8)}`);
        // still add to in-memory store if not already there (channel was just selected)
        if (!(messagesByTopic[topicId] ?? []).some((m) => m.message_id === envelope.message_id)) {
          setMessagesByTopic(topicId, [...(messagesByTopic[topicId] ?? []), existing as GossipMessage]);
        }
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
      } else {
        // user is viewing this channel — auto-send read receipt (debounced)
        sendReadReceipt();
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
      // store envelope in IDB for sync (not displayed)
      await db.putMessages([envelopeToSyncMsg(envelope, topicId, now)]);
      break;
    }

    case "ChannelDestroyed": {
      const ch = channels().find((c) => c.topic_id === topicId);
      if (!ch || ch.creator_node_id !== envelope.sender_node_id) {
        warn("gossip-store", `ignoring ChannelDestroyed from non-creator ${envelope.sender_node_id.slice(0, 16)}`);
        break;
      }
      // idempotent: skip if already destroyed (e.g. received via sync)
      if (ch.destroyed_at) {
        debug("gossip-store", `channel already destroyed, skipping duplicate ChannelDestroyed`);
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
        message_id: `sys-${envelope.message_id}`,
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
      // store envelope in IDB for sync (not displayed)
      await db.putMessages([envelopeToSyncMsg(envelope, topicId, now)]);
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

      // store envelope in IDB for sync even if target not found in-memory
      await db.putMessages([envelopeToSyncMsg(envelope, topicId, now)]);

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
          // member already known (e.g. from neighbor_up or previous join) — update display_name
          const prev = existing[existingIdx];
          if (member.display_name && member.display_name !== prev.display_name) {
            const updated = existing.map((m, i) => i === existingIdx ? { ...m, display_name: member.display_name } : m);
            setMembersByTopic(topicId, updated);
            await db.putMembers(topicId, [{ ...prev, display_name: member.display_name }]);
          }
        } else {
          await db.putMembers(topicId, [member]);
          setMembersByTopic(topicId, [...existing, member]);
        }

        // show system message for join/rejoin (dedup by message_id)
        const joinMsgId = `sys-${envelope.message_id}`;
        if (!(messagesByTopic[topicId] ?? []).some((m) => m.message_id === joinMsgId)) {
          const sysMsg: GossipMessage = {
            message_id: joinMsgId,
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
        }

        // NOTE: ephemeral presence — NOT stored to IDB for sync.
        // member state is maintained via neighbor_up/down events and heartbeat sweep.

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

      // NOTE: ephemeral presence — NOT stored to IDB for sync.
      // storing MemberRemoved caused false "left the channel" system messages
      // when synced to peers who then process them via onIncomingMessage.

      // show system message (deterministic ID for dedup)
      const leftMsgId = `sys-${envelope.message_id}`;
      if ((messagesByTopic[topicId] ?? []).some((m) => m.message_id === leftMsgId)) break;
      const leftMsg: GossipMessage = {
        message_id: leftMsgId,
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

    case "SyncRequest": {
      // peer is asking us for messages since a timestamp
      const reqResult = schema.SyncRequestPayloadSchema.safeParse(safeJsonParse(envelope.payload));
      if (!reqResult.success) {
        warn("gossip-store", "invalid SyncRequest payload", reqResult.error.issues, envelope.payload);
        break;
      }
      const reqPayload = reqResult.data;

      // only respond if addressed to us (or no `to` field = broadcast request)
      const myNodeId = profile()?.node_id;
      if (reqPayload.to && myNodeId && reqPayload.to !== myNodeId) {
        debug("gossip-store", `ignoring SyncRequest addressed to ${reqPayload.to.slice(0, 16)}, not us`);
        break;
      }

      const limit = Math.min(reqPayload.limit ?? 50, 100);
      let localMsgs: db.StoredMessage[];
      if (reqPayload.before) {
        // backward pagination: get messages before this timestamp
        localMsgs = await db.getMessagesByTopicBefore(topicId, reqPayload.before, limit);
      } else {
        // forward: get messages since the requested timestamp (with 30s overlap for clock skew)
        const sinceSafe = Math.max(0, reqPayload.since - 30);
        localMsgs = await db.getMessagesByTopicSince(topicId, sinceSafe, limit);
      }

      // only sync content types — ephemeral presence (MemberAdded, MemberRemoved,
      // Heartbeat, ReadReceipt) is handled by live transport events
      const SYNCABLE_TYPES = new Set(["MusicShare", "ChannelMeta", "ChannelDestroyed", "MessageDeleted", "Reaction", "ReactionRemoved", "ProfileUpdate"]);
      const envelopes: string[] = localMsgs
        .filter((m) => SYNCABLE_TYPES.has(m.msg_type) && !m.deleted_at)
        .map((m) => JSON.stringify({
          msg_type: m.msg_type,
          sender_node_id: m.sender_node_id,
          sender_name: m.sender_name ?? "anonymous",
          timestamp: m.timestamp,
          message_id: m.message_id,
          payload: m.payload,
        }));

      if (envelopes.length > 0) {
        const p = profile();
        try {
          await transport.broadcast(topicId, {
            msg_type: "SyncResponse",
            sender_node_id: p?.node_id ?? "local",
            sender_name: p?.display_name ?? "anonymous",
            timestamp: nowUnix(),
            message_id: generateId(),
            payload: JSON.stringify({
              messages: envelopes,
              has_more: localMsgs.length >= limit,
            }),
          });
          debug("gossip-store", `responded to SyncRequest with ${envelopes.length} messages`);
        } catch {
          warn("gossip-store", "failed to send SyncResponse");
        }
      }
      break;
    }

    case "SyncResponse": {
      // peer is sending us messages we may have missed
      const respResult = schema.SyncResponsePayloadSchema.safeParse(safeJsonParse(envelope.payload));
      if (!respResult.success) {
        warn("gossip-store", "invalid SyncResponse payload", respResult.error.issues, envelope.payload);
        break;
      }
      const respPayload = respResult.data;
      if (!respPayload.messages.length) break;

      debug("gossip-store", `received SyncResponse with ${respPayload.messages.length} messages (has_more=${respPayload.has_more})`);

      const myId = profile()?.node_id;
      let oldestTimestamp = Infinity;
      for (const envStr of respPayload.messages) {
        const parsed = safeJsonParse(envStr);
        if (!parsed || typeof parsed !== "object") continue;

        // feed each envelope back through onIncomingMessage for dedup + storage
        const syncEnv = parsed as GossipEnvelope;
        if (!syncEnv.msg_type || !syncEnv.message_id) continue;

        // skip our own messages — our local copy is authoritative
        if (myId && syncEnv.sender_node_id === myId) {
          debug("gossip-store", `sync: skipping own ${syncEnv.msg_type} ${syncEnv.message_id.slice(0, 8)}`);
          if (syncEnv.timestamp < oldestTimestamp) oldestTimestamp = syncEnv.timestamp;
          continue;
        }

        if (syncEnv.timestamp < oldestTimestamp) oldestTimestamp = syncEnv.timestamp;
        await onIncomingMessage(syncEnv, topicId);
      }

      // if more messages exist, send a follow-up SyncRequest for the next page
      if (respPayload.has_more && oldestTimestamp < Infinity) {
        const p = profile();
        const myId = p?.node_id ?? "local";
        try {
          await transport.broadcast(topicId, {
            msg_type: "SyncRequest",
            sender_node_id: myId,
            sender_name: p?.display_name ?? "anonymous",
            timestamp: nowUnix(),
            message_id: generateId(),
            payload: stringifyPayload("SyncRequest", {
              since: 0,
              before: oldestTimestamp,
              limit: 50,
              to: envelope.sender_node_id, // ask the same peer for the next page
            }),
          });
          debug("gossip-store", `sent follow-up SyncRequest (before=${oldestTimestamp}) to ${envelope.sender_node_id.slice(0, 16)}`);
        } catch {
          warn("gossip-store", "follow-up SyncRequest failed");
        }
      }
      break;
    }

    case "ReadReceipt": {
      // peer is telling us their latest read position
      const receiptResult = schema.ReadReceiptPayloadSchema.safeParse(safeJsonParse(envelope.payload));
      if (!receiptResult.success) {
        warn("gossip-store", "invalid ReadReceipt payload", receiptResult.error.issues);
        break;
      }
      const receiptPayload = receiptResult.data;

      debug("gossip-store", `ReadReceipt from ${envelope.sender_node_id.slice(0, 16)}: ${receiptPayload.latest_message_id.slice(0, 8)} @ ${receiptPayload.latest_timestamp}`);

      // update the member's last-read position in our member list + persist to IDB
      const members = membersByTopic[topicId] ?? [];
      const memberIdx = members.findIndex((m) => m.node_id === envelope.sender_node_id);
      if (memberIdx >= 0) {
        const updatedMember = { ...members[memberIdx], last_read_message_id: receiptPayload.latest_message_id, last_read_at: receiptPayload.latest_timestamp };
        const updated = members.map((m, i) => i === memberIdx ? updatedMember : m);
        setMembersByTopic(topicId, updated);
        await db.putMembers(topicId, [updatedMember]);
      }
      break;
    }

    case "Heartbeat": {
      // peer is announcing they're still online
      const hbResult = schema.HeartbeatPayloadSchema.safeParse(safeJsonParse(envelope.payload));
      const hbMembers = membersByTopic[topicId] ?? [];
      const hbIdx = hbMembers.findIndex((m) => m.node_id === envelope.sender_node_id);
      if (hbIdx >= 0) {
        const updatedMember = {
          ...hbMembers[hbIdx],
          last_heartbeat: envelope.timestamp,
          online_since: hbResult.success ? hbResult.data.online_since : null,
        };
        const updated = hbMembers.map((m, i) => i === hbIdx ? updatedMember : m);
        setMembersByTopic(topicId, updated);
        await db.putMembers(topicId, [updatedMember]);
      }
      break;
    }

    default:
      warn("gossip-store", `unhandled msg_type: ${envelope.msg_type}`);
  }
}
