// local iroh node id, populated once on startup by the charnel host.
//
// the local "charnel-managed" remote in spume's IndexedDB is recorded as an
// http transport with no `peer_addr` (it dispatches via IPC, not network).
// but the same charnel binary IS running an iroh endpoint, so we can hand
// out share links / send-to-remote payloads pointing at its node id.
//
// this module gives the rest of the app a synchronous accessor for that id.
// callers in browser / non-charnel mode just see `null`.

import { createSignal } from "solid-js";

const [localNodeId, setLocalNodeId] = createSignal<string | null>(null);

/** read the cached local node id (null until charnel sets it, or always null in browser). */
export function getLocalNodeId(): string | null {
  return localNodeId();
}

/** reactive accessor for solid components. */
export const localNodeIdSignal = localNodeId;

/** charnel host populates this once on startup; browser leaves it null. */
export function setLocalNodeIdValue(value: string | null): void {
  setLocalNodeId(value);
}
