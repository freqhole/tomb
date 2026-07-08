// the metadata side of the resolver chain: an IndexedDB-backed record
// store keyed by blob_id (the blake3 hex digest), with secondary indexes
// so a record can also be found by its legacy sha256, by blake3 alone
// (covering a record whose primary key is a legacy sha256), by blob_type,
// or by parent_blob_id.
//
// follows a "open fresh, close when done" pattern for every operation
// rather than holding one long-lived connection open - simple, and avoids
// a version-change block from another tab ever having anything to wait on.

import type { BlobRecord } from "./types.js";

const STORE_NAME = "blobs";
const DB_VERSION = 1;

function openDb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "blob_id" });
        store.createIndex("sha256", "sha256", { unique: false });
        store.createIndex("blake3", "blake3", { unique: false });
        store.createIndex("blob_type", "blob_type", { unique: false });
        store.createIndex("parent_blob_id", "parent_blob_id", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putRecord(dbName: string, record: BlobRecord): Promise<void> {
  const db = await openDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
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

export async function getRecord(dbName: string, blobId: string): Promise<BlobRecord | null> {
  const db = await openDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).get(blobId);
    req.onsuccess = () => resolve((req.result as BlobRecord) ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

async function getByIndex(
  dbName: string,
  indexName: "sha256" | "blake3",
  value: string
): Promise<BlobRecord | null> {
  if (!value) return null;
  const db = await openDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).index(indexName).get(value);
    req.onsuccess = () => resolve((req.result as BlobRecord) ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export function getRecordBySha256(dbName: string, sha256: string): Promise<BlobRecord | null> {
  return getByIndex(dbName, "sha256", sha256);
}

export function getRecordByBlake3(dbName: string, blake3: string): Promise<BlobRecord | null> {
  return getByIndex(dbName, "blake3", blake3);
}

export async function deleteRecord(dbName: string, blobId: string): Promise<void> {
  const db = await openDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(blobId);
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

export async function clearRecords(dbName: string): Promise<void> {
  const db = await openDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
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
