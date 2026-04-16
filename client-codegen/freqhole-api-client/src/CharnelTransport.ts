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

    console.debug(
      "[P2P] init: checking p2p_is_available for peer",
      this.peerAddr,
    );
    const available = (await inv("p2p_is_available")) as boolean;
    console.debug("[P2P] init: p2p_is_available =", available);
    if (!available) {
      throw new Error("P2P not available - federation endpoint not running");
    }

    this.nodeId = (await inv("p2p_get_node_id")) as string;
    console.debug("[P2P] init: got node_id =", this.nodeId);
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

    console.debug("[P2P] p2p_proxy_request ->", {
      peerAddr: this.peerAddr,
      method,
      path,
      bodyLength: body?.length ?? 0,
    });

    try {
      const result = (await inv("p2p_proxy_request", {
        peerAddr: this.peerAddr,
        method,
        path,
        body: body ?? null,
      })) as { status: number; body: string };

      console.debug(
        "[P2P] p2p_proxy_request <- status",
        result.status,
        "for",
        method,
        path,
      );
      return result;
    } catch (err) {
      console.debug(
        "[P2P] p2p_proxy_request ERROR for",
        method,
        path,
        ":",
        err,
      );
      throw err;
    }
  }

  /**
   * upload via P2P
   *
   * for music uploads, returns an error directing callers to use uploadByPath()
   * which uses iroh-blobs pull model (file path -> FsStore import -> remote pull).
   * for non-music uploads (images), uses base64 encoding (small enough to be fine).
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

    // for music uploads, import bytes into iroh-blobs store and use the
    // blake3 pull model (same as uploadByPath but from in-memory bytes).
    // this supports Android where file picker returns File objects, not paths.
    if (path === "/api/upload/music") {
      return this.uploadMusicViaBytes(file);
    }

    // for non-music uploads (images etc), use base64 (small enough)
    return this.uploadViaBase64(path, file, formData);
  }

  /**
   * upload a file by filesystem path via P2P using iroh-blobs pull model
   *
   * 1. imports file into local FsStore (gets blake3 hash)
   * 2. tells remote peer to pull the blob via iroh-blobs
   * 3. remote peer downloads verified, writes to disk, creates import job
   */
  async uploadByPath(
    path: string,
    filePath: string,
    metadata?: Record<string, unknown>,
  ): Promise<TransportResponse> {
    const inv = await ensureInvoke();

    // only use iroh-blobs for music uploads
    if (path === "/api/upload/music") {
      console.debug("[P2P] uploadByPath: importing blob from", filePath);
      // import file into local FsStore -> get blake3 hash
      const blake3 = (await inv("p2p_import_blob", { filePath })) as string;
      console.debug("[P2P] uploadByPath: imported blob, blake3 =", blake3);

      // build request body for the remote peer
      const body: Record<string, unknown> = {
        blake3,
        filename:
          filePath.split("/").pop() || filePath.split("\\").pop() || "music",
        ...metadata,
      };

      // tell the remote peer to pull the blob from us
      return this.request(
        "POST",
        "/api/upload/music-by-blake3",
        JSON.stringify(body),
      );
    }

    // for non-music uploads, send path + metadata via proxy_request
    const body: Record<string, unknown> = {
      file_path: filePath,
      ...metadata,
    };
    return this.request("POST", path, JSON.stringify(body));
  }

  /**
   * fallback upload via base64 encoding
   * used for non-music uploads (images are small enough)
   */
  private async uploadViaBase64(
    path: string,
    file: File,
    formData: FormData,
  ): Promise<TransportResponse> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const base64 = bytesToBase64(bytes);

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
   * upload music via in-memory bytes using iroh-blobs pull model
   *
   * reads the File into bytes, imports into local blobs store via
   * p2p_import_blob_bytes, then tells the remote peer to pull via blake3.
   * used on Android where the file picker gives File objects, not paths.
   */
  private async uploadMusicViaBytes(
    file: File,
  ): Promise<TransportResponse> {
    const inv = await ensureInvoke();

    console.debug("[P2P] uploadMusicViaBytes: reading file bytes for", file.name);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const b64 = bytesToBase64(bytes);

    // import bytes into local iroh-blobs store -> get blake3 hash
    const blake3 = (await inv("p2p_import_blob_bytes", {
      data: b64,
    })) as string;
    console.debug("[P2P] uploadMusicViaBytes: imported blob, blake3 =", blake3);

    // tell the remote peer to pull the blob from us
    const body = { blake3, filename: file.name };
    return this.request(
      "POST",
      "/api/upload/music-by-blake3",
      JSON.stringify(body),
    );
  }

  /**
   * fetch a blob via P2P
   * if blake3 is provided, uses iroh-blobs verified streaming.
   * for blobs without blake3 (images, waveforms, thumbnails), uses proxy_request
   * to fetch base64-encoded data from the peer's /api/blobs/{id}/data endpoint.
   */
  async fetchBlob(blobId: string, blake3?: string): Promise<BlobData> {
    const inv = await ensureInvoke();
    const tauri = await import("@tauri-apps/api/core");
    const onProgress = new tauri.Channel<{ bytes_downloaded: number }>();

    console.debug("[P2P] fetchBlob:", {
      blobId,
      blake3: blake3 ?? "(none)",
      peerAddr: this.peerAddr,
    });

    if (blake3) {
      // blake3 known — use verified iroh-blobs download
      console.debug(
        "[P2P] fetchBlob: using verified iroh-blobs download (blake3 known)",
      );
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

    // no blake3 — try proxy_request to get blob data from database
    // this is the primary path for images (waveforms, thumbnails) stored in the database
    console.debug(
      "[P2P] fetchBlob: no blake3, trying proxy_request for blob data",
    );
    try {
      const result = await this.request("GET", `/api/blobs/${blobId}/data`);
      if (result.status === 200) {
        const parsed = JSON.parse(result.body);
        if (parsed.success && parsed.data?.data) {
          const bytes = base64ToBytes(parsed.data.data);
          const contentType = parsed.data.mime || "application/octet-stream";
          return { data: bytes, contentType };
        }
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.warn(
        `[CharnelTransport] proxy blob data request failed, falling back to verified download: ${errorMessage}`,
      );
    }

    // fallback: ask the peer to compute blake3, then do verified download
    console.debug(
      "[P2P] fetchBlob: falling back to p2p_fetch_blob_verified_by_id for",
      blobId,
    );
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
      contentType: result.content_type ?? "application/octet-stream",
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

    console.debug("[P2P] fetchHelloImage: requesting from peer", this.peerAddr);
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
