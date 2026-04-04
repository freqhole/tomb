// ---------------------------------------------------------------------------
// friendz bridge — module-level singleton for widget ↔ protocol communication
//
// the friends widget (and other UI) can't directly access the FriendzProtocol
// instance created in boot.ts. this bridge module holds a reference to the
// protocol and exposes functions that widgets can import. follows the same
// pattern as identity.ts (module-level state with exported accessors).
//
// lifecycle:
//   1. boot.ts creates FriendzProtocol and calls initBridge(protocol)
//   2. widgets import isOnline(), sendFriendRequest(), etc.
//   3. boot.ts calls destroyBridge() on teardown
// ---------------------------------------------------------------------------

import type { FriendzProtocol } from "./friends-protocol";

// ---------------------------------------------------------------------------
// module state
// ---------------------------------------------------------------------------

let protocol: FriendzProtocol | null = null;
let bridgeReadyListeners: Array<() => void> = [];

// ---------------------------------------------------------------------------
// initialization (called by boot.ts)
// ---------------------------------------------------------------------------

/**
 * set the active FriendzProtocol instance. called once from boot.ts
 * after the protocol is created and wired up. triggers any pending
 * "bridge ready" listeners.
 */
export function initBridge(p: FriendzProtocol): void {
  protocol = p;
  // notify anyone waiting for the bridge to be ready
  for (const listener of bridgeReadyListeners) {
    listener();
  }
  bridgeReadyListeners = [];
}

/**
 * tear down the bridge. called from boot.ts on disconnect/destroy.
 */
export function destroyBridge(): void {
  protocol = null;
  bridgeReadyListeners = [];
}

// ---------------------------------------------------------------------------
// state queries (safe to call before bridge is ready — return defaults)
// ---------------------------------------------------------------------------

/** whether the bridge has an active protocol instance. */
export function isProtocolReady(): boolean {
  return protocol !== null;
}

/**
 * check if a friend peer is considered online (heartbeat within timeout).
 * returns false if the bridge isn't ready or the peer is unknown.
 */
export function isOnline(nodeId: string): boolean {
  return protocol?.isOnline(nodeId) ?? false;
}

/**
 * get all peer node IDs currently considered online.
 * returns empty array if the bridge isn't ready.
 */
export function getOnlinePeers(): string[] {
  return protocol?.getOnlinePeers() ?? [];
}

/**
 * subscribe to online/offline state changes.
 * if the bridge isn't ready yet, the handler will be registered once it is.
 * returns an unsubscribe function.
 */
export function onOnlineChange(handler: () => void): () => void {
  if (protocol) {
    return protocol.onOnlineChange(handler);
  }

  // bridge not ready yet — defer registration
  let unsub: (() => void) | null = null;
  let cancelled = false;

  const readyListener = () => {
    if (cancelled || !protocol) return;
    unsub = protocol.onOnlineChange(handler);
  };
  bridgeReadyListeners.push(readyListener);

  return () => {
    cancelled = true;
    if (unsub) unsub();
    // remove from pending listeners if not yet fired
    const idx = bridgeReadyListeners.indexOf(readyListener);
    if (idx !== -1) bridgeReadyListeners.splice(idx, 1);
  };
}

/**
 * subscribe to be notified when the bridge becomes ready.
 * if already ready, the handler fires synchronously.
 * returns an unsubscribe function.
 */
export function onBridgeReady(handler: () => void): () => void {
  if (protocol) {
    handler();
    return () => {};
  }

  bridgeReadyListeners.push(handler);
  return () => {
    const idx = bridgeReadyListeners.indexOf(handler);
    if (idx !== -1) bridgeReadyListeners.splice(idx, 1);
  };
}

// ---------------------------------------------------------------------------
// outbound actions (require bridge to be ready)
// ---------------------------------------------------------------------------

/**
 * send a friend request to a peer.
 * throws if the bridge isn't ready.
 */
export async function sendFriendRequest(peerNodeId: string): Promise<void> {
  if (!protocol) throw new Error("friendz bridge not initialized");
  return protocol.sendFriendRequest(peerNodeId);
}

/**
 * accept an incoming friend request.
 * sends an accept message to the remote peer via the protocol.
 * the caller is responsible for updating the local friends doc
 * (moving the request to "accepted" and adding the friend entry).
 */
export async function acceptFriendRequest(fromNodeId: string): Promise<void> {
  if (!protocol) throw new Error("friendz bridge not initialized");
  return protocol.sendFriendAccept(fromNodeId);
}

/**
 * reject an incoming friend request.
 * sends a reject message to the remote peer via the protocol.
 * the caller is responsible for updating the local friends doc
 * (moving the request to "rejected").
 */
export async function rejectFriendRequest(fromNodeId: string): Promise<void> {
  if (!protocol) throw new Error("friendz bridge not initialized");
  return protocol.sendFriendReject(fromNodeId);
}

/**
 * request a peer's profile (username, bio, avatar).
 * the response will arrive via the protocol's onProfileResponse callback,
 * which boot.ts wires to write into the friends doc.
 */
export async function requestProfile(peerNodeId: string): Promise<void> {
  if (!protocol) throw new Error("friendz bridge not initialized");
  return protocol.requestProfile(peerNodeId);
}

// ---------------------------------------------------------------------------
// privacy setting updates
// ---------------------------------------------------------------------------

/**
 * update the profile visibility setting on the protocol.
 * called when the user changes the setting in the friends widget.
 */
export function setProfileVisibility(visibility: "friends" | "everyone" | "nobody"): void {
  protocol?.setProfileVisibility(visibility);
}

/**
 * update the friend requests setting on the protocol.
 * called when the user changes the setting in the friends widget.
 */
export function setFriendRequestsFrom(from: "everyone" | "nobody"): void {
  protocol?.setFriendRequestsFrom(from);
}
