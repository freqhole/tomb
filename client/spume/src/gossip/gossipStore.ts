// gossip reactive store — SolidJS signals + store for gossip state
//
// local-first: all data lives in IndexedDB. no remote API dependency.
// transport (midden WASM for browser, tauri IPC for charnel) delivers
// messages which get validated + persisted here.

import { createSignal, batch } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import * as db from "./gossipDb";
import * as transport from "./gossipTransport";
import type {
  GossipChannel,
  GossipChannelMember,
  GossipMessage,
  GossipReaction,
  GossipProfile,
  GossipEnvelope,
} from "freqhole-api-client";
import type { GossipFriend } from "./gossipTypes";
export type { GossipFriend } from "./gossipTypes";
import { debug, warn } from "../utils/logger";

// ============================================================================
// state
// ============================================================================

const [channels, setChannels] = createSignal<GossipChannel[]>([]);
const [activeTopicId, setActiveTopicId] = createSignal<string | null>(null);
const [messagesByTopic, setMessagesByTopic] = createStore<Record<string, GossipMessage[]>>({});
const [reactionsByTopic, setReactionsByTopic] = createStore<Record<string, GossipReaction[]>>({});
const [membersByTopic, setMembersByTopic] = createStore<Record<string, GossipChannelMember[]>>({});
const [unread, setUnread] = createSignal<Set<string>>(new Set());
const [loadingChannel, setLoadingChannel] = createSignal(false);
const [initialized, setInitialized] = createSignal(false);

// gossip profile (this node's identity)
const [profile, setProfile] = createSignal<GossipProfile | null>(null);

// friends list
const [friends, setFriends] = createSignal<GossipFriend[]>([]);

// transport / connection status (reactive — re-read from transport on change)
const [statusTick, setStatusTick] = createSignal(0);

/** midden node status: idle | connecting | online | error */
export function nodeStatus() {
  statusTick(); // subscribe to changes
  return transport.getNodeStatus();
}

/** gossip topic status for the active channel */
export function activeTopicStatus() {
  statusTick();
  const tid = activeTopicId();
  if (!tid) return null;
  return transport.getTopicStatus(tid);
}

/** peer count for the active channel */
export function activeTopicPeerCount() {
  statusTick();
  const tid = activeTopicId();
  if (!tid) return 0;
  return transport.getTopicPeerCount(tid);
}

/** number of topics we're subscribed to */
export function subscribedTopicCount() {
  statusTick();
  return transport.getSubscribedTopicIds().length;
}

// ============================================================================
// derived
// ============================================================================

export function activeChannel() {
  const tid = activeTopicId();
  return tid ? channels().find((c) => c.topic_id === tid) ?? null : null;
}

export function activeMessages() {
  const tid = activeTopicId();
  const msgs = tid ? messagesByTopic[tid] ?? [] : [];
  const reactions = tid ? reactionsByTopic[tid] ?? [] : [];
  if (!reactions.length) return msgs;
  const byTarget = new Map<string, GossipReaction[]>();
  for (const r of reactions) {
    const arr = byTarget.get(r.target_message_id) ?? [];
    arr.push(r);
    byTarget.set(r.target_message_id, arr);
  }
  return msgs.map((m) => {
    const msgReactions = byTarget.get(m.message_id);
    return msgReactions ? { ...m, reactions: msgReactions } : m;
  });
}

export function activeMembers() {
  const tid = activeTopicId();
  return tid ? membersByTopic[tid] ?? [] : [];
}

export function activeReactions() {
  const tid = activeTopicId();
  return tid ? reactionsByTopic[tid] ?? [] : [];
}

// ============================================================================
// helpers
// ============================================================================

function generateId(): string {
  return crypto.randomUUID();
}

/** generate a 32-byte topic ID as 64 hex chars (for iroh-gossip) */
function generateTopicId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

// ============================================================================
// init / teardown
// ============================================================================

export async function init(): Promise<void> {
  if (initialized()) return;

  try {
    await db.initGossipDB();

    // register transport callbacks
    transport.setOnMessage(onIncomingMessage);
    transport.setOnStatusChange(() => setStatusTick((n) => n + 1));
    transport.setOnNeighborChange(onNeighborChange);

    // load profile from IndexedDB
    await loadProfile();

    // load channels from IndexedDB
    const cached = await db.getAllChannels();
    const cachedFriends = await db.getAllFriends();
    batch(() => {
      setChannels(cached as GossipChannel[]);
      setFriends(cachedFriends as GossipFriend[]);
      setInitialized(true);
    });

    debug("gossip-store", `initialized with ${cached.length} channels`);

    // if we have a profile, eagerly init midden and rejoin channels
    if (profile()) {
      initTransportAndRejoin(cached as GossipChannel[]);
    }
  } catch (e) {
    warn("gossip-store", "init failed:", e);
    setInitialized(true);
  }
}

/** fire-and-forget: init midden node, update profile node_id, rejoin all channels */
function initTransportAndRejoin(cachedChannels: GossipChannel[]): void {
  (async () => {
    try {
      // init midden node (also persists identity to IndexedDB)
      const nodeId = await transport.getNodeId();
      debug("gossip-store", `midden node ready: ${nodeId.slice(0, 16)}...`);

      // update profile's node_id if it was "local" or different
      const p = profile();
      if (p && p.node_id !== nodeId) {
        const updated: GossipProfile = { ...p, node_id: nodeId };
        await db.putProfile(updated);
        // remove old "local" key profile if we upgraded
        if (p.node_id === "local") {
          try { await db.deleteProfile("local"); } catch { /* ignore */ }
        }
        setProfile(updated);
        debug("gossip-store", `profile node_id updated to ${nodeId.slice(0, 16)}...`);
      }

      // rejoin all cached channels
      for (const ch of cachedChannels) {
        try {
          debug("gossip-store", `rejoining channel "${ch.name}" (${ch.topic_id.slice(0, 16)}...) creator=${ch.creator_node_id.slice(0, 16)}... me=${nodeId.slice(0, 16)}...`);
          // if we created it, subscribe (no waiting for peers)
          // otherwise join with creator as bootstrap
          if (ch.creator_node_id === nodeId || ch.creator_node_id === "local") {
            await transport.subscribeTopic(ch.topic_id);
          } else {
            await transport.subscribeTopic(ch.topic_id, [ch.creator_node_id]);
          }
        } catch (e) {
          warn("gossip-store", `failed to rejoin channel ${ch.name}:`, e);
        }
      }

      if (cachedChannels.length > 0) {
        debug("gossip-store", `rejoined ${cachedChannels.length} channels`);
      }
    } catch (e) {
      warn("gossip-store", "midden init / rejoin failed:", e);
    }
  })();
}

export async function teardown(): Promise<void> {
  transport.leaveAll();
  batch(() => {
    setChannels([]);
    setActiveTopicId(null);
    setMessagesByTopic(reconcile({}));
    setReactionsByTopic(reconcile({}));
    setMembersByTopic(reconcile({}));
    setUnread(new Set<string>());
    setInitialized(false);
    setProfile(null);
  });
  await db.clearAllGossipData();
}

// ============================================================================
// channel actions
// ============================================================================

export async function selectChannel(topicId: string): Promise<void> {
  if (activeTopicId() === topicId && messagesByTopic[topicId]?.length) return;

  setLoadingChannel(true);
  setActiveTopicId(topicId);

  setUnread((prev) => {
    const next = new Set(prev);
    next.delete(topicId);
    return next;
  });

  try {
    const messages = await db.getMessagesByTopic(topicId);
    const reactions = await db.getReactionsByTopic(topicId);
    const members = await db.getMembersByTopic(topicId);

    batch(() => {
      setMessagesByTopic(topicId, messages as GossipMessage[]);
      setReactionsByTopic(topicId, reactions as GossipReaction[]);
      setMembersByTopic(topicId, members as GossipChannelMember[]);
    });
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
  };

  await db.putChannel(channel);
  setChannels((prev) => [channel, ...prev]);

  // add self as member
  const selfMember: GossipChannelMember = {
    topic_id: channel.topic_id,
    node_id: nodeId,
    display_name: p?.display_name ?? null,
    role: "creator",
    joined_at: now,
  };
  await db.putMembers(channel.topic_id, [selfMember]);

  // subscribe to the gossip topic (we're the first peer, no bootstrap)
  try {
    await transport.subscribeTopic(channel.topic_id);
  } catch (e) {
    warn("gossip-store", "failed to subscribe to new channel topic:", e);
  }

  // broadcast channel metadata so peers learn name/description
  try {
    await transport.broadcast(channel.topic_id, {
      msg_type: "ChannelMeta",
      sender_node_id: nodeId,
      sender_name: p?.display_name ?? "anonymous",
      timestamp: now,
      message_id: generateId(),
      payload: JSON.stringify({
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
    music_only: true,
  };

  await db.putChannel(channel);
  setChannels((prev) => [channel, ...prev]);

  // add self as member
  const p = profile();
  const selfMember: GossipChannelMember = {
    topic_id: topicId,
    node_id: p?.node_id ?? "local",
    display_name: p?.display_name ?? null,
    role: "member",
    joined_at: now,
  };
  await db.putMembers(topicId, [selfMember]);

  // join the gossip topic with the creator as bootstrap peer
  try {
    debug("gossip-store", `joinChannel: joining topic ${topicId.slice(0, 16)}... with bootstrap peer ${creatorNodeId.slice(0, 16)}...`);
    await transport.joinTopic(topicId, [creatorNodeId]);
  } catch (e) {
    warn("gossip-store", "failed to join channel topic:", e);
    // fall back to subscribe without blocking on peers
    try {
      await transport.subscribeTopic(topicId, [creatorNodeId]);
    } catch (e2) {
      warn("gossip-store", "subscribe fallback also failed:", e2);
    }
  }

  // broadcast a MemberAdded envelope so peers know we joined
  try {
    await transport.broadcast(topicId, {
      msg_type: "MemberAdded",
      sender_node_id: selfMember.node_id,
      sender_name: p?.display_name ?? "anonymous",
      timestamp: now,
      message_id: generateId(),
      payload: JSON.stringify({
        node_id: selfMember.node_id,
        display_name: selfMember.display_name,
        role: "member",
      }),
    });
  } catch {
    // not critical — peers will learn about us via gossip neighbor events
  }

  // auto-add channel creator as friend
  await addFriend(creatorNodeId, channelName + " creator");

  return channel;
}

export async function leaveChannel(topicId: string): Promise<void> {
  transport.leaveTopic(topicId);
  setChannels((prev) => prev.filter((c) => c.topic_id !== topicId));
  if (activeTopicId() === topicId) setActiveTopicId(null);
  await db.deleteChannel(topicId);
  await db.deleteMessagesByTopic(topicId);
}

export async function getInvite(topicId: string) {
  const ch = channels().find((c) => c.topic_id === topicId);
  if (!ch) throw new Error("channel not found");
  return {
    topic_id: ch.topic_id,
    channel_name: ch.name,
    creator_node_id: ch.creator_node_id,
  };
}

// ============================================================================
// message actions
// ============================================================================

export async function sendMessage(
  text: string | null,
  items: any[],
): Promise<void> {
  const tid = activeTopicId();
  if (!tid) return;

  // enforce limits
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
    payload: JSON.stringify({ text, items }),
    timestamp: now,
    received_at: now,
    deleted_at: null,
  };

  await db.putMessages([msg]);
  setMessagesByTopic(tid, [...(messagesByTopic[tid] ?? []), msg]);

  // update channel's last_message_at
  setChannels((prev) =>
    prev.map((c) =>
      c.topic_id === tid ? { ...c, last_message_at: now } : c,
    ),
  );
  // persist updated channel
  const updated = channels().find((c) => c.topic_id === tid);
  if (updated) await db.putChannel(updated);

  // broadcast to peers
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

  // persist the soft delete
  const updated = (messagesByTopic[tid] ?? []).find((m) => m.message_id === messageId);
  if (updated) await db.putMessages([updated]);

  // broadcast to peers
  const p = profile();
  try {
    await transport.broadcast(tid, {
      msg_type: "MessageDeleted",
      sender_node_id: p?.node_id ?? "local",
      sender_name: p?.display_name ?? "anonymous",
      timestamp: now,
      message_id: generateId(),
      payload: JSON.stringify({ message_id: messageId }),
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

  // check if we already reacted with this emoji on this message (toggle)
  const existing = (reactionsByTopic[tid] ?? []).find(
    (r) => r.target_message_id === targetMessageId && r.emoji === emoji && r.sender_node_id === senderNodeId
  );

  if (existing) {
    // remove the reaction
    await db.deleteReaction(existing.message_id);
    setReactionsByTopic(tid, (reactionsByTopic[tid] ?? []).filter((r) => r.message_id !== existing.message_id));

    // broadcast removal to peers
    try {
      await transport.broadcast(tid, {
        msg_type: "ReactionRemoved",
        sender_node_id: senderNodeId,
        sender_name: p?.display_name ?? "anonymous",
        timestamp: now,
        message_id: existing.message_id,
        payload: JSON.stringify({
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

  // broadcast to peers
  try {
    await transport.broadcast(tid, {
      msg_type: "Reaction",
      sender_node_id: reaction.sender_node_id,
      sender_name: reaction.sender_name ?? "anonymous",
      timestamp: now,
      message_id: reaction.message_id,
      payload: JSON.stringify({
        target_message_id: targetMessageId,
        emoji,
      }),
    });
  } catch {
    // not critical
  }
}

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

  const p: GossipProfile = {
    node_id: nodeId,
    display_name: displayName,
    avatar_blob: avatarBlob,
    updated_at: nowUnix(),
  };
  await db.putProfile(p);
  setProfile(p);
  debug("gossip-store", `profile saved: ${displayName} (node: ${nodeId.slice(0, 16)}...)`);
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

/** called by transport when a peer connects or disconnects on any topic */
function onNeighborChange(nodeId: string, isUp: boolean): void {
  const now = nowUnix();
  const friend = friends().find((f) => f.node_id === nodeId);
  if (!friend) return;

  const updated = { ...friend, online: isUp, last_seen: isUp ? now : friend.last_seen ?? now };
  db.putFriend(updated);
  setFriends((prev) => prev.map((f) => f.node_id === nodeId ? updated : f));
}

// ============================================================================
// incoming message handler (for midden / tauri transport)
// ============================================================================

/** called by transport layer when a validated GossipEnvelope arrives */
export async function onIncomingMessage(envelope: GossipEnvelope, topicId: string): Promise<void> {
  debug("gossip-store", `incoming ${envelope.msg_type} from ${envelope.sender_node_id?.slice(0, 16)} on ${topicId.slice(0, 16)}`);
  const now = nowUnix();

  switch (envelope.msg_type) {
    case "MusicShare": {
      // dedup: skip if we already have this message
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

      // update channel's last_message_at
      setChannels((prev) =>
        prev.map((c) =>
          c.topic_id === topicId ? { ...c, last_message_at: now } : c,
        ),
      );
      const updated = channels().find((c) => c.topic_id === topicId);
      if (updated) await db.putChannel(updated);

      // mark unread if not the active channel
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
      // update channel metadata from the broadcast
      try {
        const parsed = JSON.parse(envelope.payload);
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
      } catch {
        warn("gossip-store", "invalid channel-meta payload", envelope.payload);
      }
      break;
    }

    case "Reaction": {
      // dedup: skip if we already have this reaction
      if ((reactionsByTopic[topicId] ?? []).some((r) => r.message_id === envelope.message_id)) {
        debug("gossip-store", `dedup: skipping reaction ${envelope.message_id.slice(0, 8)}`);
        break;
      }
      const reaction: GossipReaction = {
        message_id: envelope.message_id,
        topic_id: topicId,
        target_message_id: "", // parsed from payload below
        sender_node_id: envelope.sender_node_id,
        sender_name: envelope.sender_name,
        emoji: "",
        timestamp: envelope.timestamp,
      };
      try {
        const parsed = JSON.parse(envelope.payload);
        reaction.target_message_id = parsed.target_message_id ?? "";
        reaction.emoji = parsed.emoji ?? "";
      } catch {
        warn("gossip-store", "invalid reaction payload", envelope.payload);
        return;
      }
      await db.putReactions([reaction]);
      setReactionsByTopic(topicId, [...(reactionsByTopic[topicId] ?? []), reaction]);
      break;
    }

    case "ReactionRemoved": {
      // remove the reaction identified by message_id (the reaction's own id)
      const reactionId = envelope.message_id;
      const existingReaction = (reactionsByTopic[topicId] ?? []).find((r) => r.message_id === reactionId);
      if (existingReaction) {
        await db.deleteReaction(reactionId);
        setReactionsByTopic(topicId, (reactionsByTopic[topicId] ?? []).filter((r) => r.message_id !== reactionId));
      }
      break;
    }

    case "MessageDeleted": {
      try {
        const parsed = JSON.parse(envelope.payload);
        const targetId = parsed.message_id as string;
        setMessagesByTopic(
          topicId,
          (messagesByTopic[topicId] ?? []).map((m) =>
            m.message_id === targetId ? { ...m, deleted_at: envelope.timestamp } : m,
          ),
        );
        const deletedMsg = (messagesByTopic[topicId] ?? []).find((m) => m.message_id === targetId);
        if (deletedMsg) await db.putMessages([deletedMsg]);
      } catch {
        warn("gossip-store", "invalid delete payload", envelope.payload);
      }
      break;
    }

    case "MemberAdded": {
      try {
        const parsed = JSON.parse(envelope.payload);
        const member: GossipChannelMember = {
          topic_id: topicId,
          node_id: parsed.node_id ?? envelope.sender_node_id,
          display_name: parsed.display_name ?? envelope.sender_name,
          role: parsed.role ?? "member",
          joined_at: envelope.timestamp,
        };
        await db.putMembers(topicId, [member]);
        setMembersByTopic(topicId, [...(membersByTopic[topicId] ?? []), member]);

        // insert a system message so the join shows in the timeline
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
      } catch {
        warn("gossip-store", "invalid member-added payload", envelope.payload);
      }
      break;
    }

    case "ProfileUpdate": {
      try {
        const parsed = JSON.parse(envelope.payload);
        const peerProfile: GossipProfile = {
          node_id: envelope.sender_node_id,
          display_name: parsed.display_name ?? envelope.sender_name,
          avatar_blob: parsed.avatar_blob ?? null,
          updated_at: envelope.timestamp,
        };
        await db.putProfile(peerProfile);
      } catch {
        warn("gossip-store", "invalid profile-update payload", envelope.payload);
      }
      break;
    }

    default:
      debug("gossip-store", `unhandled msg_type: ${envelope.msg_type}`);
  }
}

// ============================================================================
// exports
// ============================================================================

export {
  channels,
  activeTopicId,
  unread,
  loadingChannel,
  initialized,
  profile,
  friends,
  setProfile,
  setActiveTopicId,
};

/** raw messages-by-topic store for cross-channel queries (e.g. friend thread view) */
export function messagesByTopicRaw(): Record<string, GossipMessage[]> {
  return messagesByTopic;
}
