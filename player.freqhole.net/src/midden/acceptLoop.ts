// rough stub for phase 2's accept loop. calls node.accept() in a loop and
// dispatches by ALPN. only the freqhole-player/1 branch exists so far, and
// it just logs - pairing/control message handling lands in phases 2-3.

import type { MiddenNode } from "@freqhole/midden";
import { PLAYER_ALPN } from "./node";

let running = false;

/** start the inbound accept loop. safe to call once; no-ops on repeat calls. */
export function startAcceptLoop(node: MiddenNode): void {
  if (running) return;
  running = true;

  void (async () => {
    for (;;) {
      const stream = await node.accept();
      if (stream === null) break; // endpoint closed

      const alpn = (stream as { alpn(): string }).alpn();
      if (alpn === PLAYER_ALPN) {
        // TODO(phase 2): pairing handshake (pin exchange) + trust store checks
        // TODO(phase 3): control command dispatch for already-trusted peers
        console.log("[player] accepted connection on", alpn);
      } else {
        console.log("[player] ignoring connection on unhandled alpn", alpn);
      }
    }
  })();
}
