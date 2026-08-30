// phase 6: unified local/remote playback target ("spotify-connect style").
// one active target at a time - either this device's own local playback,
// or a specific paired freqhole-player device. not persisted across
// reloads (deliberately - a fresh page load always defaults back to local,
// the safe/expected state, rather than silently reconnecting to a player
// that might not be reachable anymore).

import { createSignal } from "solid-js";
import { closePlayerControlSession } from "./playerPairingClient";

export type ActiveTarget =
  { kind: "local" } | { kind: "player"; node_id: string; display_name: string };

const LOCAL_TARGET: ActiveTarget = { kind: "local" };

const [target, setTargetSignal] = createSignal<ActiveTarget>(LOCAL_TARGET);
export const activeTarget = target;

export function setActiveTargetToLocal(): void {
  const prev = target();
  if (prev.kind === "player") closePlayerControlSession(prev.node_id);
  setTargetSignal(LOCAL_TARGET);
}

export function setActiveTargetToPlayer(player: { node_id: string; display_name: string }): void {
  const prev = target();
  // switching directly from one player to another - don't leave the old
  // one's persistent stream open past the point it'll ever be reused.
  if (prev.kind === "player" && prev.node_id !== player.node_id) {
    closePlayerControlSession(prev.node_id);
  }
  setTargetSignal({ kind: "player", node_id: player.node_id, display_name: player.display_name });
}

export function isRemoteTargetActive(): boolean {
  return target().kind === "player";
}

/** the active player's node_id, or null when the local target is active. */
export function activeTargetNodeId(): string | null {
  const t = target();
  return t.kind === "player" ? t.node_id : null;
}
