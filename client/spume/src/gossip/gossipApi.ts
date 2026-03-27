// gossip API service — wraps FreqholeClient.gossip.* for the active remote
//
// gossip operates through the user's own freqhole server. the server persists
// channels/messages locally and (eventually) relays to/from iroh-gossip.

import { getRemoteClient } from "../music/data";
import type { ApiClient } from "../app/api/client";
import type {
  GossipChannel,
  GossipChannelMember,
  GossipMessage,
  GossipProfile,
  ChannelDetailResponse,
  ChannelInvite,
  CreateChannelRequest,
  JoinChannelRequest,
  MessagesResponse,
} from "freqhole-api-client";
import type { MusicReference } from "freqhole-api-client";
import { warn } from "../utils/logger";

// ============================================================================
// helpers
// ============================================================================

async function client(): Promise<ApiClient> {
  const c = await getRemoteClient();
  if (!c) throw new Error("no active remote — connect to a server first");
  return c;
}

function unwrap<T>(result: { success: boolean; data?: T; error?: any }): T {
  if (!result.success) {
    const msg = result.error?.message ?? "api call failed";
    warn("gossip", msg);
    throw new Error(msg);
  }
  return result.data as T;
}

// ============================================================================
// channels
// ============================================================================

export async function createChannel(params: CreateChannelRequest): Promise<GossipChannel> {
  const c = await client();
  return unwrap(await c.gossip.createChannel(params));
}

export async function listChannels(): Promise<GossipChannel[]> {
  const c = await client();
  return unwrap(await c.gossip.listChannels());
}

export async function getChannel(topicId: string): Promise<ChannelDetailResponse> {
  const c = await client();
  return unwrap(await c.gossip.getChannel({ topic_id: topicId }));
}

export async function leaveChannel(topicId: string): Promise<void> {
  const c = await client();
  unwrap(await c.gossip.leaveChannel({ topic_id: topicId }));
}

export async function joinChannel(params: JoinChannelRequest): Promise<GossipChannel> {
  const c = await client();
  return unwrap(await c.gossip.joinChannel(params));
}

export async function getInvite(topicId: string): Promise<ChannelInvite> {
  const c = await client();
  return unwrap(await c.gossip.getInvite({ topic_id: topicId }));
}

// ============================================================================
// messages
// ============================================================================

export async function getMessages(
  topicId: string,
  opts?: { beforeTimestamp?: number; limit?: number },
): Promise<MessagesResponse> {
  const c = await client();
  return unwrap(
    await c.gossip.getMessages({
      topic_id: topicId,
      before_timestamp: opts?.beforeTimestamp ?? null,
      limit: opts?.limit ?? null,
    }),
  );
}

export async function sendMessage(
  topicId: string,
  text: string | null,
  items: MusicReference[],
): Promise<GossipMessage> {
  const c = await client();
  return unwrap(
    await c.gossip.sendMessage({ topic_id: topicId, text, items: items as any }),
  );
}

export async function deleteMessage(topicId: string, messageId: string): Promise<void> {
  const c = await client();
  unwrap(await c.gossip.deleteMessage({ topic_id: topicId, message_id: messageId }));
}

// ============================================================================
// reactions
// ============================================================================

export async function react(topicId: string, targetMessageId: string, emoji: string): Promise<void> {
  const c = await client();
  unwrap(
    await c.gossip.react({
      topic_id: topicId,
      target_message_id: targetMessageId,
      emoji,
    }),
  );
}

// ============================================================================
// members
// ============================================================================

export async function listMembers(topicId: string): Promise<GossipChannelMember[]> {
  const c = await client();
  return unwrap(await c.gossip.listMembers({ topic_id: topicId }));
}

// ============================================================================
// profile
// ============================================================================

export async function getProfile(): Promise<GossipProfile | null> {
  const c = await client();
  return unwrap(await c.gossip.getProfile()) ?? null;
}

export async function updateProfile(displayName: string, avatarBlob: string | null): Promise<GossipProfile> {
  const c = await client();
  return unwrap(await c.gossip.updateProfile({ display_name: displayName, avatar_blob: avatarBlob }));
}
