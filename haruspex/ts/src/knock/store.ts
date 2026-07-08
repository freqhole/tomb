// idb-backed KnockStore.
//
// database + store names are parameterized (see KnockStoreOptions) rather
// than hardcoded, so an app's existing knock table names can be pointed at
// this store in place, without a browser-data migration - the same
// `dbName` option pattern reliquary-ts's ./blobs subpath uses.

import type {
  CreateKnockInput,
  KnockDecision,
  KnockRecord,
  KnockScope,
  KnockStore,
} from "./types.js";
import { KnockConflictError } from "./types.js";

export interface KnockStoreOptions {
  databaseName: string;
  storeName: string;
}

const NODE_ID_INDEX = "nodeId";
const DEDUP_INDEX = "dedup";

interface KnockRow extends KnockRecord {
  /** canonical rendering of `scope`, stored only to back the dedup index. */
  scopeKey: string;
}

/**
 * canonical rendering of a scope, used as the dedup index key. mirrors
 * rust's dedup key exactly: it is keyed on the full scope value, so e.g.
 * two account-scope knocks for different `requestedUsername`s do not dedup
 * against each other.
 */
function scopeKey(scope: KnockScope): string {
  switch (scope.kind) {
    case "account":
      return `account:${scope.requestedUsername ?? ""}`;
    case "browse":
      return "browse";
    case "resource":
      return `resource:${scope.resourceId}:${scope.requestedRole ?? ""}`;
  }
}

function toRow(record: KnockRecord): KnockRow {
  return { ...record, scopeKey: scopeKey(record.scope) };
}

function fromRow(row: KnockRow): KnockRecord {
  const { scopeKey: _scopeKey, ...record } = row;
  return record;
}

function reqPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * open the database, creating the store (and its indexes) on demand if
 * this is the first time this database/store pair has been opened.
 */
function openDb(databaseName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const probe = indexedDB.open(databaseName);
    probe.onsuccess = () => {
      const db = probe.result;
      if (db.objectStoreNames.contains(storeName)) {
        resolve(db);
        return;
      }
      const nextVersion = db.version + 1;
      db.close();
      const upgrade = indexedDB.open(databaseName, nextVersion);
      upgrade.onupgradeneeded = () => {
        const upgradeDb = upgrade.result;
        if (!upgradeDb.objectStoreNames.contains(storeName)) {
          const store = upgradeDb.createObjectStore(storeName, { keyPath: "id" });
          store.createIndex(NODE_ID_INDEX, "nodeId", { unique: false });
          store.createIndex(DEDUP_INDEX, ["nodeId", "scopeKey", "status"], {
            unique: false,
          });
        }
      };
      upgrade.onsuccess = () => resolve(upgrade.result);
      upgrade.onerror = () => reject(upgrade.error);
    };
    probe.onerror = () => reject(probe.error);
  });
}

/**
 * an idb-backed KnockStore. database/store names are parameterized (see
 * KnockStoreOptions) so an app can point this at its own existing tables.
 */
export function createIdbKnockStore(options: KnockStoreOptions): KnockStore {
  const { databaseName, storeName } = options;

  return {
    async createKnock(input: CreateKnockInput): Promise<KnockRecord> {
      const db = await openDb(databaseName, storeName);
      try {
        const key = scopeKey(input.scope);
        return await new Promise<KnockRecord>((resolve, reject) => {
          const tx = db.transaction(storeName, "readwrite");
          const store = tx.objectStore(storeName);
          const dedupIndex = store.index(DEDUP_INDEX);
          const range = IDBKeyRange.only([input.nodeId, key, "pending"]);
          const checkReq = dedupIndex.getAllKeys(range);

          checkReq.onerror = () => reject(checkReq.error);
          checkReq.onsuccess = () => {
            if (checkReq.result.length > 0) {
              reject(new KnockConflictError(input.nodeId, input.scope));
              tx.abort();
              return;
            }
            const record: KnockRecord = {
              id: crypto.randomUUID(),
              nodeId: input.nodeId,
              direction: input.direction,
              scope: input.scope,
              message: input.message ?? "",
              status: "pending",
              createdAt: input.createdAt ?? Date.now(),
              decisions: [],
            };
            const putReq = store.put(toRow(record));
            putReq.onerror = () => reject(putReq.error);
            putReq.onsuccess = () => resolve(record);
          };
        });
      } finally {
        db.close();
      }
    },

    async getKnock(id: string): Promise<KnockRecord | null> {
      const db = await openDb(databaseName, storeName);
      try {
        const tx = db.transaction(storeName, "readonly");
        const row = (await reqPromise(tx.objectStore(storeName).get(id))) as
          | KnockRow
          | undefined;
        return row ? fromRow(row) : null;
      } finally {
        db.close();
      }
    },

    async listPending(): Promise<KnockRecord[]> {
      const db = await openDb(databaseName, storeName);
      try {
        const tx = db.transaction(storeName, "readonly");
        const rows = (await reqPromise(tx.objectStore(storeName).getAll())) as KnockRow[];
        return rows
          .filter((r) => r.status === "pending")
          .map(fromRow)
          .sort((a, b) => b.createdAt - a.createdAt);
      } finally {
        db.close();
      }
    },

    async listAll(): Promise<KnockRecord[]> {
      const db = await openDb(databaseName, storeName);
      try {
        const tx = db.transaction(storeName, "readonly");
        const rows = (await reqPromise(tx.objectStore(storeName).getAll())) as KnockRow[];
        return rows.map(fromRow).sort((a, b) => b.createdAt - a.createdAt);
      } finally {
        db.close();
      }
    },

    async findByNodeId(nodeId: string): Promise<KnockRecord | null> {
      const db = await openDb(databaseName, storeName);
      try {
        const tx = db.transaction(storeName, "readonly");
        const rows = (await reqPromise(
          tx.objectStore(storeName).index(NODE_ID_INDEX).getAll(nodeId),
        )) as KnockRow[];
        if (rows.length === 0) return null;
        rows.sort((a, b) => b.createdAt - a.createdAt);
        return fromRow(rows[0]);
      } finally {
        db.close();
      }
    },

    async recordDecision(
      id: string,
      decision: KnockDecision,
      patch?: { grantedResourceIds?: string[] },
    ): Promise<KnockRecord> {
      const db = await openDb(databaseName, storeName);
      try {
        return await new Promise<KnockRecord>((resolve, reject) => {
          const tx = db.transaction(storeName, "readwrite");
          const store = tx.objectStore(storeName);
          const getReq = store.get(id);
          getReq.onerror = () => reject(getReq.error);
          getReq.onsuccess = () => {
            const row = getReq.result as KnockRow | undefined;
            if (!row) {
              reject(new Error(`knock ${id} not found`));
              tx.abort();
              return;
            }
            const record = fromRow(row);
            const updated: KnockRecord = {
              ...record,
              status: decision.outcome,
              processedAt: decision.at,
              processedBy: decision.byNodeId,
              decisions: [...record.decisions, decision],
              grantedResourceIds: patch?.grantedResourceIds ?? record.grantedResourceIds,
            };
            const putReq = store.put(toRow(updated));
            putReq.onerror = () => reject(putReq.error);
            putReq.onsuccess = () => resolve(updated);
          };
        });
      } finally {
        db.close();
      }
    },

    async deleteKnock(id: string): Promise<void> {
      const db = await openDb(databaseName, storeName);
      try {
        const tx = db.transaction(storeName, "readwrite");
        await reqPromise(tx.objectStore(storeName).delete(id));
      } finally {
        db.close();
      }
    },
  };
}
