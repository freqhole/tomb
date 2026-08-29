// push channel (phase 12 follow-up): registry of open "status subscription"
// streams. a controller can dial one of these and leave it open
// indefinitely (distinct from the existing dial-per-command sessions the
// control protocol otherwise uses - see midden/acceptLoop.ts) to receive a
// `PlayerStatus` push the moment anything changes on the player, instead of
// polling `get_status` on an interval.
//
// wasm-only for now: the charnel/tauri native transport dials a single
// request/response invoke per command (`player_pairing_dial`) with no
// persistent-stream equivalent yet - a native controller still has to fall
// back to polling until that gets built (tracked in
// docs/player-remote-site-plan.md phase 12).

import type { BiStream } from "@freqhole/midden";
import type { PlayerStatus } from "./schema";

const subscribers = new Map<string, Set<BiStream>>();

export function registerSubscriber(nodeId: string, stream: BiStream): void {
  let set = subscribers.get(nodeId);
  if (!set) {
    set = new Set();
    subscribers.set(nodeId, set);
  }
  set.add(stream);
}

export function unregisterSubscriber(nodeId: string, stream: BiStream): void {
  const set = subscribers.get(nodeId);
  if (!set) return;
  set.delete(stream);
  if (set.size === 0) subscribers.delete(nodeId);
}

/** pushes a status update to every currently-subscribed controller stream.
 * a write failure just drops that stream from the registry - the accept
 * loop's own read side independently notices the close and cleans up too. */
export function broadcastStatus(status: PlayerStatus): void {
  if (subscribers.size === 0) return;
  const line = JSON.stringify(status);
  for (const [nodeId, streams] of subscribers) {
    for (const stream of streams) {
      stream.write_line(line).catch(() => {
        subscribers.get(nodeId)?.delete(stream);
      });
    }
  }
}
