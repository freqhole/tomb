// gossip store — profile, friends, and neighbor event actions

import * as db from "../gossipDb";
import * as transport from "../gossipTransport";
import type { GossipProfile } from "freqhole-api-client";
import type { GossipFriend } from "../gossipTypes";
import type { GossipChannelMember } from "freqhole-api-client";
import {
  profile, setProfile,
  friends, setFriends,
  membersByTopic, setMembersByTopic,
  nowUnix,
} from "./state";
import { debug, warn } from "../../utils/logger";

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

/** called by transport when a peer connects or disconnects on a topic */
export function onNeighborChange(topicId: string, nodeId: string, isUp: boolean): void {
  const now = nowUnix();

  // auto-add peer as channel member on connect
  if (isUp) {
    const existing = membersByTopic[topicId] ?? [];
    if (!existing.some((m) => m.node_id === nodeId)) {
      const member: GossipChannelMember = {
        topic_id: topicId,
        node_id: nodeId,
        display_name: nodeId.slice(0, 12),
        role: "member",
        joined_at: now,
      };
      db.putMembers(topicId, [member]);
      setMembersByTopic(topicId, [...existing, member]);
    }
  }

  // update friend online status
  const friend = friends().find((f) => f.node_id === nodeId);
  if (!friend) return;

  const updated = { ...friend, online: isUp, last_seen: isUp ? now : friend.last_seen ?? now };
  db.putFriend(updated);
  setFriends((prev) => prev.map((f) => f.node_id === nodeId ? updated : f));
}
