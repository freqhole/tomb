// CharnelTransport - P2P transport for Tauri apps
//
// uses Tauri IPC commands to make P2P requests via the server's
// app iroh endpoint. no WASM needed.

import type { BlobData, BlobFetchOptions, Transport, TransportResponse } from "./transport.js";
import type { BlobProgressCallback } from "./WasmTransport.js";
import { isTauriRuntime } from "./tauriRuntime.js";
import type { CloseReason, EventFilter, JobEvent, JobStateSnapshot } from "./codegen/schema.js";
import { JobEventsStreamClosed } from "./CharnelLocalTransport.js";

// tauri invoke function type
type InvokeFn = (cmd: string, args?: unknown) => Promise<unknown>;

// webkitgtk (linux) requires HTTP/HTTPS URLs for Cache API keys.
// wrap bare blobIds with a synthetic URL prefix.
function cacheKey(blobId: string): string {
  return `https://blob.local/${blobId}`;
}

/**
 * error thrown by request()/upload methods when a tauri IPC call fails.
 * mirrors sendToRemote.ts's `EnvelopeError` shape so callers can
 * consistently check `.errorType` regardless of which transport produced
 * the failure. `step` distinguishes which part of a two-step upload
 * (local import vs. telling the remote peer to pull) failed.
 */
export class TransportError extends Error {
  readonly errorType?: string;
  readonly step?: "import" | "remote_trigger";
  /**
   * per-step breakdown for a multi-step fallback chain (e.g.
   * `fetchBlob`'s verified-download -> api-request -> on-demand-blake3
   * sequence). populated only by call sites that actually fall through
   * multiple attempts before failing - absent for single-shot failures.
   */
  readonly attempts?: Array<{ step: string; reason: string }>;
  constructor(
    message: string,
    opts?: {
      errorType?: string;
      step?: "import" | "remote_trigger";
      attempts?: Array<{ step: string; reason: string }>;
    },
  ) {
    super(message);
    this.name = "TransportError";
    this.errorType = opts?.errorType;
    this.step = opts?.step;
    this.attempts = opts?.attempts;
  }
}

/**
 * extract a best-effort `error_type` out of a caught tauri IPC
 * rejection. tauri rejections are sometimes a plain string, sometimes an
 * `Error`, and (once the rust side lands the convention - see
 * docs/error-handling-tasks.md track P0-D) sometimes a short
 * machine-parseable prefix like `"file_not_found: could not open file"`,
 * or a JSON-encoded structured error body forwarded from a remote peer's
 * response. this parses either shape, falling back to the raw message
 * when neither is present - never matches on natural-language message
 * text (the prefix regex only matches a single snake_case token
 * immediately before the colon, so an ordinary sentence like "failed to
 * open file: permission denied" is left alone).
 */
// P2P `ApiRequest` messages are read in one shot on the remote peer and
// capped by that peer's configured `federation.max_message_size_mb`
// (10 MB by default - see grimoire/src/config.rs). the base64 fallback
// (used here when a blob-pull upload path isn't available for this
// route, e.g. video uploads today) embeds the whole file directly in
// that message, inflated ~4/3 by base64 plus a small JSON envelope. we
// don't know the actual remote's configured cap, so this is a
// conservative pre-flight check against the documented default with
// headroom for that overhead - it exists purely to fail fast with a
// clear message instead of a raw mid-transfer "stream too long"/generic
// "network error".
const MAX_BASE64_UPLOAD_BYTES = 7 * 1024 * 1024;

function uploadTooLargeError(file: File, path: string): TransportError {
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  const limitMb = (MAX_BASE64_UPLOAD_BYTES / (1024 * 1024)).toFixed(0);
  const kind = path.includes("/video") ? "video uploads" : "uploads of this size";
  return new TransportError(
    `this file is ${mb} MB, too large to upload over this P2P connection (roughly ${limitMb} MB limit) - large ${kind} aren't fully supported over P2P yet`,
    { errorType: "upload_too_large_for_transport" },
  );
}

function extractErrorType(err: unknown): { message: string; errorType?: string } {
  const message = err instanceof Error ? err.message : String(err);
  const trimmed = message.trim();

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      const firstError =
        Array.isArray(parsed.errors) && parsed.errors.length > 0
          ? (parsed.errors[0] as Record<string, unknown>)
          : undefined;
      const errorType =
        (typeof firstError?.error_type === "string" && firstError.error_type) ||
        (typeof parsed.error_type === "string" && parsed.error_type) ||
        undefined;
      if (errorType) {
        const detail =
          (typeof firstError?.detail === "string" && firstError.detail) ||
          (typeof parsed.message === "string" && parsed.message) ||
          message;
        return { message: detail, errorType };
      }
    } catch {
      // not valid json, fall through to prefix-token parsing below
    }
  }

  const prefixMatch = /^([a-z][a-z0-9_]*):\s*(.+)$/s.exec(message);
  if (prefixMatch) {
    return { message: prefixMatch[2], errorType: prefixMatch[1] };
  }

  return { message };
}

/** run `fn`, retagging any thrown error with which upload step failed. */
async function tagStep<T>(step: "import" | "remote_trigger", fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TransportError) {
      throw new TransportError(e.message, { errorType: e.errorType, step });
    }
    const { message, errorType } = extractErrorType(e);
    const stepLabel = step === "import" ? "local import" : "remote trigger";
    throw new TransportError(`${stepLabel} failed: ${message}`, { errorType, step });
  }
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
  return isTauriRuntime();
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
  async request(method: string, path: string, body?: string): Promise<TransportResponse> {
    const inv = await ensureInvoke();

    // intentionally no per-error debug log here: the underlying
    // p2p_api_call command already traces failures on the rust
    // side, and callers (auth-status, health-check, etc.) decide
    // whether to surface the error. logging at this layer fires once
    // per request per failed peer and drowns the console for any
    // peer that's temporarily unreachable.
    try {
      const result = (await inv("p2p_api_call", {
        peerAddr: this.peerAddr,
        method,
        path,
        body: body ?? null,
      })) as { status: number; body: string };

      return result;
    } catch (e) {
      const { message, errorType } = extractErrorType(e);
      throw new TransportError(`p2p request failed: ${message}`, { errorType });
    }
  }

  /**
   * upload via P2P
   *
   * for music/video uploads, uses the iroh-blobs pull model (import bytes ->
   * FsStore -> remote pull) - see uploadByPath() for the filesystem-path variant.
   * for other uploads (images), uses base64 encoding (small enough to be fine).
   */
  async upload(
    path: string,
    formData: FormData,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<TransportResponse> {
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

    // for music/video uploads, import bytes into iroh-blobs store and use the
    // blake3 pull model (same as uploadByPath but from in-memory bytes).
    // this supports Android where file picker returns File objects, not paths.
    // the import is already chunked (see uploadMediaViaBytes), so real
    // per-chunk progress is reported here, same as HttpTransport's XHR path.
    if (path === "/api/upload/music" || path === "/api/upload/video") {
      return this.uploadMediaViaBytes(path, file, onProgress);
    }

    // for non-media uploads (images etc), use base64 (small enough)
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

    // only use iroh-blobs for music/video uploads
    if (path === "/api/upload/music" || path === "/api/upload/video") {
      console.debug("[P2P] uploadByPath: importing blob from", filePath);
      // import file into local FsStore -> get blake3 hash
      const blake3 = await tagStep(
        "import",
        async () => (await inv("p2p_import_blob", { filePath })) as string,
      );
      console.debug("[P2P] uploadByPath: imported blob, blake3 =", blake3);

      const defaultName = path === "/api/upload/video" ? "video" : "music";
      // build request body for the remote peer
      const body: Record<string, unknown> = {
        blake3,
        filename: filePath.split("/").pop() || filePath.split("\\").pop() || defaultName,
        ...metadata,
      };

      // tell the remote peer to pull the blob from us
      return tagStep("remote_trigger", () =>
        this.request("POST", `${path}-by-blake3`, JSON.stringify(body)),
      );
    }

    // for non-media uploads, send path + metadata via api_request
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
    if (file.size > MAX_BASE64_UPLOAD_BYTES) {
      throw uploadTooLargeError(file, path);
    }

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

    // send via api_request — routes through offal dispatch on the remote peer
    return this.request("POST", path, JSON.stringify(body));
  }

  /**
   * upload music or video via in-memory bytes using iroh-blobs pull model
   *
   * streams the File to the local blobs store in bounded chunks via
   * p2p_import_begin / p2p_import_chunk / p2p_import_finish, then tells the
   * remote peer to pull via blake3. chunking is required on Android, where
   * tauri IPC is JSON-only and a single large base64 payload OOMs the
   * webview; it also keeps memory bounded on both sides (the receiver
   * accumulates chunks in a temp file on disk, not in memory).
   *
   * `onProgress`, if given, is called after each chunk finishes uploading
   * with (bytes sent so far, file.size) - this is real, byte-level progress
   * driven by the same chunk loop that does the actual IPC transfer, not an
   * estimate. only covers the local-import phase (client -> local FsStore);
   * the remote peer's own pull afterwards has no progress signal exposed
   * back to this client.
   */
  private async uploadMediaViaBytes(
    path: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<TransportResponse> {
    const inv = await ensureInvoke();

    console.debug("[P2P] uploadMediaViaBytes: streaming file", file.name, file.size, "bytes");

    // ~4MB raw per chunk -> ~5.5MB base64 per IPC call, well within limits.
    const CHUNK_SIZE = 4 * 1024 * 1024;

    const blake3 = await tagStep("import", async () => {
      const uploadId = (await inv("p2p_import_begin")) as string;
      try {
        for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
          const slice = file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size));
          const chunkBytes = new Uint8Array(await slice.arrayBuffer());
          const b64 = bytesToBase64(chunkBytes);
          await inv("p2p_import_chunk", { uploadId, data: b64 });
          onProgress?.(Math.min(offset + chunkBytes.length, file.size), file.size);
        }
      } catch (err) {
        // best-effort cleanup of the partial temp file on the receiver side.
        try {
          await inv("p2p_import_abort", { uploadId });
        } catch {
          // ignore abort failures
        }
        throw err;
      }

      // finalize: import accumulated temp file into the blobs store -> blake3.
      return (await inv("p2p_import_finish", { uploadId })) as string;
    });
    console.debug("[P2P] uploadMediaViaBytes: imported blob, blake3 =", blake3);

    // tell the remote peer to pull the blob from us
    const body = { blake3, filename: file.name };
    return tagStep("remote_trigger", () =>
      this.request("POST", `${path}-by-blake3`, JSON.stringify(body)),
    );
  }

  /**
   * fetch a blob via P2P
   * if blake3 is provided, uses iroh-blobs verified streaming.
   * for blobs without blake3 (images, waveforms, thumbnails), uses api_request
   * to fetch base64-encoded data from the peer's /api/blobs/{id}/data endpoint.
   */
  async fetchBlob(blobId: string, blake3?: string): Promise<BlobData> {
    const inv = await ensureInvoke();
    const tauri = await import("@tauri-apps/api/core");
    const onProgress = new tauri.Channel<{ bytes_downloaded: number }>();
    // per-step failure breakdown, attached to the final thrown error so a
    // bug report/log has the full fallback-chain picture, not just the
    // last step's message (see docs/error-handling-tasks.md track P0-E).
    const attempts: Array<{ step: string; reason: string }> = [];

    if (blake3) {
      // blake3 known — use verified iroh-blobs download. no fallback
      // chain in this branch (no blake3 means we can't retry via
      // api_request/on-demand-blake3 below), but still tag the failure
      // with `attempts` for consistency with the no-blake3 path.
      try {
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
      } catch (e) {
        const { message, errorType } = extractErrorType(e);
        throw new TransportError(`verified download failed for blob ${blobId}: ${message}`, {
          errorType,
          attempts: [
            { step: "verified_download", reason: errorType ? `${errorType}: ${message}` : message },
          ],
        });
      }
    }

    // no blake3 — try api_request to get blob data from database
    // this is the primary path for images (waveforms, thumbnails) stored in the database
    try {
      const result = await this.request("GET", `/api/blobs/${blobId}/data`);
      if (result.status === 200) {
        const parsed = JSON.parse(result.body);
        if (parsed.success && parsed.data?.data) {
          const bytes = base64ToBytes(parsed.data.data);
          const contentType = parsed.data.mime || "application/octet-stream";
          return { data: bytes, contentType };
        }
        attempts.push({
          step: "api_request",
          reason: `unexpected response shape (status ${result.status})`,
        });
      } else {
        attempts.push({ step: "api_request", reason: `http ${result.status}` });
      }
    } catch (e) {
      const { message, errorType } = extractErrorType(e);
      const reason = errorType ? `${errorType}: ${message}` : message;
      attempts.push({ step: "api_request", reason });
      console.warn(
        `[CharnelTransport] api blob data request failed, falling back to verified download: ${reason}`,
      );
    }

    // fallback: ask the peer to compute blake3, then do verified download
    try {
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
    } catch (e) {
      const { message, errorType } = extractErrorType(e);
      attempts.push({
        step: "on_demand_blake3",
        reason: errorType ? `${errorType}: ${message}` : message,
      });
      throw new TransportError(
        `failed to fetch blob ${blobId} after trying all fallback methods: ${message}`,
        { errorType, attempts },
      );
    }
  }

  /**
   * fetch a blob via P2P, reporting download progress.
   *
   * only the verified (blake3) iroh-blobs path can report progress - the
   * rust side streams `bytes_downloaded` over a tauri Channel. without a
   * blake3 there is nothing to subscribe to, so this degrades to a plain
   * `fetchBlob` and a single 100% report at the end.
   *
   * `totalBytes` must be supplied by the caller (blob metadata lookup):
   * the channel only carries a running byte count, not the total.
   */
  async fetchBlobWithProgress(
    blobId: string,
    onProgress: BlobProgressCallback,
    blake3?: string,
    totalBytes?: number,
    mimeType?: string,
  ): Promise<BlobData> {
    const inv = await ensureInvoke();
    const tauri = await import("@tauri-apps/api/core");
    const channel = new tauri.Channel<{ bytes_downloaded: number }>();
    channel.onmessage = (message) => {
      const received = message?.bytes_downloaded ?? 0;
      // a total of 0 keeps the ui on its indeterminate/bouncing state
      // rather than reporting a bogus ratio
      onProgress(received, totalBytes ?? 0);
    };

    // most library blobs have no blake3 on the client (only synced/uploaded
    // ones do). the by-id route makes the peer compute it and then streams
    // the same verified download, so it reports real progress too - without
    // this branch a blake3-less blob only ever reported a single 100% tick
    // at the end, which reads as "no progress bar at all".
    const command = blake3 ? "p2p_fetch_blob_verified" : "p2p_fetch_blob_verified_by_id";
    const args = blake3
      ? { peerAddr: this.peerAddr, blake3Hash: blake3, onProgress: channel }
      : { peerAddr: this.peerAddr, blobId, onProgress: channel };

    try {
      const result = (await inv(command, args)) as {
        data: string;
        content_type: string | null;
        size: number;
      };

      const bytes = base64ToBytes(result.data);
      onProgress(bytes.byteLength, totalBytes || bytes.byteLength);
      return {
        data: bytes,
        contentType: result.content_type ?? mimeType ?? "application/octet-stream",
      };
    } catch (e) {
      const { message, errorType } = extractErrorType(e);
      throw new TransportError(`verified download failed for blob ${blobId}: ${message}`, {
        errorType,
        attempts: [
          { step: "verified_download", reason: errorType ? `${errorType}: ${message}` : message },
        ],
      });
    }
  }

  /**
   * get a URL for a blob - caches in Cache API unless `opts.cache === "skip"`
   * if blake3 provided, uses verified iroh-blobs download
   */
  async getBlobUrl(blobId: string, blake3?: string, opts?: BlobFetchOptions): Promise<string> {
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

    if (opts?.cache !== "skip") {
      // store in Cache API (HTTP URL key for webkitgtk compatibility)
      const response = new Response(blob, {
        headers: { "Content-Type": blobData.contentType },
      });
      await cache.put(cacheKey(blobId), response);
    }

    // create object URL
    const url = URL.createObjectURL(blob);
    urlCache.set(blobId, url);
    return url;
  }

  /**
   * get a URL for a blob, reporting download progress along the way.
   * same caching behaviour as `getBlobUrl` - a cache hit reports 100%
   * immediately so callers can clear their loading state.
   */
  async getBlobUrlWithProgress(
    blobId: string,
    onProgress: BlobProgressCallback,
    blake3?: string,
    totalBytes?: number,
    mimeType?: string,
    opts?: BlobFetchOptions,
  ): Promise<string> {
    const cached = urlCache.get(blobId);
    if (cached) {
      onProgress(1, 1);
      return cached;
    }

    const cache = await caches.open(this.cacheName);
    const cachedResponse = await cache.match(cacheKey(blobId));
    if (cachedResponse) {
      const blob = await cachedResponse.blob();
      const url = URL.createObjectURL(blob);
      urlCache.set(blobId, url);
      onProgress(1, 1);
      return url;
    }

    const blobData = await this.fetchBlobWithProgress(
      blobId,
      onProgress,
      blake3,
      totalBytes,
      mimeType,
    );
    const blob = new Blob([blobData.data.slice().buffer], {
      type: blobData.contentType,
    });

    if (opts?.cache !== "skip") {
      const response = new Response(blob, {
        headers: { "Content-Type": blobData.contentType },
      });
      await cache.put(cacheKey(blobId), response);
    }

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

  // -----------------------------------------------------------------
  // job events (remote path via freqhole-events/1 ALPN)
  //
  // routes through the `jobs_events_snapshot` / `jobs_events_subscribe`
  // tauri commands, passing `targetPeer` so charnel dials the remote
  // peer instead of the in-process broker.
  // -----------------------------------------------------------------

  async snapshotJobEvents(filter?: EventFilter): Promise<JobStateSnapshot[]> {
    const inv = await ensureInvoke();
    const out = (await inv("jobs_events_snapshot", {
      filter: filter ?? null,
      targetPeer: this.peerAddr,
    })) as JobStateSnapshot[];
    return out;
  }

  subscribeJobEvents(filter?: EventFilter, signal?: AbortSignal): AsyncIterable<JobEvent> {
    return charnelRemoteJobEventsIterable(this.peerAddr, filter, signal);
  }
}

// frame shape emitted by the rust-side `JobsEventsFrame` — mirrors
// `CharnelLocalTransport.ts`.
type JobsEventsFrame = { kind: "event"; evt: JobEvent } | { kind: "closed"; reason: CloseReason };

async function* charnelRemoteJobEventsIterable(
  peerAddr: string,
  filter: EventFilter | undefined,
  signal: AbortSignal | undefined,
): AsyncGenerator<JobEvent, void, void> {
  const { invoke: inv, Channel } = await import("@tauri-apps/api/core");

  const queue: JobsEventsFrame[] = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const waitForFrame = () =>
    new Promise<void>((resolve) => {
      wake = () => {
        wake = null;
        resolve();
      };
    });

  const channel = new Channel<JobsEventsFrame>();
  channel.onmessage = (frame: JobsEventsFrame) => {
    queue.push(frame);
    if (frame.kind === "closed") closed = true;
    wake?.();
  };

  let sessionId: string;
  try {
    sessionId = (await inv("jobs_events_subscribe", {
      filter: filter ?? null,
      events: channel,
      targetPeer: peerAddr,
    })) as string;
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }

  const onAbort = () => {
    closed = true;
    inv("jobs_events_unsubscribe", { sessionId }).catch(() => {});
    wake?.();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (true) {
      if (queue.length === 0) {
        if (closed) return;
        if (signal?.aborted) return;
        await waitForFrame();
        continue;
      }
      const frame = queue.shift()!;
      if (frame.kind === "closed") {
        const reasonKind = (frame.reason as { kind: string }).kind ?? "internal";
        if (reasonKind === "client_unsubscribed") return;
        throw new JobEventsStreamClosed(frame.reason);
      }
      yield frame.evt;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (!closed) {
      try {
        await inv("jobs_events_unsubscribe", { sessionId });
      } catch {
        // session may have already been torn down; nothing to do.
      }
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
