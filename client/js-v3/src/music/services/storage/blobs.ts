// local blob storage for images and media
// metadata in IndexedDB, actual blob data in OPFS or Cache API

import { openDB, type IDBPDatabase } from "idb";
import { url } from "inspector/promises";

const BLOB_DB_NAME = "freqhole_blobs";
const BLOB_DB_VERSION = 1;
const STORE_BLOBS = "blobs";
const CACHE_NAME = "freqhole-blobs";

// global blob URL cache - persists for session, cleared on page reload
const BLOB_URL_CACHE = new Map<string, string>();

export type BlobStorageType = "opfs" | "cache";

export interface BlobRecord {
  blob_id: string; // sha256 hash of content (primary key)
  storage_type: BlobStorageType;
  storage_path: string; // opfs path or cache key
  mime_type: string;
  file_size: number;
  created_at: number;
}

let blobDbInstance: IDBPDatabase | null = null;

async function initBlobDB(): Promise<IDBPDatabase> {
  if (blobDbInstance) return blobDbInstance;

  blobDbInstance = await openDB(BLOB_DB_NAME, BLOB_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: "blob_id" });
      }
    },
  });

  return blobDbInstance;
}

/**
 * check if OPFS is available
 */
async function isOPFSAvailable(): Promise<boolean> {
  try {
    if (!navigator.storage?.getDirectory) return false;
    await navigator.storage.getDirectory();
    return true;
  } catch {
    return false;
  }
}

/**
 * write blob to OPFS
 */
async function writeBlobToOPFS(blobId: string, data: Blob): Promise<string> {
  const root = await navigator.storage.getDirectory();
  const blobsDir = await root.getDirectoryHandle("blobs", { create: true });
  const fileHandle = await blobsDir.getFileHandle(blobId, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
  return `/blobs/${blobId}`;
}

/**
 * read blob from OPFS
 */
async function readBlobFromOPFS(storagePath: string): Promise<Blob | null> {
  try {
    const root = await navigator.storage.getDirectory();
    const blobsDir = await root.getDirectoryHandle("blobs");
    const fileName = storagePath.split("/").pop()!;
    const fileHandle = await blobsDir.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    return file;
  } catch {
    return null;
  }
}

/**
 * write blob to Cache API
 */
async function writeBlobToCache(blobId: string, data: Blob, mimeType: string): Promise<string> {
  const cache = await caches.open(CACHE_NAME);
  const url = `freqhole://blob/${blobId}`;
  const response = new Response(data, {
    headers: { "Content-Type": mimeType },
  });
  await cache.put(url, response);
  return url;
}

/**
 * read blob from Cache API
 */
async function readBlobFromCache(storagePath: string): Promise<Blob | null> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(storagePath);
    if (!response) return null;
    return await response.blob();
  } catch {
    return null;
  }
}

/**
 * store a blob in local storage and return its ID (sha256 hash)
 * automatically chooses OPFS or Cache API based on availability
 */
export async function storeBlob(
  data: Blob,
  mimeType: string,
): Promise<string> {
  const db = await initBlobDB();

  // compute sha256 hash of blob data
  const arrayBuffer = await data.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const blobId = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");

  // check if already exists
  const existing = await db.get(STORE_BLOBS, blobId);
  if (existing) {
    return blobId;
  }

  // determine storage type and write blob data
  const useOPFS = await isOPFSAvailable();
  const storageType: BlobStorageType = useOPFS ? "opfs" : "cache";
  const storagePath = useOPFS
    ? await writeBlobToOPFS(blobId, data)
    : await writeBlobToCache(blobId, data, mimeType);

  // store metadata
  const record: BlobRecord = {
    blob_id: blobId,
    storage_type: storageType,
    storage_path: storagePath,
    mime_type: mimeType,
    file_size: data.size,
    created_at: Date.now(),
  };

  await db.put(STORE_BLOBS, record);
  return blobId;
}

/**
 * get blob metadata by ID
 */
export async function getBlobMetadata(blobId: string): Promise<BlobRecord | null> {
  const db = await initBlobDB();
  const record = await db.get(STORE_BLOBS, blobId);
  return record || null;
}

/**
 * get blob data by ID
 */
export async function getBlob(blobId: string): Promise<Blob | null> {
  const metadata = await getBlobMetadata(blobId);
  if (!metadata) return null;

  if (metadata.storage_type === "opfs") {
    return await readBlobFromOPFS(metadata.storage_path);
  } else {
    return await readBlobFromCache(metadata.storage_path);
  }
}

/**
 * get blob object URL by ID (cached to avoid repeated OPFS reads and URL creations)
 * returns object URL string that can be used directly in img src
 * URLs are cached for the session and automatically cleaned up on page unload
 */
export async function getBlobObjectURL(blobId: string): Promise<string | null> {
  if (!blobId) return null;
  
  // check cache first
  const cachedUrl = BLOB_URL_CACHE.get(blobId);
  if (cachedUrl) return cachedUrl;
  
  // fetch blob and create object URL
  const blob = await getBlob(blobId);
  if (!blob) return null;
  
  const objectUrl = URL.createObjectURL(blob);
  BLOB_URL_CACHE.set(blobId, objectUrl);
  
  return objectUrl;
}


/**
 * synchronous blob URL cache lookup (no OPFS read)
 * returns cached object URL if available, null otherwise
 */
export function getCachedBlobObjectURL(blobId: string): string | null {
  if (!blobId) return null;
  return BLOB_URL_CACHE.get(blobId) ?? null;
}

/**
 * clear all cached blob URLs (for testing/cleanup)
 */
export function clearBlobUrlCache(): void {
  BLOB_URL_CACHE.forEach(url => URL.revokeObjectURL(url));
  BLOB_URL_CACHE.clear();
}

// cleanup on page unload (optional - browser does this anyway)
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    clearBlobUrlCache();
  });
}

/**
 * delete blob by ID
 */
export async function deleteBlob(blobId: string): Promise<void> {
  const metadata = await getBlobMetadata(blobId);
  if (!metadata) return;

  // delete from storage
  if (metadata.storage_type === "opfs") {
    try {
      const root = await navigator.storage.getDirectory();
      const blobsDir = await root.getDirectoryHandle("blobs");
      const fileName = metadata.storage_path.split("/").pop()!;
      await blobsDir.removeEntry(fileName);
    } catch {
      // ignore errors
    }
  } else {
    try {
      const cache = await caches.open(CACHE_NAME);
      await cache.delete(metadata.storage_path);
    } catch {
      // ignore errors
    }
  }

  // delete metadata
  const db = await initBlobDB();
  await db.delete(STORE_BLOBS, blobId);
}
