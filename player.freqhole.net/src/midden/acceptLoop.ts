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
import { SubscribeRequestSchema } from "../control/schema";
import { registerSubscriber, unregisterSubscriber } from "../control/statusSubscribers";
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
      const firstLine = (await stream.read_line()) as string | null;
      if (firstLine === null) return;

      const controller = await getTrustedController(peerNodeId);
      const connectedInfo = {
        node_id: peerNodeId,
        display_name: controller?.display_name ?? peerNodeId.slice(0, 8),
      };

      if (isSubscribeRequest(firstLine)) {
        // push-subscription session (phase 12 follow-up): no commands are
        // ever dispatched on this stream - just register it for
        // statusSubscribers.broadcastStatus() pushes and wait for the
        // controller to close it.
        registerSubscriber(peerNodeId, stream);
        markControllerConnected(connectedInfo);
        try {
          for (;;) {
            const line = (await stream.read_line()) as string | null;
            if (line === null) break;
          }
        } finally {
          unregisterSubscriber(peerNodeId, stream);
          markControllerDisconnected(peerNodeId);
        }
        return;
      }

      // control session: keep the stream open and dispatch every command
      // line sent on it, until the controller closes its side.
      markControllerConnected(connectedInfo);
      try {
        let line: string | null = firstLine;
        while (line !== null) {
          const ack = await dispatchCommand(node, line);
          await stream.write_line(JSON.stringify(ack));
          line = (await stream.read_line()) as string | null;
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
    // console.error("[player] connection handling failed:", err);
  } finally {
    stream.close();
  }
}

function isSubscribeRequest(rawLine: string): boolean {
  try {
    return SubscribeRequestSchema.safeParse(JSON.parse(rawLine)).success;
  } catch {
    return false;
  }
}
