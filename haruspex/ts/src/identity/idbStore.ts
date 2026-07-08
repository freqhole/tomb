import type { IdentityStore, P2PIdentity } from "./types.js";

/** record key used within an identity object store, unless overridden. */
const DEFAULT_KEY = "p2p_identity";

/**
 * an idb database/store/key triple describing where an identity record
 * lives. every consuming app parameterizes its own database name (and,
 * when reading another app's database as a fallback source, that app's
 * database name too) - see resolve.ts for the cross-app fallback story.
 */
export interface IdentitySource {
  /** indexeddb database name. */
  databaseName: string;
  /** object store name within that database. */
  storeName: string;
  /** record key within the store; defaults to "p2p_identity". */
  key?: string;
}

/**
 * check whether a database exists without creating it.
 *
 * strategy:
 *   1. use indexedDB.databases() when available (chrome/firefox 126+)
 *   2. fall back to a versionless open; abort the versionchange transaction
 *      if upgrade fires (meaning the db did not exist), then delete the
 *      empty database that open unavoidably created before we could abort.
 */
export async function databaseExists(databaseName: string): Promise<boolean> {
  if (typeof indexedDB.databases === "function") {
    try {
      const dbs = await indexedDB.databases();
      return dbs.some((d) => d.name === databaseName);
    } catch {
      // fall through to open-based detection
    }
  }
  return openBasedExistenceCheck(databaseName);
}

function openBasedExistenceCheck(databaseName: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = indexedDB.open(databaseName);
    let existed = true;

    req.onupgradeneeded = (event) => {
      // upgradeneeded on a version-0 open means the db is being created now
      existed = false;
      (event.target as IDBOpenDBRequest).transaction?.abort();
    };

    req.onsuccess = () => {
      req.result.close();
      if (!existed) {
        // clean up the empty database that was created before we could abort
        indexedDB.deleteDatabase(databaseName);
      }
      resolve(existed);
    };

    req.onerror = () => {
      // the abort above causes an error - if existed is false this is expected
      resolve(existed);
    };
  });
}

/**
 * open a database read-only-safe: returns null if it does not already
 * exist, never creating or upgrading it in the process.
 */
export async function openExistingDatabase(
  databaseName: string,
): Promise<IDBDatabase | null> {
  if (!(await databaseExists(databaseName))) return null;

  return new Promise((resolve) => {
    const req = indexedDB.open(databaseName);

    req.onupgradeneeded = (event) => {
      // should not fire - databaseExists() just confirmed the db is there.
      // abort defensively so we never create it out from under a concurrent
      // deletion.
      (event.target as IDBOpenDBRequest).transaction?.abort();
      resolve(null);
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

/** check whether a given identity source's database and store both exist,
 *  without creating or upgrading anything. */
export async function identitySourceAvailable(
  source: IdentitySource,
): Promise<boolean> {
  const db = await openExistingDatabase(source.databaseName);
  if (!db) return false;
  const has = db.objectStoreNames.contains(source.storeName);
  db.close();
  return has;
}

function getRecord(
  db: IDBDatabase,
  storeName: string,
  key: string,
): Promise<P2PIdentity | null> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).get(key);
    req.onsuccess = () => resolve((req.result as P2PIdentity) ?? null);
    req.onerror = () => reject(req.error);
  });
}

function putRecord(
  db: IDBDatabase,
  storeName: string,
  key: string,
  value: P2PIdentity,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    const req = tx.objectStore(storeName).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * read an identity record from a source, without creating or upgrading its
 * database. returns null if the database, store, or record is absent.
 */
export async function readIdentityFrom(
  source: IdentitySource,
): Promise<P2PIdentity | null> {
  const db = await openExistingDatabase(source.databaseName);
  if (!db) return null;
  try {
    if (!db.objectStoreNames.contains(source.storeName)) return null;
    return await getRecord(db, source.storeName, source.key ?? DEFAULT_KEY);
  } finally {
    db.close();
  }
}

/**
 * write an identity record to a source. the database and store must already
 * exist (this never creates or upgrades a database it doesn't own).
 */
export async function writeIdentityTo(
  source: IdentitySource,
  identity: P2PIdentity,
): Promise<void> {
  const db = await openExistingDatabase(source.databaseName);
  if (!db || !db.objectStoreNames.contains(source.storeName)) {
    db?.close();
    throw new Error(
      `identity source "${source.databaseName}" (store "${source.storeName}") does not exist`,
    );
  }
  try {
    await putRecord(db, source.storeName, source.key ?? DEFAULT_KEY, identity);
  } finally {
    db.close();
  }
}

async function openAtCurrentVersion(databaseName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(databaseName);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openWithStoreCreated(
  databaseName: string,
  version: number,
  storeName: string,
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(databaseName, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function openOrCreateDatabase(
  databaseName: string,
  storeName: string,
): Promise<IDBDatabase> {
  const db = await openAtCurrentVersion(databaseName);
  if (db.objectStoreNames.contains(storeName)) return db;

  const nextVersion = db.version + 1;
  db.close();
  return openWithStoreCreated(databaseName, nextVersion, storeName);
}

/**
 * an identity store backed by its own dedicated idb database/store, created
 * on demand. suitable as an app's local, always-available identity store -
 * the store the cross-app resolution in resolve.ts falls back to when no
 * other source has an identity yet.
 */
export function createIdbIdentityStore(source: IdentitySource): IdentityStore {
  const key = source.key ?? DEFAULT_KEY;

  return {
    async get() {
      const db = await openOrCreateDatabase(source.databaseName, source.storeName);
      try {
        return await getRecord(db, source.storeName, key);
      } finally {
        db.close();
      }
    },

    async set(identity: P2PIdentity) {
      const db = await openOrCreateDatabase(source.databaseName, source.storeName);
      try {
        await putRecord(db, source.storeName, key, identity);
      } finally {
        db.close();
      }
    },
  };
}
