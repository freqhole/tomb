// reactive list of controllers currently holding an open control-session
// stream (see midden/acceptLoop.ts) - distinct from trustStore's "ever
// paired" list, this reflects live connectivity so the tv-friendly ui can
// show who's actually connected right now.
//
// the current transport dials a brand new connection per command rather
// than holding one open (e.g. remotePlaybackControl.ts's get_status
// heartbeat poll), so a disconnect is expected constantly during normal
// use - without a grace period, the indicator would flicker connect/
// disconnect every single command. instead, a disconnect only takes
// effect after DISCONNECT_GRACE_MS with no reconnect from that node id.
//
// phase 14f: this grace period doubles as the de-facto "heartbeat
// timeout" - every command dial (including the get_status heartbeat poll
// in remotePlaybackControl.ts) and every open wasm subscribe-stream
// already counts as a liveness signal (see markControllerConnected call
// sites in midden/acceptLoop.ts), so no dedicated heartbeat command is
// needed. the grace period just needs to comfortably outlast one poll
// interval plus jitter, while still being short enough that a genuine
// disconnect (tab closed, session ended) is reflected promptly instead of
// lingering too long.
//
// tuned alongside POLL_INTERVAL_MS (remotePlaybackControl.ts): that poll
// was slowed from 3s to 30s once state-change pushes (broadcastStatus,
// see dispatcher.ts/playbackEngine.ts) made frequent polling redundant -
// the poll is now just an idle keep-alive, not the primary sync path. this
// grace period was widened to match (~1.5x the new 30s interval, enough
// margin for one missed/delayed tick without flickering the indicator).
// 5s (matching the OLD 3s poll) would now falsely disconnect between
// almost every heartbeat tick.

import { createSignal } from "solid-js";

export interface ConnectedController {
  node_id: string;
  display_name: string;
}

const DISCONNECT_GRACE_MS = 45_000;

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
