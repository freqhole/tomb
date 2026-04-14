// WASM transport for P2P connections via midden
//
// uses midden's MiddenNode to make API requests to peer nodes.
// blobs are cached in Cache API for audio playback.

import type { BlobData, Transport, TransportResponse } from "./transport.js";

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
  // legacy unverified blob fetch - removed from midden, kept for compat
  fetch_blob?(peer_addr: string, blob_id: string): Promise<BlobResultLike>;
  // optional
  fetch_blob_with_progress?(
    peer_addr: string,
    blob_id: string,
    on_progress: (received: number, total: number) => void,
  ): Promise<BlobResultLike>;
  // fetch server image (public, no auth required) - optional
  // returns HelloImageResult (properties: data, content_type) not BlobResultLike (methods)
  fetch_hello_image?(
    peer_addr: string,
  ): Promise<{ data: Uint8Array; content_type: string | undefined }>;
  // import bytes into local iroh-blobs store, returns blake3 hash (64 hex chars)
  // keeps a TempTag so GC won't collect it until release_blob is called
  import_blob?(data: Uint8Array): Promise<string>;
  // release a blob's TempTag, allowing GC
  release_blob?(blake3_hash: string): void;
  // start background accept loop for incoming iroh-blobs connections
  // must be called once for remote peers to pull blobs from this node
  start_blob_server?(): void;
  // download blob with iroh-blobs verified streaming - optional
  download_verified?(
    peer_addr: string,
    blake3_hash: string,
  ): Promise<Uint8Array>;
  // download blob with automatic ensure + retry - optional
  download_verified_with_ensure?(
    peer_addr: string,
    blake3_hash: string,
  ): Promise<Uint8Array>;
  // download blob by ID with on-demand blake3 computation - optional
  // returns [Uint8Array, string] but typed as any[] for wasm-bindgen compatibility
  download_verified_by_id?(peer_addr: string, blob_id: string): Promise<any[]>;
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
    try {
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
    } catch (e) {
      // P2P connection errors - rethrow with message that isNetworkError will catch
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.warn(`[WasmTransport] P2P request failed: ${errorMessage}`);
      throw new Error(`connection failed: ${errorMessage}`);
    }
  }

  async upload(path: string, formData: FormData): Promise<TransportResponse> {
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

    // for music uploads, use iroh-blobs pull model if available
    if (path === "/api/upload/music" && this.node.import_blob) {
      return this.uploadViaIrohBlobs(file, formData);
    }

    // fallback: base64 encode and send via proxy_request (works for image uploads)
    return this.uploadViaBase64(path, file, formData);
  }

  /**
   * upload via iroh-blobs pull model:
   * 1. import file bytes into local iroh-blobs store (returns blake3 hash)
   * 2. tell remote peer the hash via /api/upload/music-by-blake3
   * 3. remote peer pulls the blob from us via iroh-blobs verified streaming
   * 4. release the TempTag so local GC can reclaim the blob
   */
  private async uploadViaIrohBlobs(
    file: File,
    formData: FormData,
  ): Promise<TransportResponse> {
    try {
      console.log(
        "[WasmTransport] importing file into iroh-blobs store...",
        file.name,
        file.size,
      );
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const hash = await this.node.import_blob!(fileBytes);
      console.log("[WasmTransport] blob imported, blake3:", hash);

      try {
        const body: Record<string, unknown> = {
          blake3: hash,
          filename: file.name,
          size: fileBytes.length,
        };

        // include metadata if present (parsed as JSON)
        const metadataStr = formData.get("metadata") as string | null;
        if (metadataStr) {
          try {
            body.metadata = JSON.parse(metadataStr);
          } catch {
            // ignore parse errors
          }
        }

        // include associate_with if present
        const associateWithStr = formData.get("associate_with") as
          | string
          | null;
        if (associateWithStr) {
          try {
            body.associate_with = JSON.parse(associateWithStr);
          } catch {
            // ignore parse errors
          }
        }

        console.log(
          "[WasmTransport] requesting remote pull via /api/upload/music-by-blake3",
        );
        const response = await this.request(
          "POST",
          "/api/upload/music-by-blake3",
          JSON.stringify(body),
        );
        console.log("[WasmTransport] upload response:", response.status);
        return response;
      } finally {
        // release TempTag so local GC can reclaim the blob
        this.node.release_blob?.(hash);
      }
    } catch (error) {
      console.error("[WasmTransport] upload failed:", error);
      throw error;
    }
  }

  /**
   * fallback upload via base64 encoding
   * used for image uploads (which work via offal dispatch) and when
   * iroh-blobs import_blob is not available
   */
  private async uploadViaBase64(
    path: string,
    file: File,
    formData: FormData,
  ): Promise<TransportResponse> {
    if (path === "/api/upload/music") {
      console.warn(
        "[WasmTransport] falling back to base64 upload for music (import_blob not available)",
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce(
        (data, byte) => data + String.fromCharCode(byte),
        "",
      ),
    );

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

  async fetchBlob(blobId: string, blake3?: string): Promise<BlobData> {
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

    // if blake3 is provided, try iroh-blobs verified download
    // prefer download_verified_with_ensure (handles on-demand loading)
    // fall back to download_verified if that's not available
    if (blake3) {
      const downloadFn =
        this.node.download_verified_with_ensure ?? this.node.download_verified;

      if (downloadFn) {
        try {
          const data = await downloadFn.call(this.node, this.peerAddr, blake3);
          const contentType = "audio/mpeg"; // iroh-blobs doesn't track content type, assume audio

          // cache for future use
          const arrayBuffer = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          ) as ArrayBuffer;
          const response = new Response(arrayBuffer, {
            headers: { "Content-Type": contentType },
          });
          await cache.put(blobId, response);

          return { data, contentType };
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          console.warn(
            `[WasmTransport] verified download failed, falling back: ${errorMessage}`,
          );
          // fall through to regular fetch_blob
        }
      }
    } else if (this.node.download_verified_by_id) {
      // no blake3 provided - try on-demand computation + verified download
      try {
        const result = await this.node.download_verified_by_id(
          this.peerAddr,
          blobId,
        );
        const data = result[0] as Uint8Array;
        // result[1] is the computed blake3 hash - could be cached for future verified downloads
        const contentType = "audio/mpeg";

        // cache for future use
        const arrayBuffer = data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer;
        const response = new Response(arrayBuffer, {
          headers: { "Content-Type": contentType },
        });
        await cache.put(blobId, response);

        return { data, contentType };
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.warn(
          `[WasmTransport] on-demand verified download failed, falling back: ${errorMessage}`,
        );
        // fall through to regular fetch_blob
      }
    }

    // fetch from peer using legacy protocol (if available)
    if (this.node.fetch_blob) {
      try {
        const result = await this.node.fetch_blob(this.peerAddr, blobId);
        const data = result.data();
        const contentType = result.content_type() ?? "application/octet-stream";

        // cache for future use
        const arrayBuffer = data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer;
        const response = new Response(arrayBuffer, {
          headers: { "Content-Type": contentType },
        });
        await cache.put(blobId, response);

        return { data, contentType };
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.warn(`[WasmTransport] P2P fetch_blob failed: ${errorMessage}`);
        throw new Error(`connection failed: ${errorMessage}`);
      }
    }

    throw new Error(
      "no download method available for this blob (no blake3 hash and no legacy fetch_blob)",
    );
  }

  /**
   * fetch a blob with progress callback
   * @param blobId - the blob ID to fetch
   * @param onProgress - callback with (received, total) bytes
   * @param blake3 - optional blake3 hash for verified streaming via iroh-blobs
   * @returns blob data with content type
   */
  async fetchBlobWithProgress(
    blobId: string,
    onProgress: BlobProgressCallback,
    blake3?: string,
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

    // if blake3 is provided, try iroh-blobs verified download
    // prefer download_verified_with_ensure (handles on-demand loading)
    // note: download_verified doesn't support progress yet, but we can still use it
    if (blake3) {
      const downloadFn =
        this.node.download_verified_with_ensure ?? this.node.download_verified;

      if (downloadFn) {
        try {
          const data = await downloadFn.call(this.node, this.peerAddr, blake3);
          const contentType = "audio/mpeg";

          // report 100% progress
          onProgress(data.length, data.length);

          // cache for future use
          const arrayBuffer = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          ) as ArrayBuffer;
          const response = new Response(arrayBuffer, {
            headers: { "Content-Type": contentType },
          });
          await cache.put(blobId, response);

          return { data, contentType };
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          console.warn(
            `[WasmTransport] verified download failed, falling back: ${errorMessage}`,
          );
          // fall through to regular fetch_blob
        }
      }
    }

    // fetch from peer using legacy protocol (if available)
    if (this.node.fetch_blob_with_progress || this.node.fetch_blob) {
      try {
        let result: BlobResultLike;
        if (this.node.fetch_blob_with_progress) {
          result = await this.node.fetch_blob_with_progress(
            this.peerAddr,
            blobId,
            onProgress,
          );
        } else {
          // fallback to non-progress fetch
          result = await this.node.fetch_blob!(this.peerAddr, blobId);
        }
        const data = result.data();
        const contentType = result.content_type() ?? "application/octet-stream";

        // cache for future use
        const arrayBuffer = data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer;
        const response = new Response(arrayBuffer, {
          headers: { "Content-Type": contentType },
        });
        await cache.put(blobId, response);

        return { data, contentType };
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.warn(`[WasmTransport] P2P fetch_blob failed: ${errorMessage}`);
        throw new Error(`connection failed: ${errorMessage}`);
      }
    }

    throw new Error(
      "no download method available for this blob (no blake3 hash and no legacy fetch_blob)",
    );
  }

  async getBlobUrl(blobId: string, blake3?: string): Promise<string> {
    // check in-memory cache first
    const cached = this.blobUrlCache.get(blobId);
    if (cached) {
      return cached;
    }

    // fetch and create object URL (pass blake3 for verified download)
    const { data, contentType } = await this.fetchBlob(blobId, blake3);
    const arrayBuffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([arrayBuffer], { type: contentType });
    const url = URL.createObjectURL(blob);

    this.blobUrlCache.set(blobId, url);
    return url;
  }

  /**
   * get a blob URL with progress callback
   * @param blobId - the blob ID to fetch
   * @param onProgress - callback with (received, total) bytes
   * @param blake3 - optional blake3 hash for verified streaming via iroh-blobs
   * @returns URL usable in <audio>/<img> src
   */
  async getBlobUrlWithProgress(
    blobId: string,
    onProgress: BlobProgressCallback,
    blake3?: string,
  ): Promise<string> {
    // check in-memory cache first
    const cached = this.blobUrlCache.get(blobId);
    if (cached) {
      // report 100% progress for cached URLs
      onProgress(1, 1);
      return cached;
    }

    // fetch with progress and create object URL (pass blake3 for verified download)
    const { data, contentType } = await this.fetchBlobWithProgress(
      blobId,
      onProgress,
      blake3,
    );
    const arrayBuffer = data.buffer.slice(
      data.byteOffset,
      data.byteOffset + data.byteLength,
    ) as ArrayBuffer;
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

  /**
   * fetch server image (public, no auth required)
   * used during "add remote" flow before user is authenticated
   * @returns blob data with content type, or null if method not available
   */
  async fetchHelloImage(): Promise<BlobData | null> {
    if (!this.node.fetch_hello_image) {
      console.warn("fetch_hello_image not available - midden rebuild required");
      return null;
    }

    const result = await this.node.fetch_hello_image(this.peerAddr);
    const data = result.data;
    const contentType = result.content_type ?? "image/png";

    return { data, contentType };
  }
}
