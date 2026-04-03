import type { CanvasStore } from "./canvas-store";

// palette for assigning distinct colors to each peer
const PEER_COLORS = [
  0x22c55e, 0xeab308, 0xef4444, 0x3b82f6,
  0xa855f7, 0xf97316, 0x06b6d4, 0xec4899,
];

export type PresenceMessage =
  | { type: "cursor"; x: number; y: number }
  | { type: "online" }
  | { type: "offline" }
  | { type: "lock-widget"; widgetId: string }
  | { type: "unlock-widget"; widgetId: string }
  | { type: "selection"; widgetIds: string[] };

export interface PeerPresence {
  peerId: string;
  cursor: { x: number; y: number } | null;
  online: boolean;
  lastSeen: number;
  lockedWidgets: Set<string>;
  selectedWidgets: string[];
  color: number;
}

// minimum interval between cursor broadcasts (~20fps)
const CURSOR_THROTTLE_MS = 50;

/**
 * manages ephemeral presence state for all peers on a shared canvas.
 * broadcasts local cursor position, online status, widget locks, and
 * selections through the canvas store's ephemeral messaging channel.
 * incoming messages from other peers are tracked in a per-peer map
 * and surfaced through callbacks.
 */
export class PresenceManager {
  readonly localPeerId: string;

  /** called whenever a peer's presence data changes */
  onPeerPresenceChanged: ((peerId: string, presence: PeerPresence) => void) | null = null;

  /** called the first time we hear from a new peer */
  onPeerJoined: ((peerId: string) => void) | null = null;

  /** called when a peer is pruned or goes offline */
  onPeerLeft: ((peerId: string) => void) | null = null;

  private readonly store: CanvasStore;
  private readonly peers: Map<string, PeerPresence> = new Map();
  private readonly unsubscribe: () => void;

  // tracks how many peers have been created so we can assign colors
  // in insertion order (modulo palette length)
  private peerIndexCounter = 0;

  // cursor throttle bookkeeping
  private lastCursorBroadcast = 0;
  private pendingCursorTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(store: CanvasStore, localPeerId: string) {
    this.store = store;
    this.localPeerId = localPeerId;

    // subscribe to incoming ephemeral messages from other peers
    this.unsubscribe = this.store.onEphemeral(
      (senderId: string, data: Uint8Array) => {
        this.handleEphemeralMessage(senderId, data);
      },
    );
  }

  // ---------------------------------------------------------------------------
  // outbound broadcasts
  // ---------------------------------------------------------------------------

  /**
   * broadcast the local cursor position. throttled to ~20fps so we
   * don't flood the network on every pointermove event.
   */
  broadcastCursor(x: number, y: number): void {
    const now = Date.now();
    const elapsed = now - this.lastCursorBroadcast;

    if (elapsed >= CURSOR_THROTTLE_MS) {
      // enough time has passed — send immediately
      this.lastCursorBroadcast = now;
      if (this.pendingCursorTimer !== null) {
        clearTimeout(this.pendingCursorTimer);
        this.pendingCursorTimer = null;
      }
      this.broadcast({ type: "cursor", x, y });
    } else {
      // schedule a trailing send so the final position always arrives
      if (this.pendingCursorTimer !== null) {
        clearTimeout(this.pendingCursorTimer);
      }
      this.pendingCursorTimer = setTimeout(() => {
        this.pendingCursorTimer = null;
        this.lastCursorBroadcast = Date.now();
        this.broadcast({ type: "cursor", x, y });
      }, CURSOR_THROTTLE_MS - elapsed);
    }
  }

  /** announce that we are online */
  broadcastOnline(): void {
    this.broadcast({ type: "online" });
  }

  /** announce that we are going offline (best-effort) */
  broadcastOffline(): void {
    this.broadcast({ type: "offline" });
  }

  /** claim an exclusive editing lock on a widget */
  lockWidget(widgetId: string): void {
    this.broadcast({ type: "lock-widget", widgetId });
  }

  /** release an editing lock on a widget */
  unlockWidget(widgetId: string): void {
    this.broadcast({ type: "unlock-widget", widgetId });
  }

  /** broadcast the current set of selected widget ids */
  broadcastSelection(widgetIds: string[]): void {
    this.broadcast({ type: "selection", widgetIds });
  }

  // ---------------------------------------------------------------------------
  // query methods
  // ---------------------------------------------------------------------------

  /** check whether any peer currently holds a lock on the given widget */
  isWidgetLocked(widgetId: string): boolean {
    for (const peer of this.peers.values()) {
      if (peer.online && peer.lockedWidgets.has(widgetId)) {
        return true;
      }
    }
    return false;
  }

  /** return the peerId that holds a lock on the widget, or null */
  getLockedBy(widgetId: string): string | null {
    for (const peer of this.peers.values()) {
      if (peer.online && peer.lockedWidgets.has(widgetId)) {
        return peer.peerId;
      }
    }
    return null;
  }

  /** return the full peer presence map (read-only reference) */
  getPeers(): Map<string, PeerPresence> {
    return this.peers;
  }

  /** return presence data for a single peer, or null if unknown */
  getPeer(peerId: string): PeerPresence | null {
    return this.peers.get(peerId) ?? null;
  }

  /** number of known peers (including offline ones that haven't been pruned) */
  get peerCount(): number {
    return this.peers.size;
  }

  // ---------------------------------------------------------------------------
  // stale peer pruning
  // ---------------------------------------------------------------------------

  /**
   * mark peers as offline if they haven't sent any presence message
   * within `maxAgeMs` milliseconds. clears their locks so widgets
   * aren't stuck in a locked state after a peer disappears.
   */
  pruneStale(maxAgeMs = 30_000): void {
    const cutoff = Date.now() - maxAgeMs;

    for (const peer of this.peers.values()) {
      if (peer.online && peer.lastSeen < cutoff) {
        peer.online = false;
        peer.cursor = null;
        peer.lockedWidgets.clear();
        peer.selectedWidgets = [];

        this.onPeerPresenceChanged?.(peer.peerId, peer);
        this.onPeerLeft?.(peer.peerId);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------------

  /** unsubscribe from ephemeral messages and discard all peer state */
  destroy(): void {
    if (this.pendingCursorTimer !== null) {
      clearTimeout(this.pendingCursorTimer);
      this.pendingCursorTimer = null;
    }
    this.unsubscribe();
    this.peers.clear();
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  /**
   * lazily create a PeerPresence entry for a peer we haven't seen
   * before. fires `onPeerJoined` the first time a peer appears.
   */
  private getOrCreatePeer(peerId: string): PeerPresence {
    const existing = this.peers.get(peerId);
    if (existing) {
      return existing;
    }

    const color = PEER_COLORS[this.peerIndexCounter % PEER_COLORS.length];
    this.peerIndexCounter += 1;

    const peer: PeerPresence = {
      peerId,
      cursor: null,
      online: true,
      lastSeen: Date.now(),
      lockedWidgets: new Set(),
      selectedWidgets: [],
      color,
    };

    this.peers.set(peerId, peer);
    this.onPeerJoined?.(peerId);
    return peer;
  }

  /** encode a presence message as JSON and broadcast it via the store */
  private broadcast(msg: PresenceMessage): void {
    const json = JSON.stringify(msg);
    const bytes = new TextEncoder().encode(json);
    this.store.broadcastEphemeral(bytes);
  }

  /**
   * decode an incoming ephemeral message, update the sender's
   * PeerPresence record, and notify via callback.
   */
  private handleEphemeralMessage(senderId: string, data: Uint8Array): void {
    // ignore our own messages that might echo back
    if (senderId === this.localPeerId) {
      return;
    }

    let msg: PresenceMessage;
    try {
      const json = new TextDecoder().decode(data);
      msg = JSON.parse(json) as PresenceMessage;
    } catch {
      // malformed message — nothing we can do
      return;
    }

    const peer = this.getOrCreatePeer(senderId);
    peer.lastSeen = Date.now();

    switch (msg.type) {
      case "cursor":
        peer.cursor = { x: msg.x, y: msg.y };
        peer.online = true;
        break;

      case "online":
        peer.online = true;
        break;

      case "offline":
        peer.online = false;
        peer.cursor = null;
        peer.lockedWidgets.clear();
        peer.selectedWidgets = [];
        break;

      case "lock-widget":
        peer.lockedWidgets.add(msg.widgetId);
        break;

      case "unlock-widget":
        peer.lockedWidgets.delete(msg.widgetId);
        break;

      case "selection":
        peer.selectedWidgets = msg.widgetIds;
        break;

      default:
        // unknown message type — ignore gracefully
        return;
    }

    this.onPeerPresenceChanged?.(senderId, peer);
  }
}
