// shared "known peer identity" store - mirrors grimoire's users::{User,
// UserPeerNode} repository pattern (grimoire/src/users/repository.rs) as
// closely as idb allows, kept as two separate stores rather than
// flattened. browser-world is always exactly 1 node_id : 1 user today,
// but keeping the same shape as grimoire means a real grimoire-backed
// multi-device user later is a straightforward mapping, not a redesign
// (see docs/player-peer-trust-bridge-plan.md).
//
// used by BOTH services/players/pairedPlayers.ts (outbound - players this
// instance dials) and services/remotePlayback/trustStoreAdapter.ts
// (inbound - controllers trusted to dial this instance), since both are
// just "known peer identities" and there's no reason to keep two separate,
// structurally-identical stores for them.

import { initAppDB } from "../storage/db";
import { generateUUID } from "../../../utils/uuid";
import {
  STORE_USERS,
  STORE_USER_PEER_NODES,
  type PeerNodeWithUser,
  type User,
  type UserPeerNode,
  type UserRole,
} from "../storage/types";

function joinUserAndPeerNode(user: User, peerNode: UserPeerNode): PeerNodeWithUser {
  return {
    user_id: peerNode.user_id,
    node_id: peerNode.node_id,
    instance_name: peerNode.instance_name,
    created_at: peerNode.created_at,
    last_seen_at: peerNode.last_seen_at,
    username: user.username,
    role: user.role,
    deleted_at: peerNode.deleted_at,
    user_deleted_at: user.deleted_at,
  };
}

export async function getUser(userId: string): Promise<User | null> {
  const db = await initAppDB();
  return (await db.get(STORE_USERS, userId)) ?? null;
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const db = await initAppDB();
  const all = (await db.getAll(STORE_USERS)) as User[];
  return all.find((u) => u.username === username) ?? null;
}

export async function createUser(input: { username: string; role: UserRole }): Promise<User> {
  const db = await initAppDB();
  const now = Date.now();
  const user: User = {
    id: generateUUID(),
    username: input.username,
    role: input.role,
    api_key: null,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    haruspex_user_id: null,
    metadata: null,
  };
  await db.put(STORE_USERS, user);
  return user;
}

export async function updateUser(
  userId: string,
  patch: Partial<Pick<User, "username" | "role" | "metadata">>
): Promise<User | null> {
  const db = await initAppDB();
  const existing = (await db.get(STORE_USERS, userId)) as User | undefined;
  if (!existing) return null;
  const updated: User = { ...existing, ...patch, updated_at: Date.now() };
  await db.put(STORE_USERS, updated);
  return updated;
}

// browser-world hard-deletes for now (see docs/player-peer-trust-bridge-plan.md)
// - soft-delete columns are modeled for parity with grimoire but unused.
export async function deleteUser(userId: string): Promise<void> {
  const db = await initAppDB();
  await db.delete(STORE_USERS, userId);
}

export async function getPeerNode(nodeId: string): Promise<UserPeerNode | null> {
  const db = await initAppDB();
  return (await db.get(STORE_USER_PEER_NODES, nodeId)) ?? null;
}

export async function upsertPeerNode(
  userId: string,
  nodeId: string,
  instanceName: string | null = null
): Promise<UserPeerNode> {
  const db = await initAppDB();
  const existing = (await db.get(STORE_USER_PEER_NODES, nodeId)) as UserPeerNode | undefined;
  const peerNode: UserPeerNode = {
    node_id: nodeId,
    user_id: userId,
    instance_name: instanceName ?? existing?.instance_name ?? null,
    metadata: existing?.metadata ?? null,
    created_at: existing?.created_at ?? Date.now(),
    last_seen_at: existing?.last_seen_at ?? null,
    deleted_at: null,
  };
  await db.put(STORE_USER_PEER_NODES, peerNode);
  return peerNode;
}

export async function touchPeerNode(nodeId: string): Promise<void> {
  const db = await initAppDB();
  const existing = (await db.get(STORE_USER_PEER_NODES, nodeId)) as UserPeerNode | undefined;
  if (!existing) return;
  await db.put(STORE_USER_PEER_NODES, { ...existing, last_seen_at: Date.now() });
}

// hard-deletes the peer node AND its linked user (browser-world users
// exist only to back exactly one peer node today - see module doc comment
// above), matching grimoire's `remove_peer_node`/`hard_delete_peer_node`
// pair but collapsed to one call since there's no soft-delete ui yet.
export async function removePeerNode(nodeId: string): Promise<void> {
  const db = await initAppDB();
  const peerNode = (await db.get(STORE_USER_PEER_NODES, nodeId)) as UserPeerNode | undefined;
  await db.delete(STORE_USER_PEER_NODES, nodeId);
  if (peerNode) await deleteUser(peerNode.user_id);
}

export async function findUserByNodeId(nodeId: string): Promise<PeerNodeWithUser | null> {
  const db = await initAppDB();
  const peerNode = (await db.get(STORE_USER_PEER_NODES, nodeId)) as UserPeerNode | undefined;
  if (!peerNode) return null;
  const user = (await db.get(STORE_USERS, peerNode.user_id)) as User | undefined;
  if (!user) return null;
  return joinUserAndPeerNode(user, peerNode);
}

export async function listPeerNodesWithUsers(): Promise<PeerNodeWithUser[]> {
  const db = await initAppDB();
  const peerNodes = (await db.getAll(STORE_USER_PEER_NODES)) as UserPeerNode[];
  const users = (await db.getAll(STORE_USERS)) as User[];
  const usersById = new Map(users.map((u) => [u.id, u]));
  const joined: PeerNodeWithUser[] = [];
  for (const peerNode of peerNodes) {
    const user = usersById.get(peerNode.user_id);
    if (user) joined.push(joinUserAndPeerNode(user, peerNode));
  }
  return joined;
}

/** mirrors grimoire's `admin_dispatch::handlers::peers::allow` - link
 * node_id to an existing user (by node_id, falling back to username) or
 * create a new one, then upsert the peer-node link. shared by both
 * `pairedPlayers.savePairedPlayer` (outbound) and
 * `trustStoreAdapter.trustController` (inbound) - see module doc comment
 * above for why both share this same pair of stores. */
export async function allowPeer(
  nodeId: string,
  username: string,
  role: UserRole
): Promise<PeerNodeWithUser> {
  const existingPeerNode = await getPeerNode(nodeId);
  if (existingPeerNode) {
    const updatedUser = (await updateUser(existingPeerNode.user_id, { username, role })) ?? null;
    if (updatedUser) {
      const peerNode = await upsertPeerNode(updatedUser.id, nodeId);
      return joinUserAndPeerNode(updatedUser, peerNode);
    }
  }
  const existingUser = await getUserByUsername(username);
  const user = existingUser
    ? ((await updateUser(existingUser.id, { role })) ?? existingUser)
    : await createUser({ username, role });
  const peerNode = await upsertPeerNode(user.id, nodeId);
  return joinUserAndPeerNode(user, peerNode);
}
