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

async function dialLine(peerAddr: string, line: string): Promise<string | null> {
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

export async function sendPlayerCommand(peerAddr: string, command: unknown): Promise<unknown> {
  const line = await dialLine(peerAddr, JSON.stringify(command));
  return line ? JSON.parse(line) : null;
}

/** opens a persistent subscription stream to a paired player and invokes
 * `onStatus` every time it pushes a status update - a real-time
 * alternative to polling `sendPlayerCommand({command:"get_status"})` on an
 * interval. returns an unsubscribe function.
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

  let closed = false;
  let stream: BiStreamLike | null = null;

  void (async () => {
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
      // dial/stream failed - caller's polling fallback still covers status
    } finally {
      stream?.close();
    }
  })();

  return () => {
    closed = true;
    stream?.close();
  };
}
