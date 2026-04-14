// CharnelTransport - P2P transport for Tauri apps
//
// uses Tauri IPC commands to make P2P requests via the server's
// app iroh endpoint. no WASM needed.

import type { BlobData, Transport, TransportResponse } from "./transport.js";

// tauri invoke function type
type InvokeFn = (cmd: string, args?: unknown) => Promise<unknown>;

// webkitgtk (linux) requires HTTP/HTTPS URLs for Cache API keys.
// wrap bare blobIds with a synthetic URL prefix.
function cacheKey(blobId: string): string {
  return `https://blob.local/${blobId}`;
}

// tauri invoke is dynamically imported to avoid bundling in browser builds
let invoke: InvokeFn | null = null;

/**
 * initialize tauri invoke function
 * call this before using CharnelTransport
 */
async function ensureInvoke(): Promise<InvokeFn> {
  if (invoke) return invoke;
  try {
    const tauri = await import("@tauri-apps/api/core");
    invoke = tauri.invoke as InvokeFn;
    return invoke;
  } catch {
    throw new Error("@tauri-apps/api not available - not running in Tauri");
  }
}

/**
 * check if tauri is available
 */
export function isCharnelAvailable(): boolean {
  return typeof window !== "undefined" && "__TAURI__" in window;
}

// default cache name if none provided
const DEFAULT_CACHE_NAME = "freqhole-blobs-v1";

// in-memory url cache for revocation
const urlCache = new Map<string, string>();

/**
 * decode base64 string to Uint8Array
 * handles both standard and URL-safe base64 encoding
 */
function base64ToBytes(base64: string): Uint8Array {
  // convert URL-safe base64 to standard base64
  let standardBase64 = base64.replace(/-/g, "+").replace(/_/g, "/");
  // add padding if needed
  const padLen = (4 - (standardBase64.length % 4)) % 4;
  standardBase64 += "=".repeat(padLen);

  const binaryString = atob(standardBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

/**
 * encode Uint8Array to base64 string
 */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * CharnelTransport - P2P transport using Tauri IPC commands
 * implements Transport interface for use with FreqholeClient
 */
export class CharnelTransport implements Transport {
  private peerAddr: string;
  private nodeId: string | null = null;
  private readonly cacheName: string;

  constructor(peerAddr: string, cacheName?: string) {
    this.peerAddr = peerAddr;
    this.cacheName = cacheName ?? DEFAULT_CACHE_NAME;
  }

  /**
   * initialize transport - must be called before use
   */
  async init(): Promise<void> {
    const inv = await ensureInvoke();

    const available = (await inv("p2p_is_available")) as boolean;
    if (!available) {
      throw new Error("P2P not available - federation endpoint not running");
    }

    this.nodeId = (await inv("p2p_get_node_id")) as string;
  }

  /**
   * get local node_id (returns null if not yet initialized)
   */
  getNodeId(): string | null {
    return this.nodeId;
  }

  /**
   * make an API request via P2P
   */
  async request(
    method: string,
    path: string,
    body?: string,
  ): Promise<TransportResponse> {
    const inv = await ensureInvoke();

    const result = (await inv("p2p_proxy_request", {
      peerAddr: this.peerAddr,
      method,
      path,
      body: body ?? null,
    })) as { status: number; body: string };

    return result;
  }

  /**
   * upload via P2P
   *
   * TODO: implement iroh-blobs pull model for CharnelTransport
   * needs a new Tauri command to import file into local FsStore:
   *   1. invoke("p2p_import_blob", { filePath }) -> blake3 hash
   *   2. proxy_request POST /api/upload/music-by-blake3 { blake3, filename }
   *   3. remote peer pulls blob via iroh-blobs from our endpoint
   * for now, falls back to base64 which routes to /api/upload/music (not in offal, will 404)
   */
  async upload(path: string, formData: FormData): Promise<TransportResponse> {
    // extract file from form data
    const file = formData.get("file") as File | null;
    if (!file) {
      return {
        status: 400,
        body: JSON.stringify({
          success: false,
          message: "no file provided",
          errors: [
            {
              error_type: "bad_request",
              title: "bad request",
              detail: "no file provided",
            },
          ],
        }),
      };
    }

    // read file and encode as base64
    const bytes = new Uint8Array(await file.arrayBuffer());
    const base64 = bytesToBase64(bytes);

    // build JSON body for dispatch
    const body: Record<string, unknown> = {
      data: base64,
      filename: file.name,
    };

    // include associate_with if present
    const associateWithStr = formData.get("associate_with") as string | null;
    if (associateWithStr) {
      try {
        body.associate_with = JSON.parse(associateWithStr);
      } catch {
        // ignore parse errors
      }
    }

    // send via proxy_request — routes through offal dispatch on the remote peer
    return this.request("POST", path, JSON.stringify(body));
  }

  /**
   * fetch a blob via P2P
   * if blake3 is provided, uses iroh-blobs verified streaming
   */
  async fetchBlob(blobId: string, blake3?: string): Promise<BlobData> {
    const inv = await ensureInvoke();
    const tauri = await import("@tauri-apps/api/core");
    const onProgress = new tauri.Channel<{ bytes_downloaded: number }>();

    if (blake3) {
      // blake3 known — use verified iroh-blobs download
      const result = (await inv("p2p_fetch_blob_verified", {
        peerAddr: this.peerAddr,
        blake3Hash: blake3,
        onProgress,
      })) as { data: string; content_type: string | null; size: number };

      const bytes = base64ToBytes(result.data);
      return {
        data: bytes,
        contentType: result.content_type ?? "audio/mpeg",
      };
    }

    // no blake3 provided — ask the peer to compute it, then do verified download
    const result = (await inv("p2p_fetch_blob_verified_by_id", {
      peerAddr: this.peerAddr,
      blobId,
      onProgress,
    })) as {
      data: string;
      content_type: string | null;
      size: number;
      blake3: string;
    };

    const bytes = base64ToBytes(result.data);
    return {
      data: bytes,
      contentType: result.content_type ?? "audio/mpeg",
    };
  }

  /**
   * get a URL for a blob - caches in Cache API
   * if blake3 provided, uses verified iroh-blobs download
   */
  async getBlobUrl(blobId: string, blake3?: string): Promise<string> {
    // check in-memory cache first
    const cached = urlCache.get(blobId);
    if (cached) {
      return cached;
    }

    // check Cache API (use HTTP URL key for webkitgtk compatibility)
    const cache = await caches.open(this.cacheName);
    const cachedResponse = await cache.match(cacheKey(blobId));

    if (cachedResponse) {
      const blob = await cachedResponse.blob();
      const url = URL.createObjectURL(blob);
      urlCache.set(blobId, url);
      return url;
    }

    // fetch via P2P and cache (pass blake3 for verified download)
    const blobData = await this.fetchBlob(blobId, blake3);
    const blob = new Blob([blobData.data.slice().buffer], {
      type: blobData.contentType,
    });

    // store in Cache API (HTTP URL key for webkitgtk compatibility)
    const response = new Response(blob, {
      headers: { "Content-Type": blobData.contentType },
    });
    await cache.put(cacheKey(blobId), response);

    // create object URL
    const url = URL.createObjectURL(blob);
    urlCache.set(blobId, url);
    return url;
  }

  /**
   * revoke a blob URL
   */
  revokeBlobUrl(blobId: string): void {
    const url = urlCache.get(blobId);
    if (url) {
      URL.revokeObjectURL(url);
      urlCache.delete(blobId);
    }
  }

  /**
   * clear all blob URLs
   */
  clearBlobUrls(): void {
    for (const url of urlCache.values()) {
      URL.revokeObjectURL(url);
    }
    urlCache.clear();
  }

  /**
   * fetch server image (public, no auth required)
   * used during "add remote" flow before user is authenticated
   */
  async fetchHelloImage(): Promise<BlobData | null> {
    const inv = await ensureInvoke();

    try {
      const result = (await inv("p2p_fetch_hello_image", {
        peerAddr: this.peerAddr,
      })) as { data: string; content_type: string | null };

      // decode base64 data
      const bytes = base64ToBytes(result.data);

      return {
        data: bytes,
        contentType: result.content_type ?? "image/png",
      };
    } catch (e) {
      console.error("fetchHelloImage failed:", e);
      return null;
    }
  }
}

// transport cache - reuse instances per peer
const transportCache = new Map<string, CharnelTransport>();

/**
 * get or create a CharnelTransport for a peer (async)
 * initializes transport before returning
 */
export async function createCharnelTransport(
  peerAddr: string,
  cacheName?: string,
): Promise<CharnelTransport> {
  // include cacheName in cache key so different remotes get different transports
  const cacheKey = cacheName ? `${peerAddr}:${cacheName}` : peerAddr;
  const existing = transportCache.get(cacheKey);
  if (existing) {
    return existing;
  }

  const transport = new CharnelTransport(peerAddr, cacheName);
  await transport.init();
  transportCache.set(cacheKey, transport);
  return transport;
}

/**
 * get or create a CharnelTransport (alias for createCharnelTransport)
 */
export async function getCharnelTransport(
  peerAddr: string,
  cacheName?: string,
): Promise<CharnelTransport> {
  return createCharnelTransport(peerAddr, cacheName);
}

/**
 * get local node_id from tauri
 */
export async function getCharnelNodeId(): Promise<string> {
  const inv = await ensureInvoke();
  return (await inv("p2p_get_node_id")) as string;
}

/**
 * check if P2P is available in tauri
 */
export async function isCharnelP2PAvailable(): Promise<boolean> {
  try {
    const inv = await ensureInvoke();
    return (await inv("p2p_is_available")) as boolean;
  } catch {
    return false;
  }
}
