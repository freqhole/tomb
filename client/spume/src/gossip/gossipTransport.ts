// gossip transport — bridges midden WASM gossip to the gossip store
//
// manages topic subscriptions and recv loops. incoming messages are
// Zod-validated at this boundary, then handed to gossipStore.onIncomingMessage().
// outgoing messages are serialized to GossipEnvelope JSON and broadcast.

import type { GossipSenderLike, GossipReceiverLike } from "freqhole-api-client";
import { schema } from "freqhole-api-client";
import { getMiddenNode } from "../app/api/client";
import { debug, warn, error as logError } from "../utils/logger";

const TAG = "gossip-transport";

// active topic senders keyed by topic_id hex
const senders = new Map<string, GossipSenderLike>();

// abort controllers for recv loops
const abortControllers = new Map<string, AbortController>();

// callback for validated incoming envelopes
let onMessage: ((envelope: schema.GossipEnvelope, topicId: string) => Promise<void>) | null = null;

// ============================================================================
// connection status tracking
// ============================================================================

export type NodeStatus = "idle" | "connecting" | "online" | "error";
export type TopicStatus = "subscribing" | "waiting_for_peers" | "connected" | "error";

let _nodeStatus: NodeStatus = "idle";
let _nodeError: string | null = null;
// per-topic: peer count (from neighbor_up / neighbor_down)
const topicPeerCounts = new Map<string, number>();
const topicStatuses = new Map<string, TopicStatus>();

// callbacks for status changes — store registers these
let onStatusChange: (() => void) | null = null;
let onNeighborChange: ((nodeId: string, isUp: boolean) => void) | null = null;

export function setOnStatusChange(cb: () => void): void {
  onStatusChange = cb;
}

export function setOnNeighborChange(cb: (nodeId: string, isUp: boolean) => void): void {
  onNeighborChange = cb;
}

export function getNodeStatus(): { status: NodeStatus; error: string | null } {
  return { status: _nodeStatus, error: _nodeError };
}

export function getTopicStatus(topicId: string): TopicStatus | null {
  return topicStatuses.get(topicId) ?? null;
}

export function getTopicPeerCount(topicId: string): number {
  return topicPeerCounts.get(topicId) ?? 0;
}

export function getSubscribedTopicIds(): string[] {
  return [...senders.keys()];
}

function setNodeStatus(status: NodeStatus, error?: string): void {
  _nodeStatus = status;
  _nodeError = error ?? null;
  onStatusChange?.();
}

function setTopicStatus(topicId: string, status: TopicStatus): void {
  topicStatuses.set(topicId, status);
  onStatusChange?.();
}

function updateTopicPeerCount(topicId: string, delta: number): void {
  const current = topicPeerCounts.get(topicId) ?? 0;
  const next = Math.max(0, current + delta);
  topicPeerCounts.set(topicId, next);
  if (next > 0) {
    topicStatuses.set(topicId, "connected");
  }
  onStatusChange?.();
}

/**
 * register the callback that receives validated incoming gossip envelopes.
 * call this once during store init.
 */
export function setOnMessage(
  cb: (envelope: schema.GossipEnvelope, topicId: string) => Promise<void>,
): void {
  onMessage = cb;
}

/**
 * join a gossip topic and start receiving messages.
 * blocks until at least one peer is connected (gossip_join).
 * use for topics where you know bootstrap peers.
 */
export async function joinTopic(
  topicId: string,
  bootstrapPeers: string[],
): Promise<void> {
  if (senders.has(topicId)) {
    debug(TAG, `already joined topic ${topicId.slice(0, 16)}...`);
    return;
  }

  setTopicStatus(topicId, "waiting_for_peers");

  const node = await ensureNode();
  if (!node.gossip_join) {
    setTopicStatus(topicId, "error");
    throw new Error("midden node does not support gossip — upgrade midden WASM");
  }

  const handle = await node.gossip_join(topicId, JSON.stringify(bootstrapPeers));
  debug(TAG, `gossip_join returned handle for ${topicId.slice(0, 16)}...`);
  const sender = handle.take_sender();
  const receiver = handle.take_receiver();
  debug(TAG, `split handle into sender + receiver for ${topicId.slice(0, 16)}...`);
  senders.set(topicId, sender);
  setTopicStatus(topicId, "connected");
  debug(TAG, `joined topic ${topicId.slice(0, 16)}...`);

  startRecvLoop(topicId, receiver);
}

/**
 * subscribe to a gossip topic without waiting for peers.
 * use when creating a new topic (you're the first peer).
 */
export async function subscribeTopic(
  topicId: string,
  bootstrapPeers: string[] = [],
): Promise<void> {
  if (senders.has(topicId)) {
    debug(TAG, `already subscribed to topic ${topicId.slice(0, 16)}...`);
    return;
  }

  setTopicStatus(topicId, "subscribing");

  const node = await ensureNode();
  if (!node.gossip_subscribe) {
    setTopicStatus(topicId, "error");
    throw new Error("midden node does not support gossip — upgrade midden WASM");
  }

  const handle = await node.gossip_subscribe(topicId, JSON.stringify(bootstrapPeers));
  debug(TAG, `gossip_subscribe returned handle for ${topicId.slice(0, 16)}... (bootstrap: ${bootstrapPeers.length} peers)`);
  const sender = handle.take_sender();
  const receiver = handle.take_receiver();
  debug(TAG, `split handle into sender + receiver for ${topicId.slice(0, 16)}...`);
  senders.set(topicId, sender);
  setTopicStatus(topicId, bootstrapPeers.length > 0 ? "waiting_for_peers" : "connected");
  debug(TAG, `subscribed to topic ${topicId.slice(0, 16)}...`);

  startRecvLoop(topicId, receiver);
}

/**
 * broadcast a GossipEnvelope to all peers in a topic.
 */
export async function broadcast(
  topicId: string,
  envelope: schema.GossipEnvelope,
): Promise<void> {
  const sender = senders.get(topicId);
  if (!sender) {
    warn(TAG, `cannot broadcast — not subscribed to topic ${topicId.slice(0, 16)}...`);
    return;
  }

  const json = JSON.stringify(envelope);
  const bytes = new TextEncoder().encode(json);
  await sender.broadcast(bytes);
  debug(TAG, `broadcast ${envelope.msg_type} to ${topicId.slice(0, 16)}... (${bytes.length} bytes)`);
}

/**
 * leave a topic — stops recv loop and drops the handle.
 */
export function leaveTopic(topicId: string): void {
  const ac = abortControllers.get(topicId);
  if (ac) {
    ac.abort();
    abortControllers.delete(topicId);
  }
  senders.delete(topicId);
  topicStatuses.delete(topicId);
  topicPeerCounts.delete(topicId);
  onStatusChange?.();
  debug(TAG, `left topic ${topicId.slice(0, 16)}...`);
}

/**
 * leave all topics — call on teardown.
 */
export function leaveAll(): void {
  for (const topicId of [...senders.keys()]) {
    leaveTopic(topicId);
  }
}

/**
 * check if we're currently subscribed to a topic.
 */
export function isSubscribed(topicId: string): boolean {
  return senders.has(topicId);
}

/**
 * get our local midden node_id, or null if not initialized.
 */
export async function getNodeId(): Promise<string> {
  const node = await ensureNode();
  return node.node_id();
}

/** init midden node with status tracking */
async function ensureNode() {
  if (_nodeStatus === "idle" || _nodeStatus === "error") {
    setNodeStatus("connecting");
  }
  try {
    const node = await getMiddenNode();
    setNodeStatus("online");
    return node;
  } catch (e) {
    setNodeStatus("error", e instanceof Error ? e.message : String(e));
    throw e;
  }
}

// ============================================================================
// recv loop
// ============================================================================

function startRecvLoop(topicId: string, receiver: GossipReceiverLike): void {
  const ac = new AbortController();
  abortControllers.set(topicId, ac);

  // fire and forget — loop runs until topic is left or stream closes
  (async () => {
    debug(TAG, `recv loop started for ${topicId.slice(0, 16)}...`);
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;
    while (!ac.signal.aborted) {
      try {
        const raw = await receiver.recv();
        debug(TAG, `recv raw on ${topicId.slice(0, 16)}:`, raw);

        // null = topic closed
        if (raw === null || raw === undefined) {
          debug(TAG, `topic ${topicId.slice(0, 16)}... closed`);
          break;
        }

        // midden WASM returns a Map — convert to plain object
        const event: Record<string, any> =
          raw instanceof Map ? Object.fromEntries(raw) : raw;

        debug(TAG, `recv event on ${topicId.slice(0, 16)}:`, event);

        // track neighbor events for connection status
        if (event.type === "neighbor_up") {
          debug(TAG, `topic ${topicId.slice(0, 16)}... peer connected: ${event.node_id?.slice(0, 16)}...`);
          updateTopicPeerCount(topicId, +1);
          if (event.node_id) onNeighborChange?.(event.node_id, true);
          continue;
        }
        if (event.type === "neighbor_down") {
          debug(TAG, `topic ${topicId.slice(0, 16)}... peer disconnected: ${event.node_id?.slice(0, 16)}...`);
          updateTopicPeerCount(topicId, -1);
          if (event.node_id) onNeighborChange?.(event.node_id, false);
          continue;
        }
        if (event.type === "lagged") {
          warn(TAG, `topic ${topicId.slice(0, 16)}... lagged (missed messages)`);
          continue;
        }

        // skip unknown non-received events
        if (event.type !== "received") {
          debug(TAG, `topic ${topicId.slice(0, 16)}... event: ${event.type}`);
          continue;
        }

        // decode base64 content → JSON → Zod validate
        const contentBytes = base64Decode(event.content);
        const contentStr = new TextDecoder().decode(contentBytes);

        let parsed: unknown;
        try {
          parsed = JSON.parse(contentStr);
        } catch {
          warn(TAG, `invalid JSON from ${event.from?.slice(0, 16)}...`);
          continue;
        }

        const result = schema.GossipEnvelopeSchema.safeParse(parsed);
        if (!result.success) {
          warn(TAG, `invalid envelope from ${event.from?.slice(0, 16)}...`, result.error.issues);
          continue;
        }

        if (onMessage) {
          debug(TAG, `delivering ${result.data.msg_type} from ${result.data.sender_node_id?.slice(0, 16)} to store`);
          await onMessage(result.data, topicId);
        } else {
          console.warn(`[gossip-transport] NO onMessage callback registered! dropping envelope`);
        }
        consecutiveErrors = 0;
      } catch (e) {
        if (ac.signal.aborted) break;
        consecutiveErrors++;
        logError(TAG, `recv error on ${topicId.slice(0, 16)}... (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS})`, e);
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          logError(TAG, `too many consecutive errors on ${topicId.slice(0, 16)}..., stopping recv loop`);
          setTopicStatus(topicId, "error");
          break;
        }
        // exponential backoff: 1s, 2s, 4s, 8s, 16s
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, consecutiveErrors - 1)));
      }
    }
    debug(TAG, `recv loop ended for ${topicId.slice(0, 16)}...`);
    senders.delete(topicId);
    abortControllers.delete(topicId);
  })();
}

// ============================================================================
// base64 decode (no padding, matching midden's encoding)
// ============================================================================

function base64Decode(b64: string): Uint8Array {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const lookup = new Uint8Array(128);
  for (let i = 0; i < chars.length; i++) lookup[chars.charCodeAt(i)] = i;

  // strip padding if present
  const stripped = b64.replace(/=+$/, "");
  const len = (stripped.length * 3) >> 2;
  const out = new Uint8Array(len);

  let j = 0;
  for (let i = 0; i < stripped.length; i += 4) {
    const a = lookup[stripped.charCodeAt(i)];
    const b = lookup[stripped.charCodeAt(i + 1)];
    const c = lookup[stripped.charCodeAt(i + 2)];
    const d = lookup[stripped.charCodeAt(i + 3)];
    out[j++] = (a << 2) | (b >> 4);
    if (j < len) out[j++] = ((b & 0xf) << 4) | (c >> 2);
    if (j < len) out[j++] = ((c & 0x3) << 6) | d;
  }
  return out;
}
