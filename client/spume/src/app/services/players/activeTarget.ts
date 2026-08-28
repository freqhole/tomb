// phase 6: unified local/remote playback target ("spotify-connect style").
// one active target at a time - either this device's own local playback,
// or a specific paired freqhole-player device. not persisted across
// reloads (deliberately - a fresh page load always defaults back to local,
// the safe/expected state, rather than silently reconnecting to a player
// that might not be reachable anymore).

import { createSignal } from "solid-js";

export type ActiveTarget =
  { kind: "local" } | { kind: "player"; node_id: string; display_name: string };

const LOCAL_TARGET: ActiveTarget = { kind: "local" };

const [target, setTargetSignal] = createSignal<ActiveTarget>(LOCAL_TARGET);
export const activeTarget = target;

export function setActiveTargetToLocal(): void {
  setTargetSignal(LOCAL_TARGET);
}

export function setActiveTargetToPlayer(player: { node_id: string; display_name: string }): void {
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
