// reactive list of controllers currently holding an open control-session
// stream (see midden/acceptLoop.ts) - distinct from trustStore's "ever
// paired" list, this reflects live connectivity so the tv-friendly ui can
// show who's actually connected right now.
//
// the current transport dials a brand new connection per command rather
// than holding one open (e.g. remotePlaybackControl.ts's 3s status-poll
// interval), so a disconnect is expected constantly during normal use -
// without a grace period, the indicator would flicker connect/disconnect
// every single command. instead, a disconnect only takes effect after
// DISCONNECT_GRACE_MS with no reconnect from that node id.

import { createSignal } from "solid-js";

export interface ConnectedController {
  node_id: string;
  display_name: string;
}

const DISCONNECT_GRACE_MS = 60_000;

const [connected, setConnected] = createSignal<ConnectedController[]>([]);
export const connectedControllers = connected;

const pendingRemovals = new Map<string, ReturnType<typeof setTimeout>>();

export function markControllerConnected(controller: ConnectedController): void {
  const pending = pendingRemovals.get(controller.node_id);
  if (pending) {
    clearTimeout(pending);
    pendingRemovals.delete(controller.node_id);
  }
  setConnected((prev) =>
    prev.some((c) => c.node_id === controller.node_id) ? prev : [...prev, controller],
  );
}

export function markControllerDisconnected(nodeId: string): void {
  const existing = pendingRemovals.get(nodeId);
  if (existing) clearTimeout(existing);
  const timeout = setTimeout(() => {
    pendingRemovals.delete(nodeId);
    setConnected((prev) => prev.filter((c) => c.node_id !== nodeId));
  }, DISCONNECT_GRACE_MS);
  pendingRemovals.set(nodeId, timeout);
}
