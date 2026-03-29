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
import type { GossipChannel, GossipMessage, GossipProfile } from "freqhole-api-client";
import {
  setChannels,
  setActiveTopicId,
  messagesByTopic,
  setMessagesByTopic,
  setReactionsByTopic,
  membersByTopic,
  setMembersByTopic,
  setUnread,
  setInitialized,
  initialized,
  profile, setProfile,
  friends, setFriends,
  setStatusTick,
  batch, reconcile,
  generateId,
  nowUnix,
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
export function messagesByTopicRaw(): Record<string, GossipMessage[]> {
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
      setChannels(cached);
      setFriends(cachedFriends);
      setInitialized(true);
    });

    info("gossip-store", `initialized with ${cached.length} channels`);

    // if we have a profile, eagerly init midden and rejoin channels
    if (profile()) {
      initTransportAndRejoin(cached);
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

      // start heartbeat: broadcast presence to all topics every 60s + sweep stale peers
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      let heartbeatCycle = 0;
      heartbeatInterval = setInterval(async () => {
        const p3 = profile();
        const hbNodeId = p3?.node_id ?? "local";
        if (hbNodeId === "local") return;
        heartbeatCycle++;
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

        // periodic catch-up sync: every 2nd heartbeat (2 min), request missed messages
        // from connected peers. works around unreliable gossip live-delivery.
        if (heartbeatCycle % 2 === 0) {
          await periodicSync(hbNodeId, topicIds);
        }

        // sweep: mark friends offline if no heartbeat received for 120s
        sweepStaleMembers();
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
// periodic catch-up sync — request missed messages from connected peers
// ============================================================================
// iroh-gossip live delivery can be unreliable (one-directional transport
// issues, relay path failures). this periodic sync ensures we catch any
// messages that the gossip protocol failed to deliver live.

async function periodicSync(myNodeId: string, topicIds: string[]): Promise<void> {
  const p = profile();
  const displayName = p?.display_name ?? "anonymous";
  const now = nowUnix();

  for (const tid of topicIds) {
    const peerIds = transport.getTopicPeerIds(tid);
    if (peerIds.length === 0) continue;

    // find latest message timestamp for this topic
    let latestTs = 0;
    const topicMsgs = messagesByTopic[tid] ?? [];
    if (topicMsgs.length > 0) {
      latestTs = Math.max(...topicMsgs.map((m) => m.timestamp));
    } else {
      try {
        const idbMsgs = await db.getMessagesByTopic(tid);
        if (idbMsgs.length > 0) {
          latestTs = Math.max(...idbMsgs.map((m) => m.timestamp ?? 0));
        }
      } catch { /* ignore */ }
    }

    // send a SyncRequest to each connected peer
    for (const peerId of peerIds) {
      if (peerId === myNodeId) continue;
      try {
        await transport.broadcast(tid, {
          msg_type: "SyncRequest",
          sender_node_id: myNodeId,
          sender_name: displayName,
          timestamp: now,
          message_id: generateId(),
          payload: JSON.stringify({
            since: latestTs,
            limit: 50,
            before: null,
            to: peerId,
          }),
        });
        debug("gossip-store", `periodic sync: sent SyncRequest to ${peerId.slice(0, 16)} on ${tid.slice(0, 16)} since ${latestTs}`);
      } catch {
        // best-effort
      }
    }
  }
}

// ============================================================================
// heartbeat sweep — mark friends offline if no heartbeat for 120s
// ============================================================================

const HEARTBEAT_STALE_THRESHOLD = 120; // seconds

function sweepStaleMembers(): void {
  const now = Math.floor(Date.now() / 1000);
  const myNodeId = profile()?.node_id;
  if (!myNodeId) return;

  // collect all node_ids that have a fresh heartbeat across any topic
  const freshNodeIds = new Set<string>();
  for (const topicId of transport.getSubscribedTopicIds()) {
    const members = membersByTopic[topicId] ?? [];
    for (const m of members) {
      if (m.node_id === myNodeId) continue;
      const lastHb = (m as any).last_heartbeat as number | undefined;
      if (lastHb && now - lastHb < HEARTBEAT_STALE_THRESHOLD) {
        freshNodeIds.add(m.node_id);
      }
    }
  }

  // mark friends offline if they were online but have no fresh heartbeat
  const currentFriends = friends();
  let changed = false;
  const updatedFriends = currentFriends.map((f) => {
    if (f.online && f.node_id !== myNodeId && !freshNodeIds.has(f.node_id)) {
      // check if this friend has ANY heartbeat at all (only sweep those who should be heartbeating)
      let hasAnyHeartbeat = false;
      for (const topicId of transport.getSubscribedTopicIds()) {
        const members = membersByTopic[topicId] ?? [];
        const member = members.find((m) => m.node_id === f.node_id);
        if (member && (member as any).last_heartbeat) {
          hasAnyHeartbeat = true;
          break;
        }
      }
      if (hasAnyHeartbeat) {
        changed = true;
        const updated = { ...f, online: false, last_seen: now };
        db.putFriend(updated);
        return updated;
      }
    }
    return f;
  });

  if (changed) {
    setFriends(updatedFriends);
    debug("gossip-store", `heartbeat sweep: marked ${updatedFriends.filter((f, i) => f !== currentFriends[i]).length} friend(s) offline`);
  }
}
