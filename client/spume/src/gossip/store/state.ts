// gossip shared state — signals, stores, helpers, and derived values.
//
// extracted from gossipStore.ts so that sub-modules (channels, messages,
// social) can import shared state without circular dependencies.

import { createSignal, batch } from "solid-js";
import { createStore, reconcile } from "solid-js/store";
import * as transport from "../gossipTransport";
import type {
  GossipChannel,
  GossipChannelMember,
  GossipMessage,
  GossipReaction,
  GossipProfile,
} from "freqhole-api-client";
import { schema } from "freqhole-api-client";
import { MusicSharePayloadSchema } from "freqhole-api-client";
import type { GossipFriend } from "../gossipTypes";
import { warn } from "../../utils/logger";

// ============================================================================
// signals + stores
// ============================================================================

export const [channels, setChannels] = createSignal<GossipChannel[]>([]);
export const [activeTopicId, setActiveTopicId] = createSignal<string | null>(null);
export const [messagesByTopic, setMessagesByTopic] = createStore<Record<string, GossipMessage[]>>({});
export const [reactionsByTopic, setReactionsByTopic] = createStore<Record<string, GossipReaction[]>>({});
export const [membersByTopic, setMembersByTopic] = createStore<Record<string, GossipChannelMember[]>>({});
export const [unread, setUnread] = createSignal<Set<string>>(new Set());
export const [loadingChannel, setLoadingChannel] = createSignal(false);
export const [initialized, setInitialized] = createSignal(false);
export const [profile, setProfile] = createSignal<GossipProfile | null>(null);
export const [friends, setFriends] = createSignal<GossipFriend[]>([]);
export const [statusTick, setStatusTick] = createSignal(0);

// re-export batch + reconcile so sub-modules don't need to import solid-js directly
export { batch, reconcile };

// ============================================================================
// transport status helpers (reactive)
// ============================================================================

export function nodeStatus() {
  statusTick();
  return transport.getNodeStatus();
}

export function activeTopicStatus() {
  statusTick();
  const tid = activeTopicId();
  if (!tid) return null;
  return transport.getTopicStatus(tid);
}

export function activeTopicPeerCount() {
  statusTick();
  const tid = activeTopicId();
  if (!tid) return 0;
  return transport.getTopicPeerCount(tid);
}

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

export function generateId(): string {
  return crypto.randomUUID();
}

export function generateTopicId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function safeJsonParse(str: string): unknown {
  try { return JSON.parse(str); } catch { return undefined; }
}

/** map of msg_type → Zod payload schema for outgoing validation */
const payloadSchemas: Record<string, { safeParse: (data: unknown) => { success: boolean; data?: any; error?: any } }> = {
  ChannelMeta: schema.ChannelMetaPayloadSchema,
  ChannelDestroyed: schema.ChannelDestroyedPayloadSchema,
  MemberAdded: schema.MemberPayloadSchema,
  MemberRemoved: schema.MemberPayloadSchema,
  MessageDeleted: schema.MessageDeletedPayloadSchema,
  Reaction: schema.ReactionPayloadSchema,
  ReactionRemoved: schema.ReactionPayloadSchema,
  ProfileUpdate: schema.ProfileUpdatePayloadSchema,
  MusicShare: MusicSharePayloadSchema, // hand-rolled discriminated union, not broken codegen
  SyncRequest: schema.SyncRequestPayloadSchema,
  SyncResponse: schema.SyncResponsePayloadSchema,
  ReadReceipt: schema.ReadReceiptPayloadSchema,
  Heartbeat: schema.HeartbeatPayloadSchema,
};

/** validate outgoing payload against the matching Zod schema, then stringify.
 *  throws if validation fails — outgoing data not matching schema is a bug. */
export function stringifyPayload(msgType: string, data: unknown): string {
  const s = payloadSchemas[msgType];
  if (s) {
    const result = s.safeParse(data);
    if (!result.success) {
      warn("gossip-store", `outgoing ${msgType} payload failed Zod validation`, result.error?.issues ?? result.error, data);
      throw new Error(`outgoing ${msgType} payload failed Zod validation`);
    }
  }
  return JSON.stringify(data);
}
