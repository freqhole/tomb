// gossip store — channel actions (create, join, leave, destroy, select, update)

import * as db from "../gossipDb";
import * as transport from "../gossipTransport";
import type {
  GossipChannel,
  GossipChannelMember,
  GossipMessage,
} from "freqhole-api-client";
import {
  channels, setChannels,
  activeTopicId, setActiveTopicId,
  messagesByTopic, setMessagesByTopic,
  setReactionsByTopic,
  setMembersByTopic,
  setUnread,
  setLoadingChannel,
  profile,
  batch,
  generateId, generateTopicId, nowUnix, stringifyPayload,
} from "./state";
import { addFriend } from "./social";
import { debug, info, warn } from "../../utils/logger";

export async function selectChannel(topicId: string): Promise<void> {
  const alreadyActive = activeTopicId() === topicId && messagesByTopic[topicId]?.length;

  setActiveTopicId(topicId);

  setUnread((prev) => {
    const next = new Set(prev);
    next.delete(topicId);
    return next;
  });

  try {
    const members = await db.getMembersByTopic(topicId);
    setMembersByTopic(topicId, members as GossipChannelMember[]);

    if (!alreadyActive) {
      setLoadingChannel(true);
      const messages = await db.getMessagesByTopic(topicId);
      const reactions = await db.getReactionsByTopic(topicId);
      messages.sort((a: any, b: any) => a.timestamp - b.timestamp);
      info("gossip-store", `selectChannel ${topicId.slice(0, 16)}: loaded ${messages.length} messages, ${reactions.length} reactions from IDB`);

      batch(() => {
        setMessagesByTopic(topicId, messages as GossipMessage[]);
        setReactionsByTopic(topicId, reactions as any[]);
      });
    }
  } catch (e) {
    warn("gossip-store", `failed to load channel ${topicId}:`, e);
  } finally {
    setLoadingChannel(false);
  }
}

export async function createChannel(
  name: string,
  description: string | null,
  musicOnly: boolean,
): Promise<GossipChannel> {
  const p = profile();
  const nodeId = p?.node_id ?? "local";
  const now = nowUnix();

  const channel: GossipChannel = {
    topic_id: generateTopicId(),
    name,
    description,
    creator_node_id: nodeId,
    created_at: now,
    settings: null,
    last_message_at: null,
    music_only: musicOnly,
    destroyed_at: null,
  };

  await db.putChannel(channel);
  setChannels((prev) => [channel, ...prev]);

  const selfMember: GossipChannelMember = {
    topic_id: channel.topic_id,
    node_id: nodeId,
    display_name: p?.display_name ?? null,
    role: "creator",
    joined_at: now,
  };
  await db.putMembers(channel.topic_id, [selfMember]);
  setMembersByTopic(channel.topic_id, [selfMember]);

  try {
    await transport.subscribeTopic(channel.topic_id);
  } catch (e) {
    warn("gossip-store", "failed to subscribe to new channel topic:", e);
  }

  try {
    await transport.broadcast(channel.topic_id, {
      msg_type: "ChannelMeta",
      sender_node_id: nodeId,
      sender_name: p?.display_name ?? "anonymous",
      timestamp: now,
      message_id: generateId(),
      payload: stringifyPayload("ChannelMeta", {
        name,
        description,
        music_only: musicOnly,
        creator_node_id: nodeId,
      }),
    });
  } catch {
    // not critical — peers may not be connected yet
  }

  debug("gossip-store", `created channel: ${name}`);
  return channel;
}

export async function joinChannel(
  topicId: string,
  channelName: string,
  creatorNodeId: string,
  musicOnly?: boolean,
): Promise<GossipChannel> {
  const now = nowUnix();

  const channel: GossipChannel = {
    topic_id: topicId,
    name: channelName,
    description: null,
    creator_node_id: creatorNodeId,
    created_at: now,
    settings: null,
    last_message_at: null,
    music_only: musicOnly ?? false,
    destroyed_at: null,
  };

  await db.putChannel(channel);
  setChannels((prev) => [channel, ...prev]);

  const p = profile();
  const selfMember: GossipChannelMember = {
    topic_id: topicId,
    node_id: p?.node_id ?? "local",
    display_name: p?.display_name ?? null,
    role: "member",
    joined_at: now,
  };
  await db.putMembers(topicId, [selfMember]);
  setMembersByTopic(topicId, [selfMember]);

  try {
    info("gossip-store", `joinChannel: subscribing to topic ${topicId.slice(0, 16)}... with bootstrap peer ${creatorNodeId.slice(0, 16)}...`);
    await transport.subscribeTopic(topicId, [creatorNodeId]);
  } catch (e) {
    warn("gossip-store", "failed to subscribe to joined channel:", e);
  }

  try {
    await transport.broadcast(topicId, {
      msg_type: "MemberAdded",
      sender_node_id: selfMember.node_id,
      sender_name: p?.display_name ?? "anonymous",
      timestamp: now,
      message_id: generateId(),
      payload: stringifyPayload("MemberAdded", {
        node_id: selfMember.node_id,
        display_name: selfMember.display_name,
        role: "member",
      }),
    });
  } catch {
    // not critical — peers will learn about us via gossip neighbor events
  }

  try {
    await addFriend(creatorNodeId, channelName + " creator");
  } catch (e) {
    warn("gossip-store", "failed to add friend during join:", e);
  }

  return channel;
}

export async function leaveChannel(topicId: string): Promise<void> {
  transport.leaveTopic(topicId);
  setChannels((prev) => prev.filter((c) => c.topic_id !== topicId));
  if (activeTopicId() === topicId) setActiveTopicId(null);
  await db.deleteChannel(topicId);
  await db.deleteMessagesByTopic(topicId);
}

export async function destroyChannel(topicId: string): Promise<void> {
  const ch = channels().find((c) => c.topic_id === topicId);
  if (!ch) return;
  const p = profile();
  const nodeId = p?.node_id ?? "local";

  if (ch.creator_node_id !== nodeId) {
    warn("gossip-store", "only the creator can destroy a channel");
    return;
  }

  const now = nowUnix();

  setChannels((prev) =>
    prev.map((c) => (c.topic_id === topicId ? { ...c, destroyed_at: now } : c)),
  );
  const updated = channels().find((c) => c.topic_id === topicId);
  if (updated) await db.putChannel(updated);

  const sysMsg: GossipMessage = {
    message_id: generateId(),
    topic_id: topicId,
    sender_node_id: nodeId,
    sender_name: p?.display_name ?? null,
    msg_type: "System",
    payload: JSON.stringify({ text: "channel was closed by the creator" }),
    timestamp: now,
    received_at: now,
    deleted_at: null,
  };
  await db.putMessages([sysMsg]);
  setMessagesByTopic(topicId, [...(messagesByTopic[topicId] ?? []), sysMsg]);

  try {
    await transport.broadcast(topicId, {
      msg_type: "ChannelDestroyed",
      sender_node_id: nodeId,
      sender_name: p?.display_name ?? "anonymous",
      timestamp: now,
      message_id: generateId(),
      payload: stringifyPayload("ChannelDestroyed", { reason: null }),
    });
  } catch {
    // not critical
  }

  debug("gossip-store", `destroyed channel: ${ch.name}`);
}

export async function getInvite(topicId: string) {
  const ch = channels().find((c) => c.topic_id === topicId);
  if (!ch) throw new Error("channel not found");
  return {
    topic_id: ch.topic_id,
    channel_name: ch.name,
    creator_node_id: ch.creator_node_id,
    music_only: ch.music_only,
  };
}

export async function updateChannelDescription(
  topicId: string,
  description: string,
): Promise<void> {
  const ch = channels().find((c) => c.topic_id === topicId);
  if (!ch) return;

  setChannels((prev) =>
    prev.map((c) => (c.topic_id === topicId ? { ...c, description } : c)),
  );
  const updated = channels().find((c) => c.topic_id === topicId);
  if (updated) await db.putChannel(updated);

  const p = profile();
  const nodeId = p?.node_id ?? "local";
  try {
    await transport.broadcast(topicId, {
      msg_type: "ChannelMeta",
      sender_node_id: nodeId,
      sender_name: p?.display_name ?? "anonymous",
      timestamp: nowUnix(),
      message_id: generateId(),
      payload: stringifyPayload("ChannelMeta", {
        name: ch.name,
        description,
        music_only: ch.music_only,
        creator_node_id: ch.creator_node_id,
      }),
    });
  } catch {
    // not critical
  }
}

export function markChannelRead(topicId: string): void {
  setUnread((prev) => {
    const next = new Set(prev);
    next.delete(topicId);
    return next;
  });
}
