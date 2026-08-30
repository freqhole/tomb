// implements cenotaph's `TrustStore` interface against spume's shared
// users/user_peer_nodes stores (see services/users/usersStore.ts) rather
// than a dedicated store - deliberately NOT cenotaph's own
// `createIdbTrustStore()`, which would stand up a second, separate
// indexeddb database for no reason when spume already has one to share.
// this is spume's single, unified, role-aware incoming-peer-trust list
// (docs/player-peer-trust-bridge-plan.md) - also consulted by
// acceptModeBootstrap.ts's apiRouter `resolvePeerRole`. the same two
// stores also back `pairedPlayers.ts`'s outbound "players this instance
// dials" list, since both are just "known peer identities".

import type { TrustedController, TrustStore } from "@freqhole/cenotaph";
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

export const spumeTrustStore: TrustStore = {
  async isTrustedController(nodeId) {
    return (await findUserByNodeId(nodeId)) !== null;
  },

  async getTrustedController(nodeId) {
    const joined = await findUserByNodeId(nodeId);
    return joined ? toTrustedController(joined) : undefined;
  },

  async trustController(nodeId, displayName, role) {
    await allowPeer(nodeId, displayName, role);
  },

  async forgetController(nodeId) {
    await removePeerNode(nodeId);
  },

  async listTrustedControllers() {
    const all = await listPeerNodesWithUsers();
    return all.map(toTrustedController);
  },
};
