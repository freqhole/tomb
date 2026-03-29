// gossip reactive store — orchestrator
//
// local-first: all data lives in IndexedDB. no remote API dependency.
// transport (midden WASM for browser, tauri IPC for charnel) delivers
// messages which get validated + persisted here.
//
// sub-modules:
//   state.ts     — shared signals, stores, helpers, derived values
//   channels.ts  — channel CRUD actions
//   messages.ts  — message send/delete/react + incoming handler
//   social.ts    — profile, friends, neighbor events

import * as db from "../gossipDb";
import * as transport from "../gossipTransport";
import type { GossipChannel, GossipProfile } from "freqhole-api-client";
import type { GossipFriend } from "../gossipTypes";
import {
  setChannels,
  setActiveTopicId,
  messagesByTopic,
  setMessagesByTopic,
  setReactionsByTopic,
  setMembersByTopic,
  setUnread,
  setInitialized,
  initialized,
  profile, setProfile,
  setFriends,
  setStatusTick,
  batch, reconcile,
  generateId,
  nowUnix,
  stringifyPayload,
} from "./state";
import { onIncomingMessage } from "./messages";
import { loadProfile } from "./social";
import { onNeighborChange } from "./social";
import { debug, info, warn } from "../../utils/logger";

// module-level state for heartbeat interval
let heartbeatInterval: ReturnType<typeof setInterval> | null = null;
const heartbeatOnlineSince = Math.floor(Date.now() / 1000);

// ============================================================================
// re-export everything from sub-modules so consumers use a single import
// ============================================================================

export type { GossipFriend } from "../gossipTypes";

// state — signals + derived
export {
  channels,
  activeTopicId,
  setActiveTopicId,
  unread,
  loadingChannel,
  initialized,
  profile,
  setProfile,
  friends,
  nodeStatus,
  activeTopicStatus,
  activeTopicPeerCount,
  subscribedTopicCount,
  activeChannel,
  activeMessages,
  activeMembers,
  activeReactions,
} from "./state";

// channel actions
export {
  selectChannel,
  createChannel,
  joinChannel,
  leaveChannel,
  destroyChannel,
  getInvite,
  updateChannelDescription,
  markChannelRead,
} from "./channels";

// message actions
export {
  sendMessage,
  deleteMessage,
  react,
  sendReadReceipt,
  readReceiptsForTopic,
} from "./messages";
export type { ReadReceiptMap } from "./messages";

// social actions
export {
  saveProfile,
  addFriend,
  removeFriend,
  updateFriend,
} from "./social";

/** raw messages-by-topic store for cross-channel queries (e.g. friend thread view) */
export function messagesByTopicRaw(): Record<string, any[]> {
  return messagesByTopic;
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

    // broadcast MemberRemoved to all topics on page unload (best-effort)
    if (typeof window !== "undefined") {
      window.addEventListener("beforeunload", broadcastPresenceLeave);
    }

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

    info("gossip-store", `initialized with ${cached.length} channels`);

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
      info("gossip-store", `midden node ready: ${nodeId.slice(0, 16)}...`);

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
        info("gossip-store", `rejoined ${cachedChannels.length} channels`);
      }

      // re-announce presence on all topics so peers know we're back
      const p2 = profile();
      const displayName = p2?.display_name ?? "anonymous";
      for (const ch of cachedChannels) {
        try {
          await transport.broadcast(ch.topic_id, {
            msg_type: "MemberAdded",
            sender_node_id: nodeId,
            sender_name: displayName,
            timestamp: Math.floor(Date.now() / 1000),
            message_id: crypto.randomUUID(),
            payload: JSON.stringify({
              node_id: nodeId,
              display_name: displayName,
              role: ch.creator_node_id === nodeId ? "creator" : "member",
            }),
          });
        } catch {
          // not critical — peers will learn via neighbor events
        }
      }

      // start heartbeat: broadcast presence to all topics every 60s
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      heartbeatInterval = setInterval(async () => {
        const p3 = profile();
        const hbNodeId = p3?.node_id ?? "local";
        if (hbNodeId === "local") return;
        const topicIds = transport.getSubscribedTopicIds();
        for (const tid of topicIds) {
          try {
            await transport.broadcast(tid, {
              msg_type: "Heartbeat",
              sender_node_id: hbNodeId,
              sender_name: p3?.display_name ?? "anonymous",
              timestamp: Math.floor(Date.now() / 1000),
              message_id: crypto.randomUUID(),
              payload: JSON.stringify({ online_since: heartbeatOnlineSince }),
            });
          } catch {
            // best-effort
          }
        }
      }, 60_000);
    } catch (e) {
      warn("gossip-store", "midden init / rejoin failed:", e);
    }
  })();
}

export async function teardown(): Promise<void> {
  // stop heartbeat
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
  // broadcast MemberRemoved to all topics before disconnecting
  await broadcastPresenceLeave();
  transport.leaveAll();
  if (typeof window !== "undefined") {
    window.removeEventListener("beforeunload", broadcastPresenceLeave);
  }
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
// graceful close — broadcast MemberRemoved to all subscribed topics
// ============================================================================

async function broadcastPresenceLeave(): Promise<void> {
  const p = profile();
  const nodeId = p?.node_id ?? "local";
  if (nodeId === "local") return;
  const displayName = p?.display_name ?? "anonymous";

  const topicIds = transport.getSubscribedTopicIds();
  for (const topicId of topicIds) {
    try {
      await transport.broadcast(topicId, {
        msg_type: "MemberRemoved",
        sender_node_id: nodeId,
        sender_name: displayName,
        timestamp: nowUnix(),
        message_id: generateId(),
        payload: stringifyPayload("MemberRemoved", {
          node_id: nodeId,
          display_name: displayName,
          role: null,
        }),
      });
    } catch {
      // best-effort — we're leaving anyway
    }
  }
}
