// blob worker logic - the CPU-bound blob work (blake3 hashing, sha256
// hashing, base64 encode/decode, OPFS writes, thumbnail generation, chunked
// upload sessions) that `blob-worker.ts` exposes over comlink.
//
// kept free of comlink/postMessage side effects on purpose: this module is
// what the test suite imports directly, and what `blob-worker.ts` (the
// thin worker entry) and `blob-worker-client.ts` (the main-thread fallback
// path) both build on.
//
// browser-only. blake3 hashing needs a midden-shaped module bundled by the
// embedding app (see `midden-blake3.ts`) - without one, `hashBlake3`
// degrades to an empty string and the streaming upload/selftest functions
// throw a clear error, matching the graceful-degradation contract of the
// rest of this file.

import { sha256Hex } from "../utils/hash.js";
import { loadMiddenBlake3, type Blake3HasherLike } from "./midden-blake3.js";
import { log } from "../utils/log.js";

const TAG = "blob.worker.logic";

/** message the worker entry posts once comlink has registered its message
 *  listener - see `blob-worker.ts` for why the ordering matters. */
export const BLOB_WORKER_READY_MESSAGE = "blob-worker-ready";

/** directory name for the on-disk (OPFS) blob store. exported so callers
 *  reading bytes back directly (bypassing the worker's write path, e.g.
 *  `./blobs`'s main-thread OPFS reads) always agree with the worker on
 *  where the bytes actually live. */
export const OPFS_DIR = "reliquary-blobs";

/**
 * compute blake3 hash of a Uint8Array via the embedding app's midden
 * module. returns an empty string when no such module is bundled, or when
 * it does not export `hash_blake3`.
 */
export async function hashBlake3(data: Uint8Array): Promise<string> {
  try {
    const midden = await loadMiddenBlake3();
    if (!midden || typeof midden.hash_blake3 !== "function") {
      log.warn(
        TAG,
        "no midden module with hash_blake3 available, blake3 hashing degraded to empty string",
      );
      return "";
    }
    return midden.hash_blake3(data);
  } catch (err) {
    log.warn(TAG, "blake3 hashing threw, degrading to empty string:", err);
    return "";
  }
}

/**
 * compute sha256 hash via SubtleCrypto. SubtleCrypto.digest is already
 * async/non-blocking on the main thread, but this is exposed here too so
 * callers can do sha256 + blake3 in a single round-trip.
 */
export async function hashSha256(data: ArrayBuffer): Promise<string> {
  return sha256Hex(data);
}

/**
 * base64-encode an ArrayBuffer. uses chunked btoa to avoid stack overflow
 * on large buffers (`String.fromCharCode(...veryLargeArray)` blows up).
 */
export async function base64Encode(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000; // 32 KiB at a time
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

/**
 * decode a base64 string into a Uint8Array.
 */
export async function base64Decode(b64: string): Promise<Uint8Array> {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

// ---- OPFS write path ------------------------------------------------------

async function getOpfsDir(create = false): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(OPFS_DIR, { create });
  } catch {
    return null;
  }
}

// minimal structural type for FileSystemSyncAccessHandle - the lib.dom
// typings this package builds against don't include it. only the methods
// actually used here are typed.
interface SyncAccessHandle {
  truncate(size: number): void;
  write(buffer: ArrayBuffer | ArrayBufferView, options?: { at?: number }): number;
  flush(): void;
  close(): void;
}

/**
 * write blob bytes to OPFS. prefers `FileSystemSyncAccessHandle` (worker-only,
 * fastest path on chromium/safari/firefox) and falls back to the async
 * writable-stream API. silently no-ops if OPFS is unavailable.
 *
 * `data` should be transferred across postMessage to avoid a copy.
 */
export async function writeBlobToOpfs(blobId: string, data: ArrayBuffer): Promise<void> {
  const dir = await getOpfsDir(true);
  if (!dir) return;
  const fileHandle = await dir.getFileHandle(blobId, { create: true });

  // sync access handle: only available in workers, much faster than
  // createWritable(). uses synchronous I/O on a dedicated I/O thread.
  const createSync = (
    fileHandle as unknown as {
      createSyncAccessHandle?: () => Promise<SyncAccessHandle>;
    }
  ).createSyncAccessHandle;
  if (typeof createSync === "function") {
    let handle: SyncAccessHandle | null = null;
    try {
      handle = await createSync.call(fileHandle);
      handle.truncate(0);
      handle.write(data, { at: 0 });
      handle.flush();
    } finally {
      handle?.close();
    }
    return;
  }

  // fallback: async writable stream (works on main thread too)
  const createWritable = (
    fileHandle as unknown as {
      createWritable?: () => Promise<FileSystemWritableFileStream>;
    }
  ).createWritable;
  if (typeof createWritable !== "function") return;
  const writable = await createWritable.call(fileHandle);
  await writable.write(data);
  await writable.close();
}

/**
 * read blob bytes from OPFS into a transferable ArrayBuffer. returns null
 * if the file doesn't exist or OPFS is unavailable.
 */
export async function readBlobFromOpfs(blobId: string): Promise<ArrayBuffer | null> {
  const dir = await getOpfsDir(false);
  if (!dir) return null;
  try {
    const fileHandle = await dir.getFileHandle(blobId, { create: false });
    const file = await fileHandle.getFile();
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

// ---- combo: full upload pipeline ------------------------------------------

export interface ProcessedBlob {
  blob_id: string; // blake3 hex - the canonical content-address for the blob db
  sha256: string; // legacy hash, kept so old records/doc references still resolve
  blake3: string;
  size: number;
  mime: string;
  filename: string;
}

/**
 * one-shot: hash bytes (sha256 + blake3), write to OPFS, return metadata.
 * lets callers avoid three round-trips across the worker boundary for an
 * upload. `data` should be transferred.
 *
 * blake3 is the canonical blob id (matches iroh-blobs / a native rust
 * store); sha256 is still computed so legacy sha256-keyed records and old
 * doc references keep resolving via the sha256 index.
 */
export async function processBlobBytes(
  data: ArrayBuffer,
  filename: string,
  mime: string,
): Promise<ProcessedBlob> {
  // run sha256 and blake3 concurrently. SubtleCrypto.digest does its own
  // copy of the bytes, so we can't transfer-and-reuse - do them in parallel
  // and let the runtime overlap them.
  const [sha256, blake3] = await Promise.all([hashSha256(data), hashBlake3(new Uint8Array(data))]);
  await writeBlobToOpfs(blake3, data);
  return {
    blob_id: blake3,
    sha256,
    blake3,
    size: data.byteLength,
    mime,
    filename,
  };
}

// ---- thumbnail / image resize -------------------------------------------

export interface ResizeImageOptions {
  /** maximum output width in pixels (default: 200) */
  maxWidth?: number;
  /** maximum output height in pixels (default: 200) */
  maxHeight?: number;
  /** WebP quality 0..1 (default: 0.8) */
  quality?: number;
  /** if true, center-crop to a square before resizing */
  cropSquare?: boolean;
  /** if true, fit the whole image inside a maxWidth x maxHeight square
   * without cropping, padding the shorter axis with transparent pixels -
   * the right choice for document/page thumbnails, where cropping can cut
   * off real content. takes precedence over `cropSquare` when both are set. */
  fitSquare?: boolean;
  /** output mime type (default: "image/webp") */
  mime?: string;
}

/**
 * resize an image Blob to a WebP data URL via OffscreenCanvas. all heavy
 * work (image decode, resize, WebP encode, base64 encode) happens here.
 * returns null on any failure.
 *
 * the input Blob is structured-cloned across postMessage by reference
 * (the underlying bytes aren't copied), so this is cheap to call.
 */
export async function resizeImageToWebpDataUrl(
  blob: Blob,
  options?: ResizeImageOptions,
): Promise<string | null> {
  const maxWidth = options?.maxWidth ?? 200;
  const maxHeight = options?.maxHeight ?? 200;
  const quality = options?.quality ?? 0.8;
  const cropSquare = options?.cropSquare ?? false;
  const fitSquare = options?.fitSquare ?? false;
  const mime = options?.mime ?? "image/webp";

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);

    if (fitSquare) {
      const scale = Math.min(maxWidth / bitmap.width, maxHeight / bitmap.height);
      const drawW = Math.max(1, Math.round(bitmap.width * scale));
      const drawH = Math.max(1, Math.round(bitmap.height * scale));
      const dx = Math.floor((maxWidth - drawW) / 2);
      const dy = Math.floor((maxHeight - drawH) / 2);

      const canvas = new OffscreenCanvas(maxWidth, maxHeight);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      // canvas starts fully transparent — draw the scaled image centered,
      // leaving transparent padding on the shorter axis rather than
      // cropping content off the longer one.
      ctx.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, dx, dy, drawW, drawH);

      const out = await canvas.convertToBlob({ type: mime, quality });
      const buf = await out.arrayBuffer();
      const b64 = await base64Encode(buf);
      return `data:${mime};base64,${b64}`;
    }

    let sx = 0;
    let sy = 0;
    let sw = bitmap.width;
    let sh = bitmap.height;

    if (cropSquare) {
      const minDim = Math.min(bitmap.width, bitmap.height);
      sx = (bitmap.width - minDim) / 2;
      sy = (bitmap.height - minDim) / 2;
      sw = minDim;
      sh = minDim;
    }

    const sourceAspect = sw / sh;
    let outW = sw;
    let outH = sh;

    if (outW > maxWidth) {
      outW = maxWidth;
      outH = Math.round(outW / sourceAspect);
    }
    if (outH > maxHeight) {
      outH = maxHeight;
      outW = Math.round(outH * sourceAspect);
    }

    outW = Math.max(1, outW);
    outH = Math.max(1, outH);

    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);

    const out = await canvas.convertToBlob({ type: mime, quality });
    const buf = await out.arrayBuffer();
    const b64 = await base64Encode(buf);
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}

/**
 * convenience wrapper that fits an image inside `maxSize` x `maxSize`,
 * encoding WebP at 0.75 quality. skips non-image blobs.
 */
export async function generateThumbnailDataUrl(blob: Blob, maxSize = 200): Promise<string | null> {
  if (!blob.type.startsWith("image/")) return null;
  return resizeImageToWebpDataUrl(blob, {
    maxWidth: maxSize,
    maxHeight: maxSize,
    quality: 0.75,
  });
}

// ---- streaming upload sessions --------------------------------------------
// chunked counterpart to processBlobBytes: the main thread feeds a File's
// stream() chunks one at a time, so neither thread ever holds the whole
// payload. bytes land incrementally in a temp OPFS file (sync access
// handle), blake3 is computed incrementally via the embedding app's midden
// module, and on finish the temp file is renamed to the final blake3
// content address.

interface UploadSession {
  handle: SyncAccessHandle;
  tmpName: string;
  hasher: { update(chunk: Uint8Array): void; finalize(): string; free(): void };
  size: number;
}

const uploadSessions = new Map<number, UploadSession>();
let nextUploadSessionId = 1;

/**
 * begin a streaming upload session. throws when the environment can't
 * support it (no OPFS sync access handles, or no midden module with a
 * Blake3Hasher bundled) - callers fall back to the one-shot
 * processBlobBytes path.
 */
export async function uploadBegin(): Promise<number> {
  const midden = await loadMiddenBlake3();
  const Blake3HasherCtor = midden?.Blake3Hasher;
  if (typeof Blake3HasherCtor !== "function") {
    throw new Error("streaming upload unavailable: midden Blake3Hasher missing");
  }
  const dir = await getOpfsDir(true);
  if (!dir) throw new Error("streaming upload unavailable: OPFS inaccessible");

  const id = nextUploadSessionId++;
  const tmpName = `.upload-${id}-${Date.now()}`;
  const fileHandle = await dir.getFileHandle(tmpName, { create: true });
  const createSync = (
    fileHandle as unknown as { createSyncAccessHandle?: () => Promise<SyncAccessHandle> }
  ).createSyncAccessHandle;
  if (typeof createSync !== "function") {
    await dir.removeEntry(tmpName).catch(() => {});
    throw new Error("streaming upload unavailable: no sync access handle support");
  }
  const handle = await createSync.call(fileHandle);
  handle.truncate(0);

  uploadSessions.set(id, { handle, tmpName, hasher: new Blake3HasherCtor(), size: 0 });
  return id;
}

/** append the next chunk (transferred buffer) to a session. */
export async function uploadPush(id: number, buffer: ArrayBuffer): Promise<void> {
  const session = uploadSessions.get(id);
  if (!session) throw new Error(`unknown upload session ${id}`);
  const bytes = new Uint8Array(buffer);
  session.hasher.update(bytes);
  session.handle.write(bytes, { at: session.size });
  session.size += bytes.byteLength;
}

/**
 * finish a session: flush + close the temp file, then rename it to the
 * final blake3 content address. returns { blake3, size }.
 */
export async function uploadFinish(id: number): Promise<{ blake3: string; size: number }> {
  const session = uploadSessions.get(id);
  if (!session) throw new Error(`unknown upload session ${id}`);
  uploadSessions.delete(id);

  let blake3 = "";
  try {
    session.handle.flush();
    session.handle.close();
    blake3 = session.hasher.finalize();
  } finally {
    session.hasher.free();
  }

  const dir = await getOpfsDir(true);
  if (!dir) throw new Error("OPFS inaccessible at upload finish");
  const tmpHandle = await dir.getFileHandle(session.tmpName);

  // dedup: if the content-addressed file already exists, drop the temp copy
  let exists = false;
  try {
    await dir.getFileHandle(blake3, { create: false });
    exists = true;
  } catch {
    // target doesn't exist - rename below
  }
  if (exists) {
    await dir.removeEntry(session.tmpName).catch(() => {});
    return { blake3, size: session.size };
  }

  const move = (tmpHandle as unknown as { move?: (name: string) => Promise<void> }).move;
  if (typeof move === "function") {
    await move.call(tmpHandle, blake3);
  } else {
    // rare fallback (no FileSystemFileHandle.move): copy then remove.
    // buffers once here - still better than failing the upload.
    const file = await tmpHandle.getFile();
    await writeBlobToOpfs(blake3, await file.arrayBuffer());
    await dir.removeEntry(session.tmpName).catch(() => {});
  }
  return { blake3, size: session.size };
}

/** abort a session: close and delete the temp file. */
export async function uploadAbort(id: number): Promise<void> {
  const session = uploadSessions.get(id);
  if (!session) return;
  uploadSessions.delete(id);
  try {
    session.handle.close();
  } catch {
    // already closed
  }
  session.hasher.free();
  const dir = await getOpfsDir(false);
  await dir?.removeEntry(session.tmpName).catch(() => {});
}

// ---- streaming hash-only sessions -----------------------------------------
// same incremental Blake3Hasher as the upload sessions above, but with no
// OPFS write side at all - for callers that already have their own on-disk
// storage path (e.g. spume's video import, which writes to its own OPFS
// directory) and just need a blake3 without materializing the whole file
// in memory, and without a second on-disk copy under this package's own
// content-addressed OPFS_DIR.

const hashSessions = new Map<number, Blake3HasherLike>();
let nextHashSessionId = 1;

/**
 * begin a streaming hash-only session. throws when the environment can't
 * support it (no midden module with a Blake3Hasher bundled) - callers
 * fall back to the one-shot `hashBlake3`.
 */
export async function hashBegin(): Promise<number> {
  const midden = await loadMiddenBlake3();
  const Blake3HasherCtor = midden?.Blake3Hasher;
  if (typeof Blake3HasherCtor !== "function") {
    throw new Error("streaming hash unavailable: midden Blake3Hasher missing");
  }
  const id = nextHashSessionId++;
  hashSessions.set(id, new Blake3HasherCtor());
  return id;
}

/** feed the next chunk (transferred buffer) into a hash session. */
export async function hashPush(id: number, buffer: ArrayBuffer): Promise<void> {
  const hasher = hashSessions.get(id);
  if (!hasher) throw new Error(`unknown hash session ${id}`);
  hasher.update(new Uint8Array(buffer));
}

/** finish a session, returning the final blake3 hash. */
export async function hashFinish(id: number): Promise<string> {
  const hasher = hashSessions.get(id);
  if (!hasher) throw new Error(`unknown hash session ${id}`);
  hashSessions.delete(id);
  try {
    return hasher.finalize();
  } finally {
    hasher.free();
  }
}

/** abort a session, freeing the hasher without finalizing. */
export async function hashAbort(id: number): Promise<void> {
  const hasher = hashSessions.get(id);
  if (!hasher) return;
  hashSessions.delete(id);
  hasher.free();
}

/**
 * opfs-store selftest - runs the embedding app's midden module's
 * out-of-crate iroh-blobs store round trip against real OPFS. must run in
 * a dedicated worker: sync access handles don't exist on the main thread.
 * throws when no midden module (or no `opfs_store_selftest` export) is
 * bundled.
 */
export async function opfsStoreSelftest(): Promise<string> {
  const midden = await loadMiddenBlake3();
  const fn = midden?.opfs_store_selftest;
  if (typeof fn !== "function") {
    throw new Error("opfs_store_selftest missing from the bundled midden module");
  }
  return fn();
}

/**
 * persistence selftest - blobs + tags must survive a store shutdown and
 * reopen over the same OPFS directory (the whole point of the store:
 * cross-reload resume without re-import). worker context required.
 */
export async function opfsStoreSelftestPersistence(): Promise<string> {
  const midden = await loadMiddenBlake3();
  const fn = midden?.opfs_store_selftest_persistence;
  if (typeof fn !== "function") {
    throw new Error("opfs_store_selftest_persistence missing from the bundled midden module");
  }
  return fn();
}
