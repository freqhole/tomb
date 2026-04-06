// ---------------------------------------------------------------------------
// skein blob store — browser-mode blob storage using OPFS for raw bytes
// and raw IndexedDB for metadata.
//
// follows the meta-db.ts pattern: open the database fresh for each
// operation, close it when done. no idb library dependency.
// ---------------------------------------------------------------------------

// ---- interfaces -----------------------------------------------------------

export interface SkeinBlobRecord {
  blob_id: string;
  sha256: string;
  blake3: string;
  filename: string;
  mime: string;
  size: number;
  domain: string;
  blob_type: string;
  parent_blob_id: string | null;
  metadata: Record<string, unknown>;
  created_at: number;
}

export interface SkeinDomainEntity {
  entity_id: string;
  blob_id: string;
  domain: string;
  title: string;
  description: string;
  metadata: Record<string, unknown>;
  created_at: number;
}

// ---- constants ------------------------------------------------------------

const BLOB_DB_NAME = "skein-blobs";
const BLOB_STORE = "blobs";
const ENTITY_STORE = "domain_entities";
const OPFS_DIR = "skein-blobs";

// ---- session url cache ----------------------------------------------------

const blobUrlCache = new Map<string, string>();
let beforeUnloadRegistered = false;

function ensureBeforeUnloadListener(): void {
  if (beforeUnloadRegistered) return;
  if (typeof window === "undefined") return;
  window.addEventListener("beforeunload", () => {
    for (const url of blobUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    blobUrlCache.clear();
  });
  beforeUnloadRegistered = true;
}

/**
 * revoke all cached object urls and clear the cache.
 */
export function clearBlobUrlCache(): void {
  for (const url of blobUrlCache.values()) {
    URL.revokeObjectURL(url);
  }
  blobUrlCache.clear();
}

// ---- database helpers -----------------------------------------------------

/**
 * open (or create) the skein-blobs indexeddb database.
 *
 * version 1 creates the "blobs" and "domain_entities" object stores
 * with their respective indexes. callers are responsible for closing
 * the returned database when done.
 */
export async function openBlobDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BLOB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(BLOB_STORE)) {
        const blobStore = db.createObjectStore(BLOB_STORE, {
          keyPath: "blob_id",
        });
        blobStore.createIndex("sha256", "sha256", { unique: false });
        blobStore.createIndex("domain", "domain", { unique: false });
      }
      if (!db.objectStoreNames.contains(ENTITY_STORE)) {
        const entityStore = db.createObjectStore(ENTITY_STORE, {
          keyPath: "entity_id",
        });
        entityStore.createIndex("blob_id", "blob_id", { unique: false });
        entityStore.createIndex("domain", "domain", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---- OPFS helpers ---------------------------------------------------------

/**
 * get (or create) the skein-blobs directory handle in OPFS.
 */
async function getOpfsDir(create = false): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(OPFS_DIR, { create });
  } catch {
    return null;
  }
}

// ---- public api -----------------------------------------------------------

/**
 * check whether the origin private file system API is available.
 */
export function isOPFSSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "storage" in navigator &&
    typeof navigator.storage.getDirectory === "function"
  );
}

/**
 * compute the SHA-256 hash of an ArrayBuffer and return it as a hex string.
 */
export async function computeSha256(data: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hashBuffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

/**
 * compute the blake3 hash of data using the midden WASM module.
 * returns empty string if midden is not available (e.g. WASM not loaded yet).
 */
async function computeBlake3(data: Uint8Array): Promise<string> {
  try {
    const midden = (await import("midden")) as any;
    if (typeof midden.hash_blake3 === "function") {
      return midden.hash_blake3(data);
    }
    return "";
  } catch {
    // midden WASM not available — skip blake3 computation
    return "";
  }
}

/**
 * classify a MIME type into a domain string.
 */
export function classifyDomain(mime: string): string {
  if (mime.startsWith("image/")) return "photo";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "document";
  return "file";
}

/**
 * store raw blob bytes in OPFS and write the metadata record to IndexedDB.
 *
 * the `meta` parameter should contain everything except `created_at`,
 * which is set automatically to `Date.now()`.
 */
export async function storeBlob(
  blobId: string,
  data: ArrayBuffer,
  meta: Omit<SkeinBlobRecord, "created_at">
): Promise<void> {
  // write bytes to OPFS
  const dir = await getOpfsDir(true);
  if (dir) {
    const fileHandle = await dir.getFileHandle(blobId, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(data);
    await writable.close();
  }

  // write metadata record to IndexedDB
  const record: SkeinBlobRecord = {
    ...meta,
    created_at: Date.now(),
  };

  const db = await openBlobDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, "readwrite");
    const store = tx.objectStore(BLOB_STORE);
    store.put(record);
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
 * convenience method to store a browser File object as a blob.
 *
 * uses the SHA-256 hash of the file content as the blob_id for
 * content-addressed deduplication. if a blob with the same id already
 * exists, the existing record is returned without writing again.
 */
export async function storeBlobFromFile(file: File, domain?: string): Promise<SkeinBlobRecord> {
  const buffer = await file.arrayBuffer();
  const sha256 = await computeSha256(buffer);
  const blake3 = await computeBlake3(new Uint8Array(buffer));
  const blobId = sha256;

  // dedup — return existing record if already stored
  const existing = await getBlobRecord(blobId);
  if (existing) return existing;

  const resolvedDomain = domain ?? classifyDomain(file.type);

  const meta: Omit<SkeinBlobRecord, "created_at"> = {
    blob_id: blobId,
    sha256,
    blake3,
    filename: file.name,
    mime: file.type || "application/octet-stream",
    size: buffer.byteLength,
    domain: resolvedDomain,
    blob_type: "original",
    parent_blob_id: null,
    metadata: {},
  };

  await storeBlob(blobId, buffer, meta);

  // return the full record (with created_at) from the store
  const record = await getBlobRecord(blobId);
  return record!;
}

/**
 * update the blake3 hash for an existing blob record.
 */
export async function updateBlake3(blobId: string, blake3: string): Promise<void> {
  const db = await openBlobDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, "readwrite");
    const store = tx.objectStore(BLOB_STORE);
    const getReq = store.get(blobId);
    getReq.onsuccess = () => {
      const record = getReq.result as SkeinBlobRecord | undefined;
      if (record) {
        record.blake3 = blake3;
        store.put(record);
      }
    };
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
 * retrieve a blob metadata record by its id.
 *
 * returns `null` when the blob does not exist.
 */
export async function getBlobRecord(blobId: string): Promise<SkeinBlobRecord | null> {
  const db = await openBlobDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, "readonly");
    const store = tx.objectStore(BLOB_STORE);
    const req = store.get(blobId);
    req.onsuccess = () => resolve((req.result as SkeinBlobRecord) ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * look up a blob record by its blake3 hash.
 *
 * scans all records in the store since there is no blake3 index.
 * returns `null` when no matching record is found.
 */
export async function getBlobRecordByBlake3(blake3Hash: string): Promise<SkeinBlobRecord | null> {
  if (!blake3Hash) return null;
  const db = await openBlobDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE, "readonly");
    const store = tx.objectStore(BLOB_STORE);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) {
        resolve(null);
        return;
      }
      const record = cursor.value as SkeinBlobRecord;
      if (record.blake3 === blake3Hash) {
        resolve(record);
        return;
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * read the raw blob bytes from OPFS.
 *
 * returns `null` if the file is not found or OPFS is unavailable.
 */
export async function getBlobData(blobId: string): Promise<ArrayBuffer | null> {
  try {
    const dir = await getOpfsDir(false);
    if (!dir) return null;
    const fileHandle = await dir.getFileHandle(blobId);
    const file = await fileHandle.getFile();
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * check whether a blob record exists in the store.
 */
export async function hasBlob(blobId: string): Promise<boolean> {
  const record = await getBlobRecord(blobId);
  return record !== null;
}

/**
 * get (or create) a temporary object url for a stored blob.
 *
 * urls are cached for the lifetime of the page session and revoked
 * automatically on beforeunload. returns `null` if the blob is not found.
 */
export async function getBlobObjectURL(blobId: string): Promise<string | null> {
  ensureBeforeUnloadListener();

  // check the session cache first
  const cached = blobUrlCache.get(blobId);
  if (cached) return cached;

  const data = await getBlobData(blobId);
  if (!data) return null;

  const record = await getBlobRecord(blobId);
  const mime = record?.mime ?? "application/octet-stream";

  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  blobUrlCache.set(blobId, url);
  return url;
}

// ---- domain entity operations ---------------------------------------------

/**
 * store a domain entity record in IndexedDB.
 */
export async function storeDomainEntity(entity: SkeinDomainEntity): Promise<void> {
  const db = await openBlobDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTITY_STORE, "readwrite");
    const store = tx.objectStore(ENTITY_STORE);
    store.put(entity);
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
 * retrieve a domain entity by its id.
 *
 * returns `null` when the entity does not exist.
 */
export async function getDomainEntity(entityId: string): Promise<SkeinDomainEntity | null> {
  const db = await openBlobDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTITY_STORE, "readonly");
    const store = tx.objectStore(ENTITY_STORE);
    const req = store.get(entityId);
    req.onsuccess = () => resolve((req.result as SkeinDomainEntity) ?? null);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

/**
 * retrieve all domain entities associated with a given blob id.
 */
export async function getDomainEntitiesByBlob(blobId: string): Promise<SkeinDomainEntity[]> {
  const db = await openBlobDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(ENTITY_STORE, "readonly");
    const store = tx.objectStore(ENTITY_STORE);
    const index = store.index("blob_id");
    const req = index.getAll(blobId);
    req.onsuccess = () => resolve((req.result as SkeinDomainEntity[]) ?? []);
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

// ---- deletion -------------------------------------------------------------

/**
 * delete a blob and all associated data.
 *
 * removes the OPFS file, the IndexedDB metadata record, any domain
 * entities referencing this blob, and any cached object url.
 */
export async function deleteBlob(blobId: string): Promise<void> {
  // remove from OPFS
  try {
    const dir = await getOpfsDir(false);
    if (dir) {
      await dir.removeEntry(blobId);
    }
  } catch {
    // file may not exist — that's fine
  }

  // revoke any cached url
  const cachedUrl = blobUrlCache.get(blobId);
  if (cachedUrl) {
    URL.revokeObjectURL(cachedUrl);
    blobUrlCache.delete(blobId);
  }

  // delete the blob record and associated domain entities from IDB
  const db = await openBlobDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([BLOB_STORE, ENTITY_STORE], "readwrite");

    // delete the blob record
    const blobStore = tx.objectStore(BLOB_STORE);
    blobStore.delete(blobId);

    // find and delete all domain entities referencing this blob
    const entityStore = tx.objectStore(ENTITY_STORE);
    const index = entityStore.index("blob_id");
    const cursorReq = index.openCursor(blobId);
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

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
 * clear all blob data — both IndexedDB stores, the OPFS directory,
 * and the session url cache.
 */
export async function clearAll(): Promise<void> {
  // clear the url cache
  clearBlobUrlCache();

  // clear both IDB stores
  const db = await openBlobDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([BLOB_STORE, ENTITY_STORE], "readwrite");
    tx.objectStore(BLOB_STORE).clear();
    tx.objectStore(ENTITY_STORE).clear();
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });

  // remove the OPFS directory
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(OPFS_DIR, { recursive: true });
  } catch {
    // directory may not exist — that's fine
  }
}
