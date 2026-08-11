// FriendzClient: the presence engine for the unified friendz protocol -
// per-peer send streams, heartbeats, and online/offline tracking. the
// transport is an injected structural type (BiStreamLike/MiddenNodeLike),
// matching the shape of midden's own wasm-exported bidirectional stream
// api - this subpath never imports midden itself.

import { encodeMessage, decodeMessage, type FriendzMessage } from "./codec.js";
import type { CoreMessage } from "./messages.js";

/** how often to send heartbeat pings to known peers (ms). */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;

/** time after last heartbeat before marking a peer offline (ms). */
export const DEFAULT_HEARTBEAT_TIMEOUT_MS = 90_000;

/**
 * the structural surface this subpath needs from a bidirectional byte
 * stream to one peer - matches midden's wasm-exported `BiStream`.
 * `read_message`/`write_message` are already message-boundary-framed by
 * the underlying transport, so the codec's unframed encodeMessage/
 * decodeMessage are what this client uses over a BiStreamLike (the
 * length-delimited FrameReader in codec.ts is for transports without that
 * built-in framing).
 */
export interface BiStreamLike {
  peer_node_id(): string;
  alpn(): string;
  write_message(data: Uint8Array): Promise<void>;
  read_message(): Promise<Uint8Array | null>;
  close(): void;
}

/** the structural surface this subpath needs from a p2p node to open streams. */
export interface MiddenNodeLike {
  node_id(): string;
  open_bi(peerAddr: string, alpn: string): Promise<BiStreamLike>;
}

export interface FriendzClientOptions {
  /** resolves to the node used to open outbound streams. */
  getNode: () => Promise<MiddenNodeLike>;
  /** the alpn to open outbound streams on. default "freqhole-friendz/1". */
  alpn?: string;
  localNodeId: string;
  localUsername: string;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  /** called for every decoded message received from any peer. */
  onMessage?: (message: FriendzMessage, fromNodeId: string) => void;
  /** called when a peer transitions from offline/unknown to online. */
  onPeerBecameOnline?: (nodeId: string) => void;
  /** called when a peer times out or announces going offline. */
  onPeerWentOffline?: (nodeId: string) => void;
  /** called when a received message's bytes fail to decode. never throws. */
  onDecodeError?: (error: unknown, fromNodeId: string) => void;
}

export interface FriendzClient {
  /** send a message to a peer, opening a stream if one isn't already open. */
  sendMessage(peerNodeId: string, message: FriendzMessage): Promise<void>;
  /** hand an accepted inbound stream to the client - starts its read loop. */
  handleIncomingStream(stream: BiStreamLike): void;
  /** start the periodic heartbeat. getPeerNodeIds is re-read each tick. */
  startHeartbeat(getPeerNodeIds: () => string[]): void;
  /** stop the periodic heartbeat. */
  stopHeartbeat(): void;
  /** fire-and-forget an offline-announcement to every currently-online peer. */
  announceOffline(): void;
  /** is this peer considered online (a heartbeat arrived within the timeout)? */
  isOnline(nodeId: string): boolean;
  /** every peer node id currently considered online. */
  getOnlinePeers(): string[];
  /** subscribe to online/offline transitions. returns an unsubscribe function. */
  onOnlineChange(handler: () => void): () => void;
  /** close every open stream, stop timers, release listeners. */
  destroy(): void;
}

function coreMessage(message: CoreMessage): FriendzMessage {
  return { kind: "core", message };
}

function heartbeatMessage(nodeId: string, username: string): FriendzMessage {
  return coreMessage({ type: "heartbeat", v: 1, nodeId, username });
}

function offlineAnnouncementMessage(nodeId: string): FriendzMessage {
  return coreMessage({ type: "offline-announcement", v: 1, nodeId });
}

/** create a FriendzClient bound to the given transport + identity. */
export function createFriendzClient(options: FriendzClientOptions): FriendzClient {
  const alpn = options.alpn ?? "freqhole-friendz/1";
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const heartbeatTimeoutMs = options.heartbeatTimeoutMs ?? DEFAULT_HEARTBEAT_TIMEOUT_MS;

  const streams = new Map<string, BiStreamLike>();
  const pendingConnections = new Map<string, Promise<BiStreamLike>>();
  const lastSeen = new Map<string, number>();
  const onlineChangeListeners = new Set<() => void>();

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let destroyed = false;

  function emitOnlineChange(): void {
    for (const handler of onlineChangeListeners) handler();
  }

  function markOnline(nodeId: string): void {
    const wasOnline = isOnline(nodeId);
    lastSeen.set(nodeId, Date.now());
    emitOnlineChange();
    if (!wasOnline) options.onPeerBecameOnline?.(nodeId);
  }

  function markOffline(nodeId: string): void {
    if (!lastSeen.has(nodeId)) return;
    lastSeen.delete(nodeId);
    emitOnlineChange();
    options.onPeerWentOffline?.(nodeId);
  }

  function isOnline(nodeId: string): boolean {
    const seenAt = lastSeen.get(nodeId);
    if (seenAt === undefined) return false;
    return Date.now() - seenAt < heartbeatTimeoutMs;
  }

  function getOnlinePeers(): string[] {
    const now = Date.now();
    const online: string[] = [];
    for (const [nodeId, seenAt] of lastSeen) {
      if (now - seenAt < heartbeatTimeoutMs) online.push(nodeId);
    }
    return online;
  }

  async function readLoop(peerId: string, stream: BiStreamLike): Promise<void> {
    try {
      while (!destroyed) {
        const data = await stream.read_message();
        if (!data) break;
        try {
          const message = decodeMessage(data);
          if (message.kind === "core" && message.message.type === "heartbeat") {
            markOnline(peerId);
          }
          if (message.kind === "core" && message.message.type === "offline-announcement") {
            markOffline(message.message.nodeId);
          }
          options.onMessage?.(message, peerId);
        } catch (err) {
          options.onDecodeError?.(err, peerId);
        }
      }
    } catch {
      // the stream errored (peer gone, transport reset). if it was replaced
      // by a newer stream already, that's expected - not this peer going
      // offline, just a reconnect racing this loop's own close.
      const wasReplaced = streams.get(peerId) !== stream;
      if (!destroyed && !wasReplaced) markOffline(peerId);
    } finally {
      if (streams.get(peerId) === stream) streams.delete(peerId);
      // release the underlying transport handle every time this loop ends,
      // whether from clean eof or an error - otherwise the native/wasm side
      // never hears about it (nothing else calls close() on this exact
      // instance once it's no longer the map's current entry), leaking one
      // stream handle per dropped/reconnected peer for as long as the
      // process runs. safe to call even if already closed (e.g. replaced by
      // handleIncomingStream, which already closed this same instance).
      stream.close();
    }
  }

  async function openStream(peerNodeId: string): Promise<BiStreamLike> {
    const node = await options.getNode();
    const stream = await node.open_bi(peerNodeId, alpn);
    streams.set(peerNodeId, stream);
    void readLoop(peerNodeId, stream);
    return stream;
  }

  async function getOrOpenStream(peerNodeId: string): Promise<BiStreamLike> {
    const existing = streams.get(peerNodeId);
    if (existing) return existing;

    let pending = pendingConnections.get(peerNodeId);
    if (!pending) {
      pending = openStream(peerNodeId);
      pendingConnections.set(peerNodeId, pending);
    }
    try {
      return await pending;
    } finally {
      pendingConnections.delete(peerNodeId);
    }
  }

  async function sendMessage(peerNodeId: string, message: FriendzMessage): Promise<void> {
    const stream = await getOrOpenStream(peerNodeId);
    await stream.write_message(encodeMessage(message));
  }

  function handleIncomingStream(stream: BiStreamLike): void {
    const peerId = stream.peer_node_id();
    const existing = streams.get(peerId);
    if (existing) existing.close();
    streams.set(peerId, stream);
    void readLoop(peerId, stream);
  }

  function startHeartbeat(getPeerNodeIds: () => string[]): void {
    stopHeartbeat();

    const tick = async (peerIds: string[]) => {
      const msg = heartbeatMessage(options.localNodeId, options.localUsername);
      for (const peerId of peerIds) {
        try {
          await sendMessage(peerId, msg);
        } catch {
          // unreachable this tick - the next heartbeat (or an explicit
          // reconnect) will retry; nothing to recover here.
        }
        const seenAt = lastSeen.get(peerId);
        if (seenAt !== undefined && Date.now() - seenAt >= heartbeatTimeoutMs) {
          markOffline(peerId);
        }
      }
    };

    void tick(getPeerNodeIds());
    heartbeatTimer = setInterval(() => {
      void tick(getPeerNodeIds());
    }, heartbeatIntervalMs);
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function announceOffline(): void {
    const msg = offlineAnnouncementMessage(options.localNodeId);
    for (const peerId of getOnlinePeers()) {
      sendMessage(peerId, msg).catch(() => {
        // fire-and-forget - we're shutting down.
      });
    }
  }

  function onOnlineChange(handler: () => void): () => void {
    onlineChangeListeners.add(handler);
    return () => onlineChangeListeners.delete(handler);
  }

  function destroy(): void {
    destroyed = true;
    stopHeartbeat();
    for (const [, stream] of streams) stream.close();
    streams.clear();
    pendingConnections.clear();
    lastSeen.clear();
    onlineChangeListeners.clear();
  }

  return {
    sendMessage,
    handleIncomingStream,
    startHeartbeat,
    stopHeartbeat,
    announceOffline,
    isOnline,
    getOnlinePeers,
    onOnlineChange,
    destroy,
  };
}
