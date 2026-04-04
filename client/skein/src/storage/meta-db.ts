// ---------------------------------------------------------------------------
// shared IndexedDB helpers for the skein-meta key-value store.
//
// this module owns the "skein-meta" database that holds small metadata
// values (narthex doc id, identity records, etc.) separate from
// automerge's own indexeddb storage so we don't couple to its schema.
// ---------------------------------------------------------------------------

/** database name used for skein metadata persistence. */
export const NARTHEX_DB_NAME = "skein-meta";

/** the single object store inside the meta database. */
export const META_STORE_NAME = "kv";

/**
 * open (or create) the skein-meta indexeddb database.
 *
 * version 1 creates the "kv" object store if it doesn't already exist.
 * callers are responsible for closing the returned database when done.
 */
export async function openMetaDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(NARTHEX_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * read a plain string value from the meta store.
 *
 * returns `null` when the key does not exist.
 */
export async function getMetaValue(key: string): Promise<string | null> {
  const db = await openMetaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE_NAME, "readonly");
    const store = tx.objectStore(META_STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result as string) ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * write a plain string value into the meta store.
 */
export async function setMetaValue(key: string, value: string): Promise<void> {
  const db = await openMetaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE_NAME, "readwrite");
    const store = tx.objectStore(META_STORE_NAME);
    store.put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * read a structured record from the meta store.
 *
 * the value is stored as-is by indexeddb's structured clone algorithm,
 * so any cloneable object (plain objects, arrays, dates, etc.) works.
 * returns `null` when the key does not exist.
 */
export async function getMetaRecord<T>(key: string): Promise<T | null> {
  const db = await openMetaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE_NAME, "readonly");
    const store = tx.objectStore(META_STORE_NAME);
    const req = store.get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * write a structured record into the meta store.
 *
 * the value is persisted using indexeddb's structured clone algorithm,
 * so any cloneable object (plain objects, arrays, dates, etc.) works.
 */
export async function setMetaRecord<T>(key: string, value: T): Promise<void> {
  const db = await openMetaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE_NAME, "readwrite");
    const store = tx.objectStore(META_STORE_NAME);
    store.put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

/**
 * delete a record from the meta store by key.
 *
 * resolves silently if the key does not exist.
 */
export async function deleteMetaRecord(key: string): Promise<void> {
  const db = await openMetaDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE_NAME, "readwrite");
    const store = tx.objectStore(META_STORE_NAME);
    store.delete(key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}
