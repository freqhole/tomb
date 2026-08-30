// reactive list of controllers currently holding an open control-session
// stream (see control/playerConnectionHandler.ts) - distinct from
// trustStore's "ever paired" list, this reflects live connectivity so a
// tv-friendly ui can show who's actually connected right now.
//
// the current transport dials a brand new connection per command rather
// than holding one open (e.g. a `get_status` heartbeat poll), so a
// disconnect is expected constantly during normal use - without a grace
// period, the indicator would flicker connect/disconnect every single
// command. instead, a disconnect only takes effect after
// DISCONNECT_GRACE_MS with no reconnect from that node id.
//
// this grace period doubles as the de-facto "heartbeat timeout" - every
// command dial (including a `get_status` heartbeat poll) and every open
// wasm subscribe-stream already counts as a liveness signal (see
// markControllerConnected call sites in control/playerConnectionHandler.ts),
// so no dedicated heartbeat command is needed. the grace period just needs
// to comfortably outlast one poll interval plus jitter, while still being
// short enough that a genuine disconnect (tab closed, session ended) is
// reflected promptly instead of lingering too long.
import { createSignal } from "solid-js";
const DISCONNECT_GRACE_MS = 45_000;
const [connected, setConnected] = createSignal([]);
export const connectedControllers = connected;
const pendingRemovals = new Map();
export function markControllerConnected(controller) {
    const pending = pendingRemovals.get(controller.node_id);
    if (pending) {
        clearTimeout(pending);
        pendingRemovals.delete(controller.node_id);
    }
    setConnected((prev) => prev.some((c) => c.node_id === controller.node_id) ? prev : [...prev, controller]);
}
export function markControllerDisconnected(nodeId) {
    const existing = pendingRemovals.get(nodeId);
    if (existing)
        clearTimeout(existing);
    const timeout = setTimeout(() => {
        pendingRemovals.delete(nodeId);
        setConnected((prev) => prev.filter((c) => c.node_id !== nodeId));
    }, DISCONNECT_GRACE_MS);
    pendingRemovals.set(nodeId, timeout);
}
