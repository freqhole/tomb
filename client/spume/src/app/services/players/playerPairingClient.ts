// dials a paired (or pairing) freqhole-player device directly over p2p and
// speaks the small ndjson protocol player.freqhole.net's acceptLoop
// implements: pair_request/pair_response for pairing, {type:"control",...}
// commands afterward. mirrors player.freqhole.net's own
// src/dev/testBridge.ts dial helpers.
//
// non-charnel (browser/wasm) only for now — getMiddenNode() throws under
// tauri/charnel; charnel-transport parity is left for a follow-up (see
// docs/player-remote-site-plan.md phase 5).

import { getMiddenNode } from "../../api/client";

export const PLAYER_ALPN = "freqhole-player/1";

export interface PairResult {
  ok: boolean;
  reason?: string;
}

export async function pairWithPlayer(
  peerAddr: string,
  pin: string,
  displayName: string
): Promise<PairResult> {
  const node = await getMiddenNode();
  if (!node.open_bi) {
    throw new Error("this transport does not support direct p2p streams");
  }
  const stream = await node.open_bi(peerAddr, PLAYER_ALPN);
  try {
    await stream.write_line(
      JSON.stringify({ type: "pair_request", pin, display_name: displayName })
    );
    const line = await stream.read_line();
    if (!line) return { ok: false, reason: "no_response" };
    const parsed = JSON.parse(line) as { ok?: boolean; reason?: string };
    return { ok: parsed.ok === true, reason: parsed.reason };
  } finally {
    stream.close();
  }
}

export async function sendPlayerCommand(peerAddr: string, command: unknown): Promise<unknown> {
  const node = await getMiddenNode();
  if (!node.open_bi) {
    throw new Error("this transport does not support direct p2p streams");
  }
  const stream = await node.open_bi(peerAddr, PLAYER_ALPN);
  try {
    await stream.write_line(JSON.stringify(command));
    const line = await stream.read_line();
    return line ? JSON.parse(line) : null;
  } finally {
    stream.close();
  }
}
