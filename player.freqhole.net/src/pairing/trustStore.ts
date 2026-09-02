// local trust store: which controller node ids this player has paired
// with. persisted in its own indexeddb database (kept separate from
// @freqhole/haruspex's identity database to avoid two independent openDB
// calls racing over the same database's version).

import { openDB, type IDBPDatabase } from "idb";

export interface TrustedController {
  node_id: string;
  display_name: string;
  paired_at: number;
}

const DB_NAME = "freqhole_player_trust";
const DB_VERSION = 1;
const STORE_NAME = "trusted_controllers";

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "node_id" });
        }
      },
    });
  }
  return dbPromise;
}

export async function isTrustedController(nodeId: string): Promise<boolean> {
  const db = await getDb();
  const record = await db.get(STORE_NAME, nodeId);
  return record !== undefined;
}

export async function getTrustedController(nodeId: string): Promise<TrustedController | undefined> {
  const db = await getDb();
  return db.get(STORE_NAME, nodeId);
}

export async function trustController(nodeId: string, displayName: string): Promise<void> {
  const db = await getDb();
  const controller: TrustedController = {
    node_id: nodeId,
    display_name: displayName,
    paired_at: Date.now(),
  };
  await db.put(STORE_NAME, controller);
}

export async function forgetController(nodeId: string): Promise<void> {
  const db = await getDb();
  await db.delete(STORE_NAME, nodeId);
}

export async function listTrustedControllers(): Promise<TrustedController[]> {
  const db = await getDb();
  return db.getAll(STORE_NAME);
}
