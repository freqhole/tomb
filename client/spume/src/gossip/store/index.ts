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
} from "./state";
import { onIncomingMessage } from "./messages";
import { loadProfile } from "./social";
import { onNeighborChange } from "./social";
import { debug, info, warn } from "../../utils/logger";

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
} from "./messages";

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
