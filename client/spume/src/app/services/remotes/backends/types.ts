// storage-backend interface for the remotez registry.
//
// two impls live next to this file:
// - idbBackend.ts:    indexeddb-backed (pure-web spume)
// - sqliteBackend.ts: sqlite-backed via tauri commands (charnel app)
//
// remoteManager.ts owns all business logic (slug gen, server-info fetch,
// image url handling, listener notifications) and calls these primitives.

import type { Remote } from "../../storage/schemas/remote";

export interface RemoteBackend {
  /** list all remotes; ordering is up to the caller */
  list(): Promise<Remote[]>;
  /** fetch a single remote by id */
  get(remoteId: string): Promise<Remote | undefined>;
  /**
   * fetch a P2P remote whose peer_addr exactly matches, OR whose peer_addr
   * contains / is contained by the given string (handles node_id vs JSON
   * endpoint mismatches).
   */
  getByPeerAddr(peerAddr: string): Promise<Remote | undefined>;
  /** insert or update a remote (full upsert) */
  put(remote: Remote): Promise<void>;
  /** delete a remote by id (no-op if missing) */
  remove(remoteId: string): Promise<void>;
  /** mark a single remote as active and clear is_active on all others */
  markActive(remoteId: string): Promise<void>;
}
