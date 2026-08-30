// builds the freqhole-player/1 connection handler: pairing handshake for
// untrusted peers, command dispatch + push-subscription sessions for
// trusted ones. parameterized by a `PlaybackBackend` so different host
// apps (player.freqhole.net's own media-element engine, spume's real
// player) can plug in their own playback implementation without forking
// this logic - see playbackBackend.ts.

import type { CenotaphBiStream } from "../midden/node";
import { handlePairRequest } from "../pairing/pairingHandler";
import type { TrustStore } from "../pairing/trustStore";
import {
  ensureActiveSession,
  isPeerAllowedInSession,
  touchSession,
} from "../pairing/playerSession";
import type { PlayerSessionStore } from "../pairing/playerSession";
import { dispatchCommand } from "./dispatcher";
import { PresenceQuerySchema, SubscribeRequestSchema } from "./schema";
import { registerSubscriber, unregisterSubscriber } from "./statusSubscribers";
import { markControllerConnected, markControllerDisconnected } from "./connectedControllers";
import type { PlaybackBackend } from "./playbackBackend";

export interface PlayerConnectionHandlerOptions<TNode = unknown> {
  backend: PlaybackBackend<TNode>;
  /** where pairing/trust state is persisted - see trustStore.ts for why
   * this is injected rather than owned by cenotaph itself. */
  trustStore: TrustStore;
  /** where the ephemeral player session (who's currently allowed to send
   * commands, see playerSession.ts) is persisted. */
  sessionStore: PlayerSessionStore;
  /** called once per connection attempt, before any pairing/trust handling
   * runs; return false to reject the connection outright (e.g. a host-side
   * "remote mode" toggle that's currently off) - the stream is closed
   * immediately with no pairing handshake at all. defaults to
   * always-enabled. */
  isEnabled?: () => boolean;
}

/** builds a per-connection handler for `midden/acceptLoop.ts`'s
 * `startAcceptLoop`, registered against `PLAYER_ALPN`. */
export function createPlayerConnectionHandler<TNode = unknown>(
  options: PlayerConnectionHandlerOptions<TNode>,
): (node: TNode, stream: CenotaphBiStream) => Promise<void> {
  const { backend, trustStore, sessionStore, isEnabled } = options;

  return async function handleConnection(node: TNode, stream: CenotaphBiStream): Promise<void> {
    if (isEnabled && !isEnabled()) {
      // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
      console.log("[debug/playerConn] rejected: isEnabled() returned false");
      stream.close();
      return;
    }

    try {
      const peerNodeId = stream.peer_node_id();
      const trusted = await trustStore.isTrustedController(peerNodeId);
      // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
      console.log(
        `[debug/playerConn] connection from ${peerNodeId.slice(0, 12)}, trusted=${trusted}`,
      );

      const firstLine = (await stream.read_line()) as string | null;
      if (firstLine === null) return;

      if (isPairRequestLine(firstLine)) {
        // a pair_request always goes through the pairing handshake, even
        // from an already-trusted peer: a controller that "forgot" this
        // player locally has no record of ever pairing, so it re-sends
        // pair_request on its next attempt. trustController() is an
        // upsert, so this just re-validates the pin and refreshes the
        // display_name/paired_at - it never fails just for being an
        // already-trusted node_id (previously this fell through to
        // command dispatch as an untrusted-shaped check, and dispatchCommand
        // rejected it as {ok:false, reason:"invalid_command"}).
        const session = await ensureActiveSession(sessionStore);
        const response = await handlePairRequest(
          trustStore,
          sessionStore,
          session,
          peerNodeId,
          firstLine,
        );
        // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
        console.log("[debug/playerConn] pair response:", response);
        await stream.write_line(JSON.stringify(response));

        // wait for the peer's clean close (EOF) before tearing down our own
        // side - closing immediately after write_line can race the QUIC
        // flush and surface as "connection lost" on the peer's read
        // (write_line has no built-in flush barrier, unlike
        // write_raw_and_finish's stopped() wait - see lib/midden/src/lib.rs).
        await stream.read_line();
        return;
      }

      if (trusted) {
        const controller = await trustStore.getTrustedController(peerNodeId);
        const connectedInfo = {
          node_id: peerNodeId,
          display_name: controller?.display_name ?? peerNodeId.slice(0, 8),
        };

        if (isPresenceQuery(firstLine)) {
          // one-shot: answer with the current presence and close - no
          // persistent registration, unlike subscribe below (see schema.ts's
          // `PresenceQuery` doc comment). reaching this point already means
          // isEnabled() was true (checked at the very top of this function),
          // so the answer is always "active" here - a peer that dials while
          // presence is off gets no response at all (connection rejected
          // before ever reading a line), which callers should treat the same
          // as "stopped"/unreachable.
          await stream.write_line(JSON.stringify({ type: "presence", state: "active" }));
          return;
        }

        if (isSubscribeRequest(firstLine)) {
          // push-subscription session: no commands are ever dispatched on
          // this stream - just register it for statusSubscribers.
          // broadcastStatus() pushes and wait for the controller to close
          // it. status is read-only, so this doesn't need session
          // membership - any trusted peer can watch what's playing.
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

        // sending actual (mutating) commands additionally requires being
        // part of the current session (see playerSession.ts) - a peer can
        // be a long-known trusted controller from a past gathering
        // without being part of this one. checked per-command (not once
        // for the whole stream) and `get_status` is exempted, same as
        // subscribe/presence above - it's read-only (sent constantly by
        // every paired client's background poll, see dispatcher.ts's
        // `QR_HIDING_COMMANDS` comment) and rejecting it just because a
        // peer isn't in-session breaks reconciliation polling for no
        // security benefit.
        let session = await ensureActiveSession(sessionStore);

        // control session: keep the stream open and dispatch every
        // command line sent on it, until the controller closes its side.
        markControllerConnected(connectedInfo);
        try {
          let line: string | null = firstLine;
          while (line !== null) {
            if (!isGetStatusCommand(line) && !isPeerAllowedInSession(session, peerNodeId)) {
              await stream.write_line(
                JSON.stringify({ type: "command_ack", ok: false, reason: "not_in_session" }),
              );
            } else {
              const ack = await dispatchCommand(backend, node, line);
              await stream.write_line(JSON.stringify(ack));
              session = await touchSession(sessionStore, session);
            }
            line = (await stream.read_line()) as string | null;
          }
        } finally {
          markControllerDisconnected(peerNodeId);
        }
        return;
      }

      // untrusted peer sent something other than a pair_request - reject
      // rather than dispatching it as a command.
      // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
      console.log("[debug/playerConn] untrusted peer sent non-pair-request:", firstLine);
      await stream.write_line(
        JSON.stringify({ type: "pair_response", ok: false, reason: "invalid_pin" }),
      );
    } catch (err) {
      // console.error("[cenotaph] player connection handling failed:", err);
    } finally {
      stream.close();
    }
  };
}

function isSubscribeRequest(rawLine: string): boolean {
  try {
    return SubscribeRequestSchema.safeParse(JSON.parse(rawLine)).success;
  } catch {
    return false;
  }
}

function isPresenceQuery(rawLine: string): boolean {
  try {
    return PresenceQuerySchema.safeParse(JSON.parse(rawLine)).success;
  } catch {
    return false;
  }
}

function isGetStatusCommand(rawLine: string): boolean {
  try {
    const parsed = JSON.parse(rawLine) as { type?: unknown; command?: unknown };
    return parsed.type === "control" && parsed.command === "get_status";
  } catch {
    return false;
  }
}

function isPairRequestLine(rawLine: string): boolean {
  try {
    return (JSON.parse(rawLine) as { type?: unknown }).type === "pair_request";
  } catch {
    return false;
  }
}
