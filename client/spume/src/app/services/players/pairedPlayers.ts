// paired player devices (freqhole-player/1 remotes) — now just `Remote`
// records with `is_player_device: true` (see
// docs/rathole-pairing-invite-code-plan.md and
// docs/cenotaph-migration-plan.md phase 7). this module is a thin,
// player-shaped view over remoteManager.ts's CRUD, kept so existing
// callers (QueuePlayerTargetRow.tsx, PairedPlayersView.tsx,
// playerPresenceStore.ts, AddRemoteModal.tsx, PairPlayerModal.tsx) don't
// need to know about the full `Remote` shape - they only ever needed
// `{node_id, username, created_at}`.
//
// superseded design: this used to be backed by a separate
// users/user_peer_nodes idb mirror (services/users/usersStore.ts) shared
// with trustStoreAdapter.ts's INBOUND trust list - that dual-purpose
// store still exists for inbound trust, but outbound pairing (this
// module) no longer uses it: a paired player is a real, ordinary `Remote`
// like any other, consistent with how pairing with a grimoire-backed
// player (rathole) now works (redeems a real invite code, then behaves
// like any other remote - see rathole-pairing-invite-code-plan.md).
// existing pre-refactor entries in the old store are not migrated (no
// real deployed userbase, per prior precedent) - re-pairing recreates
// them as `Remote` records.

import { createSignal } from "solid-js";
import {
  createRemote,
  deleteRemote,
  getAllRemotes,
  getRemoteByPeerAddr,
  updateRemote,
  updateRemoteConnectionTime,
} from "../remotes/remoteManager";
import { isHttpRemote, type P2PRemote } from "../storage/types";

export interface PairedPlayer {
  node_id: string;
  username: string;
  created_at: number;
}

function toPairedPlayer(remote: P2PRemote): PairedPlayer {
  return { node_id: remote.peer_addr, username: remote.name, created_at: remote.created_at };
}

// bumped whenever players are paired/renamed/forgotten so views can
// refresh without polling (mirrors radioHistoryVersion's pattern).
const [version, setVersion] = createSignal(0);
export const pairedPlayersVersion = version;

function bumpVersion(): void {
  setVersion((v) => v + 1);
}

export async function listPairedPlayers(): Promise<PairedPlayer[]> {
  const all = await getAllRemotes();
  return all
    .filter((r): r is P2PRemote => !isHttpRemote(r) && r.is_player_device === true)
    .sort((a, b) => b.created_at - a.created_at)
    .map(toPairedPlayer);
}

export async function getPairedPlayer(nodeId: string): Promise<PairedPlayer | null> {
  const remote = await getRemoteByPeerAddr(nodeId);
  if (!remote || isHttpRemote(remote) || !remote.is_player_device) return null;
  return toPairedPlayer(remote);
}

export async function savePairedPlayer(nodeId: string, displayName: string): Promise<PairedPlayer> {
  const existing = await getRemoteByPeerAddr(nodeId);
  if (existing) {
    const updated = await updateRemote(existing.remote_id, { name: displayName });
    bumpVersion();
    return { node_id: nodeId, username: updated.name, created_at: updated.created_at };
  }
  const remote = await createRemote({
    name: displayName,
    peer_addr: nodeId,
    is_player_device: true,
  });
  bumpVersion();
  return toPairedPlayer(remote as P2PRemote);
}

export async function renamePairedPlayer(nodeId: string, displayName: string): Promise<void> {
  const existing = await getRemoteByPeerAddr(nodeId);
  if (!existing) return;
  await updateRemote(existing.remote_id, { name: displayName });
  bumpVersion();
}

export async function forgetPairedPlayer(nodeId: string): Promise<void> {
  const existing = await getRemoteByPeerAddr(nodeId);
  if (!existing) return;
  await deleteRemote(existing.remote_id);
  bumpVersion();
}

export async function touchPairedPlayer(nodeId: string): Promise<void> {
  const existing = await getRemoteByPeerAddr(nodeId);
  if (!existing) return;
  await updateRemoteConnectionTime(existing.remote_id);
}
