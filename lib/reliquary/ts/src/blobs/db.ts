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
const REFS_STORE_NAME = "blob_canvas_refs";
const DB_VERSION = 3;

function openVersioned(dbName: string, version: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, version);
    req.onupgradeneeded = () => {
      const db = req.result;
      let store: IDBObjectStore;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        store = db.createObjectStore(STORE_NAME, { keyPath: "blob_id" });
        store.createIndex("sha256", "sha256", { unique: false });
        store.createIndex("blake3", "blake3", { unique: false });
        store.createIndex("blob_type", "blob_type", { unique: false });
        store.createIndex("parent_blob_id", "parent_blob_id", { unique: false });
      } else {
        // pre-existing store from an earlier DB_VERSION - new indexes can
        // still be added via the in-flight version-change transaction
        // (`req.transaction`), they just can't be added outside
        // onupgradeneeded. without this branch a version bump would silently
        // never add the index for anyone who already has a v1/v2 database.
        store = req.transaction!.objectStore(STORE_NAME);
      }
      // added in v3 - supports sorting the local-files list (filez tab 2)
      // by size without a full-store scan.
      if (!store.indexNames.contains("size")) {
        store.createIndex("size", "size", { unique: false });
      }
      if (!store.indexNames.contains("created_at")) {
        store.createIndex("created_at", "created_at", { unique: false });
      }
      if (!db.objectStoreNames.contains(REFS_STORE_NAME)) {
        // tracks which canvas documents currently have a widget
        // referencing a given blob - a widget-delete cleanup can check
        // this before purging local bytes, instead of scanning every
        // canvas. composite key so re-adding an existing ref is a no-op
        // (put with the same key overwrites, add() would throw).
        const refs = db.createObjectStore(REFS_STORE_NAME, { keyPath: ["blob_id", "canvas_doc_id"] });
        refs.createIndex("blob_id", "blob_id", { unique: false });
        refs.createIndex("canvas_doc_id", "canvas_doc_id", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// a dbName passed to `createBlobStore` is often an app's pre-existing
// database (that's the whole point of making it a constructor parameter -
// see store.ts) - it may already sit at a version higher than
// `DB_VERSION`, and `indexedDB.open(name, version)` fails with a
// VersionError when asked for a version lower than the database's actual
// one. resolved versions are cached per dbName so the common case (a
// fresh database, or one already at `DB_VERSION`) only ever pays for one
// open per operation, matching the "open fresh, close when done" pattern
// used throughout this module.
const resolvedVersions = new Map<string, number>();

async function openDb(dbName: string): Promise<IDBDatabase> {
  const cachedVersion = resolvedVersions.get(dbName);
  if (cachedVersion !== undefined) {
    return openVersioned(dbName, cachedVersion);
  }

  try {
    const db = await openVersioned(dbName, DB_VERSION);
    resolvedVersions.set(dbName, DB_VERSION);
    return db;
  } catch (err) {
    if (!(err instanceof DOMException) || err.name !== "VersionError") throw err;

    // the database already exists at some higher version - open it
    // version-less to discover what that is, then reopen at that exact
    // version (creating the store if a pre-existing database somehow
    // never had one).
    const probe = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const currentVersion = probe.version;
    const hasStore =
      probe.objectStoreNames.contains(STORE_NAME) && probe.objectStoreNames.contains(REFS_STORE_NAME);
    probe.close();

    const targetVersion = hasStore ? currentVersion : currentVersion + 1;
    resolvedVersions.set(dbName, targetVersion);
    return openVersioned(dbName, targetVersion);
  }
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

// ---------------------------------------------------------------------------
// blob/canvas reference index - which canvas docs currently have a widget
// referencing a given blob, so a widget-delete cleanup can check this
// before purging local bytes instead of scanning every canvas.
// ---------------------------------------------------------------------------

export async function addCanvasRef(dbName: string, blobId: string, canvasDocId: string): Promise<void> {
  const db = await openDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REFS_STORE_NAME, "readwrite");
    tx.objectStore(REFS_STORE_NAME).put({ blob_id: blobId, canvas_doc_id: canvasDocId });
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

export async function removeCanvasRef(dbName: string, blobId: string, canvasDocId: string): Promise<void> {
  const db = await openDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REFS_STORE_NAME, "readwrite");
    tx.objectStore(REFS_STORE_NAME).delete([blobId, canvasDocId]);
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

export async function getCanvasRefs(dbName: string, blobId: string): Promise<string[]> {
  const db = await openDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REFS_STORE_NAME, "readonly");
    const req = tx.objectStore(REFS_STORE_NAME).index("blob_id").getAll(blobId);
    req.onsuccess = () => {
      const rows = (req.result as { canvas_doc_id: string }[]) ?? [];
      resolve(rows.map((r) => r.canvas_doc_id));
    };
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => db.close();
  });
}

export async function removeAllCanvasRefsForCanvas(dbName: string, canvasDocId: string): Promise<void> {
  const db = await openDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REFS_STORE_NAME, "readwrite");
    const store = tx.objectStore(REFS_STORE_NAME);
    const req = store.index("canvas_doc_id").openCursor(IDBKeyRange.only(canvasDocId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    req.onerror = () => reject(req.error);
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

export async function clearCanvasRefs(dbName: string): Promise<void> {
  const db = await openDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(REFS_STORE_NAME, "readwrite");
    tx.objectStore(REFS_STORE_NAME).clear();
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

// ---------------------------------------------------------------------------
// paginated/sortable/searchable listing - backs the filez widget's local-
// files tab. indexeddb has no native LIKE/filtered-count/filtered-sum, so
// `totalCount`/`totalSize` always cost one full cursor scan (bounded to one
// record at a time, never the whole store materialized in an array); the
// page itself streams off an indexed cursor (sort by "size"/"created_at")
// so pagination stays cheap even when `search` narrows the results. sorting
// by "filename" has no index to lean on and falls back to fetch-all + sort
// in memory - acceptable since it's the secondary/less-common path.
// ---------------------------------------------------------------------------

export interface ListBlobsOptions {
  sort?: "size" | "filename" | "created_at";
  direction?: "asc" | "desc";
  /** filename substring filter, case-insensitive (matches sqlite's default
   *  `LIKE` behavior on the rust/tauri side). */
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ListBlobsPage {
  items: BlobRecord[];
  /** rows matching `search` (or every row, if no `search`) - not just this page. */
  totalCount: number;
  /** bytes across every row matching `search` (or every row, if no `search`). */
  totalSize: number;
}

function matchesSearch(record: BlobRecord, search?: string): boolean {
  if (!search) return true;
  return (record.filename ?? "").toLowerCase().includes(search.toLowerCase());
}

export async function listBlobs(dbName: string, options: ListBlobsOptions = {}): Promise<ListBlobsPage> {
  const { sort = "created_at", direction = "desc", search, limit = 50, offset = 0 } = options;
  const db = await openDb(dbName);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);

    let totalCount = 0;
    let totalSize = 0;
    const items: BlobRecord[] = [];

    tx.oncomplete = () => {
      db.close();
      resolve({ items, totalCount, totalSize });
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };

    // aggregate pass, always a full scan (see module doc comment above).
    const aggReq = store.openCursor();
    aggReq.onsuccess = () => {
      const cursor = aggReq.result;
      if (!cursor) {
        collectPage();
        return;
      }
      const record = cursor.value as BlobRecord;
      if (matchesSearch(record, search)) {
        totalCount += 1;
        totalSize += record.size ?? 0;
      }
      cursor.continue();
    };
    aggReq.onerror = () => reject(aggReq.error);

    function collectPage(): void {
      const useIndex = (sort === "size" || sort === "created_at") && store.indexNames.contains(sort);
      const cursorDirection: IDBCursorDirection = direction === "asc" ? "next" : "prev";

      if (useIndex) {
        let skipped = 0;
        const req = store.index(sort).openCursor(null, cursorDirection);
        req.onsuccess = () => {
          const cursor = req.result;
          // no `cursor.continue()` here on either branch below intentionally
          // stops iteration once the page is full - the transaction then
          // auto-completes since nothing else is pending.
          if (!cursor || items.length >= limit) return;
          const record = cursor.value as BlobRecord;
          if (matchesSearch(record, search)) {
            if (skipped < offset) {
              skipped += 1;
            } else {
              items.push(record);
            }
          }
          cursor.continue();
        };
        req.onerror = () => reject(req.error);
        return;
      }

      // filename sort: no index to stream off, fetch/filter/sort/slice.
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result as BlobRecord[]).filter((r) => matchesSearch(r, search));
        all.sort((a, b) => {
          const av = (a.filename ?? "").toLowerCase();
          const bv = (b.filename ?? "").toLowerCase();
          return direction === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
        });
        items.push(...all.slice(offset, offset + limit));
      };
      req.onerror = () => reject(req.error);
    }
  });
}

