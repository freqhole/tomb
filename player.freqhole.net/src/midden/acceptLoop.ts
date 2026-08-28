// inbound accept loop (phase 2 + phase 3 wiring): accepts connections on
// freqhole-player/1 and routes the first ndjson line to either the pairing
// handler (pairing/pairingHandler.ts) or the control dispatcher
// (control/dispatcher.ts), based on whether the connecting node id is
// already in the trust store.
//
// iroh-blobs connections never reach here - node.accept() handles those
// internally before returning anything to JS.

import type { BiStream, MiddenNode } from "@freqhole/midden";
import { PLAYER_ALPN, FREQHOLE_ALPN } from "./node";
import { handlePairRequest } from "../pairing/pairingHandler";
import { getTrustedController, isTrustedController } from "../pairing/trustStore";
import { dispatchCommand } from "../control/dispatcher";
import { handleApiRequest } from "../hello/helloHandler";
import {
  markControllerConnected,
  markControllerDisconnected,
} from "../control/connectedControllers";

let running = false;

/** start the inbound accept loop. safe to call once; no-ops on repeat calls. */
export function startAcceptLoop(node: MiddenNode): void {
  if (running) return;
  running = true;

  void (async () => {
    for (;;) {
      const stream = (await node.accept()) as BiStream | null;
      if (stream === null) break; // endpoint closed

      if (stream.alpn() === PLAYER_ALPN) {
        void handleConnection(node, stream);
      } else if (stream.alpn() === FREQHOLE_ALPN) {
        void handleApiRequest(stream);
      } else {
        console.log("[player] ignoring connection on unhandled alpn", stream.alpn());
        stream.close();
      }
    }
  })();
}

async function handleConnection(node: MiddenNode, stream: BiStream): Promise<void> {
  try {
    const peerNodeId = stream.peer_node_id();
    const trusted = await isTrustedController(peerNodeId);

    if (trusted) {
      // control session: keep the stream open and dispatch every command
      // line sent on it, until the controller closes its side.
      const controller = await getTrustedController(peerNodeId);
      markControllerConnected({
        node_id: peerNodeId,
        display_name: controller?.display_name ?? peerNodeId.slice(0, 8),
      });
      try {
        for (;;) {
          const line = (await stream.read_line()) as string | null;
          if (line === null) break;
          const ack = await dispatchCommand(node, line);
          await stream.write_line(JSON.stringify(ack));
        }
      } finally {
        markControllerDisconnected(peerNodeId);
      }
      return;
    }

    // untrusted peer: single-shot pairing handshake only.
    const line = (await stream.read_line()) as string | null;
    if (line === null) return;

    const response = await handlePairRequest(peerNodeId, line);
    await stream.write_line(JSON.stringify(response));

    // wait for the peer's clean close (EOF) before tearing down our own
    // side - closing immediately after write_line can race the QUIC flush
    // and surface as "connection lost" on the peer's read (write_line has
    // no built-in flush barrier, unlike write_raw_and_finish's stopped()
    // wait - see lib/midden/src/lib.rs).
    await stream.read_line();
  } catch (err) {
    console.error("[player] connection handling failed:", err);
  } finally {
    stream.close();
  }
}
