// the blake3-canonical blob record store: ties the metadata side (db.ts,
// IndexedDB) to the bytes side (bytes-backend.ts, OPFS + Cache API) behind
// one API, and implements the resolver chain that lets old sha256-era
// references keep working alongside new blake3-keyed records.
//
// "resolver chain" here means two related lookup chains:
//   - record resolution (`resolveBlob`): primary key -> blake3 index ->
//     sha256 index -> blake3 index again with a separately-known hash.
//     this is what lets a caller pass either a blake3 or a legacy sha256
//     and get the same record back.
//   - bytes resolution (`bytes-backend.ts`'s `readThroughChain`): a
//     record's `storage_backend` field says where its bytes were written;
//     when that's unknown (a record predating the field) every backend is
//     probed in order (OPFS, then Cache API).
//
// db name is a constructor parameter (`createBlobStore({ dbName })`) so
// each consuming app can keep its own existing IndexedDB database name -
// no browser-data migration is forced by adopting this package. bytes
// storage (OPFS directory, Cache API cache) is content-addressed by
// blake3 and shared at the origin regardless of which app wrote it, so it
// is not parameterized per store instance - see `bytes-backend.ts`.

import { hashBlake3, hashSha256, streamFileToOpfs } from "../worker/index.js";
import {
  clearRecords,
  deleteRecord,
  getRecord,
  getRecordByBlake3,
  getRecordBySha256,
  putRecord,
} from "./db.js";
import {
  defaultBytesChain,
  hasBytesInChain,
  readThroughChain,
  removeFromChain,
  writeThroughChain,
  type BytesBackend,
} from "./bytes-backend.js";
import type { BlobLocalityInfo, BlobRecord, NewBlobMeta } from "./types.js";

export { isOPFSSupported } from "./bytes-backend.js";
export type { BlobLocalityInfo, BlobLocalityMetadata, BlobRecord, BlobType, BytesBackendName, NewBlobMeta } from "./types.js";

/** default IndexedDB database name for apps that don't need to preserve an
 *  existing one. */
export const DEFAULT_DB_NAME = "reliquary-blobs";

/** files at or above this size stream into OPFS chunk-by-chunk (incremental
 *  blake3 + sync-access-handle writes via the blob worker) instead of being
 *  buffered whole for the one-shot hash+write pipeline. */
const STREAM_UPLOAD_THRESHOLD = 8 * 1024 * 1024;

export interface BlobStoreOptions {
  /** IndexedDB database name for this store's metadata. defaults to
   *  `DEFAULT_DB_NAME`; pass an app's existing database name to keep
   *  reading/writing the same browser data it already has. */
  dbName?: string;
}

export interface StoreBlobFromFileOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export interface BlobStore {
  storeBlob(data: ArrayBuffer, meta: NewBlobMeta): Promise<BlobRecord>;
  storeBlobFromFile(
    file: File,
    meta?: Partial<NewBlobMeta>,
    options?: StoreBlobFromFileOptions
  ): Promise<BlobRecord>;
  getBlobRecord(blobId: string): Promise<BlobRecord | null>;
  getBlobRecordByBlake3(blake3: string): Promise<BlobRecord | null>;
  getBlobRecordBySha256(sha256: string): Promise<BlobRecord | null>;
  resolveBlob(blobId: string, blake3?: string): Promise<BlobRecord | null>;
  getBlobMetadata(blobId: string, blake3?: string): Promise<BlobRecord | null>;
  getBlobData(blobId: string, blake3?: string): Promise<ArrayBuffer | null>;
  getBlob(blobId: string, blake3?: string): Promise<Blob | null>;
  getBlobObjectURL(blobId: string, blake3?: string): Promise<string | null>;
  clearBlobUrlCache(): void;
  hasBlobBytes(blobId: string): Promise<boolean>;
  checkBlobLocality(blobId: string, blake3?: string): Promise<BlobLocalityInfo>;
  deleteBlob(blobId: string): Promise<void>;
  clearAll(): Promise<void>;
}

/** create a blob store instance. each instance owns its own object-url
 *  cache; construct one per app (not per component/request). */
export function createBlobStore(options: BlobStoreOptions = {}): BlobStore {
  const dbName = options.dbName ?? DEFAULT_DB_NAME;
  const chain: BytesBackend[] = defaultBytesChain();

  const blobUrlCache = new Map<string, string>();
  let beforeUnloadRegistered = false;
  function ensureBeforeUnloadListener(): void {
    if (beforeUnloadRegistered || typeof window === "undefined") return;
    window.addEventListener("beforeunload", () => {
      for (const url of blobUrlCache.values()) URL.revokeObjectURL(url);
      blobUrlCache.clear();
    });
    beforeUnloadRegistered = true;
  }

  async function storeBlob(data: ArrayBuffer, meta: NewBlobMeta): Promise<BlobRecord> {
    // hash before writing anything - both hashers copy their input rather
    // than transferring it, so `data` is still intact for the write below.
    const [blake3, sha256] = await Promise.all([hashBlake3(new Uint8Array(data)), hashSha256(data)]);
    const blobId = blake3;

    // dedup - content-addressed, so a pre-existing record for this blake3
    // means the bytes are already stored under it.
    const existing = await getRecord(dbName, blobId);
    if (existing) return existing;

    // opfs primary, cache-api fallback for opfs-less environments. only a
    // total failure (neither backend accepted the write) throws - a record
    // with bytes nowhere is worse than no record at all, but a successful
    // cache-api write is not a failure.
    const backend = await writeThroughChain(chain, blobId, data, meta.mime);
    if (!backend) {
      throw new Error(`blob write failed for ${blobId.slice(0, 16)}... - no bytes backend accepted it`);
    }

    const record: BlobRecord = {
      blob_id: blobId,
      blake3,
      sha256,
      filename: meta.filename,
      mime: meta.mime,
      size: data.byteLength,
      blob_type: meta.blob_type ?? "original",
      parent_blob_id: meta.parent_blob_id ?? null,
      metadata: meta.metadata,
      created_at: Date.now(),
      storage_backend: backend,
    };
    await putRecord(dbName, record);
    return record;
  }

  async function storeBlobFromFile(
    file: File,
    meta: Partial<NewBlobMeta> = {},
    options?: StoreBlobFromFileOptions
  ): Promise<BlobRecord> {
    const mime = meta.mime ?? file.type ?? "application/octet-stream";
    const filename = meta.filename ?? file.name;

    if (file.size >= STREAM_UPLOAD_THRESHOLD) {
      try {
        const { blake3, size } = await streamFileToOpfs(file, options);
        const existing = await getRecord(dbName, blake3);
        if (existing) return existing;
        // sha256 is legacy-only - it's never computed for a streamed
        // upload, since brand-new content has no old sha256-keyed
        // reference that would need it.
        const record: BlobRecord = {
          blob_id: blake3,
          blake3,
          filename,
          mime,
          size,
          blob_type: meta.blob_type ?? "original",
          parent_blob_id: meta.parent_blob_id ?? null,
          metadata: meta.metadata,
          created_at: Date.now(),
          storage_backend: "opfs",
        };
        await putRecord(dbName, record);
        return record;
      } catch (err) {
        // a deliberate cancel must propagate, not silently fall back to
        // buffering the whole file.
        if (err instanceof DOMException && err.name === "AbortError") throw err;
        // otherwise fall through to the buffered path below (e.g. no
        // worker, no OPFS sync-access-handle support in this browser).
      }
    }

    if (options?.signal?.aborted) {
      throw new DOMException("upload cancelled", "AbortError");
    }

    const buffer = await file.arrayBuffer();
    return storeBlob(buffer, { filename, mime, ...meta });
  }

  function getBlobRecord(blobId: string): Promise<BlobRecord | null> {
    return getRecord(dbName, blobId);
  }

  function getBlobRecordByBlake3(blake3: string): Promise<BlobRecord | null> {
    return getRecordByBlake3(dbName, blake3);
  }

  function getBlobRecordBySha256(sha256: string): Promise<BlobRecord | null> {
    return getRecordBySha256(dbName, sha256);
  }

  /**
   * resolve a blobId to a record using multiple lookup strategies: primary
   * key -> blake3 index (blobId itself) -> sha256 index -> blake3 index
   * (separately-known hash). handles both id generations - blake3 is
   * canonical now, sha256-keyed records are legacy but must keep
   * resolving.
   */
  async function resolveBlob(blobId: string, blake3?: string): Promise<BlobRecord | null> {
    if (!blobId) return null;

    const byKey = await getRecord(dbName, blobId);
    if (byKey) return byKey;

    const byIdAsBlake3 = await getRecordByBlake3(dbName, blobId);
    if (byIdAsBlake3) return byIdAsBlake3;

    const bySha = await getRecordBySha256(dbName, blobId);
    if (bySha) return bySha;

    if (blake3) {
      const byBlake3 = await getRecordByBlake3(dbName, blake3);
      if (byBlake3) return byBlake3;
    }

    return null;
  }

  async function getBlobData(blobId: string, blake3?: string): Promise<ArrayBuffer | null> {
    const record = await resolveBlob(blobId, blake3);
    if (!record) return null;
    return readThroughChain(chain, record.blob_id, record.storage_backend);
  }

  async function getBlob(blobId: string, blake3?: string): Promise<Blob | null> {
    const record = await resolveBlob(blobId, blake3);
    if (!record) return null;
    const data = await readThroughChain(chain, record.blob_id, record.storage_backend);
    if (!data) return null;
    return new Blob([data], { type: record.mime || "application/octet-stream" });
  }

  async function getBlobObjectURL(blobId: string, blake3?: string): Promise<string | null> {
    ensureBeforeUnloadListener();

    const cached = blobUrlCache.get(blobId);
    if (cached) return cached;

    const blob = await getBlob(blobId, blake3);
    if (!blob) return null;

    const url = URL.createObjectURL(blob);
    blobUrlCache.set(blobId, url);
    return url;
  }

  function clearBlobUrlCache(): void {
    for (const url of blobUrlCache.values()) URL.revokeObjectURL(url);
    blobUrlCache.clear();
  }

  async function hasBlobBytes(blobId: string): Promise<boolean> {
    const record = await resolveBlob(blobId);
    if (!record) return false;
    return hasBytesInChain(chain, record.blob_id, record.storage_backend);
  }

  /**
   * check whether a blob is available locally. a record without bytes
   * (e.g. a write whose bytes backend silently failed, or a record synced
   * in from a peer before its bytes arrived) counts as "remote" rather
   * than a stuck "local" - that stranded state previously left playback
   * finding nothing with no re-snatch ever offered.
   */
  async function checkBlobLocality(blobId: string, blake3?: string): Promise<BlobLocalityInfo> {
    if (!blobId) return { locality: "unknown" };

    const record = await resolveBlob(blobId, blake3);
    if (!record) return { locality: "remote" };

    const bytesPresent = await hasBytesInChain(chain, record.blob_id, record.storage_backend);
    if (!bytesPresent) return { locality: "remote" };

    return {
      locality: "local",
      metadata: {
        id: record.blob_id,
        mime: record.mime || undefined,
        filename: record.filename || undefined,
        size: record.size || undefined,
        blake3: record.blake3 || undefined,
      },
    };
  }

  async function deleteBlob(blobId: string): Promise<void> {
    const record = await getRecord(dbName, blobId);
    if (record) await removeFromChain(chain, record.blob_id);

    const cachedUrl = blobUrlCache.get(blobId);
    if (cachedUrl) {
      URL.revokeObjectURL(cachedUrl);
      blobUrlCache.delete(blobId);
    }

    await deleteRecord(dbName, blobId);
  }

  async function clearAll(): Promise<void> {
    clearBlobUrlCache();
    await clearRecords(dbName);
    await Promise.all(chain.map((backend) => backend.clear()));
  }

  return {
    storeBlob,
    storeBlobFromFile,
    getBlobRecord,
    getBlobRecordByBlake3,
    getBlobRecordBySha256,
    resolveBlob,
    getBlobMetadata: resolveBlob,
    getBlobData,
    getBlob,
    getBlobObjectURL,
    clearBlobUrlCache,
    hasBlobBytes,
    checkBlobLocality,
    deleteBlob,
    clearAll,
  };
}

// low-level building blocks re-exported for callers that need to compose
// their own resolver chain (e.g. a future transfer layer writing
// already-hashed, already-verified bytes without re-hashing them here).
export { writeThroughChain, readThroughChain, hasBytesInChain, removeFromChain } from "./bytes-backend.js";
export type { BytesBackend } from "./bytes-backend.js";
