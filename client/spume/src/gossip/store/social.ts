// gossip store — profile, friends, and neighbor event actions

import * as db from "../gossipDb";
import * as transport from "../gossipTransport";
import type { GossipProfile } from "freqhole-api-client";
import type { GossipFriend } from "../gossipTypes";
import type { GossipChannelMember } from "freqhole-api-client";
import {
  profile, setProfile,
  friends, setFriends,
  channels,
  membersByTopic, setMembersByTopic,
  messagesByTopic,
  nowUnix, generateId, stringifyPayload,
} from "./state";
import { debug, info, warn } from "../../utils/logger";

// ============================================================================
// profile actions
// ============================================================================

const LOCAL_PROFILE_KEY = "local";

export async function loadProfile(): Promise<void> {
  try {
    // try loading by the "local" key first, then fall back to finding any local profile
    let p = await db.getProfile(LOCAL_PROFILE_KEY);
    if (!p) {
      // profile may have been saved under the midden node_id — find it
      const all = await db.getAllProfiles();
      if (all.length > 0) p = all[0];
    }
    setProfile(p as GossipProfile | null ?? null);
  } catch (e) {
    warn("gossip-store", "failed to load profile:", e);
  }
}

export async function saveProfile(displayName: string, avatarBlob: string | null): Promise<void> {
  // use midden node_id if available, otherwise keep existing or fall back to "local"
  let nodeId = profile()?.node_id ?? LOCAL_PROFILE_KEY;
  try {
    nodeId = await transport.getNodeId();
  } catch {
    // midden not available yet — use existing node_id
  }

  const now = nowUnix();
  const p: GossipProfile = {
    node_id: nodeId,
    display_name: displayName,
    avatar_blob: avatarBlob,
    updated_at: now,
  };
  await db.putProfile(p);
  setProfile(p);
  info("gossip-store", `profile saved: ${displayName} (node: ${nodeId.slice(0, 16)}...)`);

  // broadcast ProfileUpdate to all subscribed topics so peers learn the new name
  const topicIds = transport.getSubscribedTopicIds();
  for (const tid of topicIds) {
    try {
      await transport.broadcast(tid, {
        msg_type: "ProfileUpdate",
        sender_node_id: nodeId,
        sender_name: displayName,
        timestamp: now,
        message_id: generateId(),
        payload: stringifyPayload("ProfileUpdate", {
          display_name: displayName,
          avatar_blob: avatarBlob,
        }),
      });
    } catch {
      // not critical — peers will learn on next message
    }
  }
}

// ============================================================================
// friends actions
// ============================================================================

/** add a friend if not already known and not self */
export async function addFriend(nodeId: string, displayName?: string): Promise<void> {
  const self = profile()?.node_id;
  if (!nodeId || nodeId === "local" || nodeId === self) return;

  // skip if already a friend
  const existing = friends().find((f) => f.node_id === nodeId);
  if (existing) return;

  const friend: GossipFriend = {
    node_id: nodeId,
    display_name: displayName ?? nodeId.slice(0, 12),
    avatar_url: null,
    last_seen: nowUnix(),
    online: false,
  };
  await db.putFriend(friend);
  setFriends((prev) => [...prev, friend]);
  debug("gossip-store", `added friend: ${friend.display_name} (${nodeId.slice(0, 16)}...)`);
}

export async function removeFriend(nodeId: string): Promise<void> {
  await db.deleteFriend(nodeId);
  setFriends((prev) => prev.filter((f) => f.node_id !== nodeId));
}

/** update a friend's display name (e.g. when we learn it from a ProfileUpdate) */
export async function updateFriend(nodeId: string, updates: Partial<GossipFriend>): Promise<void> {
  const existing = friends().find((f) => f.node_id === nodeId);
  if (!existing) return;
  const updated = { ...existing, ...updates };
  await db.putFriend(updated);
  setFriends((prev) => prev.map((f) => f.node_id === nodeId ? updated : f));
}

// ============================================================================
// neighbor events (peer connect / disconnect)
// ============================================================================

/** called by transport when a peer connects or disconnects on a topic */
export async function onNeighborChange(topicId: string, nodeId: string, isUp: boolean): Promise<void> {
  const now = nowUnix();

  // auto-add peer as channel member on connect
  if (isUp) {
    const existing = membersByTopic[topicId] ?? [];
    if (!existing.some((m) => m.node_id === nodeId)) {
      // try to resolve a display name from known profiles or friends
      let displayName: string | null = null;
      try {
        const knownProfile = await db.getProfile(nodeId);
        if (knownProfile?.display_name) displayName = knownProfile.display_name;
      } catch { /* ignore */ }
      if (!displayName) {
        const friend = friends().find((f) => f.node_id === nodeId);
        if (friend?.display_name) displayName = friend.display_name;
      }

      const member: GossipChannelMember = {
        topic_id: topicId,
        node_id: nodeId,
        display_name: displayName ?? nodeId.slice(0, 12),
        role: "member",
        joined_at: now,
      };
      db.putMembers(topicId, [member]);
      setMembersByTopic(topicId, [...existing, member]);
    }

    // if we are the channel creator, broadcast ChannelMeta so the new peer gets current state
    const p = profile();
    const myNodeId = p?.node_id ?? "local";
    const ch = channels().find((c) => c.topic_id === topicId);
    if (ch && ch.creator_node_id === myNodeId) {
      try {
        await transport.broadcast(topicId, {
          msg_type: "ChannelMeta",
          sender_node_id: myNodeId,
          sender_name: p?.display_name ?? "anonymous",
          timestamp: now,
          message_id: generateId(),
          payload: stringifyPayload("ChannelMeta", {
            name: ch.name,
            description: ch.description,
            music_only: ch.music_only,
            creator_node_id: ch.creator_node_id,
          }),
        });
      } catch {
        // not critical
      }
    }

    // --- outbox flush: re-broadcast messages that were sent while offline ---
    try {
      const undelivered = await db.getUndeliveredMessages(topicId);
      if (undelivered.length > 0) {
        info("gossip-store", `flushing ${undelivered.length} undelivered messages on ${topicId.slice(0, 16)}`);
        const deliveredIds: string[] = [];
        for (const m of undelivered) {
          try {
            await transport.broadcast(topicId, {
              msg_type: m.msg_type,
              sender_node_id: m.sender_node_id,
              sender_name: m.sender_name ?? "anonymous",
              timestamp: m.timestamp,
              message_id: m.message_id,
              payload: m.payload,
            });
            deliveredIds.push(m.message_id);
          } catch {
            warn("gossip-store", `failed to flush message ${m.message_id.slice(0, 8)}`);
          }
        }
        if (deliveredIds.length > 0) {
          await db.markMessagesDelivered(deliveredIds);
          info("gossip-store", `marked ${deliveredIds.length} messages as delivered`);
        }
      }
    } catch (e) {
      warn("gossip-store", "outbox flush failed:", e);
    }

    // --- sync request: ask the connecting peer for messages we may have missed ---
    try {
      const p2 = profile();
      const myId = p2?.node_id ?? "local";
      // find the latest message timestamp we have for this topic
      const topicMsgs = messagesByTopic[topicId] ?? [];
      const latestTs = topicMsgs.length > 0
        ? Math.max(...topicMsgs.map((m) => m.timestamp))
        : 0;

      if (latestTs > 0) {
        await transport.broadcast(topicId, {
          msg_type: "SyncRequest",
          sender_node_id: myId,
          sender_name: p2?.display_name ?? "anonymous",
          timestamp: now,
          message_id: generateId(),
          payload: JSON.stringify({
            since: latestTs,
            limit: 50,
            to: nodeId, // direct to the connecting peer
          }),
        });
        debug("gossip-store", `sent SyncRequest to ${nodeId.slice(0, 16)} since ${latestTs}`);
      }
    } catch (e) {
      warn("gossip-store", "sync request failed:", e);
    }
  }

  // update friend online status
  const friend = friends().find((f) => f.node_id === nodeId);
  if (!friend) return;

  const updated = { ...friend, online: isUp, last_seen: isUp ? now : friend.last_seen ?? now };
  db.putFriend(updated);
  setFriends((prev) => prev.map((f) => f.node_id === nodeId ? updated : f));
}
