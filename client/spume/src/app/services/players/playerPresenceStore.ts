// shared, reactive "is this paired player online?" map - mirrors
// remoteHealth.ts's `wakeAllRemotes()`/`onlineMap` pattern for the
// player-pairing equivalent. exists so a boot-time presence sweep and
// QueuePlayerTargetRow's flyout-open refresh both feed the same signal,
// instead of each keeping its own private, component-local copy.

import { createSignal } from "solid-js";
import { listPairedPlayers } from "./pairedPlayers";
import { queryPlayerPresence, type PlayerPresence } from "./playerPairingClient";

const [presence, setPresence] = createSignal<Record<string, PlayerPresence>>({});

/** reactive accessor - `undefined` for a node id not probed yet this
 * session (neither confirmed online nor offline). */
export const playerPresence = presence;

let inFlight: Promise<void> | null = null;

/** fire-and-forget sweep of every paired player's presence - returns
 * immediately, never awaited by callers (in particular, app boot must not
 * block initial render on this). results land in `playerPresence()` as
 * each probe resolves. concurrent calls share one in-flight sweep rather
 * than piling up redundant dials. */
export function wakeAllPlayers(): void {
  if (inFlight) return;
  inFlight = (async () => {
    try {
      const players = await listPairedPlayers();
      await Promise.all(
        players.map((player) =>
          queryPlayerPresence(player.node_id).then((state) => {
            setPresence((prev) => ({ ...prev, [player.node_id]: state }));
          })
        )
      );
    } catch {
      // best-effort sweep only - a failure here just leaves some/all
      // players at "not probed yet" for this session.
    } finally {
      inFlight = null;
    }
  })();
}
