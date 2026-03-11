// WASM transport for P2P connections via midden
//
// uses midden's MiddenNode to make API requests to peer nodes.
// blobs are cached in Cache API for audio playback.

import type { Transport, TransportResponse, BlobData } from "./transport.js";

/**
 * interface matching midden's BlobResult WASM class
 */
export interface BlobResultLike {
  data(): Uint8Array;
  size(): number;
  content_type(): string | undefined;
}

/**
 * upload result from midden
 */
export interface UploadResultLike {
  blob_id(): string | undefined;
  job_id(): string | undefined;
  /** full server response body for Zod validation */
  body(): string | undefined;
}

/**
 * interface matching midden's MiddenNode WASM class
 * use this type when you don't want to import midden directly
 */
export interface MiddenNodeLike {
  node_id(): string;
  secret_key(): Uint8Array;
  proxy_request(
    peer_addr: string,
    method: string,
    path: string,
    body?: string | null,
  ): Promise<{ status: number; body: string }>;
  fetch_blob(peer_addr: string, blob_id: string): Promise<BlobResultLike>;
  // optional - only available after midden rebuild with progress support
  fetch_blob_with_progress?(
    peer_addr: string,
    blob_id: string,
    on_progress: (received: number, total: number) => void,
  ): Promise<BlobResultLike>;
  // upload blob to peer - optional, only available after midden rebuild
  upload_blob?(
    peer_addr: string,
    filename: string,
    content_type: string,
    data: Uint8Array,
  ): Promise<UploadResultLike>;
}

/**
 * progress callback for blob fetching
 * @param received - bytes received so far
 * @param total - total bytes expected (0 if unknown)
 */
export type BlobProgressCallback = (received: number, total: number) => void;

// unified cache for all remote blobs (HTTP + P2P) - default if no custom cache name provided
const DEFAULT_CACHE_NAME = "freqhole-blobs-v1";

/**
 * WASM transport - uses midden for P2P connections
 *
 * usage:
 * ```typescript
 * import { MiddenNode } from "midden";
 * import { WasmTransport, createClient } from "freqhole-api-client";
 *
 * const node = await MiddenNode.create();
 * const transport = new WasmTransport(node, peerNodeId);
 * const client = createClient(transport);
 * ```
 */
export class WasmTransport implements Transport {
  private blobUrlCache = new Map<string, string>();
  private readonly cacheName: string;

  constructor(
    private readonly node: MiddenNodeLike,
    private readonly peerAddr: string, // node_id or full endpoint JSON
    cacheName?: string, // optional custom cache name for per-remote caching
  ) {
    this.cacheName = cacheName ?? DEFAULT_CACHE_NAME;
  }

  /**
   * get our local node's ID
   */
  get localNodeId(): string {
    return this.node.node_id();
  }

  /**
   * get the peer address this transport connects to
   */
  get remotePeerAddr(): string {
    return this.peerAddr;
  }

  async request(
    method: string,
    path: string,
    body?: string,
  ): Promise<TransportResponse> {
    const result = await this.node.proxy_request(
      this.peerAddr,
      method,
      path,
      body ?? null,
    );
    return {
      status: result.status,
      body: result.body,
    };
  }

  async upload(_path: string, formData: FormData): Promise<TransportResponse> {
    // check if upload is supported (requires midden rebuild)
    if (!this.node.upload_blob) {
      throw new Error(
        "P2P upload requires midden rebuild with upload_blob support",
      );
    }

    // extract file from form data
    const file = formData.get("file") as File | null;
    if (!file) {
      return {
        status: 400,
        body: JSON.stringify({ error: "no file provided" }),
      };
    }

    // read file data
    const data = new Uint8Array(await file.arrayBuffer());
    const contentType = file.type || "application/octet-stream";

    try {
      const result = await this.node.upload_blob(
        this.peerAddr,
        file.name,
        contentType,
        data,
      );

      // use full server response body if available (for proper Zod validation)
      const serverBody = result.body();
      if (serverBody) {
        return {
          status: 200,
          body: serverBody,
        };
      }

      // fallback to minimal response (shouldn't happen with updated midden)
      return {
        status: 200,
        body: JSON.stringify({
          blob_id: result.blob_id(),
          job_id: result.job_id(),
          message: "upload successful",
        }),
      };
    } catch (e) {
      return {
        status: 500,
        body: JSON.stringify({
          error: e instanceof Error ? e.message : String(e),
        }),
      };
    }
  }

  async fetchBlob(blobId: string): Promise<BlobData> {
    // check Cache API first
    const cache = await caches.open(this.cacheName);
    // use just blobId as key (cache name already partitions by remote)
    const cached = await cache.match(blobId);

    if (cached) {
      const data = new Uint8Array(await cached.arrayBuffer());
      const contentType =
        cached.headers.get("Content-Type") || "application/octet-stream";
      return { data, contentType };
    }

    // fetch from peer
    const result = await this.node.fetch_blob(this.peerAddr, blobId);
    const data = result.data();
    const contentType = result.content_type() ?? "application/octet-stream";

    // cache for future use
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const response = new Response(arrayBuffer, {
      headers: { "Content-Type": contentType },
    });
    await cache.put(blobId, response);

    return { data, contentType };
  }

  /**
   * fetch a blob with progress callback
   * @param blobId - the blob ID to fetch
   * @param onProgress - callback with (received, total) bytes
   * @returns blob data with content type
   */
  async fetchBlobWithProgress(
    blobId: string,
    onProgress: BlobProgressCallback,
  ): Promise<BlobData> {
    // check Cache API first
    const cache = await caches.open(this.cacheName);
    const cached = await cache.match(blobId);

    if (cached) {
      const data = new Uint8Array(await cached.arrayBuffer());
      const contentType =
        cached.headers.get("Content-Type") || "application/octet-stream";
      // report 100% progress for cached blobs
      onProgress(data.length, data.length);
      return { data, contentType };
    }

    // fetch from peer - use progress-enabled method if available
    let result: BlobResultLike;
    if (this.node.fetch_blob_with_progress) {
      result = await this.node.fetch_blob_with_progress(
        this.peerAddr,
        blobId,
        onProgress,
      );
    } else {
      // fallback to non-progress fetch
      result = await this.node.fetch_blob(this.peerAddr, blobId);
    }
    const data = result.data();
    const contentType = result.content_type() ?? "application/octet-stream";

    // cache for future use
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const response = new Response(arrayBuffer, {
      headers: { "Content-Type": contentType },
    });
    await cache.put(blobId, response);

    return { data, contentType };
  }

  async getBlobUrl(blobId: string): Promise<string> {
    // check in-memory cache first
    const cached = this.blobUrlCache.get(blobId);
    if (cached) {
      return cached;
    }

    // fetch and create object URL
    const { data, contentType } = await this.fetchBlob(blobId);
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: contentType });
    const url = URL.createObjectURL(blob);

    this.blobUrlCache.set(blobId, url);
    return url;
  }

  /**
   * get a blob URL with progress callback
   * @param blobId - the blob ID to fetch
   * @param onProgress - callback with (received, total) bytes
   * @returns URL usable in <audio>/<img> src
   */
  async getBlobUrlWithProgress(
    blobId: string,
    onProgress: BlobProgressCallback,
  ): Promise<string> {
    // check in-memory cache first
    const cached = this.blobUrlCache.get(blobId);
    if (cached) {
      // report 100% progress for cached URLs
      onProgress(1, 1);
      return cached;
    }

    // fetch with progress and create object URL
    const { data, contentType } = await this.fetchBlobWithProgress(blobId, onProgress);
    const arrayBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: contentType });
    const url = URL.createObjectURL(blob);

    this.blobUrlCache.set(blobId, url);
    return url;
  }

  /**
   * revoke a blob URL to free memory
   */
  revokeBlobUrl(blobId: string): void {
    const url = this.blobUrlCache.get(blobId);
    if (url) {
      URL.revokeObjectURL(url);
      this.blobUrlCache.delete(blobId);
    }
  }

  /**
   * clear all cached blob URLs
   */
  clearBlobUrls(): void {
    for (const url of this.blobUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobUrlCache.clear();
  }
}
