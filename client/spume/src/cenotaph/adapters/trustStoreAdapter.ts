// implements cenotaph's `TrustStore` interface against spume's shared
// users/user_peer_nodes stores (see services/users/usersStore.ts) rather
// than a dedicated store - deliberately NOT cenotaph's own
// `createIdbTrustStore()`, which would stand up a second, separate
// indexeddb database for no reason when spume already has one to share.
// this is spume's single, unified, role-aware incoming-peer-trust list
// (docs/player-peer-trust-bridge-plan.md) - also consulted by
// acceptModeBootstrap.ts's apiRouter `resolvePeerRole`.
//
// charnel/tauri mode has a REAL grimoire instance already running
// locally, though - inbound trust there should be the SAME
// UserPeerNode/User trust every other peer-auth check in the app already
// uses (via admin_dispatch's peers_allow/peers_list_all/peers_hard_delete),
// not a second, browser-only idb mirror. so this store branches on
// `isCharnelMode()`: charnel delegates to real grimoire; plain-browser
// mode (no grimoire to delegate to) keeps the idb-backed mirror below.
// this mirror is inbound-trust-only now - `pairedPlayers.ts`'s outbound
// "players this instance dials" list uses `Remote` records directly (see
// rathole-pairing-invite-code-plan.md and cenotaph-migration-plan.md
// phase 7), not this store.

import type { PeerRole, TrustedController, TrustStore } from "@freqhole/cenotaph";
import { adminLocalRawDispatch } from "../../api/adminClient";
import { isCharnelMode } from "../charnel/mode";
import {
  allowPeer,
  findUserByNodeId,
  listPeerNodesWithUsers,
  removePeerNode,
} from "../users/usersStore";
import type { PeerNodeWithUser } from "../storage/types";

function toTrustedController(joined: PeerNodeWithUser): TrustedController {
  return {
    node_id: joined.node_id,
    display_name: joined.username,
    role: joined.role,
    paired_at: joined.created_at,
  };
}

// grimoire's admin_dispatch `peers_list_all` response shape (see
// grimoire/src/admin_dispatch/types/peers.rs's `AdminPeerSummary`) - kept
// as a local, minimal interface (this is the only admin_dispatch response
// this module reads) rather than pulling in a generated client type.
interface AdminPeerSummary {
  node_id: string;
  username: string;
  role: string;
  created_at: number;
  deleted_at: number | null;
}

function toPeerRole(role: string): PeerRole {
  return role === "admin" || role === "member" || role === "viewer" ? role : "viewer";
}

function toTrustedControllerFromAdmin(peer: AdminPeerSummary): TrustedController {
  return {
    node_id: peer.node_id,
    display_name: peer.username,
    role: toPeerRole(peer.role),
    paired_at: peer.created_at,
  };
}

async function listAdminPeers(): Promise<AdminPeerSummary[]> {
  const all = await adminLocalRawDispatch<AdminPeerSummary[]>("peers_list_all");
  return all.filter((p) => !p.deleted_at);
}

export const spumeTrustStore: TrustStore = {
  async isTrustedController(nodeId) {
    if (isCharnelMode()) {
      const peers = await listAdminPeers();
      return peers.some((p) => p.node_id === nodeId);
    }
    return (await findUserByNodeId(nodeId)) !== null;
  },

  async getTrustedController(nodeId) {
    if (isCharnelMode()) {
      const peers = await listAdminPeers();
      const found = peers.find((p) => p.node_id === nodeId);
      return found ? toTrustedControllerFromAdmin(found) : undefined;
    }
    const joined = await findUserByNodeId(nodeId);
    return joined ? toTrustedController(joined) : undefined;
  },

  async trustController(nodeId, displayName, role) {
    if (isCharnelMode()) {
      await adminLocalRawDispatch("peers_allow", {
        node_id: nodeId,
        username: displayName,
        role,
      });
      return;
    }
    await allowPeer(nodeId, displayName, role);
  },

  async forgetController(nodeId) {
    if (isCharnelMode()) {
      await adminLocalRawDispatch("peers_hard_delete", { node_id: nodeId });
      return;
    }
    await removePeerNode(nodeId);
  },

  async listTrustedControllers() {
    if (isCharnelMode()) {
      const peers = await listAdminPeers();
      return peers.map(toTrustedControllerFromAdmin);
    }
    const all = await listPeerNodesWithUsers();
    return all.map(toTrustedController);
  },
};
