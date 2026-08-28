// reactive list of controllers currently holding an open control-session
// stream (see midden/acceptLoop.ts) - distinct from trustStore's "ever
// paired" list, this reflects live connectivity so the tv-friendly ui can
// show who's actually connected right now.

import { createSignal } from "solid-js";

export interface ConnectedController {
  node_id: string;
  display_name: string;
}

const [connected, setConnected] = createSignal<ConnectedController[]>([]);
export const connectedControllers = connected;

export function markControllerConnected(controller: ConnectedController): void {
  setConnected((prev) =>
    prev.some((c) => c.node_id === controller.node_id) ? prev : [...prev, controller],
  );
}

export function markControllerDisconnected(nodeId: string): void {
  setConnected((prev) => prev.filter((c) => c.node_id !== nodeId));
}
