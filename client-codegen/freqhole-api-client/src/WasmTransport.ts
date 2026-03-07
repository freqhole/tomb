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
}

// unified cache for all remote blobs (HTTP + P2P)
const CACHE_NAME = "freqhole-blobs-v1";

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

  constructor(
    private readonly node: MiddenNodeLike,
    private readonly peerAddr: string, // node_id or full endpoint JSON
  ) {}

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

  async upload(_path: string, _formData: FormData): Promise<TransportResponse> {
    // P2P upload not supported yet
    // would need to serialize FormData to multipart and send via proxy_request
    throw new Error("uploads not supported over P2P transport");
  }

  async fetchBlob(blobId: string): Promise<BlobData> {
    // check Cache API first
    const cache = await caches.open(CACHE_NAME);
    const cacheKey = `${this.peerAddr}/${blobId}`;
    const cached = await cache.match(cacheKey);

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
    await cache.put(cacheKey, response);

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
