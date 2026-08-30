// paired player devices (freqhole-player/1 remotes) — backed by the
// shared users/user_peer_nodes stores (see services/users/usersStore.ts)
// rather than a dedicated store. NOT part of the `Remote` schema: a
// paired player has no http/admin api surface, just pairing + a small
// control-command protocol, so folding it into the `Remote` discriminated
// union would leak player-only concerns (pin state, control acks) into
// every generic remote/api-dispatch call site. see
// docs/player-remote-site-plan.md phase 5 for the no-Remote rationale, and
// docs/player-peer-trust-bridge-plan.md for the users/user_peer_nodes
// mirroring rationale.

import { createSignal } from "solid-js";
import {
  allowPeer,
  findUserByNodeId,
  listPeerNodesWithUsers,
  removePeerNode,
  touchPeerNode,
  updateUser,
} from "../users/usersStore";
import type { PeerNodeWithUser } from "../storage/types";

// bumped whenever players are paired/renamed/forgotten so views can
// refresh without polling (mirrors radioHistoryVersion's pattern).
const [version, setVersion] = createSignal(0);
export const pairedPlayersVersion = version;

function bumpVersion(): void {
  setVersion((v) => v + 1);
}

export async function listPairedPlayers(): Promise<PeerNodeWithUser[]> {
  const all = await listPeerNodesWithUsers();
  return all.sort((a, b) => b.created_at - a.created_at);
}

export async function getPairedPlayer(nodeId: string): Promise<PeerNodeWithUser | null> {
  return findUserByNodeId(nodeId);
}

export async function savePairedPlayer(
  nodeId: string,
  displayName: string
): Promise<PeerNodeWithUser> {
  // outbound pairing doesn't grant any special privilege - "member" is a
  // nominal default, unused for anything since this instance never checks
  // a paired player's own role (only inbound trust, in trustStoreAdapter.ts,
  // ever consults role for auth purposes).
  const player = await allowPeer(nodeId, displayName, "member");
  bumpVersion();
  return player;
}

export async function renamePairedPlayer(nodeId: string, displayName: string): Promise<void> {
  const existing = await findUserByNodeId(nodeId);
  if (!existing) return;
  await updateUser(existing.user_id, { username: displayName });
  bumpVersion();
}

export async function forgetPairedPlayer(nodeId: string): Promise<void> {
  await removePeerNode(nodeId);
  bumpVersion();
}

export async function touchPairedPlayer(nodeId: string): Promise<void> {
  await touchPeerNode(nodeId);
}
