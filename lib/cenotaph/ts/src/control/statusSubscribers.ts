// push channel: registry of open "status subscription" streams. a
// controller can dial one of these and leave it open indefinitely (distinct
// from the existing dial-per-command sessions the control protocol
// otherwise uses - see control/playerConnectionHandler.ts) to receive a
// `PlayerStatus` push the moment anything changes on the player, instead of
// polling `get_status` on an interval.
//
// wasm-only for now: the charnel/tauri native transport dials a single
// request/response invoke per command with no persistent-stream equivalent
// yet - a native controller still has to fall back to polling until that
// gets built.

import type { CenotaphBiStream } from "../midden/node";
import type { PlayerStatus, PresenceAnnouncement } from "./schema";

const subscribers = new Map<string, Set<CenotaphBiStream>>();

export function registerSubscriber(nodeId: string, stream: CenotaphBiStream): void {
  let set = subscribers.get(nodeId);
  if (!set) {
    set = new Set();
    subscribers.set(nodeId, set);
  }
  set.add(stream);
}

export function unregisterSubscriber(nodeId: string, stream: CenotaphBiStream): void {
  const set = subscribers.get(nodeId);
  if (!set) return;
  set.delete(stream);
  if (set.size === 0) subscribers.delete(nodeId);
}

/** pushes one line to every currently-subscribed controller stream. a
 * write failure just drops that stream from the registry - the accept
 * loop's own read side independently notices the close and cleans up too. */
function broadcastLine(line: string): void {
  if (subscribers.size === 0) return;
  for (const [nodeId, streams] of subscribers) {
    for (const stream of streams) {
      stream.write_line(line).catch(() => {
        subscribers.get(nodeId)?.delete(stream);
      });
    }
  }
}

export function broadcastStatus(status: PlayerStatus): void {
  broadcastLine(JSON.stringify(status));
}

/** pushes a presence change (this device starting/stopping acting as a
 * player) to every currently-subscribed controller stream - a host app
 * calls this from its own start/stop lifecycle (mount/unmount, a remote-
 * playback toggle, beforeunload/pagehide) since cenotaph has no lifecycle
 * hook of its own for "the player is about to stop". see schema.ts's
 * `PresenceAnnouncement` for what "active"/"stopped" mean. */
export function broadcastPresence(presence: PresenceAnnouncement): void {
  broadcastLine(JSON.stringify(presence));
}
