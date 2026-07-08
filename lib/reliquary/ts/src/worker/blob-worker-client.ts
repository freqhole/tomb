// blob-worker-client - lazy comlink wrapper around the blob worker.
//
// the worker is spun up on first call to `getBlobWorker()` and reused for
// the lifetime of the page. importing this module costs nothing - the
// worker bundle is only fetched/instantiated on first use.
//
// in environments without Worker support (e.g. SSR / certain test runners)
// the client falls back to a synchronous in-process implementation so
// callers don't have to branch.

import * as Comlink from "comlink";
import type { BlobWorkerApi } from "./blob-worker.js";
import { sha256Hex } from "../utils/hash.js";
import { loadMiddenBlake3 } from "./midden-blake3.js";
import { BLOB_WORKER_READY_MESSAGE } from "./blob-worker-logic.js";

let workerProxy: Comlink.Remote<BlobWorkerApi> | null = null;
let workerInstance: Worker | null = null;
let workerReadyPromise: Promise<Comlink.Remote<BlobWorkerApi> | null> | null = null;

// generous - the worker's top-level module may load a wasm-backed midden
// module (when the embedding app bundles one) before it can register its
// Comlink message listener. slow CI runners / cold caches can take a few
// seconds for this.
const WORKER_READY_TIMEOUT_MS = 20_000;

function canSpawnWorker(): boolean {
  return typeof Worker !== "undefined";
}

/**
 * get (and lazily spawn) the comlink-wrapped blob worker proxy.
 *
 * returns null if Worker isn't available, or if the worker doesn't signal
 * readiness within `WORKER_READY_TIMEOUT_MS` - callers should branch and use
 * a main-thread fallback (every exported helper below already does this).
 *
 * waits for an explicit "ready" postMessage from the worker before handing
 * out the Comlink proxy. this avoids a real race: the worker's module top
 * level may await a wasm module's instantiation before calling
 * `Comlink.expose()` (which registers the "message" listener). an RPC call
 * sent before that listener exists fires with no listener attached and is
 * silently dropped forever - the caller's promise then never resolves.
 * waiting for the ready signal (sent immediately after `Comlink.expose()`
 * in blob-worker.ts) guarantees the listener is registered before any real
 * RPC call goes out.
 */
export async function getBlobWorker(): Promise<Comlink.Remote<BlobWorkerApi> | null> {
  if (workerProxy) return workerProxy;
  if (!canSpawnWorker()) return null;
  if (workerReadyPromise) return workerReadyPromise;

  workerReadyPromise = (async () => {
    // standard web-platform worker construction: resolves relative to this
    // module's own compiled location, so it works under vite, webpack 5,
    // and plain browsers without a bundler-specific import suffix.
    const worker = new Worker(new URL("./blob-worker.js", import.meta.url), { type: "module" });

    const ready = await new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        worker.removeEventListener("message", onMessage);
        resolve(false);
      }, WORKER_READY_TIMEOUT_MS);
      const onMessage = (e: MessageEvent): void => {
        if (e.data !== BLOB_WORKER_READY_MESSAGE) return;
        clearTimeout(timeout);
        worker.removeEventListener("message", onMessage);
        resolve(true);
      };
      worker.addEventListener("message", onMessage);
    });

    if (!ready) {
      worker.terminate();
      // allow a future call to retry (e.g. a one-off slow load) instead of
      // permanently caching this failure.
      workerReadyPromise = null;
      return null;
    }

    workerInstance = worker;
    workerProxy = Comlink.wrap<BlobWorkerApi>(worker);
    return workerProxy;
  })();

  return workerReadyPromise;
}

/**
 * tear down the worker. mainly useful for tests; production code can leave
 * the worker alive for the page lifetime.
 */
export function shutdownBlobWorker(): void {
  if (workerInstance) {
    workerInstance.terminate();
    workerInstance = null;
    workerProxy = null;
  }
  workerReadyPromise = null;
}

// ---- main-thread fallbacks -----------------------------------------------
// used when Worker isn't available. these mirror the worker's API exactly
// so consumers can share a single code path.

async function fallbackHashBlake3(data: Uint8Array): Promise<string> {
  try {
    const midden = await loadMiddenBlake3();
    return midden && typeof midden.hash_blake3 === "function" ? midden.hash_blake3(data) : "";
  } catch {
    return "";
  }
}

async function fallbackBase64Encode(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

// ---- convenience helpers --------------------------------------------------

/**
 * hash bytes with blake3, preferring the worker. accepts a Uint8Array.
 * note: this DOES copy across the worker boundary (Uint8Array isn't
 * transferable directly without giving up the underlying ArrayBuffer);
 * for upload pipelines, prefer `processBlobBytes` which transfers the
 * underlying buffer.
 */
export async function hashBlake3(data: Uint8Array): Promise<string> {
  const worker = await getBlobWorker();
  if (worker) return worker.hashBlake3(data);
  return fallbackHashBlake3(data);
}

/**
 * sha256 hash of an ArrayBuffer.
 */
export async function hashSha256(data: ArrayBuffer): Promise<string> {
  const worker = await getBlobWorker();
  if (worker) return worker.hashSha256(data);
  return sha256Hex(data);
}

/**
 * base64-encode an ArrayBuffer.
 *
 * NOTE: the buffer is structured-cloned (copied) across the worker
 * boundary so callers can safely reuse it afterwards. if you have a
 * dedicated buffer that won't be touched again, you can transfer
 * ownership manually for a small perf win.
 */
export async function base64Encode(buffer: ArrayBuffer): Promise<string> {
  const worker = await getBlobWorker();
  if (worker) return worker.base64Encode(buffer);
  return fallbackBase64Encode(buffer);
}

/**
 * one-shot upload pipeline: hash + write to OPFS in the worker, return
 * metadata. transfers the buffer.
 */
export async function processBlobBytes(
  buffer: ArrayBuffer,
  filename: string,
  mime: string
): Promise<{
  blob_id: string;
  sha256: string;
  blake3: string;
  size: number;
  mime: string;
  filename: string;
}> {
  const worker = await getBlobWorker();
  if (worker) {
    return worker.processBlobBytes(Comlink.transfer(buffer, [buffer]), filename, mime);
  }
  // main-thread fallback path - rare, mostly for tests.
  const [sha256, blake3] = await Promise.all([sha256Hex(buffer), fallbackHashBlake3(new Uint8Array(buffer))]);
  return {
    blob_id: blake3,
    sha256,
    blake3,
    size: buffer.byteLength,
    mime,
    filename,
  };
}

/**
 * write a blob to OPFS via the worker (uses `FileSystemSyncAccessHandle`
 * for max throughput).
 *
 * NOTE: the buffer is structured-cloned (copied) across the worker
 * boundary so callers can safely reuse it afterwards - important for
 * code paths that read or return the buffer after kicking off an OPFS
 * write (e.g. a snatch/download cache-back-fill). for the upload pipeline
 * use `processBlobBytes` instead, which transfers.
 */
export async function writeBlobToOpfs(blobId: string, buffer: ArrayBuffer): Promise<void> {
  const worker = await getBlobWorker();
  if (worker) {
    await worker.writeBlobToOpfs(blobId, buffer);
    return;
  }
  // no main-thread fallback - opfs writes from main thread don't have a
  // sync access handle path anyway. silently no-op.
}

/**
 * stream a File into OPFS via the worker's chunked upload session:
 * incremental blake3 + incremental sync-access-handle writes, so neither
 * thread ever holds the whole payload. each chunk buffer is transferred
 * (zero-copy) across the worker boundary.
 *
 * `onProgress` reports bytes pushed / file size (0..1) per chunk.
 * `signal` cancels between chunks: the worker session is aborted (temp
 * file cleaned up) and a DOMException AbortError is thrown.
 *
 * returns { blake3, size } - the file lands in OPFS under its blake3
 * content address. throws when streaming isn't available (no worker, no
 * OPFS sync handles, no midden module bundled); callers should fall back
 * to the one-shot processBlobBytes path.
 */
export async function streamFileToOpfs(
  file: File,
  options?: { onProgress?: (fraction: number) => void; signal?: AbortSignal }
): Promise<{ blake3: string; size: number }> {
  const worker = await getBlobWorker();
  if (!worker) throw new Error("streaming upload unavailable: no blob worker");

  const sessionId = await worker.uploadBegin();
  const reader = file.stream().getReader();
  let bytesPushed = 0;
  try {
    for (;;) {
      if (options?.signal?.aborted) {
        throw new DOMException("upload cancelled", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      // chunks are usually freshly-allocated exact buffers, but a view into
      // a larger buffer is legal - slice to exact bytes before transferring
      const exact =
        value.byteOffset === 0 && value.byteLength === value.buffer.byteLength
          ? value.buffer
          : value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      const chunkLen = value.byteLength;
      await worker.uploadPush(sessionId, Comlink.transfer(exact, [exact]));
      bytesPushed += chunkLen;
      if (options?.onProgress && file.size > 0) {
        options.onProgress(Math.min(1, bytesPushed / file.size));
      }
    }
    return await worker.uploadFinish(sessionId);
  } catch (err) {
    await worker.uploadAbort(sessionId).catch(() => {});
    throw err;
  } finally {
    reader.releaseLock();
  }
}

// ---- thumbnail / image resize -------------------------------------------

export interface ResizeImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  cropSquare?: boolean;
  mime?: string;
}

/**
 * resize an image Blob to a (default WebP) data URL.
 * prefers the blob worker (keeps the decode/encode work off the main
 * thread); falls back to a main-thread `OffscreenCanvas` path if the
 * worker isn't available. returns null on failure (non-image input,
 * decode failure, etc.).
 */
export async function resizeImageToWebpDataUrl(
  blob: Blob,
  options?: ResizeImageOptions
): Promise<string | null> {
  const worker = await getBlobWorker();
  if (worker) return worker.resizeImageToWebpDataUrl(blob, options);
  return mainThreadResizeImage(blob, options);
}

/**
 * generate a thumbnail data URL (default 200x200 WebP @ q=0.75) for an
 * image Blob. delegates to the worker.
 */
export async function generateThumbnailDataUrl(blob: Blob, maxSize = 200): Promise<string | null> {
  if (!blob.type.startsWith("image/")) return null;
  return resizeImageToWebpDataUrl(blob, {
    maxWidth: maxSize,
    maxHeight: maxSize,
    quality: 0.75,
  });
}

/**
 * decode a base64 string into a Uint8Array via the worker. for large
 * payloads (megabyte-scale snatch responses) this avoids blocking the
 * main thread on a tight `String.charCodeAt` loop.
 */
export async function base64Decode(b64: string): Promise<Uint8Array> {
  const worker = await getBlobWorker();
  if (worker) return worker.base64Decode(b64);
  // main-thread fallback
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

// ---- main-thread fallbacks -----------------------------------------------

async function mainThreadResizeImage(
  blob: Blob,
  options?: ResizeImageOptions
): Promise<string | null> {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap !== "function") {
    return null;
  }
  const maxWidth = options?.maxWidth ?? 200;
  const maxHeight = options?.maxHeight ?? 200;
  const quality = options?.quality ?? 0.8;
  const cropSquare = options?.cropSquare ?? false;
  const mime = options?.mime ?? "image/webp";

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
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
    const aspect = sw / sh;
    let outW = sw;
    let outH = sh;
    if (outW > maxWidth) {
      outW = maxWidth;
      outH = Math.round(outW / aspect);
    }
    if (outH > maxHeight) {
      outH = maxHeight;
      outW = Math.round(outH * aspect);
    }
    outW = Math.max(1, outW);
    outH = Math.max(1, outH);
    const canvas = new OffscreenCanvas(outW, outH);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, outW, outH);
    const out = await canvas.convertToBlob({ type: mime, quality });
    const buf = await out.arrayBuffer();
    const b64 = await fallbackBase64Encode(buf);
    return `data:${mime};base64,${b64}`;
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
