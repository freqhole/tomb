// serve side of p2p blob transfer: import cache + release timer.
//
// answering a peer's blob request means staging the blob's bytes into the
// transport node's own store (so verified-transfer downloads can read it),
// then releasing that stage once nobody has asked for it in a while so
// served memory doesn't grow unboundedly. `BlobServer` is that cache;
// `serveBlobRequest` is a thin resolver-based wrapper over it.

import { log } from "../utils/log.js";
import type { BlobCapableNode } from "./types.js";

const TAG = "transfer.serve";

/** how long an imported blob stays available after its last request,
 *  absent an explicit override. */
export const DEFAULT_RELEASE_AFTER_MS = 10 * 60 * 1000;

export interface BlobServerOptions {
  /** ms an imported blob stays available after its last request. */
  releaseAfterMs?: number;
}

export interface ServedBlobInfo {
  blake3: string;
  size: number;
  mime?: string;
}

interface ServedEntry extends ServedBlobInfo {
  releaseTimer: ReturnType<typeof setTimeout>;
}

/**
 * server-side import cache for peer-served blobs. imports a locally-known
 * blob into the transport node's store on first request, keyed by
 * whatever id the app addresses that blob by (a sha256, a rest-style blob
 * id, ...) - not necessarily the blake3 hash the peer ends up downloading
 * by. every repeat request for the same id resets the release timer
 * rather than re-importing.
 */
export class BlobServer {
  private readonly served = new Map<string, ServedEntry>();

  constructor(
    private readonly node: BlobCapableNode,
    private readonly options: BlobServerOptions = {}
  ) {}

  /** true when `id` is currently tracked (imported and not yet released). */
  has(id: string): boolean {
    return this.served.has(id);
  }

  /** the tracked info for `id`, without resetting its release timer, or
   *  `null` when not currently tracked. */
  peek(id: string): ServedBlobInfo | null {
    const entry = this.served.get(id);
    if (!entry) return null;
    return { blake3: entry.blake3, size: entry.size, mime: entry.mime };
  }

  /** import (on first request) and (always) reset the release timer for
   *  `id`. `resolve` is only called on a cache miss - a repeat request
   *  never re-reads or re-imports the source bytes. */
  async serve(
    id: string,
    resolve: () => Promise<{ bytes: Uint8Array; size: number; mime?: string }>
  ): Promise<ServedBlobInfo> {
    const cached = this.served.get(id);
    if (cached) {
      this.scheduleRelease(id, cached);
      return { blake3: cached.blake3, size: cached.size, mime: cached.mime };
    }

    if (!this.node.import_blob) {
      throw new Error("node does not support import_blob");
    }

    const { bytes, size, mime } = await resolve();
    const blake3 = await this.node.import_blob(bytes);
    const info: ServedBlobInfo = { blake3, size, mime };
    this.scheduleRelease(id, info);
    return info;
  }

  /** reset the release timer for `id` without re-importing. a no-op when
   *  `id` isn't currently tracked. */
  touch(id: string): void {
    const cached = this.served.get(id);
    if (cached) this.scheduleRelease(id, cached);
  }

  /** stop tracking `id` and release it from the node's store immediately,
   *  instead of waiting out the release timer. */
  release(id: string): void {
    const entry = this.served.get(id);
    if (!entry) return;
    clearTimeout(entry.releaseTimer);
    this.served.delete(id);
    this.releaseFromNode(entry.blake3);
  }

  /** number of ids currently tracked (import-cache size). */
  size(): number {
    return this.served.size;
  }

  /** clear every release timer and release every tracked blob from the
   *  node's store - call on shutdown so nothing stays pinned behind it. */
  dispose(): void {
    for (const [id, entry] of this.served) {
      clearTimeout(entry.releaseTimer);
      this.releaseFromNode(entry.blake3);
      this.served.delete(id);
    }
  }

  private scheduleRelease(id: string, info: ServedBlobInfo): void {
    const existing = this.served.get(id);
    if (existing) clearTimeout(existing.releaseTimer);
    const releaseAfterMs = this.options.releaseAfterMs ?? DEFAULT_RELEASE_AFTER_MS;
    const releaseTimer = setTimeout(() => {
      this.served.delete(id);
      this.releaseFromNode(info.blake3);
    }, releaseAfterMs);
    this.served.set(id, { ...info, releaseTimer });
  }

  private releaseFromNode(blake3: string): void {
    try {
      void this.node.release_blob?.(blake3);
    } catch (err) {
      log.debug(TAG, "release_blob failed (non-fatal):", err);
    }
  }
}

/**
 * answer a peer's blob request: resolve the blob's bytes locally (via
 * `resolve`, only called on a cache miss) and stage it into the
 * transport node's store through `server`, returning the blake3 hash +
 * size the peer downloads by. returns `null` when `resolve` reports no
 * such blob.
 */
export async function serveBlobRequest(
  server: BlobServer,
  id: string,
  resolve: (id: string) => Promise<{ bytes: Uint8Array; size: number; mime?: string } | null>
): Promise<ServedBlobInfo | null> {
  const cached = server.peek(id);
  if (cached) {
    server.touch(id);
    return cached;
  }

  const blob = await resolve(id);
  if (!blob) return null;

  return server.serve(id, async () => blob);
}
