// indexeddb-backed remote storage (pure-web spume). all writes go through
// `db.put(STORE_REMOTES, ...)`; reads use safeParseRemote/parseRemotes for
// schema migration of legacy rows.

import { initAppDB } from "../../storage/db";
import {
  STORE_REMOTES,
  type Remote,
  parseRemotes,
  safeParseRemote,
  isP2PRemote,
} from "../../storage/types";
import type { RemoteBackend } from "./types";

async function list(): Promise<Remote[]> {
  const db = await initAppDB();
  const raw = await db.getAll(STORE_REMOTES);
  return parseRemotes(raw);
}

async function get(remoteId: string): Promise<Remote | undefined> {
  const db = await initAppDB();
  const raw = await db.get(STORE_REMOTES, remoteId);
  return safeParseRemote(raw);
}

async function getByPeerAddr(peerAddr: string): Promise<Remote | undefined> {
  const all = await list();
  for (const remote of all) {
    if (!isP2PRemote(remote)) continue;
    if (remote.peer_addr === peerAddr) return remote;
    // node_id (64 hex) contained in JSON endpoint, or vice versa
    if (
      /^[a-f0-9]{64}$/i.test(peerAddr) &&
      remote.peer_addr.includes(peerAddr)
    ) {
      return remote;
    }
    if (
      /^[a-f0-9]{64}$/i.test(remote.peer_addr) &&
      peerAddr.includes(remote.peer_addr)
    ) {
      return remote;
    }
  }
  return undefined;
}

async function put(remote: Remote): Promise<void> {
  const db = await initAppDB();
  await db.put(STORE_REMOTES, remote);
}

async function remove(remoteId: string): Promise<void> {
  const db = await initAppDB();
  await db.delete(STORE_REMOTES, remoteId);
}

async function markActive(remoteId: string): Promise<void> {
  const db = await initAppDB();
  const all = await db.getAll(STORE_REMOTES);
  const now = Date.now();
  for (const r of all) {
    if (r.remote_id === remoteId) {
      await db.put(STORE_REMOTES, {
        ...r,
        is_active: true,
        last_connected_at: now,
        updated_at: now,
      });
    } else if (r.is_active) {
      await db.put(STORE_REMOTES, { ...r, is_active: false, updated_at: now });
    }
  }
}

export const idbBackend: RemoteBackend = {
  list,
  get,
  getByPeerAddr,
  put,
  remove,
  markActive,
};
