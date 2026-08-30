// dials a paired (or pairing) freqhole-player device directly over p2p and
// speaks the small ndjson protocol player.freqhole.net's acceptLoop
// implements: pair_request/pair_response for pairing, {type:"control",...}
// commands afterward. mirrors player.freqhole.net's own
// src/dev/testBridge.ts dial helpers.
//
// two transports, selected via isCharnelMode(): wasm (browser midden node,
// open_bi/write_line/read_line/close) and charnel (tauri native
// `player_pairing_dial` invoke, same one-line-request/response shape) -
// mirrors adminClient.ts's WasmAdminTransport/CharnelAdminTransport split.

import { getMiddenNode } from "../../api/client";
import { isCharnelMode } from "../charnel/mode";
import type { BiStreamLike } from "@freqhole/api-client";

export const PLAYER_ALPN = "freqhole-player/1";

export interface PairResult {
  ok: boolean;
  reason?: string;
}

// a cold peer connection (no prior direct/relay path established yet) can
// fail its first dial while iroh is still warming up addressing - mirrors
// connectionProgress.ts's bounded retry for the same underlying reason on
// http/admin remotes, so a first "pair" click doesn't need a manual retry.
const DIAL_RETRY_DELAYS_MS = [350, 900, 1800];

async function dialLineOnce(peerAddr: string, line: string): Promise<string | null> {
  if (isCharnelMode()) {
    // eslint-disable-next-line no-restricted-syntax -- tauri-only api, avoid bundling into web builds
    const { invoke } = await import("@tauri-apps/api/core");
    const result = await invoke<string | null>("player_pairing_dial", { peerAddr, line });
    return result ?? null;
  }

  const node = await getMiddenNode();
  if (!node.open_bi) {
    throw new Error("this transport does not support direct p2p streams");
  }
  const stream = await node.open_bi(peerAddr, PLAYER_ALPN);
  try {
    await stream.write_line(line);
    const response = (await stream.read_line()) as string | null;
    return response;
  } finally {
    stream.close();
  }
}

async function dialLine(peerAddr: string, line: string): Promise<string | null> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await dialLineOnce(peerAddr, line);
      // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
      console.log(`[debug/dial] attempt ${attempt + 1} succeeded, peerAddr=${peerAddr}`, {
        line,
        response,
      });
      return response;
    } catch (err) {
      // TEMP DEBUG - remove once the first-pair-attempt-fails bug is found
      console.log(`[debug/dial] attempt ${attempt + 1} failed, peerAddr=${peerAddr}`, err);
      if (attempt >= DIAL_RETRY_DELAYS_MS.length) throw err;
      await new Promise((resolve) => setTimeout(resolve, DIAL_RETRY_DELAYS_MS[attempt]));
    }
  }
}

export async function pairWithPlayer(
  peerAddr: string,
  pin: string,
  displayName: string
): Promise<PairResult> {
  const line = await dialLine(
    peerAddr,
    JSON.stringify({ type: "pair_request", pin, display_name: displayName })
  );
  if (!line) return { ok: false, reason: "no_response" };
  const parsed = JSON.parse(line) as { ok?: boolean; reason?: string };
  return { ok: parsed.ok === true, reason: parsed.reason };
}

// persistent control session per peer: acceptLoop.ts's server-side
// handleConnection already keeps a trusted controller's stream open and
// loops dispatchCommand()/write_line()/read_line() on it for as long as
// the peer keeps sending lines - but sendPlayerCommand() used to dial a
// brand-new open_bi() (a full iroh/QUIC connection: NAT traversal, relay
// negotiation, handshake) for every single command, never exercising that
// server-side design at all. reusing one stream per peer for as long as
// it's the active target cuts every command after the first down to just
// a write_line/read_line round trip on an already-open connection - see
// docs/player-remote-site-plan.md phase 18 item 5's assessment.
class PlayerControlSession {
  private stream: BiStreamLike | null = null;
  private dialing: Promise<BiStreamLike> | null = null;
  // serializes send() calls so two concurrent commands never interleave
  // their write_line/read_line pairs on the same stream.
  private tail: Promise<unknown> = Promise.resolve();

  constructor(private readonly peerAddr: string) {}

  private async getStream(): Promise<BiStreamLike> {
    if (this.stream) return this.stream;
    if (this.dialing) return this.dialing;
    this.dialing = (async () => {
      const node = await getMiddenNode();
      if (!node.open_bi) {
        throw new Error("this transport does not support direct p2p streams");
      }
      const stream = await node.open_bi(this.peerAddr, PLAYER_ALPN);
      this.stream = stream;
      return stream;
    })();
    try {
      return await this.dialing;
    } finally {
      this.dialing = null;
    }
  }

  private async sendNow(line: string): Promise<string | null> {
    for (let attempt = 0; ; attempt++) {
      try {
        const stream = await this.getStream();
        await stream.write_line(line);
        return (await stream.read_line()) as string | null;
      } catch (err) {
        // the stream (or the dial itself) is broken - drop it so the next
        // attempt redials from scratch, same backoff dialLine() already uses.
        this.stream = null;
        if (attempt >= DIAL_RETRY_DELAYS_MS.length) throw err;
        await new Promise((resolve) => setTimeout(resolve, DIAL_RETRY_DELAYS_MS[attempt]));
      }
    }
  }

  send(line: string): Promise<string | null> {
    const result = this.tail.then(() => this.sendNow(line));
    // swallow rejections in the chained tail only - callers still see the
    // real error via the returned promise - so one failed command doesn't
    // wedge every later command queued behind it.
    this.tail = result.catch(() => undefined);
    return result;
  }

  close(): void {
    this.stream?.close();
    this.stream = null;
  }
}

const controlSessions = new Map<string, PlayerControlSession>();

/** drops (and closes) the persistent control session for a peer, if one is
 * open - call this on navigate-away/target-change so a stale session
 * doesn't linger past the point it's actually reused. safe to call even if
 * no session exists yet. */
export function closePlayerControlSession(peerAddr: string): void {
  controlSessions.get(peerAddr)?.close();
  controlSessions.delete(peerAddr);
}

export async function sendPlayerCommand(peerAddr: string, command: unknown): Promise<unknown> {
  const line = JSON.stringify(command);
  // charnel/tauri's player_pairing_dial invoke has no persistent-session
  // equivalent yet (see subscribeToPlayerStatus's doc comment) - one-shot
  // dial there, same as before.
  if (isCharnelMode()) {
    const response = await dialLine(peerAddr, line);
    return response ? JSON.parse(response) : null;
  }
  let session = controlSessions.get(peerAddr);
  if (!session) {
    session = new PlayerControlSession(peerAddr);
    controlSessions.set(peerAddr, session);
  }
  const response = await session.send(line);
  return response ? JSON.parse(response) : null;
}

/** opens a persistent subscription stream to a paired player and invokes
 * `onStatus` every time it pushes a status update - a real-time
 * alternative to polling `sendPlayerCommand({command:"get_status"})` on an
 * interval. returns an unsubscribe function.
 *
 * auto-reconnects (after a short delay) if the stream ever closes or
 * throws while still subscribed - a transient blip here used to silently
 * and PERMANENTLY degrade a client to the 30s poll fallback for the rest
 * of the session (no reconnect attempt, no visible signal), which looked
 * like "another client's seek/queue change takes ages to show up" - the
 * push channel had quietly died and only the next poll tick ever caught
 * up. now it keeps retrying for as long as the caller hasn't unsubscribed.
 *
 * wasm-only for now: charnel/tauri's `player_pairing_dial` invoke is a
 * one-shot request/response with no persistent-stream equivalent yet -
 * callers should keep polling as a fallback there (see
 * remotePlaybackControl.ts's setRemoteStatusPolling, which stays enabled
 * unconditionally alongside this). */
export function subscribeToPlayerStatus(
  peerAddr: string,
  onStatus: (status: unknown) => void
): () => void {
  if (isCharnelMode()) return () => {};

  const RECONNECT_DELAY_MS = 2_000;
  let closed = false;
  let stream: BiStreamLike | null = null;

  void (async () => {
    while (!closed) {
      try {
        const node = await getMiddenNode();
        if (!node.open_bi) return;
        const s = await node.open_bi(peerAddr, PLAYER_ALPN);
        if (closed) {
          s.close();
          return;
        }
        stream = s;
        await s.write_line(JSON.stringify({ type: "subscribe" }));
        for (;;) {
          const line = (await s.read_line()) as string | null;
          if (line === null) break;
          try {
            onStatus(JSON.parse(line));
          } catch {
            // malformed push line - ignore, next push will arrive fine
          }
        }
      } catch {
        // dial/stream failed - fall through to the reconnect delay below
        // (poll fallback still covers status in the meantime)
      } finally {
        stream?.close();
        stream = null;
      }
      if (closed) break;
      await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
    }
  })();

  return () => {
    closed = true;
    stream?.close();
  };
}
