// CharnelLocalTransport - local grimoire dispatch via Tauri IPC
//
// bypasses HTTP entirely for local server access in Tauri apps.
// calls grimoire::api::dispatch directly via the api_call IPC command.
// uses Tauri's asset protocol for blob/audio file access (no HTTP streaming).

import type { Transport, TransportResponse, BlobData } from "./transport.js";

// tauri invoke function type
type InvokeFn = (cmd: string, args?: unknown) => Promise<unknown>;

// tauri invoke is dynamically imported to avoid bundling in browser builds
let invoke: InvokeFn | null = null;
let convertFileSrc: ((path: string) => string) | null = null;

// webkitgtk (linux) can't play asset:// URLs in <audio> elements.
// detect once at module level so we can use blob: URLs as a workaround.
const isLinuxWebKit = typeof navigator !== "undefined" && navigator.userAgent.includes("Linux");

// info about the embedded loopback http media server (charnel only).
// fetched once via the `media_server_info` ipc command and cached. used on
// linux to build `<audio src>` urls that bypass asset:// (which webkitgtk
// can't stream into media elements).
interface MediaServerInfo {
  base_url: string;
  api_key: string;
}
let mediaServerInfo: MediaServerInfo | null = null;
let mediaServerInfoFetch: Promise<MediaServerInfo | null> | null = null;
let mediaServerListenerAttached = false;

/** drop the cached media server info so the next call re-queries it. */
function invalidateMediaServerInfo(): void {
  console.info("[CharnelLocalTransport] invalidating media server info cache");
  mediaServerInfo = null;
  mediaServerInfoFetch = null;
}

/** subscribe (once) to tauri config-changed events to invalidate the cache
 * when the user toggles the embedded media server in settings. */
async function ensureMediaServerListener(): Promise<void> {
  if (mediaServerListenerAttached) return;
  mediaServerListenerAttached = true;
  try {
    const { listen } = await import("@tauri-apps/api/event");
    await listen<{ type?: string }>("freqhole:event", (e) => {
      if (e.payload && e.payload.type === "config-changed") {
        invalidateMediaServerInfo();
        // eagerly re-fetch so the next blob url request can be synchronous.
        // logs whether the server is now running or stopped.
        void getMediaServerInfo().then((info) => {
          console.info(
            info
              ? `[CharnelLocalTransport] media server now: ${info.base_url}`
              : "[CharnelLocalTransport] media server now: disabled",
          );
        });
      }
    });
  } catch {
    // not in tauri or event api unavailable — fine, just won't auto-invalidate
    mediaServerListenerAttached = false;
  }
}

async function getMediaServerInfo(): Promise<MediaServerInfo | null> {
  // attach the cache-invalidation listener once (lazy, fire-and-forget)
  void ensureMediaServerListener();
  if (mediaServerInfo) return mediaServerInfo;
  if (mediaServerInfoFetch) return mediaServerInfoFetch;
  mediaServerInfoFetch = (async () => {
    try {
      const inv = await ensureInvoke();
      const info = (await inv("media_server_info", {})) as MediaServerInfo | null;
      if (info && info.base_url && info.api_key) {
        mediaServerInfo = info;
        return info;
      }
      return null;
    } catch {
      return null;
    } finally {
      // allow retry on next call if it returned null (server may not have
      // finished spawning yet on app cold start)
      if (!mediaServerInfo) mediaServerInfoFetch = null;
    }
  })();
  return mediaServerInfoFetch;
}

/** build an http url for a blob via the embedded media server, or null. */
function buildMediaServerBlobUrl(info: MediaServerInfo, blobId: string): string {
  return `${info.base_url}/api/blobs/${blobId}?api_key=${info.api_key}`;
}

/**
 * initialize tauri invoke function
 */
async function ensureInvoke(): Promise<InvokeFn> {
  if (invoke) return invoke;
  try {
    const tauri = await import("@tauri-apps/api/core");
    invoke = tauri.invoke as InvokeFn;
    // also grab convertFileSrc for blob URLs
    convertFileSrc = tauri.convertFileSrc;
    return invoke;
  } catch {
    throw new Error("@tauri-apps/api not available - not running in Tauri");
  }
}

/**
 * response shape from api_call command (matches GrimoireResponse)
 */
interface ApiResponse {
  success: boolean;
  message: string;
  data?: unknown;
  errors?: Array<{ error_type: string; title: string; detail: string }>;
}

/**
 * CharnelLocalTransport - local dispatch via Tauri IPC
 *
 * implements Transport interface for use with FreqholeClient.
 * routes requests through grimoire::api::dispatch via the api_call command.
 * uses Tauri's asset protocol for blob/audio file access.
 */
export class CharnelLocalTransport implements Transport {
  // cache blob paths to avoid repeated IPC calls
  private blobPathCache = new Map<string, { path: string; mime?: string }>();
  // cache object URLs for db-stored blobs (no local path)
  private blobObjectUrlCache = new Map<string, string>();
  // single audio blob URL for linux workaround (revoke-on-replace to avoid memory leak)
  private audioBlobUrl: { blobId: string; url: string } | null = null;

  constructor(_baseUrl: string) {
    // baseUrl no longer needed - all requests go through IPC
    // eagerly fetch the embedded media server info so it's ready before the
    // first <audio src> request (avoids needless asset:// fallback on the
    // very first track played after app start).
    void getMediaServerInfo().then((info) => {
      if (info) {
        console.info(
          `[CharnelLocalTransport] embedded media server ready @ ${info.base_url}`,
        );
      } else {
        console.info(
          `[CharnelLocalTransport] embedded media server not available (using asset://)`,
        );
      }
    });
  }

  /**
   * make an API request via dispatch
   */
  async request(_method: string, path: string, body?: string): Promise<TransportResponse> {
    const inv = await ensureInvoke();

    // parse body string to JSON value (or null for no body)
    let jsonBody: unknown = null;
    if (body) {
      try {
        jsonBody = JSON.parse(body);
      } catch {
        jsonBody = {};
      }
    }

    try {
      // call dispatch via IPC
      const response = (await inv("api_call", {
        path,
        body: jsonBody,
      })) as ApiResponse;

      // check for route_not_found - this is now a real error
      const errorType = response.errors?.[0]?.error_type;
      if (!response.success && errorType === "route_not_found") {
        console.error(`[CharnelLocalTransport] route not found: ${path}`);
        return {
          status: 404,
          body: JSON.stringify(response),
        };
      }

      // return the full GrimoireResponse - same format as HTTP
      // FreqholeClient expects { data: ... } wrapper and extracts .data
      if (response.success) {
        return {
          status: 200,
          body: JSON.stringify(response),
        };
      } else {
        // map error to HTTP-like status
        const status = errorTypeToStatus(errorType ?? "internal_error");
        return {
          status,
          body: JSON.stringify(response),
        };
      }
    } catch (err) {
      // IPC error - treat as network error
      return {
        status: 0,
        body: JSON.stringify({
          error: err instanceof Error ? err.message : "IPC error",
        }),
      };
    }
  }

  /**
   * upload - converts FormData to base64 JSON and calls dispatch
   * 
   * for tauri-local, we use wait_for_completion to block until the job
   * finishes, avoiding the need for polling from the client side.
   */
  async upload(path: string, formData: FormData): Promise<TransportResponse> {
    // extract file and other fields from FormData
    const file = formData.get("file") as File | null;
    if (!file) {
      return {
        status: 400,
        body: JSON.stringify({
          success: false,
          message: "no file provided",
          errors: [{ error_type: "bad_request", title: "bad request", detail: "no file provided" }],
        }),
      };
    }

    // read file as base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), "")
    );

    // build JSON body for dispatch
    const body: Record<string, unknown> = {
      data: base64,
      filename: file.name,
      // tauri-local optimization: wait for job to complete instead of returning job_id
      // this eliminates the need for client-side polling
      wait_for_completion: true,
    };

    // include associate_with if present
    const associationStr = formData.get("associate_with");
    if (associationStr && typeof associationStr === "string") {
      try {
        body.associate_with = JSON.parse(associationStr);
      } catch {
        // ignore parse errors
      }
    }

    // call through normal request path
    return this.request("POST", path, JSON.stringify(body));
  }

  /**
   * upload by filesystem path - skips base64 encoding
   * uses tauri dialog plugin to get paths, passes directly to backend
   */
  async uploadByPath(
    path: string,
    filePath: string,
    metadata?: Record<string, unknown>,
  ): Promise<TransportResponse> {
    const body: Record<string, unknown> = {
      file_path: filePath,
      wait_for_completion: true,
      ...metadata,
    };

    return this.request("POST", path, JSON.stringify(body));
  }

  /**
   * fetch blob - get file path via IPC, convert to asset URL, fetch via browser
   * falls back to /api/blobs/{id}/data for db-stored blobs without local paths
   */
  async fetchBlob(blobId: string, _blake3?: string): Promise<BlobData> {
    await ensureInvoke();

    // check if we have a cached object URL (db-stored blob)
    const cachedObjectUrl = this.blobObjectUrlCache.get(blobId);
    if (cachedObjectUrl) {
      const fetchResponse = await fetch(cachedObjectUrl);
      const arrayBuffer = await fetchResponse.arrayBuffer();
      return {
        data: new Uint8Array(arrayBuffer),
        contentType: fetchResponse.headers.get("content-type") ?? "application/octet-stream",
      };
    }

    // try to get path from cache or IPC
    let pathInfo = this.blobPathCache.get(blobId);
    if (!pathInfo) {
      const response = await this.request("GET", `/api/blobs/${blobId}/path`, undefined);
      if (response.status === 200) {
        const parsed = JSON.parse(response.body);
        if (parsed.data?.path) {
          pathInfo = { path: parsed.data.path, mime: parsed.data.mime };
          this.blobPathCache.set(blobId, pathInfo);
        }
      }
      
      // check for no_local_path error - fall back to /data endpoint
      if (!pathInfo) {
        const parsed = JSON.parse(response.body);
        const isNoLocalPath = parsed.errors?.some((e: { error_type: string }) => e.error_type === "no_local_path");
        if (isNoLocalPath || response.status !== 200) {
          return this.fetchBlobData(blobId);
        }
        throw new Error(`failed to get blob path: ${response.body}`);
      }
    }

    if (!convertFileSrc) {
      throw new Error("convertFileSrc not available");
    }

    // convert to asset URL and fetch via browser
    const assetUrl = convertFileSrc(pathInfo.path);
    const fetchResponse = await fetch(assetUrl);
    const arrayBuffer = await fetchResponse.arrayBuffer();

    return {
      data: new Uint8Array(arrayBuffer),
      contentType: pathInfo.mime ?? "application/octet-stream",
    };
  }

  /**
   * fetch blob data via /api/blobs/{id}/data - for db-stored blobs
   * returns base64-decoded data and creates/caches object URL
   */
  private async fetchBlobData(blobId: string): Promise<BlobData> {
    const response = await this.request("GET", `/api/blobs/${blobId}/data`, undefined);
    if (response.status !== 200) {
      throw new Error(`failed to get blob data: ${response.body}`);
    }
    
    const parsed = JSON.parse(response.body);
    if (!parsed.data?.data) {
      throw new Error(`blob data not found: ${blobId}`);
    }
    
    // decode base64 to Uint8Array
    const binaryString = atob(parsed.data.data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    const mime = parsed.data.mime ?? "application/octet-stream";
    
    // create and cache object URL for future use
    const blob = new Blob([bytes], { type: mime });
    const objectUrl = URL.createObjectURL(blob);
    this.blobObjectUrlCache.set(blobId, objectUrl);
    
    return {
      data: bytes,
      contentType: mime,
    };
  }

  /**
   * get blob URL — preference order:
   * 1. cached object URL (db-stored blobs)
   * 2. embedded loopback http media server (when enabled — works on all
   *    platforms, supports range requests, required for `<audio>` on linux
   *    webkitgtk where asset:// can't stream)
   * 3. tauri asset:// (via `convertFileSrc`) — fast, but no `<audio>` on linux
   * 4. linux fallback: fetch via asset:// and wrap in a blob: object URL
   */
  getBlobUrl(blobId: string, _blake3?: string): string | Promise<string> {
    // check object URL cache first (db-stored blobs)
    const cachedObjectUrl = this.blobObjectUrlCache.get(blobId);
    if (cachedObjectUrl) {
      console.debug(`[CharnelLocalTransport] blob ${blobId}: object-url cache`);
      return cachedObjectUrl;
    }

    // prefer the embedded http media server when it's running (all platforms).
    // toggleable via charnel settings; required on linux/webkitgtk.
    if (mediaServerInfo) {
      const url = buildMediaServerBlobUrl(mediaServerInfo, blobId);
      console.debug(`[CharnelLocalTransport] blob ${blobId}: embedded http server -> ${url}`);
      return url;
    }

    // on linux without the media server, we MUST go async to wrap in a blob:
    // url (asset:// can't stream into <audio> on webkitgtk).
    if (isLinuxWebKit) {
      console.debug(`[CharnelLocalTransport] blob ${blobId}: linux fallback (async)`);
      return this.getBlobUrlAsync(blobId);
    }

    // check path cache (filesystem blobs) — direct asset:// url
    const cached = this.blobPathCache.get(blobId);
    if (cached && convertFileSrc) {
      const url = convertFileSrc(cached.path);
      console.debug(`[CharnelLocalTransport] blob ${blobId}: asset:// (cached) -> ${url}`);
      return url;
    }

    // need to fetch path (or data) first
    console.debug(`[CharnelLocalTransport] blob ${blobId}: async path lookup`);
    return this.getBlobUrlAsync(blobId);
  }

  /**
   * async version of getBlobUrl for uncached blobs
   * tries path first, falls back to /data for db-stored blobs
   */
  private async getBlobUrlAsync(blobId: string): Promise<string> {
    await ensureInvoke(); // ensure convertFileSrc is loaded

    // try the embedded http media server first if not yet cached.
    // works on all platforms when enabled.
    const info = await getMediaServerInfo();
    if (info) {
      const url = buildMediaServerBlobUrl(info, blobId);
      console.debug(`[CharnelLocalTransport] blob ${blobId}: embedded http server (async) -> ${url}`);
      return url;
    }

    const response = await this.request("GET", `/api/blobs/${blobId}/path`, undefined);
    
    if (response.status === 200) {
      const parsed = JSON.parse(response.body);
      if (parsed.data?.path) {
        // cache path for future use
        this.blobPathCache.set(blobId, { path: parsed.data.path, mime: parsed.data.mime });

        if (!convertFileSrc) {
          throw new Error("convertFileSrc not available");
        }

        // on linux without media server: fall back to blob: workaround
        if (isLinuxWebKit) {
          return this.createAudioBlobUrl(blobId, parsed.data.path, parsed.data.mime);
        }

        return convertFileSrc(parsed.data.path);
      }
    }
    
    // check for no_local_path - fall back to /data endpoint
    const parsed = JSON.parse(response.body);
    const isNoLocalPath = parsed.errors?.some((e: { error_type: string }) => e.error_type === "no_local_path");
    
    if (isNoLocalPath) {
      // fetch blob data and create object URL
      await this.fetchBlobData(blobId);
      const objectUrl = this.blobObjectUrlCache.get(blobId);
      if (objectUrl) {
        return objectUrl;
      }
    }
    
    throw new Error(`failed to get blob path: ${response.body}`);
  }

  /**
   * create a blob: object URL by fetching via asset:// protocol.
   * used on linux where webkitgtk can't play asset:// in <audio> elements.
   * only keeps one audio blob URL at a time — revokes the previous one.
   */
  private async createAudioBlobUrl(blobId: string, localPath: string, mime?: string): Promise<string> {
    if (!convertFileSrc) {
      throw new Error("convertFileSrc not available");
    }

    // revoke previous audio blob URL to free memory
    if (this.audioBlobUrl) {
      URL.revokeObjectURL(this.audioBlobUrl.url);
    }

    const assetUrl = convertFileSrc(localPath);
    const resp = await fetch(assetUrl);
    const arrayBuffer = await resp.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: mime ?? "audio/mpeg" });
    const objectUrl = URL.createObjectURL(blob);

    this.audioBlobUrl = { blobId, url: objectUrl };
    return objectUrl;
  }
}

/**
 * map error_type to HTTP status code
 */
function errorTypeToStatus(errorType: string): number {
  switch (errorType) {
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
    case "route_not_found":
      return 404;
    case "bad_request":
      return 400;
    default:
      return 500;
  }
}

/**
 * create a CharnelLocalTransport instance
 * @param baseUrl - ignored (kept for API compatibility)
 */
export function createCharnelLocalTransport(baseUrl: string): CharnelLocalTransport {
  return new CharnelLocalTransport(baseUrl);
}
