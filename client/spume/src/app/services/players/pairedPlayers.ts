// "play on" / player-target listing: a player is just an ordinary `Remote`
// (added and managed via remoteManager.ts directly, same as any other
// remote) - there's no separate CRUD/storage system for "paired players"
// anymore. two different read-only views over that same remote list live
// here, for two genuinely different questions:
//   - `listCurrentPlayers`: remotes CURRENTLY reporting player mode (see
//     remoteHealth.ts's live `isPlayerNow` signal, fed from the same hello
//     probe already used for online status) - what the "play on" flyout
//     (QueuePlayerTargetRow.tsx) wants, since casting only makes sense to a
//     live target.
//   - `listPairedPlayerRemotes`: every remote EVER paired via the player
//     pin flow (`Remote.paired_as_player` - a permanent, write-once
//     categorization, not a live status), regardless of current
//     reachability - what the settings "players" list
//     (PairedPlayersView.tsx) wants, so an offline/session-expired player
//     stays manageable instead of vanishing.
// kept in one module because both are thin queries over the same
// `{remote_id, node_id, username, created_at}`-shaped view.

import { createSignal } from "solid-js";
import {
  getAllRemotes,
  onPlayerStatusChange,
  onRemoteStatusChange,
} from "../remotes/remoteManager";
import { isPlayerNowSnapshot } from "../remotes/remoteHealth";
import { isHttpRemote, type P2PRemote } from "../storage/types";

export interface PairedPlayer {
  remote_id: string;
  node_id: string;
  username: string;
  created_at: number;
}

function toPairedPlayer(remote: P2PRemote): PairedPlayer {
  return {
    remote_id: remote.remote_id,
    node_id: remote.peer_addr,
    username: remote.name,
    created_at: remote.created_at,
  };
}

// bumped whenever any remote's online/player status changes, so views
// can refetch without polling (mirrors the old CRUD-driven version
// signal this replaces - there's no separate pairing bookkeeping to
// bump on anymore, just the live status broadcasts).
const [version, setVersion] = createSignal(0);
export const currentPlayersVersion = version;
function bump(): void {
  setVersion((v) => v + 1);
}
onPlayerStatusChange(() => bump());
onRemoteStatusChange(() => bump());

/** remotes currently reporting player mode - a point-in-time read; for
 * a live-updating view, react to `currentPlayersVersion` (or
 * remoteHealth.ts's `isPlayerNow` directly) instead of polling this. */
export async function listCurrentPlayers(): Promise<PairedPlayer[]> {
  const all = await getAllRemotes();
  return all
    .filter((r): r is P2PRemote => !isHttpRemote(r) && isPlayerNowSnapshot(r.remote_id) === true)
    .sort((a, b) => b.created_at - a.created_at)
    .map(toPairedPlayer);
}

/** every remote ever paired via the player pin flow (`paired_as_player`,
 * see `RemoteCommonSchema`'s doc comment) - regardless of whether it's
 * CURRENTLY reachable/in player mode. used by the settings "players" view
 * (PairedPlayersView.tsx), which needs to stay manageable (rename/forget/
 * re-enter pin) for an offline or session-expired player, unlike
 * `listCurrentPlayers` above which deliberately only surfaces live
 * targets for the "play on" picker. */
export async function listPairedPlayerRemotes(): Promise<PairedPlayer[]> {
  const all = await getAllRemotes();
  return all
    .filter((r): r is P2PRemote => !isHttpRemote(r) && r.paired_as_player === true)
    .sort((a, b) => b.created_at - a.created_at)
    .map(toPairedPlayer);
}
