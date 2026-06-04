// WASM transport for P2P connections via midden
//
// uses midden's MiddenNode to make API requests to peer nodes.
// blobs are cached in Cache API for audio playback.

import type { BlobData, Transport, TransportResponse } from "./transport.js";
import { snapshotJobEventsViaRequest } from "./transport.js";
import type {
  CloseReason,
  EventFilter,
  JobEvent,
  JobStateSnapshot,
} from "./codegen/schema.js";
import { JobEventsStreamClosed } from "./CharnelLocalTransport.js";

/**
 * interface matching midden's BlobResult WASM class
 */
export interface BlobResultLike {
  data(): Uint8Array;
  size(): number;
  content_type(): string | undefined;
}

/**
 * interface matching midden's BiStream WASM class. used for raw
 * bi-directional streams over arbitrary ALPNs (e.g. freqhole-events/1).
 */
export interface BiStreamLike {
  peer_node_id(): string;
  alpn(): string;
  write_line(line: string): Promise<void>;
  read_line(): Promise<string | null>;
  // length-prefixed framing (unused here, but matches the wasm class)
  write_message?(data: Uint8Array): Promise<void>;
  read_message?(): Promise<Uint8Array | null>;
  // raw byte primitives (read_to_end / write_raw_and_finish exist too)
  close(): void;
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
  // download blob and stream chunks via callback - preferred for large files
  // on_chunk receives (chunk: Uint8Array, offset: number)
  // on_progress receives (fraction: number) in [0, 1]
  // returns total bytes streamed
  download_verified_streaming?(
    peer_addr: string,
    blake3_hash: string,
    total_size: number,
    on_chunk: (chunk: Uint8Array, offset: number) => void,
    on_progress: (fraction: number) => void,
  ): Promise<number>;
  download_verified_streaming_with_ensure?(
    peer_addr: string,
    blake3_hash: string,
    total_size: number,
    on_chunk: (chunk: Uint8Array, offset: number) => void,
    on_progress: (fraction: number) => void,
  ): Promise<number>;
  // dispatch a freqhole-admin/1 ALPN command to a peer.
  // returns the grimoire response envelope `{ success, message, data, errors }`.
  // `args` is a json-encoded string (use "null" for commands with no payload).
  proxy_admin?(
    peer_addr: string,
    command: string,
    args: string,
  ): Promise<unknown>;
  // tune into a freqhole radio broadcaster (freqhole-radio/1 ALPN).
  // callbacks:
  //   on_hello(json: string)   — HelloMessage as JSON, fires once on connect
  //   on_meta(json: string)    — MetaMessage as JSON, fires on each track change
  //   on_chunk(seq, isInit, bytes) — fMP4 audio chunk
  // returns a handle whose `.leave()` closes the connection and stops audio.
  tune_radio?(
    peer_addr: string,
    station_id: string | undefined,
    on_hello: (json: string) => void,
    on_meta: (json: string) => void,
    on_chunk: (seq: number, is_init: boolean, bytes: Uint8Array) => void,
  ): Promise<RadioHandleLike>;
  // open a raw bi-directional stream on an arbitrary ALPN. used for
  // job events (freqhole-events/1) and other custom protocols.
  open_bi?(peer_addr: string, alpn: string): Promise<BiStreamLike>;
}

/**
 * handle returned from tune_radio. dropping or calling leave() closes
 * the iroh connection and stops the audio + meta callbacks.
 */
export interface RadioHandleLike {
  leave(): void;
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

// webkitgtk (linux) requires HTTP/HTTPS URLs for Cache API keys.
// wrap bare blobIds with a synthetic URL prefix.
// must match CharnelTransport's cacheKey format for consistency.
function cacheKey(blobId: string): string {
  return `https://blob.local/${blobId}`;
}

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
      const fileBytes = new Uint8Array(await file.arrayBuffer());
      const hash = await this.node.import_blob!(fileBytes);

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

        const response = await this.request(
          "POST",
          "/api/upload/music-by-blake3",
          JSON.stringify(body),
        );
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
    const cached = await cache.match(cacheKey(blobId));

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
          await cache.put(cacheKey(blobId), response);

          return { data, contentType };
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          console.warn(
            `[WasmTransport] verified download failed, falling back: ${errorMessage}`,
          );
          // fall through to proxy fetch
        }
      }
    }

    // no blake3 (or verified download failed) — try proxy_request to get blob data
    // this is the primary path for images (waveforms, thumbnails) stored in the database
    try {
      const result = await this.node.proxy_request(
        this.peerAddr,
        "GET",
        `/api/blobs/${blobId}/data`,
        null,
      );
      if (result.status === 200) {
        const parsed = JSON.parse(result.body);
        if (parsed.success && parsed.data?.data) {
          const data = base64ToBytes(parsed.data.data);
          const contentType = parsed.data.mime || "application/octet-stream";

          // cache for future use with correct content type
          const arrayBuffer = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          ) as ArrayBuffer;
          const response = new Response(arrayBuffer, {
            headers: { "Content-Type": contentType },
          });
          await cache.put(cacheKey(blobId), response);

          return { data, contentType };
        }
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      console.warn(
        `[WasmTransport] proxy blob data request failed, falling back: ${errorMessage}`,
      );
    }

    // fallback: try on-demand blake3 computation + verified download via iroh-blobs
    if (!blake3 && this.node.download_verified_by_id) {
      try {
        const result = await this.node.download_verified_by_id(
          this.peerAddr,
          blobId,
        );
        const data = result[0] as Uint8Array;
        // result[1] is the computed blake3 hash
        const contentType = "application/octet-stream";

        // cache for future use
        const arrayBuffer = data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer;
        const response = new Response(arrayBuffer, {
          headers: { "Content-Type": contentType },
        });
        await cache.put(cacheKey(blobId), response);

        return { data, contentType };
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.warn(
          `[WasmTransport] on-demand verified download failed, falling back: ${errorMessage}`,
        );
        // fall through to legacy fetch_blob
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
        await cache.put(cacheKey(blobId), response);

        return { data, contentType };
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.warn(`[WasmTransport] P2P fetch_blob failed: ${errorMessage}`);
        throw new Error(`P2P fetch_blob failed: ${errorMessage}`);
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
   * @param totalBytes - optional known total size; if provided, used as the
   *   `total` argument to onProgress so the UI can render an accurate 0-100%
   *   progress bar (the underlying iroh-blobs stream does not always report
   *   total size before bytes start flowing)
   * @param mimeType - optional content type. midden's streaming path doesn't
   *   surface the source mime, so callers should pass it when known
   *   (e.g. song.mime_type). defaults to audio/mpeg in the streaming branch
   *   and application/octet-stream in fallback branches.
   * @returns blob data with content type
   */
  async fetchBlobWithProgress(
    blobId: string,
    onProgress: BlobProgressCallback,
    blake3?: string,
    totalBytes?: number,
    mimeType?: string,
  ): Promise<BlobData> {
    // check Cache API first
    const cache = await caches.open(this.cacheName);
    const cached = await cache.match(cacheKey(blobId));

    if (cached) {
      const data = new Uint8Array(await cached.arrayBuffer());
      const contentType =
        cached.headers.get("Content-Type") || "application/octet-stream";
      // report 100% progress for cached blobs
      onProgress(data.length, data.length);
      return { data, contentType };
    }

    // if blake3 is provided, try iroh-blobs verified download
    // prefer streaming path (chunk-by-chunk into a Blob) for large files —
    // it avoids materializing the whole blob in wasm linear memory which
    // fails around 32MB+ with "encode error".
    if (blake3) {
      const streamingFn =
        this.node.download_verified_streaming_with_ensure ??
        this.node.download_verified_streaming;

      if (streamingFn) {
        try {
          const chunks: Uint8Array[] = [];
          let totalReceived = 0;
          await streamingFn.call(
            this.node,
            this.peerAddr,
            blake3,
            totalBytes ?? 0,
            (chunk: Uint8Array, _offset: number) => {
              // chunk is a wasm-owned Uint8Array view — copy to detach
              const owned = new Uint8Array(chunk.length);
              owned.set(chunk);
              chunks.push(owned);
              totalReceived += owned.length;
              // when totalBytes is unknown, drive UI from chunk arrivals
              // (consumer treats received==total as indeterminate)
              if (!totalBytes || totalBytes <= 0) {
                onProgress(totalReceived, totalReceived);
              }
            },
            (fraction: number) => {
              // unified progress: midden reports fraction across both phases
              // (download = 0..0.5, read = 0.5..1.0). use as the source of
              // truth for the UI when totalBytes is known so we get a smooth
              // 0..100% even before chunks start flowing in the read phase.
              if (totalBytes && totalBytes > 0) {
                const received = Math.min(
                  totalBytes,
                  Math.floor(fraction * totalBytes),
                );
                onProgress(received, totalBytes);
              }
            },
          );

          // concat chunks into a single Uint8Array. one allocation
          // sized exactly to totalReceived (vs the previous Blob → arrayBuffer
          // → Uint8Array round-trip which transiently held ~3x the bytes).
          const contentType = mimeType ?? "audio/mpeg";
          const data = new Uint8Array(totalReceived);
          let offset = 0;
          for (const c of chunks) {
            data.set(c, offset);
            offset += c.length;
          }
          chunks.length = 0; // free per-chunk refs early

          // cache for future use
          const cacheArrayBuffer = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          ) as ArrayBuffer;
          const response = new Response(cacheArrayBuffer, {
            headers: { "Content-Type": contentType },
          });
          await cache.put(cacheKey(blobId), response);

          return { data, contentType };
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          console.warn(
            `[WasmTransport] streaming verified download failed, trying non-streaming: ${errorMessage}`,
          );
          // fall through to non-streaming verified path
        }
      }

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
          await cache.put(cacheKey(blobId), response);

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

    // no blake3 (or verified download failed).
    // for audio blobs, prefer verified-by-id before proxy `/data` because
    // `/api/blobs/{id}/data` only works for DB-backed blobs and file-backed
    // media blobs would otherwise fail first, then fall back anyway.
    if (
      !blake3 &&
      this.node.download_verified_by_id &&
      mimeType?.startsWith("audio/")
    ) {
      try {
        const result = await this.node.download_verified_by_id(
          this.peerAddr,
          blobId,
        );
        const data = result[0] as Uint8Array;
        const contentType = mimeType || "application/octet-stream";

        onProgress(data.length, data.length);

        const arrayBuffer = data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer;
        const response = new Response(arrayBuffer, {
          headers: { "Content-Type": contentType },
        });
        await cache.put(cacheKey(blobId), response);

        return { data, contentType };
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.warn(
          `[WasmTransport] audio verified-by-id failed, falling back to proxy: ${errorMessage}`,
        );
      }
    }

    // try proxy_request to get blob data
    let proxyFailureReason: string | null = null;
    try {
      const result = await this.node.proxy_request(
        this.peerAddr,
        "GET",
        `/api/blobs/${blobId}/data`,
        null,
      );
      if (result.status === 200) {
        const parsed = JSON.parse(result.body);
        if (parsed.success && parsed.data?.data) {
          const data = base64ToBytes(parsed.data.data);
          const contentType = parsed.data.mime || "application/octet-stream";

          // report 100% progress
          onProgress(data.length, data.length);

          // cache for future use with correct content type
          const arrayBuffer = data.buffer.slice(
            data.byteOffset,
            data.byteOffset + data.byteLength,
          ) as ArrayBuffer;
          const response = new Response(arrayBuffer, {
            headers: { "Content-Type": contentType },
          });
          await cache.put(cacheKey(blobId), response);

          return { data, contentType };
        }
        proxyFailureReason = `success=false in proxy response body for blob ${blobId}`;
        console.warn(`[WasmTransport] ${proxyFailureReason}`);
      } else {
        proxyFailureReason = `proxy returned status ${result.status} for blob ${blobId}`;
        console.warn(`[WasmTransport] ${proxyFailureReason}`);
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      proxyFailureReason = `proxy request threw: ${errorMessage}`;
      console.warn(
        `[WasmTransport] proxy blob data request failed, falling back: ${errorMessage}`,
      );
    }

    // fallback: try on-demand blake3 computation + verified download via iroh-blobs.
    // this matches fetchBlob() so callers using the progress path (radio
    // timeline playback) do not fail just because the API response omitted
    // blake3 for a song.
    if (!blake3 && this.node.download_verified_by_id) {
      try {
        const result = await this.node.download_verified_by_id(
          this.peerAddr,
          blobId,
        );
        const data = result[0] as Uint8Array;
        const contentType = mimeType || "application/octet-stream";

        onProgress(data.length, data.length);

        const arrayBuffer = data.buffer.slice(
          data.byteOffset,
          data.byteOffset + data.byteLength,
        ) as ArrayBuffer;
        const response = new Response(arrayBuffer, {
          headers: { "Content-Type": contentType },
        });
        await cache.put(cacheKey(blobId), response);

        return { data, contentType };
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.warn(
          `[WasmTransport] on-demand verified download failed: ${errorMessage}`,
        );
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
        await cache.put(cacheKey(blobId), response);

        return { data, contentType };
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        console.warn(`[WasmTransport] P2P fetch_blob failed: ${errorMessage}`);
        throw new Error(`P2P fetch_blob failed: ${errorMessage}`);
      }
    }

    throw new Error(
      `no download method available for blob ${blobId} ` +
        `(blake3=${blake3 ? "yes" : "no"}, ` +
        `proxy=${proxyFailureReason ?? "not attempted"}, ` +
        `legacy_fetch_blob=${this.node.fetch_blob ? "available" : "missing"})`,
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
   * @param totalBytes - optional known total size in bytes
   * @param mimeType - optional content type for the assembled blob
   * @returns URL usable in <audio>/<img> src
   */
  async getBlobUrlWithProgress(
    blobId: string,
    onProgress: BlobProgressCallback,
    blake3?: string,
    totalBytes?: number,
    mimeType?: string,
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
      totalBytes,
      mimeType,
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

  // -----------------------------------------------------------------
  // job events (freqhole-events/1 ALPN over midden bi-stream).
  //
  // snapshot opens a one-shot stream: subscribe, read snapshot, send
  // unsubscribe, close. subscribe opens a long-lived stream that yields
  // each Event frame. ndjson framing matches the rust EventsClientMsg/
  // EventsServerMsg wire format.
  //
  // if midden's `open_bi` is missing (older midden build), both methods
  // fall back to http snapshot / polling so callers don't need to
  // feature-detect.
  // -----------------------------------------------------------------

  async snapshotJobEvents(filter?: EventFilter): Promise<JobStateSnapshot[]> {
    if (!this.node.open_bi) {
      return snapshotJobEventsViaRequest(this, filter);
    }
    const stream = await this.node.open_bi(this.peerAddr, EVENTS_ALPN);
    try {
      const id = 1;
      await stream.write_line(
        JSON.stringify({ type: "subscribe", id, filter: filter ?? {} }),
      );
      // first server frame is always Snapshot for this id
      const snapLine = await stream.read_line();
      if (snapLine === null) {
        throw new Error("snapshotJobEvents: stream closed before snapshot");
      }
      const frame = JSON.parse(snapLine) as EventsServerWire;
      if (frame.type !== "snapshot") {
        if (frame.type === "close") {
          throw new JobEventsStreamClosed(frame.reason);
        }
        throw new Error(`snapshotJobEvents: unexpected frame type ${frame.type}`);
      }
      // best-effort unsubscribe; ignore errors
      try {
        await stream.write_line(JSON.stringify({ type: "unsubscribe", id }));
      } catch {
        /* noop */
      }
      return frame.items;
    } finally {
      try {
        stream.close();
      } catch {
        /* noop */
      }
    }
  }

  subscribeJobEvents(
    filter?: EventFilter,
    signal?: AbortSignal,
  ): AsyncIterable<JobEvent> {
    if (!this.node.open_bi) {
      return wasmFallbackPollingIterable(this, filter, signal);
    }
    return wasmSubscribeJobEventsIterable(
      this.node,
      this.peerAddr,
      filter,
      signal,
    );
  }
}

// fallback when midden lacks open_bi (older build): same polling iterator
// HttpTransport uses, lazily imported to avoid a hard cycle with transport.js.
async function* wasmFallbackPollingIterable(
  transport: Transport,
  filter: EventFilter | undefined,
  signal: AbortSignal | undefined,
): AsyncGenerator<JobEvent, void, void> {
  const { pollingJobEvents } = await import("./transport.js");
  yield* pollingJobEvents(transport, filter, signal);
}

// ---------------------------------------------------------------------
// wire types for the freqhole-events/1 ndjson protocol
// (mirrors grimoire/src/federation/transport/events_protocol.rs)
// ---------------------------------------------------------------------

const EVENTS_ALPN = "freqhole-events/1";

type EventsServerWire =
  | { type: "snapshot"; id: number; items: JobStateSnapshot[] }
  | { type: "event"; id: number; evt: JobEvent }
  | { type: "close"; id: number; reason: CloseReason };

/**
 * async-iterable subscribe over a midden bi-stream. opens once, writes
 * one `subscribe`, reads `snapshot`+events, surfaces `close` as a
 * `JobEventsStreamClosed` error (except for `client_unsubscribed`).
 *
 * the snapshot itself is *not* yielded as an event — consumers that
 * want both should call `snapshotJobEvents()` separately. this matches
 * the contract `pollingJobEvents` / `charnelJobEventsIterable` follow.
 */
async function* wasmSubscribeJobEventsIterable(
  node: MiddenNodeLike,
  peerAddr: string,
  filter: EventFilter | undefined,
  signal: AbortSignal | undefined,
): AsyncGenerator<JobEvent, void, void> {
  if (!node.open_bi) {
    throw new Error("midden node has no open_bi method (rebuild midden)");
  }
  const stream = await node.open_bi(peerAddr, EVENTS_ALPN);
  const id = 1;

  const onAbort = () => {
    // best-effort: write unsubscribe + close. errors are swallowed
    // because the stream may already be torn down.
    stream
      .write_line(JSON.stringify({ type: "unsubscribe", id }))
      .catch(() => {})
      .finally(() => {
        try {
          stream.close();
        } catch {
          /* noop */
        }
      });
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    await stream.write_line(
      JSON.stringify({ type: "subscribe", id, filter: filter ?? {} }),
    );

    while (true) {
      if (signal?.aborted) return;
      const line = await stream.read_line();
      if (line === null) {
        // stream finished without an explicit close frame
        throw new JobEventsStreamClosed({ kind: "internal" } as CloseReason);
      }
      const frame = JSON.parse(line) as EventsServerWire;
      if (frame.type === "snapshot") {
        // server always sends snapshot first; we just skip it here
        continue;
      }
      if (frame.type === "event") {
        yield frame.evt;
        continue;
      }
      if (frame.type === "close") {
        const reasonKind =
          (frame.reason as { kind: string }).kind ?? "internal";
        if (reasonKind === "client_unsubscribed") return;
        throw new JobEventsStreamClosed(frame.reason);
      }
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    try {
      stream.close();
    } catch {
      /* noop */
    }
  }
}
