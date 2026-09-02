// trust store: which controller node ids this player accepts commands
// from. injected by the host app (see `TrustStore` below) rather than
// owned outright by this package, because a host app that already runs on
// its own established origin/database (e.g. spume, sharing a single
// `freqhole_app` indexeddb database with everything else it stores)
// should keep this list in that same database instead of standing up a
// second, parallel one just for cenotaph. `createIdbTrustStore` below is
// only a ready-made default for a host with no pre-existing storage to
// fold this into (e.g. player.freqhole.net, a standalone site).

import { openDB, type IDBPDatabase } from "idb";

/** mirrors grimoire's `UserRole`, minus `"root"` (see
 * `grimoire/src/users/models.rs`) - the role a paired controller carries,
 * whether the player itself is charnel/grimoire-backed or a plain
 * browser peer with its own idb trust store (see `createIdbTrustStore`).
 */
export type PeerRole = "admin" | "member" | "viewer";

/** privilege level per role - lower is more privileged, matching
 * grimoire's `UserRole::level()` exactly so the two stay comparable. */
export const ROLE_LEVEL: Record<PeerRole, number> = {
  admin: 10,
  member: 20,
  viewer: 30,
};

export interface TrustedController {
  node_id: string;
  display_name: string;
  role: PeerRole;
  paired_at: number;
}

export interface TrustStore {
  isTrustedController(nodeId: string): Promise<boolean>;
  getTrustedController(nodeId: string): Promise<TrustedController | undefined>;
  trustController(nodeId: string, displayName: string, role: PeerRole): Promise<void>;
  forgetController(nodeId: string): Promise<void>;
  listTrustedControllers(): Promise<TrustedController[]>;
}

export interface IdbTrustStoreOptions {
  databaseName?: string;
  storeName?: string;
}

/** default trust store implementation: its own dedicated indexeddb
 * database. a host app that already has its own database to share should
 * implement `TrustStore` directly against that instead of using this. */
export function createIdbTrustStore(options: IdbTrustStoreOptions = {}): TrustStore {
  const databaseName = options.databaseName ?? "cenotaph_player_trust";
  const storeName = options.storeName ?? "trusted_controllers";

  let dbPromise: Promise<IDBPDatabase> | null = null;

  function getDb(): Promise<IDBPDatabase> {
    if (!dbPromise) {
      dbPromise = openDB(databaseName, 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(storeName)) {
            db.createObjectStore(storeName, { keyPath: "node_id" });
          }
        },
      });
    }
    return dbPromise;
  }

  return {
    async isTrustedController(nodeId) {
      const db = await getDb();
      return (await db.get(storeName, nodeId)) !== undefined;
    },
    async getTrustedController(nodeId) {
      const db = await getDb();
      return db.get(storeName, nodeId);
    },
    async trustController(nodeId, displayName, role) {
      const db = await getDb();
      const controller: TrustedController = {
        node_id: nodeId,
        display_name: displayName,
        role,
        paired_at: Date.now(),
      };
      await db.put(storeName, controller);
    },
    async forgetController(nodeId) {
      const db = await getDb();
      await db.delete(storeName, nodeId);
    },
    async listTrustedControllers() {
      const db = await getDb();
      return db.getAll(storeName);
    },
  };
}
