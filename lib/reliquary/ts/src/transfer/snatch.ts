// p2p blob download: snatch a blob from a peer, either into memory or
// straight to a user-chosen disk location.
//
// per-peer retry loop tries three strategies in order against each peer:
// bulk verified download with progress, chunk-streamed verified download,
// and an unverified base64 proxy fallback. a strategy is skipped when its
// node method is missing, and falls through to the next when it FAILS
// against that peer - a peer whose backend only accepts an app-level rpc
// alpn makes the verified strategies fail even though the local node has
// the methods, and only the proxy fallback can reach it. a cancelled
// error (see `cancellation.ts`) always rethrows immediately - it is never
// treated as "this strategy/peer failed, try the next one".

import { log } from "../utils/log.js";
import { hashBlake3 } from "../worker/index.js";
import { isCancelledError } from "./cancellation.js";
import type {
  BlobCapableNode,
  DiskSnatchResult,
  SnatchInfo,
  SnatchOptions,
  SnatchResult,
} from "./types.js";

const TAG = "transfer.snatch";

const DEFAULT_TIMEOUT_MS = 10 * 60_000;

/** how long to wait for trailing chunk-callback messages to arrive after
 *  the download rpc's own promise has already resolved (see
 *  `waitForBytesReceived` below). */
const TAIL_CHUNK_WAIT_DEADLINE_MS = 30_000;
const TAIL_CHUNK_POLL_INTERVAL_MS = 25;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("peer download timed out")), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("snatch cancelled", "AbortError");
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** a worker-hosted node's chunk callback fires as its own fire-and-forget
 *  message, on a separate channel from the download rpc's return value -
 *  the rpc promise can resolve while the last few chunk messages are
 *  still in flight. wait until every byte has actually landed before
 *  treating the transfer as complete (this exact race lost the tail of a
 *  large transfer once; the wait is load-bearing, not defensive fluff). */
async function waitForBytesReceived(getReceived: () => number, total: number): Promise<void> {
  const deadline = Date.now() + TAIL_CHUNK_WAIT_DEADLINE_MS;
  while (getReceived() < total && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, TAIL_CHUNK_POLL_INTERVAL_MS));
  }
  if (getReceived() < total) {
    throw new Error(`chunk stream incomplete: received ${getReceived()} of ${total} bytes`);
  }
}

function parseFlatProxyResponse(body: string): { data: string; mime?: string } | null {
  const parsed = JSON.parse(body) as { data?: string; mime?: string };
  if (typeof parsed.data !== "string") return null;
  return { data: parsed.data, mime: parsed.mime };
}

async function base64ProxyFallback(
  node: BlobCapableNode,
  peerAddr: string,
  info: SnatchInfo,
  options: SnatchOptions,
  timeoutMs: number
): Promise<SnatchResult | null> {
  if (!node.proxy_request || !options.proxyPath) return null;

  const path = options.proxyPath(info.id ?? info.blake3);
  const resp = await withTimeout(node.proxy_request(peerAddr, "GET", path, null), timeoutMs);
  if (resp.status !== 200) return null;

  const parse = options.parseProxyResponse ?? parseFlatProxyResponse;
  const parsed = parse(resp.body);
  if (!parsed) return null;

  const bytes = base64ToBytes(parsed.data);
  options.onProgress?.(1);

  // strategies 1/2 get cryptographic verification for free - the
  // transport checks every chunk against the requested hash's bao tree
  // during the download itself. this fallback is a plain base64 json
  // response with zero transfer-level integrity checking, so verify
  // explicitly: a corrupted or malicious response must be rejected, not
  // silently accepted and persisted under the wrong hash.
  const actualHash = await hashBlake3(bytes);
  if (actualHash !== info.blake3) {
    throw new Error(
      `snatch hash mismatch: expected blake3 ${info.blake3.slice(0, 16)}... but downloaded bytes hash to ${actualHash.slice(0, 16)}... (proxy fallback is not cryptographically verified in transit)`
    );
  }

  return { bytes, blake3: info.blake3, mime: parsed.mime ?? info.mime };
}

async function snatchFromPeer(
  node: BlobCapableNode,
  peerAddr: string,
  info: SnatchInfo,
  options: SnatchOptions,
  timeoutMs: number
): Promise<SnatchResult> {
  let lastError: unknown;

  // strategy 1: bulk verified download.
  if (node.download_verified_with_ensure_progress) {
    try {
      const bytes = await withTimeout(
        node.download_verified_with_ensure_progress(
          peerAddr,
          info.blake3,
          info.size,
          options.onProgress ?? (() => {}),
          options.downloadId
        ),
        timeoutMs
      );
      return { bytes, blake3: info.blake3, mime: info.mime };
    } catch (err) {
      // a deliberate pause must not fall through to the other strategies
      if (isCancelledError(err)) throw err;
      lastError = err;
      log.debug(TAG, `strategy 1 (bulk verified) failed against ${peerAddr.slice(0, 16)}...:`, err);
    }
  }

  // strategy 2: chunk-streamed verified download, accumulated in memory.
  if (node.download_verified_streaming_with_ensure) {
    try {
      const chunks: Array<{ offset: number; data: Uint8Array }> = [];
      let bytesReceived = 0;
      const onChunk = (chunk: Uint8Array<ArrayBuffer>, offset: number): void => {
        bytesReceived += chunk.length;
        chunks.push({ offset, data: chunk });
      };

      const total = await withTimeout(
        node.download_verified_streaming_with_ensure(
          peerAddr,
          info.blake3,
          info.size,
          onChunk,
          options.onProgress ?? (() => {}),
          options.downloadId
        ),
        timeoutMs
      );

      await waitForBytesReceived(() => bytesReceived, total);

      const buffer = new Uint8Array(total);
      for (const { offset, data } of chunks) buffer.set(data, offset);
      return { bytes: buffer, blake3: info.blake3, mime: info.mime };
    } catch (err) {
      if (isCancelledError(err)) throw err;
      lastError = err;
      log.debug(
        TAG,
        `strategy 2 (streamed verified) failed against ${peerAddr.slice(0, 16)}...:`,
        err
      );
    }
  }

  // strategy 3: unverified base64 proxy fallback. its own failures
  // (non-200, bad envelope, hash mismatch) count as this peer failing.
  const proxyAttempted = !!(node.proxy_request && options.proxyPath);
  const fallback = await base64ProxyFallback(node, peerAddr, info, options, timeoutMs);
  if (fallback) return fallback;
  if (proxyAttempted && !lastError) {
    lastError = new Error("proxy fallback returned no blob");
  }

  throw lastError ?? new Error("peer has no supported download strategy");
}

/**
 * download a blob's bytes from the first peer (in `peerNodeIds` order)
 * that can serve it. a peer failure (offline, transport error, hash
 * mismatch) tries the next peer; a cancelled error (see `cancellation.ts`)
 * rethrows immediately with no next-peer retry.
 */
export async function snatchBlob(
  node: BlobCapableNode,
  peerNodeIds: string[],
  info: SnatchInfo,
  options: SnatchOptions = {}
): Promise<SnatchResult> {
  if (peerNodeIds.length === 0) {
    throw new Error("no peers available for snatch");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let lastError: unknown;

  for (const peerAddr of peerNodeIds) {
    throwIfAborted(options.signal);
    try {
      const result = await snatchFromPeer(node, peerAddr, info, options, timeoutMs);
      if (result.bytes.length === 0) {
        throw new Error("snatch returned 0 bytes - refusing empty payload");
      }
      return result;
    } catch (err) {
      if (isCancelledError(err)) throw err;
      lastError = err;
      log.warn(TAG, `snatch from peer ${peerAddr.slice(0, 16)}... failed:`, err);
    }
  }

  throw lastError ?? new Error("snatch failed: all peers exhausted");
}

async function streamToWritable(
  node: BlobCapableNode,
  peerAddr: string,
  info: SnatchInfo,
  writable: FileSystemWritableFileStream,
  options: SnatchOptions,
  timeoutMs: number
): Promise<number> {
  // the File System Access API requires ordered, awaited writes; the
  // transport's chunk callback fires synchronously and must not await, so
  // writes are chained here and drained once the transfer settles.
  let writeChain: Promise<void> = Promise.resolve();
  let writeError: unknown = null;
  let bytesReceived = 0;

  const onChunk = (chunk: Uint8Array<ArrayBuffer>, offset: number): void => {
    bytesReceived += chunk.length;
    if (writeError) return; // stop queueing after the first failure
    writeChain = writeChain.then(async () => {
      if (writeError) return;
      try {
        await writable.write({ type: "write", position: offset, data: chunk });
      } catch (err) {
        writeError = err;
      }
    });
  };

  const total = await withTimeout(
    node.download_verified_streaming_with_ensure!(
      peerAddr,
      info.blake3,
      info.size,
      onChunk,
      options.onProgress ?? (() => {}),
      options.downloadId
    ),
    timeoutMs
  );

  await waitForBytesReceived(() => bytesReceived, total);

  await writeChain;
  if (writeError) throw writeError;
  return total;
}

/**
 * download a blob straight to a user-chosen disk location, writing each
 * verified chunk to `writable` at its explicit offset as it streams in
 * (no full payload ever held in memory). falls back to a fully-buffered
 * `snatchBlob` + single write when the node has no streaming strategy.
 *
 * on a mid-stream peer failure, `writable` is truncated back to zero
 * before the next peer is tried, so a retry never appends onto partial
 * data. on a cancelled error, `writable` is left exactly as it is (no
 * truncate, no close) so a resumed snatch can rewrite the same offsets;
 * the caller owns pausing/closing/discarding it in that case.
 */
export async function snatchBlobToDisk(
  node: BlobCapableNode,
  peerNodeIds: string[],
  info: SnatchInfo,
  writable: FileSystemWritableFileStream,
  options: SnatchOptions = {}
): Promise<DiskSnatchResult> {
  if (peerNodeIds.length === 0) {
    throw new Error("no peers available for snatch");
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const canStream = typeof node.download_verified_streaming_with_ensure === "function";
  let lastError: unknown;

  for (const peerAddr of peerNodeIds) {
    throwIfAborted(options.signal);

    if (canStream) {
      try {
        const size = await streamToWritable(node, peerAddr, info, writable, options, timeoutMs);
        if (size === 0) {
          throw new Error("snatch returned 0 bytes - refusing empty payload");
        }
        await writable.close();
        return { size, blake3: info.blake3, mime: info.mime };
      } catch (err) {
        if (isCancelledError(err)) throw err;
        lastError = err;
        log.warn(TAG, `streamed snatch-to-disk from peer ${peerAddr.slice(0, 16)}... failed:`, err);
        await writable.truncate(0);
        continue;
      }
    }

    let result;
    try {
      result = await snatchFromPeer(node, peerAddr, info, options, timeoutMs);
      if (result.bytes.length === 0) {
        throw new Error("snatch returned 0 bytes - refusing empty payload");
      }
    } catch (err) {
      if (isCancelledError(err)) throw err;
      lastError = err;
      log.warn(TAG, `buffered snatch-to-disk from peer ${peerAddr.slice(0, 16)}... failed:`, err);
      continue;
    }

    throwIfAborted(options.signal);

    // write phase: a failure here is a real disk-write error, not a peer
    // problem, so it is surfaced directly - never retried against another
    // peer. `.slice()` copies into a fresh, exactly-sized buffer (not the
    // transport's possibly-oversized/shared backing buffer).
    await writable.write(result.bytes.slice());
    await writable.close();
    return { size: result.bytes.length, blake3: result.blake3, mime: result.mime };
  }

  throw lastError ?? new Error("snatch failed: all peers exhausted");
}

/**
 * pause an in-flight snatch registered under `downloadId`. the transfer
 * stops at the next chunk boundary and its promise rejects with a
 * cancelled error (see `isCancelledError`). the partial stays pinned in
 * the transport's store - resume by calling `snatchBlob`/
 * `snatchBlobToDisk` again with the same `downloadId`/blake3 (only
 * missing ranges transfer). returns false when `node` has no
 * `download_cancel` or the download already settled.
 */
export async function pauseSnatchDownload(
  node: BlobCapableNode,
  downloadId: string
): Promise<boolean> {
  if (!node.download_cancel) return false;
  return (await node.download_cancel(downloadId)) === true;
}

/**
 * pause every in-flight snatch of this blake3 hash, without needing the
 * `downloadId` the original caller registered (e.g. cleaning up after a
 * caller - a deleted widget - that no longer has its own download state).
 * returns false when `node` has no `download_cancel_by_blake3` or nothing
 * was in flight for this hash.
 */
export async function pauseSnatchDownloadByBlake3(
  node: BlobCapableNode,
  blake3Hash: string
): Promise<boolean> {
  if (!node.download_cancel_by_blake3) return false;
  return (await node.download_cancel_by_blake3(blake3Hash)) > 0;
}

/**
 * discard a paused partial: releases the gc pin a paused download left
 * behind so the transport can reclaim it. call when the user cancels for
 * good rather than pausing to resume later. best-effort - failures are
 * logged, not thrown.
 */
export async function discardPausedDownload(
  node: BlobCapableNode,
  blake3Hash: string
): Promise<void> {
  if (!node.unprotect_blob) return;
  try {
    await node.unprotect_blob(blake3Hash);
  } catch (err) {
    log.debug(TAG, "discardPausedDownload failed (non-fatal):", err);
  }
}
