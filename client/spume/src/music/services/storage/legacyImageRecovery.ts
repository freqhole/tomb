// recovers artist/album/song/playlist images left behind by pre-reliquary
// local blob storage.
//
// a browser that already had local images before this app adopted
// @freqhole/reliquary's blob store may have those images' bytes sitting in
// one of two now-unreachable places:
//
//   - this app's own predecessor to the reliquary blob store: a
//     sha256-keyed record in the same "freqhole_blobs" IndexedDB database
//     reliquary now uses (same db name, same "blobs" object store - see
//     blobs.ts's file header), with bytes in an opfs "blobs" directory or
//     the cache api under a "freqhole-blobs" cache. reliquary's own opfs
//     directory ("reliquary-blobs") and cache ("reliquary-blobs") are
//     named differently, so these bytes are invisible to it.
//   - an even older, IndexedDB-less scheme that wrote straight to an opfs
//     "thumbnails" directory (see music/services/opfs/helpers.ts's
//     writeThumbnailToOPFS, now unused) with no metadata record at all.
//
// entity records still reference these images by their original
// local_blob_id, but nothing reading through @freqhole/reliquary's blob
// store looks in either legacy location, so the images silently fail to
// resolve (they read as missing, not as an error).
//
// this is a one-shot, idempotent recovery: every already-resolving image
// is left untouched, and every entity whose bytes get recovered keeps its
// existing local_blob_id - the blob store's record for that id is
// backfilled in place (new required fields filled in, bytes copied into
// reliquary's current opfs/cache locations), so no album/artist/song/
// playlist record ever needs to change. safe to run repeatedly: already-
// migrated records (identified by having a `blake3` field) are skipped.

import { hashBlake3 } from "@freqhole/reliquary/worker";
import { defaultBytesChain, writeThroughChain } from "@freqhole/reliquary/blobs";
import { debug, error as errorLog, info, warn } from "../../../utils/logger";
import { initMusicDB } from "./db/init";
import { BLOB_DB_NAME, getBlob } from "./blobs";
import { STORE_ALBUMS, STORE_ARTISTS, STORE_PLAYLISTS, STORE_SONGS } from "./types";
import type { ImageMetadata } from "./types";

const TAG = "legacyImageRecovery";

// reliquary's internal metadata object store name (lib/reliquary/ts/src/
// blobs/db.ts's STORE_NAME) - not exported by @freqhole/reliquary, but
// stable: it's the same store blobs.ts has always used as its db/table
// name, from before reliquary's adoption through to today.
const LEGACY_BLOB_STORE = "blobs";

// this app's pre-reliquary opfs directory and cache api name for blob
// bytes (see blobs.ts's file header) - distinct from reliquary's own
// "reliquary-blobs" directory/cache.
const LEGACY_OPFS_DIR = "blobs";
const LEGACY_CACHE_NAME = "freqhole-blobs";
const LEGACY_CACHE_URL_ORIGIN = "https://blob.local";

// the even-older, IndexedDB-less opfs directory (see opfs/helpers.ts).
const LEGACY_THUMBNAILS_DIR = "thumbnails";

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
};

export interface LegacyImageRecoveryReport {
  /** unique local_blob_id references scanned across all entities. */
  scanned: number;
  /** already resolved through the current blob store - left untouched. */
  alreadyOk: number;
  /** recovered from a legacy location and backfilled into the current store. */
  recovered: number;
  /** referenced by an entity, but bytes could not be found anywhere. */
  missing: number;
}

interface RecoveredBytes {
  data: ArrayBuffer;
  mime: string;
  createdAt?: number;
  sha256?: string;
}

/**
 * scan every artist/album/song/playlist image reference, and backfill the
 * blob store for any that don't currently resolve. safe to call on every
 * app start - already-recovered (or never-broken) references are cheap to
 * re-check and are left alone.
 */
export async function recoverLegacyImages(): Promise<LegacyImageRecoveryReport> {
  const report: LegacyImageRecoveryReport = { scanned: 0, alreadyOk: 0, recovered: 0, missing: 0 };

  const ids = await collectLocalBlobIds();
  if (ids.size === 0) return report;

  let thumbnailsIndex: Map<string, string> | null = null;
  const getThumbnailsIndex = async (): Promise<Map<string, string>> => {
    if (!thumbnailsIndex) thumbnailsIndex = await buildThumbnailsIndex();
    return thumbnailsIndex;
  };

  for (const [blobId, blobType] of ids) {
    report.scanned++;

    const existing = await getBlob(blobId);
    if (existing) {
      report.alreadyOk++;
      continue;
    }

    const recovered = await recoverOneImage(blobId, blobType, getThumbnailsIndex);
    if (recovered) {
      report.recovered++;
      debug(TAG, `recovered image ${blobId.slice(0, 16)}...`);
    } else {
      report.missing++;
      warn(TAG, `could not recover image ${blobId.slice(0, 16)}... - bytes not found in any known legacy location`);
    }
  }

  info(
    TAG,
    `done: ${report.recovered} recovered, ${report.alreadyOk} already ok, ${report.missing} missing (of ${report.scanned} scanned)`
  );

  return report;
}

/** every unique local_blob_id referenced by an artist/album/song/playlist
 *  image, mapped to that image's blob_type (used as a best-effort default
 *  when backfilling a record that never had one). */
async function collectLocalBlobIds(): Promise<Map<string, ImageMetadata["blob_type"] | undefined>> {
  const db = await initMusicDB();
  const ids = new Map<string, ImageMetadata["blob_type"] | undefined>();

  const collect = (records: { images?: ImageMetadata[] }[]) => {
    for (const record of records) {
      for (const image of record.images ?? []) {
        if (image.local_blob_id) ids.set(image.local_blob_id, image.blob_type);
      }
    }
  };

  collect(await db.getAll(STORE_ALBUMS));
  collect(await db.getAll(STORE_ARTISTS));
  collect(await db.getAll(STORE_SONGS));
  collect(await db.getAll(STORE_PLAYLISTS));

  return ids;
}

async function recoverOneImage(
  blobId: string,
  blobType: ImageMetadata["blob_type"] | undefined,
  getThumbnailsIndex: () => Promise<Map<string, string>>
): Promise<boolean> {
  const fromLegacyStore = await readFromLegacyBlobStore(blobId);
  if (fromLegacyStore) {
    return backfillBlob(blobId, fromLegacyStore, blobType);
  }

  const thumbnailsIndex = await getThumbnailsIndex();
  const fromThumbnails = await readFromLegacyThumbnails(thumbnailsIndex, blobId);
  if (fromThumbnails) {
    return backfillBlob(blobId, fromThumbnails, blobType);
  }

  return false;
}

/** reads bytes for `blobId` out of this app's pre-reliquary blob store
 *  (same IndexedDB database/store, old field names, old opfs dir/cache). */
async function readFromLegacyBlobStore(blobId: string): Promise<RecoveredBytes | null> {
  let db: IDBDatabase;
  try {
    db = await openLegacyBlobsDb();
  } catch {
    return null;
  }

  try {
    const record = await getRawBlobRecord(db, blobId);
    // no record, or already migrated (has a blake3 field) - nothing to do.
    if (!record || record.blake3) return null;

    const storageType = record.storage_type as string | undefined;
    const mime = (record.mime_type as string | undefined) || "image/jpeg";
    const createdAt = record.created_at as number | undefined;

    const readers =
      storageType === "cache"
        ? [readLegacyCacheBytes, readLegacyOpfsBytes]
        : [readLegacyOpfsBytes, readLegacyCacheBytes];

    for (const read of readers) {
      const data = await read(blobId);
      if (data) return { data, mime, createdAt, sha256: blobId };
    }
    return null;
  } finally {
    db.close();
  }
}

/** reads bytes for `blobId` out of the even-older, IndexedDB-less opfs
 *  "thumbnails" directory (filenames are `${id}.${ext}` - see opfs/
 *  helpers.ts's now-unused writeThumbnailToOPFS). */
async function readFromLegacyThumbnails(
  thumbnailsIndex: Map<string, string>,
  blobId: string
): Promise<RecoveredBytes | null> {
  const filename = thumbnailsIndex.get(blobId);
  if (!filename) return null;

  try {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(LEGACY_THUMBNAILS_DIR, { create: false });
    const fileHandle = await dir.getFileHandle(filename, { create: false });
    const file = await fileHandle.getFile();
    const data = await file.arrayBuffer();
    const ext = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
    return { data, mime: EXT_TO_MIME[ext] ?? "image/jpeg" };
  } catch {
    return null;
  }
}

/** builds a one-time `id -> filename` index of the legacy "thumbnails"
 *  directory (ids alone don't carry an extension). */
async function buildThumbnailsIndex(): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  try {
    if (!navigator.storage?.getDirectory) return index;
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(LEGACY_THUMBNAILS_DIR, { create: false });
    for await (const [name, handle] of dir.entries()) {
      if (handle.kind !== "file") continue;
      const dot = name.lastIndexOf(".");
      const id = dot === -1 ? name : name.slice(0, dot);
      index.set(id, name);
    }
  } catch {
    // no "thumbnails" dir (nothing legacy to recover from here), or this
    // browser can't iterate opfs directories.
  }
  return index;
}

async function readLegacyOpfsBytes(id: string): Promise<ArrayBuffer | null> {
  try {
    if (!navigator.storage?.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle(LEGACY_OPFS_DIR, { create: false });
    const fileHandle = await dir.getFileHandle(id, { create: false });
    const file = await fileHandle.getFile();
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

async function readLegacyCacheBytes(id: string): Promise<ArrayBuffer | null> {
  try {
    if (typeof caches === "undefined") return null;
    const cache = await caches.open(LEGACY_CACHE_NAME);
    const response = await cache.match(`${LEGACY_CACHE_URL_ORIGIN}/${id}`);
    if (!response) return null;
    return await response.arrayBuffer();
  } catch {
    return null;
  }
}

/** writes recovered bytes into reliquary's current opfs/cache locations,
 *  then backfills the IndexedDB record in place - same `blob_id` key, now
 *  with every field the current blob store requires. */
async function backfillBlob(
  blobId: string,
  recovered: RecoveredBytes,
  blobType: ImageMetadata["blob_type"] | undefined
): Promise<boolean> {
  const backend = await writeThroughChain(defaultBytesChain(), blobId, recovered.data, recovered.mime);
  if (!backend) {
    errorLog(TAG, `recovered bytes for ${blobId.slice(0, 16)}... but no bytes backend accepted the write`);
    return false;
  }

  const blake3 = await hashBlake3(new Uint8Array(recovered.data));

  const record = {
    blob_id: blobId,
    blake3,
    sha256: recovered.sha256,
    filename: "image",
    mime: recovered.mime,
    size: recovered.data.byteLength,
    blob_type: blobType ?? "thumbnail",
    parent_blob_id: null,
    created_at: recovered.createdAt ?? Date.now(),
    storage_backend: backend,
  };

  let db: IDBDatabase;
  try {
    db = await openLegacyBlobsDb();
  } catch (err) {
    errorLog(TAG, `wrote bytes for ${blobId.slice(0, 16)}... but failed to open the metadata db:`, err);
    return false;
  }

  try {
    if (!db.objectStoreNames.contains(LEGACY_BLOB_STORE)) {
      errorLog(TAG, `wrote bytes for ${blobId.slice(0, 16)}... but the blob metadata store doesn't exist yet`);
      return false;
    }
    await putRawBlobRecord(db, record);
    return true;
  } finally {
    db.close();
  }
}

function openLegacyBlobsDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BLOB_DB_NAME);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function getRawBlobRecord(db: IDBDatabase, blobId: string): Promise<Record<string, unknown> | null> {
  if (!db.objectStoreNames.contains(LEGACY_BLOB_STORE)) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEGACY_BLOB_STORE, "readonly");
    const req = tx.objectStore(LEGACY_BLOB_STORE).get(blobId);
    req.onsuccess = () => resolve((req.result as Record<string, unknown>) ?? null);
    req.onerror = () => reject(req.error);
  });
}

function putRawBlobRecord(db: IDBDatabase, record: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(LEGACY_BLOB_STORE, "readwrite");
    tx.objectStore(LEGACY_BLOB_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
